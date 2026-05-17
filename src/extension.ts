import * as vscode from 'vscode';
import { GortexCli } from './daemon';
import { GortexMcpProvider } from './mcp';
import { McpClient } from './mcpClient';
import { GraphQueries } from './query';
import { RepoIndex } from './repoIndex';
import { StatusBar } from './statusBar';
import { TrackedReposProvider } from './views/trackedRepos';
import { DaemonInfoProvider } from './views/daemonInfo';
import { BlastRadiusWebview } from './views/blastRadiusWebview';
import { registerDaemonCommands } from './commands/daemonCommands';
import { registerWorkspaceCommands } from './commands/workspaceCommands';
import { registerSymbolCommands } from './commands/symbolCommands';
import { registerRepoCommands } from './commands/repoCommands';
import { GortexWorkspaceSymbolProvider } from './providers/workspaceSymbols';
import { GortexCallHierarchyProvider } from './providers/callHierarchy';
import { GortexReferenceProvider, GortexImplementationProvider } from './providers/references';
import { GortexHoverProvider } from './providers/hover';
import { GortexCodeLensProvider } from './providers/codeLens';
import { GortexDiagnostics } from './providers/diagnostics';
import { readConfig } from './config';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Gortex');
  context.subscriptions.push(output);

  const cli = new GortexCli(output);
  const mcpClient = new McpClient(output);
  const queries = new GraphQueries(mcpClient);
  const repos = new RepoIndex();
  context.subscriptions.push(mcpClient);

  const mcpProvider = new GortexMcpProvider();
  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider('gortex', mcpProvider),
  );

  const statusBar = new StatusBar(cli);
  context.subscriptions.push(statusBar);

  const reposProvider = new TrackedReposProvider();
  const daemonProvider = new DaemonInfoProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('gortex.tracked', reposProvider),
    vscode.window.registerTreeDataProvider('gortex.daemon', daemonProvider),
  );

  statusBar.onDidUpdate(status => {
    reposProvider.setStatus(status);
    daemonProvider.setStatus(status);
    repos.update(status);
  });

  const blastRadius = new BlastRadiusWebview(context, repos);

  registerDaemonCommands(context, cli, output, statusBar);
  registerWorkspaceCommands(context, cli, statusBar);
  registerSymbolCommands(context, queries, repos, blastRadius);
  registerRepoCommands(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('gortex.views.refresh', () => statusBar.refresh()),
  );

  // Native providers — these wire Gortex into VS Code's built-in surfaces
  // (Cmd+T, Call Hierarchy view, Shift+F12, etc.) so users get graph results
  // through familiar UI without learning anything new.
  registerNativeProviders(context, queries, repos, mcpClient);

  // Diagnostics from the daemon's push stream (dormant until daemon publishes).
  const diagnostics = new GortexDiagnostics(mcpClient, output);
  context.subscriptions.push(diagnostics);
  void diagnostics.start();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('gortex.statusBar')) {
        statusBar.applyVisibility();
      }
      if (e.affectsConfiguration('gortex.binaryPath')) {
        mcpProvider.refresh();
        statusBar.refresh();
      }
      // Provider toggles require a window reload to take full effect — but
      // we re-register what we can on the fly.
      if (
        e.affectsConfiguration('gortex.references.enabled') ||
        e.affectsConfiguration('gortex.implementations.enabled') ||
        e.affectsConfiguration('gortex.hover.enabled') ||
        e.affectsConfiguration('gortex.codeLens.enabled')
      ) {
        vscode.window.showInformationMessage(
          'Gortex: reload the window for provider settings to take effect.',
          'Reload',
        ).then(pick => {
          if (pick === 'Reload') vscode.commands.executeCommand('workbench.action.reloadWindow');
        });
      }
    }),
  );

  statusBar.start();
  void maybeOfferAutoTrack(cli, statusBar);
}

export function deactivate(): void {
  // Every disposable is registered on the context; nothing else to clean up.
}

/**
 * Native VS Code provider registrations. WorkspaceSymbol + CallHierarchy are
 * always on (they're additive — VS Code merges results from every registered
 * provider). The rest are gated on `gortex.<provider>.enabled` because they
 * shadow built-in behavior some users rely on.
 */
function registerNativeProviders(
  context: vscode.ExtensionContext,
  queries: GraphQueries,
  repos: RepoIndex,
  mcp: McpClient,
): void {
  const cfg = readConfig();
  const selector: vscode.DocumentSelector = { scheme: 'file' };

  context.subscriptions.push(
    vscode.languages.registerWorkspaceSymbolProvider(
      new GortexWorkspaceSymbolProvider(queries, repos),
    ),
    vscode.languages.registerCallHierarchyProvider(
      selector,
      new GortexCallHierarchyProvider(queries, repos),
    ),
  );

  if (cfg.referencesEnabled) {
    context.subscriptions.push(
      vscode.languages.registerReferenceProvider(
        selector,
        new GortexReferenceProvider(queries, repos),
      ),
    );
  }
  if (cfg.implementationsEnabled) {
    context.subscriptions.push(
      vscode.languages.registerImplementationProvider(
        selector,
        new GortexImplementationProvider(queries, repos),
      ),
    );
  }
  if (cfg.hoverEnabled) {
    context.subscriptions.push(
      vscode.languages.registerHoverProvider(selector, new GortexHoverProvider(queries)),
    );
  }
  if (cfg.codeLensEnabled) {
    const lens = new GortexCodeLensProvider(queries, repos, mcp);
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider(selector, lens),
      lens,
    );
  }
}

/**
 * If the user has `autoTrackWorkspace` on and the daemon isn't already tracking
 * the current folder, surface a one-shot prompt. We never auto-track silently —
 * the user always gets to say yes.
 */
async function maybeOfferAutoTrack(cli: GortexCli, statusBar: StatusBar): Promise<void> {
  if (!readConfig().autoTrackWorkspace) return;
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;
  let status;
  try {
    status = await cli.daemonStatus();
  } catch {
    return;
  }
  if (!status.running) return;
  const already = status.repos.some(r => r.path === folder.uri.fsPath);
  if (already) return;
  const pick = await vscode.window.showInformationMessage(
    `Track ${folder.name} with Gortex?`,
    'Track',
    'Not now',
    "Don't ask again",
  );
  if (pick === 'Track') {
    try {
      await cli.track(folder.uri.fsPath);
      await statusBar.refresh();
      vscode.window.showInformationMessage(`Tracking ${folder.name}.`);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to track: ${(err as Error).message}`);
    }
  } else if (pick === "Don't ask again") {
    await vscode.workspace.getConfiguration('gortex').update(
      'autoTrackWorkspace',
      false,
      vscode.ConfigurationTarget.Global,
    );
  }
}
