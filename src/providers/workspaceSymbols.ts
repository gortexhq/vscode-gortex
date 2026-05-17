import * as vscode from 'vscode';
import { GraphQueries, SymbolHit } from '../query';
import { RepoIndex } from '../repoIndex';

/**
 * Wires `⌘T` (Go to Symbol in Workspace) to Gortex. Unlike VS Code's built-in
 * provider, this searches across *every tracked repo* — not just the open
 * workspace — using the daemon's BM25 + camelCase-aware tokenizer.
 */
export class GortexWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
  constructor(
    private readonly queries: GraphQueries,
    private readonly repos: RepoIndex,
  ) {}

  async provideWorkspaceSymbols(
    query: string,
    token: vscode.CancellationToken,
  ): Promise<vscode.SymbolInformation[]> {
    if (!query) return [];
    let hits: SymbolHit[];
    try {
      hits = await this.queries.searchSymbols(query, 100);
    } catch {
      return [];
    }
    if (token.isCancellationRequested) return [];
    const symbols: vscode.SymbolInformation[] = [];
    for (const hit of hits) {
      const uri = this.repos.resolve(hit.file_path);
      if (!uri) continue;
      const line = Math.max(0, (hit.start_line ?? 1) - 1);
      const range = new vscode.Range(line, 0, line, 0);
      symbols.push(new vscode.SymbolInformation(
        hit.name,
        toSymbolKind(hit.kind),
        hit.repo_prefix ?? '',
        new vscode.Location(uri, range),
      ));
    }
    return symbols;
  }
}

function toSymbolKind(kind: string | undefined): vscode.SymbolKind {
  switch ((kind ?? '').toLowerCase()) {
    case 'function': case 'func':   return vscode.SymbolKind.Function;
    case 'method':                  return vscode.SymbolKind.Method;
    case 'type': case 'class':      return vscode.SymbolKind.Class;
    case 'interface':               return vscode.SymbolKind.Interface;
    case 'struct':                  return vscode.SymbolKind.Struct;
    case 'enum':                    return vscode.SymbolKind.Enum;
    case 'enum_member':             return vscode.SymbolKind.EnumMember;
    case 'variable': case 'var':    return vscode.SymbolKind.Variable;
    case 'constant': case 'const':  return vscode.SymbolKind.Constant;
    case 'field':                   return vscode.SymbolKind.Field;
    case 'module': case 'package':  return vscode.SymbolKind.Module;
    case 'file':                    return vscode.SymbolKind.File;
    default:                        return vscode.SymbolKind.Object;
  }
}
