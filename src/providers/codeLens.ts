import * as vscode from 'vscode';
import { McpClient } from '../mcpClient';
import { GraphQueries } from '../query';
import { RepoIndex } from '../repoIndex';

/**
 * Renders `12 callers · 84 dependents` above every function in the open file.
 * Off by default — polarizing. Enable via `gortex.codeLens.enabled`.
 *
 * Strategy: ask VS Code's existing DocumentSymbolProvider for the file's
 * functions/methods (zero re-implementation), then for each one fan out two
 * Gortex queries in parallel. Per-file results are cached and invalidated by
 * stale_refs notifications when the daemon publishes them.
 */
export class GortexCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  /** Cached lens lists per document URI. */
  private cache = new Map<string, vscode.CodeLens[]>();

  constructor(
    private readonly queries: GraphQueries,
    private readonly repos: RepoIndex,
    mcp: McpClient,
  ) {
    // Re-render lenses whenever the daemon publishes a stale-refs event.
    // The subscription Just Works once the daemon's publish path is wired up;
    // until then this is dormant.
    void mcp.subscribe('stale_refs', () => {
      this.cache.clear();
      this._onDidChange.fire();
    }).catch(() => undefined);
  }

  refresh(): void {
    this.cache.clear();
    this._onDidChange.fire();
  }

  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens[]> {
    const cached = this.cache.get(document.uri.toString());
    if (cached) return cached;

    const repoRelPath = this.repos.relativePath(document.uri);
    if (!repoRelPath) return [];

    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      document.uri,
    );
    if (token.isCancellationRequested || !symbols) return [];

    const targets = flattenFunctionLike(symbols);
    if (targets.length === 0) return [];

    // Limit fan-out to keep request volume reasonable on huge files.
    const limited = targets.slice(0, 40);
    const lenses = await Promise.all(limited.map(async sym => {
      // Prefer the bare identifier (gopls qualifies methods as
      // `(*Handler).foo` in sym.name, which poisons BM25). selectionRange
      // is the identifier span.
      const bareName = (() => {
        try { return document.getText(sym.selectionRange).trim(); }
        catch { return sym.name; }
      })();
      const queryName = bareName || sym.name;
      const targetLine = sym.selectionRange.start.line + 1; // gortex is 1-based

      const hits = await this.queries.searchSymbols(queryName, 25).catch(() => []);
      // Same-file + near-line match required. Without it, same-named symbols
      // in other repos hijack the lens (e.g. every `Test` method shows the
      // most popular test's caller count instead of its own).
      const hit = hits.find(h =>
        h.file_path === repoRelPath &&
        typeof h.start_line === 'number' &&
        Math.abs(h.start_line - targetLine) <= 10,
      );
      if (!hit) return undefined;
      const [callers, dependents] = await Promise.all([
        this.queries.callers(hit.id, 1, 200).catch(() => []),
        this.queries.dependents(hit.id, 2, 200).catch(() => []),
      ]);
      const range = new vscode.Range(sym.range.start, sym.range.start);
      const title = `$(call-incoming) ${callers.length} caller${callers.length === 1 ? '' : 's'}` +
                    ` · $(symbol-misc) ${dependents.length} dependent${dependents.length === 1 ? '' : 's'}`;
      const lens = new vscode.CodeLens(range, {
        title,
        command: 'vscode.executeReferenceProvider',
        arguments: [document.uri, sym.range.start],
      });
      return lens;
    }));
    const filtered = lenses.filter((x): x is vscode.CodeLens => !!x);
    this.cache.set(document.uri.toString(), filtered);
    return filtered;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

function flattenFunctionLike(symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] {
  const out: vscode.DocumentSymbol[] = [];
  const walk = (sym: vscode.DocumentSymbol) => {
    if (sym.kind === vscode.SymbolKind.Function ||
        sym.kind === vscode.SymbolKind.Method ||
        sym.kind === vscode.SymbolKind.Constructor) {
      out.push(sym);
    }
    for (const child of sym.children ?? []) walk(child);
  };
  for (const s of symbols) walk(s);
  return out;
}
