import * as vscode from 'vscode';
import { GraphQueries } from '../query';
import { MetadataCache } from '../metadata';
import { RepoIndex } from '../repoIndex';
import { candidateSymbolIds, walkFunctions, bareIdentifier } from '../symbolId';

/**
 * Renders a faint trailing hint after every function/method declaration line:
 *
 *     export function parseDaemonStatus(...)  → 12 callers · 28 dependents
 *
 * Architecture: we have everything needed to look up the graph node
 * deterministically — file path, function name, receiver type. So we
 * **construct the graph ID locally** (`repoRel::funcName` or
 * `repoRel::Receiver.methodName`) and call `get_symbol(id)`. No fuzzy
 * search, no scoring threshold, no fallback-to-wrong-symbol. Either the
 * symbol is in the graph at this exact location or we render nothing.
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

    const candidates = walkFunctions(symbols).filter(({ sym }) =>
      range.contains(sym.selectionRange.start) || range.contains(sym.range.start),
    );
    if (candidates.length === 0) return [];

    const limited = candidates.slice(0, 60);
    let rendered = 0, hiddenZero = 0, unresolved = 0;

    const hints = await Promise.all(limited.map(async ({ sym, ancestors }) => {
      const bareName = bareIdentifier(document, sym);
      const ids = candidateSymbolIds(repoRel, sym, bareName, document, ancestors);

      // Try each candidate ID in order (most specific first). The daemon
      // returns the symbol or undefined per id; first hit wins.
      let hit;
      for (const id of ids) {
        hit = await this.queries.getSymbol(id);
        if (hit) break;
      }
      if (!hit) {
        unresolved++;
        return undefined;
      }

      const stats = await this.metadata.stats(hit.id);
      if (stats.callers + stats.dependents + stats.usages === 0) {
        hiddenZero++;
        return undefined;
      }
      rendered++;

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
      `[inlayHints] ${document.uri.fsPath}: ${rendered} rendered, ${hiddenZero} hidden (zero stats), ${unresolved} unresolved (of ${limited.length})`,
    );

    return hints.filter((h): h is vscode.InlayHint => !!h);
  }
}
