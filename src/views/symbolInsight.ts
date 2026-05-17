import * as vscode from 'vscode';
import { ActiveSymbolTracker, ActiveSymbol } from '../activeSymbol';
import { GraphQueries, GraphNode } from '../query';
import { RepoIndex } from '../repoIndex';

type Section = 'callers' | 'usages' | 'dependents' | 'implementations';
type Node = SectionNode | EntryNode | InfoNode;

interface SectionNode { kind: 'section'; section: Section; nodes: GraphNode[]; }
interface EntryNode   { kind: 'entry'; node: GraphNode; }
interface InfoNode    { kind: 'info'; text: string; icon?: string; }

/**
 * Third tree view in the Gortex activity bar — updates with the cursor.
 * Always shows what the user is looking at: callers, cross-file usages,
 * blast radius, implementations. No commands, no chords — just look at the
 * panel after moving the cursor and the answer is there.
 */
export class SymbolInsightProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private current: ActiveSymbol | undefined;
  private loading = false;
  private sections: Record<Section, GraphNode[]> = {
    callers: [], usages: [], dependents: [], implementations: [],
  };
  private resolveToken = 0;

  constructor(
    private readonly tracker: ActiveSymbolTracker,
    private readonly queries: GraphQueries,
    private readonly repos: RepoIndex,
  ) {
    this.tracker.onDidChange(symbol => void this.handleChange(symbol));
  }

  private async handleChange(symbol: ActiveSymbol | undefined): Promise<void> {
    const token = ++this.resolveToken;
    this.current = symbol;
    if (!symbol) {
      this.sections = { callers: [], usages: [], dependents: [], implementations: [] };
      this.loading = false;
      this._onDidChangeTreeData.fire();
      return;
    }
    this.loading = true;
    this._onDidChangeTreeData.fire();

    const [callers, usages, dependents, implementations] = await Promise.all([
      this.queries.callers(symbol.hit.id, 1, 100).catch(() => []),
      this.queries.usages(symbol.hit.id, 100).catch(() => []),
      this.queries.dependents(symbol.hit.id, 2, 100).catch(() => []),
      this.queries.implementations(symbol.hit.id).catch(() => []),
    ]);
    if (token !== this.resolveToken) return;

    this.sections = { callers, usages, dependents, implementations };
    this.loading = false;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'info') {
      const item = new vscode.TreeItem(node.text);
      if (node.icon) item.iconPath = new vscode.ThemeIcon(node.icon);
      return item;
    }
    if (node.kind === 'section') {
      const item = new vscode.TreeItem(
        labelForSection(node.section),
        node.nodes.length > 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.description = `${node.nodes.length}`;
      item.iconPath = new vscode.ThemeIcon(iconForSection(node.section));
      return item;
    }
    const n = node.node;
    const item = new vscode.TreeItem(n.name ?? n.id);
    item.description = n.file_path ? `${n.file_path}${n.start_line ? `:${n.start_line}` : ''}` : '';
    item.iconPath = new vscode.ThemeIcon(themeIconForKind(n.kind));
    item.tooltip = new vscode.MarkdownString(
      `**${n.name ?? n.id}** \`${n.kind ?? ''}\`\n\n\`${n.id}\``,
    );
    const uri = n.file_path ? this.repos.resolve(n.file_path) : undefined;
    if (uri) {
      item.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [
          uri,
          {
            selection: n.start_line
              ? new vscode.Range(Math.max(0, n.start_line - 1), 0, Math.max(0, n.start_line - 1), 0)
              : undefined,
          },
        ],
      };
    }
    return item;
  }

  getChildren(node?: Node): Node[] {
    if (node === undefined) {
      if (!this.current) {
        return [{ kind: 'info', text: 'Place the cursor on a symbol to see its graph', icon: 'info' }];
      }
      if (this.loading) {
        return [{ kind: 'info', text: `Loading ${this.current.hit.name}…`, icon: 'sync~spin' }];
      }
      const sections: Section[] = ['callers', 'usages', 'dependents', 'implementations'];
      return sections.map<SectionNode>(s => ({ kind: 'section', section: s, nodes: this.sections[s] }));
    }
    if (node.kind === 'section') {
      if (node.nodes.length === 0) return [{ kind: 'info', text: '(none)' }];
      return node.nodes.map<EntryNode>(n => ({ kind: 'entry', node: n }));
    }
    return [];
  }
}

function labelForSection(s: Section): string {
  switch (s) {
    case 'callers':         return 'Callers';
    case 'usages':          return 'Usages';
    case 'dependents':      return 'Blast radius (depth 2)';
    case 'implementations': return 'Implementations';
  }
}

function iconForSection(s: Section): string {
  switch (s) {
    case 'callers':         return 'call-incoming';
    case 'usages':          return 'references';
    case 'dependents':      return 'symbol-misc';
    case 'implementations': return 'symbol-interface';
  }
}

function themeIconForKind(kind: string | undefined): string {
  switch ((kind ?? '').toLowerCase()) {
    case 'function': case 'func':   return 'symbol-function';
    case 'method':                  return 'symbol-method';
    case 'type': case 'class':      return 'symbol-class';
    case 'interface':               return 'symbol-interface';
    case 'struct':                  return 'symbol-struct';
    case 'enum':                    return 'symbol-enum';
    case 'variable': case 'var':    return 'symbol-variable';
    case 'constant': case 'const':  return 'symbol-constant';
    case 'field':                   return 'symbol-field';
    case 'module': case 'package':  return 'symbol-namespace';
    default:                        return 'symbol-misc';
  }
}
