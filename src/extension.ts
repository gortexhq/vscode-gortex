import * as vscode from 'vscode';
import { GortexCli } from './daemon';
import { GortexMcpProvider } from './mcp';
import { McpClient } from './mcpClient';
import { GraphQueries } from './query';
import { RepoIndex } from './repoIndex';
import { MetadataCache, AnalyzeCache } from './metadata';
import { ActiveSymbolTracker } from './activeSymbol';
import { StatusBar } from './statusBar';
import { CursorStatusBar } from './cursorStatusBar';
import { TrackedReposProvider } from './views/trackedRepos';
import { DaemonInfoProvider } from './views/daemonInfo';
import { SymbolInsightProvider } from './views/symbolInsight';
import { BlastRadiusWebview } from './views/blastRadiusWebview';
import { OccurrenceDecorations } from './decorations/occurrences';
import { GutterDecorations } from './decorations/gutter';
import { registerDaemonCommands } from './commands/daemonCommands';
import { registerWorkspaceCommands } from './commands/workspaceCommands';
import { registerSymbolCommands } from './commands/symbolCommands';
import { registerRepoCommands } from './commands/repoCommands';
import { GortexWorkspaceSymbolProvider } from './providers/workspaceSymbols';
import { GortexCallHierarchyProvider } from './providers/callHierarchy';
import { GortexReferenceProvider, GortexImplementationProvider } from './providers/references';
import { GortexHoverProvider } from './providers/hover';
import { GortexCodeLensProvider } from './providers/codeLens';
import { GortexInlayHintsProvider } from './providers/inlayHints';
import { GortexFileDecorations } from './providers/fileDecorations';
import { GortexDiagnostics } from './providers/diagnostics';
import { AnalyzeDiagnostics } from './providers/analyzeDiagnostics';
import { readConfig } from './config';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Gortex');
  context.subscriptions.push(output);

  // --- core ---
  const cli = new GortexCli(output);
  const mcpClient = new McpClient(output);
  const queries = new GraphQueries(mcpClient);
  const repos = new RepoIndex();
  const metadata = new MetadataCache(queries, mcpClient);
  const analyze = new AnalyzeCache(queries);
  context.subscriptions.push(mcpClient, metadata, analyze);

  // --- MCP server registration (for Copilot Chat) ---
  const mcpProvider = new GortexMcpProvider();
  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider('gortex', mcpProvider),
  );

  // --- status bar (daemon health) + tree views ---
  const statusBar = new StatusBar(cli);
  const reposProvider = new TrackedReposProvider();
  const daemonProvider = new DaemonInfoProvider();
  context.subscriptions.push(
    statusBar,
    vscode.window.registerTreeDataProvider('gortex.tracked', reposProvider),
    vscode.window.registerTreeDataProvider('gortex.daemon', daemonProvider),
  );
  statusBar.onDidUpdate(status => {
    reposProvider.setStatus(status);
    daemonProvider.setStatus(status);
    repos.update(status);
  });

  // --- cursor-driven surfaces ---
  const activeTracker = new ActiveSymbolTracker(queries, repos);
  context.subscriptions.push(activeTracker);

  const cfg = readConfig();

  if (cfg.symbolInsightEnabled) {
    const insight = new SymbolInsightProvider(activeTracker, queries, repos);
    context.subscriptions.push(
      vscode.window.registerTreeDataProvider('gortex.insight', insight),
    );
  }

  if (cfg.cursorStatusBarEnabled) {
    context.subscriptions.push(new CursorStatusBar(activeTracker, metadata));
  }

  if (cfg.occurrencesEnabled) {
    context.subscriptions.push(new OccurrenceDecorations(activeTracker, queries, repos));
  }

  // --- commands ---
  const blastRadius = new BlastRadiusWebview(context, repos);
  registerDaemonCommands(context, cli, output, statusBar);
  registerWorkspaceCommands(context, cli, statusBar);
  registerSymbolCommands(context, queries, repos, blastRadius);
  registerRepoCommands(context);
  context.subscriptions.push(
    vscode.commands.registerCommand('gortex.views.refresh', () => {
      statusBar.refresh();
      void analyze.refresh();
    }),
    vscode.commands.registerCommand('gortex.analyze.refresh', () => void analyze.refresh()),
  );

  // --- native providers ---
  registerNativeProviders(context, queries, repos, mcpClient, metadata);

  // --- analyze-driven surfaces (need the cache running) ---
  if (cfg.gutterIconsEnabled || cfg.fileDecorationsEnabled || cfg.analyzeDiagnosticsEnabled) {
    analyze.start(cfg.analyzeRefreshMinutes * 60_000);
  }
  if (cfg.gutterIconsEnabled) {
    context.subscriptions.push(new GutterDecorations(analyze, repos, context.extensionPath));
  }
  if (cfg.fileDecorationsEnabled) {
    const fileDecos = new GortexFileDecorations(analyze, repos);
    context.subscriptions.push(
      fileDecos,
      vscode.window.registerFileDecorationProvider(fileDecos),
    );
  }
  if (cfg.analyzeDiagnosticsEnabled) {
    context.subscriptions.push(new AnalyzeDiagnostics(analyze, repos));
  }

  // --- daemon diagnostics (dormant until daemon publishes) ---
  const diagnostics = new GortexDiagnostics(mcpClient, output);
  context.subscriptions.push(diagnostics);
  void diagnostics.start();

  // --- settings reactivity ---
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('gortex.statusBar')) statusBar.applyVisibility();
      if (e.affectsConfiguration('gortex.binaryPath')) {
        mcpProvider.refresh();
        statusBar.refresh();
      }
      if (e.affectsConfiguration('gortex')) {
        const needsReload = [
          'gortex.references.enabled',
          'gortex.implementations.enabled',
          'gortex.hover.enabled',
          'gortex.codeLens.enabled',
          'gortex.inlayHints.enabled',
          'gortex.occurrences.enabled',
          'gortex.gutterIcons.enabled',
          'gortex.fileDecorations.enabled',
          'gortex.cursorStatusBar.enabled',
          'gortex.symbolInsight.enabled',
          'gortex.analyzeDiagnostics.enabled',
        ].some(k => e.affectsConfiguration(k));
        if (needsReload) {
          vscode.window.showInformationMessage(
            'Gortex: reload the window for surface toggles to take effect.',
            'Reload',
          ).then(pick => {
            if (pick === 'Reload') vscode.commands.executeCommand('workbench.action.reloadWindow');
          });
        }
      }
    }),
  );

  statusBar.start();
  void maybeOfferAutoTrack(cli, statusBar);
}

export function deactivate(): void {
  // Disposables are owned by the context; nothing else to do.
}

function registerNativeProviders(
  context: vscode.ExtensionContext,
  queries: GraphQueries,
  repos: RepoIndex,
  mcp: McpClient,
  metadata: MetadataCache,
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
  if (cfg.inlayHintsEnabled) {
    context.subscriptions.push(
      vscode.languages.registerInlayHintsProvider(
        selector,
        new GortexInlayHintsProvider(queries, metadata, repos),
      ),
    );
  }
}

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
