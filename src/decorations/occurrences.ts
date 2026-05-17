import * as vscode from 'vscode';
import { ActiveSymbolTracker } from '../activeSymbol';
import { GraphQueries } from '../query';
import { RepoIndex } from '../repoIndex';

/**
 * When the cursor lands on a symbol, faintly underlines every other occurrence
 * **across the workspace**. VS Code's built-in highlight only spans the open
 * file — this surfaces the cross-file references the user is touching.
 *
 * Strategy:
 *   1. Subscribe to ActiveSymbolTracker (debounced cursor → symbol).
 *   2. Call find_usages for the resolved symbol (cheap on warm daemon).
 *   3. For every visible editor, set a decoration on lines that match.
 */
export class OccurrenceDecorations implements vscode.Disposable {
  private readonly decoration: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];
  private currentToken = 0;

  constructor(
    private readonly tracker: ActiveSymbolTracker,
    private readonly queries: GraphQueries,
    private readonly repos: RepoIndex,
  ) {
    this.decoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
      borderColor: new vscode.ThemeColor('editor.wordHighlightBorder'),
      borderStyle: 'solid',
      borderWidth: '0 0 1px 0',
      overviewRulerColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
      overviewRulerLane: vscode.OverviewRulerLane.Center,
    });
    this.disposables.push(
      this.tracker.onDidChange(symbol => void this.apply(symbol)),
      vscode.window.onDidChangeVisibleTextEditors(() => void this.apply(this.tracker.get())),
    );
  }

  private async apply(active: ReturnType<ActiveSymbolTracker['get']> | undefined): Promise<void> {
    const token = ++this.currentToken;
    if (!active) {
      this.clearAll();
      return;
    }
    let usages;
    try {
      usages = await this.queries.usages(active.hit.id, 500);
    } catch {
      this.clearAll();
      return;
    }
    if (token !== this.currentToken) return;

    // Bucket usages by URI for one decoration-set call per editor.
    const byUri = new Map<string, vscode.Range[]>();
    const include = (uri: vscode.Uri, line: number) => {
      const key = uri.toString();
      const arr = byUri.get(key) ?? [];
      arr.push(new vscode.Range(line, 0, line, 0));
      byUri.set(key, arr);
    };
    for (const node of usages) {
      if (!node.file_path || !node.start_line) continue;
      const uri = this.repos.resolve(node.file_path);
      if (!uri) continue;
      include(uri, Math.max(0, node.start_line - 1));
    }

    for (const editor of vscode.window.visibleTextEditors) {
      const ranges = byUri.get(editor.document.uri.toString()) ?? [];
      // Resolve each range to the word at that line so the underline lands on
      // the identifier, not the whole line.
      const resolved = ranges
        .map(r => {
          const lineText = editor.document.lineAt(r.start.line).text;
          const idx = lineText.indexOf(active.word);
          if (idx < 0) return undefined;
          return new vscode.Range(r.start.line, idx, r.start.line, idx + active.word.length);
        })
        .filter((r): r is vscode.Range => !!r);
      editor.setDecorations(this.decoration, resolved);
    }
  }

  private clearAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.decoration, []);
    }
  }

  dispose(): void {
    this.clearAll();
    this.decoration.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
