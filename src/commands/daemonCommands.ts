import * as vscode from 'vscode';
import { GortexCli } from '../daemon';
import { StatusBar } from '../statusBar';

export function registerDaemonCommands(
  context: vscode.ExtensionContext,
  cli: GortexCli,
  output: vscode.OutputChannel,
  statusBar: StatusBar,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gortex.daemon.start', async () => {
      output.show(true);
      try {
        cli.spawnDetached(['daemon', 'start', '--detach']);
        await delay(750);
        await statusBar.refresh();
        vscode.window.showInformationMessage('Gortex daemon starting…');
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to start daemon: ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('gortex.daemon.stop', async () => {
      try {
        await cli.run(['daemon', 'stop']);
        await statusBar.refresh();
        vscode.window.showInformationMessage('Gortex daemon stopped.');
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to stop daemon: ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('gortex.daemon.restart', async () => {
      try {
        await cli.run(['daemon', 'restart']);
        await statusBar.refresh();
        vscode.window.showInformationMessage('Gortex daemon restarted.');
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to restart daemon: ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('gortex.daemon.showStatus', async () => {
      output.show(true);
      try {
        await cli.run(['daemon', 'status']);
      } catch (err) {
        output.appendLine(String((err as Error).message));
      }
    }),
    vscode.commands.registerCommand('gortex.daemon.showLogs', () => {
      output.show(true);
      const terminal = vscode.window.createTerminal({ name: 'Gortex Logs' });
      terminal.sendText(`${shellQuote(cli.binary())} daemon logs`);
      terminal.show();
    }),
  );
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shellQuote(s: string): string {
  return /[\s"']/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}
