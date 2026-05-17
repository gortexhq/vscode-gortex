import * as vscode from 'vscode';
import { McpClient } from '../mcpClient';
import { GraphQueries } from '../query';
import { RepoIndex } from '../repoIndex';
import { candidateSymbolIds, walkFunctions, bareIdentifier } from '../symbolId';

/**
 * Renders `12 callers · 84 dependents` above every function in the open file.
 * Off by default — polarizing. Enable via `gortex.codeLens.enabled`.
 *
 * Uses direct ID construction (see symbolId.ts) instead of fuzzy search to
 * avoid wrong-attribution: a fresh `Test()` method would otherwise inherit
 * the stats of whatever popular `Test` function BM25 ranked first.
 *
 * Per-file results are cached; stale_refs notifications invalidate the cache
 * when the daemon publishes them.
 */
export class GortexCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  private cache = new Map<string, vscode.CodeLens[]>();

  constructor(
    private readonly queries: GraphQueries,
    private readonly repos: RepoIndex,
    mcp: McpClient,
  ) {
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

    const repoRel = this.repos.relativePath(document.uri);
    if (!repoRel) return [];

    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      document.uri,
    );
    if (token.isCancellationRequested || !symbols) return [];

    const candidates = walkFunctions(symbols).slice(0, 40);
    if (candidates.length === 0) return [];

    const lenses = await Promise.all(candidates.map(async ({ sym, ancestors }) => {
      const bareName = bareIdentifier(document, sym);
      const ids = candidateSymbolIds(repoRel, sym, bareName, document, ancestors);

      let hit;
      for (const id of ids) {
        hit = await this.queries.getSymbol(id);
        if (hit) break;
      }
      if (!hit) return undefined;

      const [callers, dependents] = await Promise.all([
        this.queries.callers(hit.id, 1, 200).catch(() => []),
        this.queries.dependents(hit.id, 2, 200).catch(() => []),
      ]);
      const range = new vscode.Range(sym.range.start, sym.range.start);
      const title = `$(call-incoming) ${callers.length} caller${callers.length === 1 ? '' : 's'}` +
                    ` · $(symbol-misc) ${dependents.length} dependent${dependents.length === 1 ? '' : 's'}`;
      return new vscode.CodeLens(range, {
        title,
        command: 'vscode.executeReferenceProvider',
        arguments: [document.uri, sym.range.start],
      });
    }));
    const filtered = lenses.filter((x): x is vscode.CodeLens => !!x);
    this.cache.set(document.uri.toString(), filtered);
    return filtered;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
