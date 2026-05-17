import * as vscode from 'vscode';
import { DaemonStatus, TrackedRepo } from '../daemon';

type Node = WorkspaceNode | RepoNode | InfoNode;

interface WorkspaceNode { kind: 'workspace'; name: string; repos: TrackedRepo[]; }
interface RepoNode      { kind: 'repo'; repo: TrackedRepo; }
interface InfoNode      { kind: 'info'; text: string; }

export class TrackedReposProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private status: DaemonStatus | undefined;

  setStatus(s: DaemonStatus): void {
    this.status = s;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'workspace') {
      const item = new vscode.TreeItem(
        `${node.name} · ${node.repos.length} repo${node.repos.length === 1 ? '' : 's'}`,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon('folder-library');
      item.contextValue = 'gortex.workspace';
      return item;
    }
    if (node.kind === 'repo') {
      const r = node.repo;
      const item = new vscode.TreeItem(r.name, vscode.TreeItemCollapsibleState.None);
      item.description = `${fmt(r.files)} files · ${fmt(r.nodes)} nodes · ${fmt(r.edges)} edges`;
      item.tooltip = new vscode.MarkdownString(
        `**${r.name}**\n\n` +
        `- workspace: \`${r.workspace}\`\n` +
        `- path: \`${r.path}\`\n` +
        `- files: ${r.files}\n- nodes: ${r.nodes}\n- edges: ${r.edges}`,
      );
      item.resourceUri = vscode.Uri.file(r.path);
      item.iconPath = new vscode.ThemeIcon('repo');
      item.contextValue = 'gortex.repo';
      item.command = {
        command: 'gortex.repos.openInExplorer',
        title: 'Open',
        arguments: [r],
      };
      return item;
    }
    const item = new vscode.TreeItem(node.text);
    item.iconPath = new vscode.ThemeIcon('info');
    return item;
  }

  getChildren(node?: Node): Node[] {
    if (!this.status) return [{ kind: 'info', text: 'Loading…' }];
    if (!this.status.running) return [];
    if (node === undefined) {
      const groups = new Map<string, TrackedRepo[]>();
      for (const r of this.status.repos) {
        const key = r.workspace || '(default)';
        const arr = groups.get(key) ?? [];
        arr.push(r);
        groups.set(key, arr);
      }
      return [...groups.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, repos]) => ({ kind: 'workspace', name, repos } satisfies WorkspaceNode));
    }
    if (node.kind === 'workspace') {
      return node.repos
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(repo => ({ kind: 'repo', repo } satisfies RepoNode));
    }
    return [];
  }
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
