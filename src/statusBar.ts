import * as vscode from 'vscode';
import { GortexCli, DaemonStatus } from './daemon';
import { readConfig } from './config';

export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private timer: NodeJS.Timeout | undefined;
  private readonly _onDidUpdate = new vscode.EventEmitter<DaemonStatus>();
  /** Fires after every refresh so tree views can stay in sync. */
  readonly onDidUpdate = this._onDidUpdate.event;

  constructor(private readonly cli: GortexCli) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'gortex.daemon.showStatus';
    this.applyVisibility();
  }

  start(): void {
    this.refresh();
    const sec = Math.max(3, readConfig().statusBarRefreshSec);
    this.timer = setInterval(() => this.refresh(), sec * 1000);
  }

  applyVisibility(): void {
    if (readConfig().statusBarEnabled) {
      this.item.show();
    } else {
      this.item.hide();
    }
  }

  async refresh(): Promise<void> {
    try {
      const s = await this.cli.daemonStatus();
      this.render(s);
      this._onDidUpdate.fire(s);
    } catch (err) {
      this.item.text = '$(error) Gortex';
      this.item.tooltip = `Gortex error: ${(err as Error).message}`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }
  }

  private render(s: DaemonStatus): void {
    if (!s.running) {
      this.item.text = '$(circle-slash) Gortex';
      this.item.tooltip = 'Gortex daemon is not running — click to start';
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      return;
    }
    const totalNodes = s.workspaces?.reduce((acc, w) => acc + w.nodes, 0) ?? 0;
    const repoCount = s.repos.length;
    const warming = s.state && /warmup|warming/i.test(s.state);
    const icon = warming ? '$(sync~spin)' : '$(pulse)';
    this.item.text = `${icon} Gortex · ${repoCount} repos · ${formatCount(totalNodes)} nodes`;
    this.item.tooltip = buildTooltip(s);
    this.item.backgroundColor = undefined;
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.item.dispose();
    this._onDidUpdate.dispose();
  }
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function buildTooltip(s: DaemonStatus): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  md.appendMarkdown(`**Gortex daemon** \`${s.version ?? ''}\`\n\n`);
  md.appendMarkdown(`- pid: \`${s.pid ?? '?'}\`\n`);
  md.appendMarkdown(`- uptime: ${s.uptime ?? '?'}\n`);
  md.appendMarkdown(`- state: ${s.state ?? '?'}\n`);
  md.appendMarkdown(`- sessions: ${s.sessions ?? 0}\n`);
  md.appendMarkdown(`- memory: ${s.memory ?? '?'}\n`);
  md.appendMarkdown(`- tracked repos: **${s.repos.length}**\n\n`);
  md.appendMarkdown(`[Show status](command:gortex.daemon.showStatus) · [Logs](command:gortex.daemon.showLogs) · [Restart](command:gortex.daemon.restart)`);
  return md;
}
