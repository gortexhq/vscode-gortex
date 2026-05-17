import * as vscode from 'vscode';
import { TrackedRepo } from '../daemon';

export function registerRepoCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gortex.repos.openInExplorer', async (repo?: TrackedRepo) => {
      if (!repo || !repo.path) return;
      const uri = vscode.Uri.file(repo.path);
      const isAlreadyOpen = (vscode.workspace.workspaceFolders ?? []).some(
        f => f.uri.fsPath === repo.path,
      );
      if (isAlreadyOpen) {
        await vscode.commands.executeCommand('revealInExplorer', uri);
        return;
      }
      const pick = await vscode.window.showQuickPick(
        [
          { label: 'Open in new window',     value: 'new' as const },
          { label: 'Open in current window', value: 'replace' as const },
          { label: 'Add to workspace',       value: 'add' as const },
        ],
        { placeHolder: `Open ${repo.name} (${repo.path})` },
      );
      if (!pick) return;
      switch (pick.value) {
        case 'new':
          await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
          break;
        case 'replace':
          await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
          break;
        case 'add':
          vscode.workspace.updateWorkspaceFolders(
            vscode.workspace.workspaceFolders?.length ?? 0,
            0,
            { uri },
          );
          break;
      }
    }),
  );
}
