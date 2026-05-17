import * as vscode from 'vscode';
import { GraphQueries } from '../query';

/**
 * On hover, shows graph stats for the symbol under the cursor:
 *   X callers · Y dependents · Z usages
 * with clickable links to open the full lists. Off by default so it doesn't
 * clash with language-server hovers — opt in via `gortex.hover.enabled`.
 */
export class GortexHoverProvider implements vscode.HoverProvider {
  constructor(private readonly queries: GraphQueries) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    const word = document.getText(document.getWordRangeAtPosition(position));
    if (!word) return undefined;
    const hits = await this.queries.searchSymbols(word, 5);
    if (token.isCancellationRequested || hits.length === 0) return undefined;
    const best = hits.find(h => document.uri.fsPath.endsWith(h.file_path)) ?? hits[0];

    // Run the three counts in parallel — they're independent.
    const [callers, dependents, usages] = await Promise.all([
      this.queries.callers(best.id, 1, 200).catch(() => []),
      this.queries.dependents(best.id, 2, 200).catch(() => []),
      this.queries.usages(best.id, 200).catch(() => []),
    ]);
    if (token.isCancellationRequested) return undefined;

    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;
    md.appendMarkdown(`**${best.name}** \`${best.kind}\`\n\n`);
    md.appendMarkdown(`- $(call-incoming) **${callers.length}** caller${callers.length === 1 ? '' : 's'}\n`);
    md.appendMarkdown(`- $(symbol-misc) **${dependents.length}** dependent${dependents.length === 1 ? '' : 's'} (blast radius)\n`);
    md.appendMarkdown(`- $(references) **${usages.length}** usage${usages.length === 1 ? '' : 's'}\n\n`);
    md.appendMarkdown(
      `[Show callers](command:gortex.symbol.callers) · ` +
      `[Show usages](command:gortex.symbol.usages) · ` +
      `[Show blast radius](command:gortex.symbol.blastRadius)`,
    );
    return new vscode.Hover(md);
  }
}
