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
    private readonly output: vscode.OutputChannel,
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
    if (!repoRel) {
      this.output.appendLine(`[inlayHints] skip ${document.uri.fsPath} — not under any tracked repo`);
      return [];
    }

    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      document.uri,
    );
    if (token.isCancellationRequested) return [];
    if (!symbols || symbols.length === 0) {
      this.output.appendLine(
        `[inlayHints] no DocumentSymbols for ${document.uri.fsPath} — install/enable the language extension (e.g. golang.go for Go)`,
      );
      return [];
    }

    const targets = flattenFunctions(symbols).filter(s =>
      range.contains(s.selectionRange.start) || range.contains(s.range.start),
    );
    if (targets.length === 0) return [];

    const limited = targets.slice(0, 60);
    let resolved = 0, hiddenZero = 0, missed = 0;

    const hints = await Promise.all(limited.map(async sym => {
      // gopls returns method names as qualified strings like "(*Handler).foo"
      // which BM25 then tokenizes into noise that buries the real symbol.
      // selectionRange points at the bare identifier in source, so reading
      // the document text there gives us the unambiguous name.
      const bareName = (() => {
        try { return document.getText(sym.selectionRange).trim(); }
        catch { return sym.name; }
      })();
      const queryName = bareName || sym.name;

      // Two-pronged lookup: try the bare name first, then fall back to the
      // qualified name with a wider limit if nothing in-file matched. This
      // handles languages whose LSP gives the bare name as well as those
      // (like gopls) that qualify methods.
      const hit = await this.resolve(queryName, repoRel)
        ?? (queryName !== sym.name ? await this.resolve(sym.name, repoRel) : undefined);

      if (!hit) {
        missed++;
        return undefined;
      }

      const stats = await this.metadata.stats(hit.id);
      if (stats.callers + stats.dependents + stats.usages === 0) {
        hiddenZero++;
        return undefined;
      }
      resolved++;

      const parts: string[] = [];
      if (stats.callers > 0) parts.push(`${stats.callers}c`);
      if (stats.dependents > 0) parts.push(`${stats.dependents}d`);
      const label = `  ${parts.join(' · ')}`;

      const lineEnd = document.lineAt(sym.selectionRange.start.line).range.end;
      const hint = new vscode.InlayHint(lineEnd, label, vscode.InlayHintKind.Type);
      hint.paddingLeft = true;
      hint.tooltip = new vscode.MarkdownString(
        `**${bareName}**\n\n` +
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

    this.output.appendLine(
      `[inlayHints] ${document.uri.fsPath}: ${resolved} rendered, ${hiddenZero} hidden (zero stats), ${missed} unresolved (of ${limited.length} targets)`,
    );

    return hints.filter((h): h is vscode.InlayHint => !!h);
  }

  /**
   * Look up a function/method name in the graph and prefer the hit that
   * lives in the current file. Uses limit:25 because the daemon's BM25
   * scoring sometimes returns nothing at limit:5 for names that share
   * tokens with the rest of the corpus (`run`, `version`, etc.).
   */
  private async resolve(name: string, repoRel: string) {
    const hits = await this.queries.searchSymbols(name, 25).catch(() => []);
    if (hits.length === 0) return undefined;
    return hits.find(h => h.file_path === repoRel) ?? hits[0];
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
