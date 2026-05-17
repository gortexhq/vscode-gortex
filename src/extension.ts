import * as vscode from 'vscode';
import { GortexCli } from './daemon';
import { GortexMcpProvider } from './mcp';
import { McpClient } from './mcpClient';
import { GraphQueries } from './query';
import { RepoIndex } from './repoIndex';
import { StatusBar } from './statusBar';
import { TrackedReposProvider } from './views/trackedRepos';
import { DaemonInfoProvider } from './views/daemonInfo';
import { registerDaemonCommands } from './commands/daemonCommands';
import { registerWorkspaceCommands } from './commands/workspaceCommands';
import { registerSymbolCommands } from './commands/symbolCommands';
import { registerRepoCommands } from './commands/repoCommands';
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

  registerDaemonCommands(context, cli, output, statusBar);
  registerWorkspaceCommands(context, cli, statusBar);
  registerSymbolCommands(context, queries, repos);
  registerRepoCommands(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('gortex.views.refresh', () => statusBar.refresh()),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('gortex.statusBar')) {
        statusBar.applyVisibility();
      }
      if (e.affectsConfiguration('gortex.binaryPath')) {
        mcpProvider.refresh();
        statusBar.refresh();
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
