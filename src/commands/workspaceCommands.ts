import * as vscode from 'vscode';
import { GortexCli } from '../daemon';
import { StatusBar } from '../statusBar';

export function registerWorkspaceCommands(
  context: vscode.ExtensionContext,
  cli: GortexCli,
  statusBar: StatusBar,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gortex.workspace.track', async () => {
      const folder = await pickWorkspaceFolder();
      if (!folder) return;
      try {
        await cli.track(folder.uri.fsPath);
        await statusBar.refresh();
        vscode.window.showInformationMessage(`Tracking ${folder.name} with Gortex.`);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to track workspace: ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('gortex.workspace.untrack', async () => {
      const folder = await pickWorkspaceFolder();
      if (!folder) return;
      try {
        await cli.untrack(folder.uri.fsPath);
        await statusBar.refresh();
        vscode.window.showInformationMessage(`Untracked ${folder.name}.`);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to untrack workspace: ${(err as Error).message}`);
      }
    }),
  );
}

async function pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    vscode.window.showWarningMessage('Open a folder first.');
    return undefined;
  }
  if (folders.length === 1) return folders[0];
  return vscode.window.showWorkspaceFolderPick();
}
