import * as vscode from 'vscode';
import { DaemonStatus } from '../daemon';

interface InfoNode { label: string; value: string; icon: string; }

export class DaemonInfoProvider implements vscode.TreeDataProvider<InfoNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<InfoNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private status: DaemonStatus | undefined;

  setStatus(s: DaemonStatus): void {
    this.status = s;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(node: InfoNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label);
    item.description = node.value;
    item.iconPath = new vscode.ThemeIcon(node.icon);
    return item;
  }

  getChildren(node?: InfoNode): InfoNode[] {
    if (node !== undefined) return [];
    const s = this.status;
    if (!s) return [{ label: 'Loading…', value: '', icon: 'sync~spin' }];
    if (!s.running) {
      return [{ label: 'Status', value: 'not running', icon: 'circle-slash' }];
    }
    const totalNodes = s.workspaces?.reduce((acc, w) => acc + w.nodes, 0) ?? 0;
    const totalEdges = s.workspaces?.reduce((acc, w) => acc + w.edges, 0) ?? 0;
    return [
      { label: 'Version',       value: s.version ?? '?',   icon: 'tag' },
      { label: 'PID',           value: String(s.pid ?? '?'), icon: 'pulse' },
      { label: 'Uptime',        value: s.uptime ?? '?',    icon: 'clock' },
      { label: 'State',         value: s.state ?? '?',     icon: 'check' },
      { label: 'Sessions',      value: String(s.sessions ?? 0), icon: 'plug' },
      { label: 'Memory',        value: s.memory ?? '?',    icon: 'database' },
      { label: 'Tracked repos', value: String(s.repos.length), icon: 'repo' },
      { label: 'Graph nodes',   value: fmt(totalNodes),    icon: 'circle-large-filled' },
      { label: 'Graph edges',   value: fmt(totalEdges),    icon: 'git-compare' },
      { label: 'Socket',        value: s.socket ?? '?',    icon: 'plug' },
    ];
  }
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
