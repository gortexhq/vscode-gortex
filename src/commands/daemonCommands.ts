import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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
    vscode.commands.registerCommand('gortex.daemon.rebuildIndex', async () => {
      // Escape hatch for the "stale snapshot" class of bug: stop daemon →
      // delete the cached snapshot → restart so the daemon does a full
      // re-extract + re-resolve. Use when the Symbol Insight panel or
      // inlay hints show zero callers for symbols that obviously have
      // callers in source — that's the classic signature of a snapshot
      // holding misresolved edges from an earlier daemon build.
      const confirm = await vscode.window.showWarningMessage(
        'Rebuild Gortex index from scratch? Daemon will stop, the snapshot will be deleted, and a full re-index will run (~2 minutes for a large workspace).',
        { modal: true },
        'Rebuild',
      );
      if (confirm !== 'Rebuild') return;

      output.show(true);
      output.appendLine('--- Rebuild index ---');
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Gortex: rebuilding index', cancellable: false },
        async progress => {
          try {
            progress.report({ message: 'stopping daemon…' });
            try { await cli.run(['daemon', 'stop']); } catch { /* maybe wasn't running */ }

            progress.report({ message: 'deleting snapshot cache…' });
            const snapshot = path.join(os.homedir(), '.cache', 'gortex', 'daemon.gob.gz');
            try { fs.unlinkSync(snapshot); output.appendLine(`removed ${snapshot}`); }
            catch (err) {
              if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                output.appendLine(`could not remove snapshot: ${(err as Error).message}`);
              }
            }

            progress.report({ message: 'starting daemon (full re-index)…' });
            // Use awaited `run` instead of fire-and-forget `spawnDetached`:
            // `gortex daemon start --detach` exits once it has forked the
            // background daemon, so we get a clear success/failure signal
            // before we start polling. The previous fire-and-forget path
            // could race with the snapshot wipe and silently fail to start
            // the daemon — leaving the user with no daemon at all.
            try {
              await cli.run(['daemon', 'start', '--detach']);
            } catch (err) {
              throw new Error(`daemon start failed: ${(err as Error).message}`);
            }

            // Poll until daemon hits 'ready'. The re-index is the expensive
            // part — we report progress so the user knows we're not stuck.
            const start = Date.now();
            const ceilingMs = 10 * 60_000;
            let sawAlive = false;
            while (Date.now() - start < ceilingMs) {
              await delay(2_000);
              try {
                const s = await cli.daemonStatus();
                if (s.running) sawAlive = true;
                if (s.running && s.state && /^ready\b/i.test(s.state)) break;
                if (s.state) progress.report({ message: `${s.state}…` });
              } catch { /* daemon not up yet */ }
            }
            if (!sawAlive) {
              throw new Error('daemon never became reachable — check `View → Output → Gortex` and `gortex daemon logs`');
            }
            await statusBar.refresh();
            vscode.window.showInformationMessage('Gortex: index rebuilt.');
          } catch (err) {
            vscode.window.showErrorMessage(`Rebuild failed: ${(err as Error).message}`);
          }
        },
      );
    }),
  );
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shellQuote(s: string): string {
  return /[\s"']/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}
