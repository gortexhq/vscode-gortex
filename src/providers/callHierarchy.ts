import * as vscode from 'vscode';
import { GraphQueries, GraphNode, SymbolHit } from '../query';
import { RepoIndex } from '../repoIndex';

/**
 * Backs VS Code's native Call Hierarchy view (right-click → Show Call
 * Hierarchy) with Gortex's graph: incoming calls via `get_callers`, outgoing
 * via `get_call_chain`. The result is a cross-repo call graph you can drill
 * into without ever leaving the editor's built-in UI.
 */
export class GortexCallHierarchyProvider implements vscode.CallHierarchyProvider {
  constructor(
    private readonly queries: GraphQueries,
    private readonly repos: RepoIndex,
  ) {}

  async prepareCallHierarchy(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.CallHierarchyItem | vscode.CallHierarchyItem[] | undefined> {
    const word = document.getText(document.getWordRangeAtPosition(position));
    if (!word) return undefined;
    const hits = await this.queries.searchSymbols(word, 10);
    if (token.isCancellationRequested) return undefined;

    // Prefer hits in the current file when there are duplicates — that's almost
    // always what the user meant.
    const currentRel = this.repos.relativePath(document.uri);
    const ordered = hits.slice().sort((a, b) => {
      const aIn = currentRel && a.file_path.endsWith(currentRel) ? -1 : 0;
      const bIn = currentRel && b.file_path.endsWith(currentRel) ? -1 : 0;
      return aIn - bIn;
    });
    return ordered.map(h => this.toItem(h)).filter((x): x is GortexCallItem => !!x);
  }

  async provideCallHierarchyIncomingCalls(
    item: vscode.CallHierarchyItem,
    token: vscode.CancellationToken,
  ): Promise<vscode.CallHierarchyIncomingCall[]> {
    const id = (item as GortexCallItem).gortexId;
    if (!id) return [];
    const nodes = await this.queries.callers(id, 1, 100);
    if (token.isCancellationRequested) return [];
    return this.toCalls(nodes, (from, range) => new vscode.CallHierarchyIncomingCall(from, [range]));
  }

  async provideCallHierarchyOutgoingCalls(
    item: vscode.CallHierarchyItem,
    token: vscode.CancellationToken,
  ): Promise<vscode.CallHierarchyOutgoingCall[]> {
    const id = (item as GortexCallItem).gortexId;
    if (!id) return [];
    const nodes = await this.queries.callChain(id, 1, 100);
    if (token.isCancellationRequested) return [];
    return this.toCalls(nodes, (to, range) => new vscode.CallHierarchyOutgoingCall(to, [range]));
  }

  private toItem(hit: SymbolHit | GraphNode): GortexCallItem | undefined {
    const uri = this.repos.resolve(hit.file_path);
    if (!uri) return undefined;
    const line = Math.max(0, (hit.start_line ?? 1) - 1);
    const endLine = Math.max(line, (hit.end_line ?? hit.start_line ?? 1) - 1);
    const range = new vscode.Range(line, 0, endLine, 0);
    const item = new GortexCallItem(
      toSymbolKind(hit.kind),
      hit.name,
      hit.kind ?? '',
      uri,
      range,
      range,
    );
    item.gortexId = hit.id;
    return item;
  }

  private toCalls<T>(
    nodes: GraphNode[],
    make: (item: GortexCallItem, range: vscode.Range) => T,
  ): T[] {
    const calls: T[] = [];
    for (const node of nodes) {
      const item = this.toItem(node);
      if (!item) continue;
      // VS Code wants per-occurrence ranges; without them, fall back to the
      // definition range. (Graph nodes don't carry exact call sites today.)
      calls.push(make(item, item.range));
    }
    return calls;
  }
}

class GortexCallItem extends vscode.CallHierarchyItem {
  gortexId: string | undefined;
}

function toSymbolKind(kind: string | undefined): vscode.SymbolKind {
  switch ((kind ?? '').toLowerCase()) {
    case 'function': case 'func':   return vscode.SymbolKind.Function;
    case 'method':                  return vscode.SymbolKind.Method;
    case 'type': case 'class':      return vscode.SymbolKind.Class;
    case 'interface':               return vscode.SymbolKind.Interface;
    case 'struct':                  return vscode.SymbolKind.Struct;
    case 'enum':                    return vscode.SymbolKind.Enum;
    case 'variable': case 'var':    return vscode.SymbolKind.Variable;
    case 'constant': case 'const':  return vscode.SymbolKind.Constant;
    case 'field':                   return vscode.SymbolKind.Field;
    case 'module': case 'package':  return vscode.SymbolKind.Module;
    default:                        return vscode.SymbolKind.Function;
  }
}
