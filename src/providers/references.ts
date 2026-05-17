import * as vscode from 'vscode';
import { GraphQueries } from '../query';
import { RepoIndex } from '../repoIndex';

/**
 * Backs `⇧F12` (Find All References) with Gortex `find_usages`. Off by default
 * because most languages already have an LSP provider — turn this on when
 * you'd rather have Gortex's cross-repo, semantic-tier-filtered results.
 */
export class GortexReferenceProvider implements vscode.ReferenceProvider {
  constructor(private readonly queries: GraphQueries, private readonly repos: RepoIndex) {}

  async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.ReferenceContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.Location[]> {
    return resolveSymbolAtCursor(document, position, this.queries, async hit => {
      const nodes = await this.queries.usages(hit.id, 200);
      if (token.isCancellationRequested) return [];
      return this.toLocations(nodes);
    });
  }

  private toLocations(nodes: { file_path?: string; start_line?: number }[]): vscode.Location[] {
    const out: vscode.Location[] = [];
    for (const n of nodes) {
      if (!n.file_path) continue;
      const uri = this.repos.resolve(n.file_path);
      if (!uri) continue;
      const line = Math.max(0, (n.start_line ?? 1) - 1);
      out.push(new vscode.Location(uri, new vscode.Position(line, 0)));
    }
    return out;
  }
}

/**
 * Backs `⌘F12` (Go to Implementations) with Gortex `find_implementations`.
 * Off by default.
 */
export class GortexImplementationProvider implements vscode.ImplementationProvider {
  constructor(private readonly queries: GraphQueries, private readonly repos: RepoIndex) {}

  async provideImplementation(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Location[]> {
    return resolveSymbolAtCursor(document, position, this.queries, async hit => {
      const nodes = await this.queries.implementations(hit.id);
      if (token.isCancellationRequested) return [];
      const out: vscode.Location[] = [];
      for (const n of nodes) {
        if (!n.file_path) continue;
        const uri = this.repos.resolve(n.file_path);
        if (!uri) continue;
        const line = Math.max(0, (n.start_line ?? 1) - 1);
        out.push(new vscode.Location(uri, new vscode.Position(line, 0)));
      }
      return out;
    });
  }
}

/**
 * Common helper: pick the best Gortex hit for the word under the cursor (the
 * one whose file_path matches the open document if any), then hand it to the
 * caller. Returns an empty array if no hit found.
 */
async function resolveSymbolAtCursor<T>(
  document: vscode.TextDocument,
  position: vscode.Position,
  queries: GraphQueries,
  withHit: (hit: { id: string }) => Promise<T[]>,
): Promise<T[]> {
  const word = document.getText(document.getWordRangeAtPosition(position));
  if (!word) return [];
  const hits = await queries.searchSymbols(word, 10);
  if (hits.length === 0) return [];
  const best = pickBestHit(hits, document.uri.fsPath);
  return withHit(best);
}

function pickBestHit<T extends { file_path: string }>(hits: T[], fsPath: string): T {
  const sameFile = hits.find(h => fsPath.endsWith(h.file_path));
  return sameFile ?? hits[0];
}
