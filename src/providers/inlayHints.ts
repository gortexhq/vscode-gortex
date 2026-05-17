import * as vscode from 'vscode';
import { GraphQueries } from '../query';
import { MetadataCache } from '../metadata';
import { RepoIndex } from '../repoIndex';

/**
 * Renders a faint trailing hint after every function/method declaration line:
 *
 *     export function parseDaemonStatus(...)  → 12 callers · 28 dependents
 *
 * Inlay hints take zero vertical space (unlike CodeLens) and feel native to
 * VS Code 1.70+. We pull function ranges from the existing DocumentSymbol
 * provider (no re-parsing), then fan out one search + count batch per symbol.
 * MetadataCache absorbs the repeated render calls.
 */
export class GortexInlayHintsProvider implements vscode.InlayHintsProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this._onDidChange.event;

  constructor(
    private readonly queries: GraphQueries,
    private readonly metadata: MetadataCache,
    private readonly repos: RepoIndex,
  ) {}

  refresh(): void {
    this._onDidChange.fire();
  }

  async provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlayHint[]> {
    const repoRel = this.repos.relativePath(document.uri);
    if (!repoRel) return [];

    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      document.uri,
    );
    if (token.isCancellationRequested || !symbols) return [];

    const targets = flattenFunctions(symbols).filter(s =>
      range.contains(s.selectionRange.start) || range.contains(s.range.start),
    );
    if (targets.length === 0) return [];

    const limited = targets.slice(0, 60);
    const hints = await Promise.all(limited.map(async sym => {
      const hits = await this.queries.searchSymbols(sym.name, 5).catch(() => []);
      const hit = hits.find(h => h.file_path === repoRel) ?? hits[0];
      if (!hit) return undefined;
      const stats = await this.metadata.stats(hit.id);
      // Don't render zero-everything noise.
      if (stats.callers + stats.dependents + stats.usages === 0) return undefined;

      const parts: string[] = [];
      if (stats.callers > 0) parts.push(`${stats.callers}c`);
      if (stats.dependents > 0) parts.push(`${stats.dependents}d`);
      const label = `  ${parts.join(' · ')}`;

      // Anchor at the end of the line that holds the declaration name, so the
      // hint floats just past the signature.
      const lineEnd = document.lineAt(sym.selectionRange.start.line).range.end;
      const hint = new vscode.InlayHint(lineEnd, label, vscode.InlayHintKind.Type);
      hint.paddingLeft = true;
      hint.tooltip = new vscode.MarkdownString(
        `**${sym.name}**\n\n` +
        `- ${stats.callers} caller${stats.callers === 1 ? '' : 's'}\n` +
        `- ${stats.dependents} dependent${stats.dependents === 1 ? '' : 's'}\n` +
        `- ${stats.usages} usage${stats.usages === 1 ? '' : 's'}\n\n` +
        `[Callers](command:gortex.symbol.callers) · ` +
        `[Usages](command:gortex.symbol.usages) · ` +
        `[Blast radius](command:gortex.symbol.blastRadius)`,
      );
      (hint.tooltip as vscode.MarkdownString).isTrusted = true;
      return hint;
    }));

    return hints.filter((h): h is vscode.InlayHint => !!h);
  }
}

function flattenFunctions(symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] {
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
