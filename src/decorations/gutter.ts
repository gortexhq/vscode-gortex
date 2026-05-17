import * as vscode from 'vscode';
import * as path from 'path';
import { AnalyzeCache, AnalyzeSymbol } from '../metadata';
import { RepoIndex } from '../repoIndex';

/**
 * Renders gutter icons next to symbol declarations:
 *   🔥 hotspot   (top of `analyze hotspots` by fan_in)
 *   💀 dead code (in `analyze dead_code`)
 *
 * Always-visible. Refreshes when AnalyzeCache updates and when an editor's
 * visible range changes — cheap, since AnalyzeCache pre-buckets by file.
 */
export class GutterDecorations implements vscode.Disposable {
  private readonly hotDeco: vscode.TextEditorDecorationType;
  private readonly deadDeco: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly cache: AnalyzeCache,
    private readonly repos: RepoIndex,
    extensionPath: string,
  ) {
    this.hotDeco = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.file(path.join(extensionPath, 'images', 'gutter', 'hot.svg')),
      gutterIconSize: 'contain',
      overviewRulerColor: '#ff7a18',
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
    this.deadDeco = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.file(path.join(extensionPath, 'images', 'gutter', 'dead.svg')),
      gutterIconSize: 'contain',
      opacity: '0.7',
    });
    this.disposables.push(
      this.cache.onDidUpdate(() => this.refreshAll()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshAll()),
      vscode.workspace.onDidChangeTextDocument(e => {
        for (const editor of vscode.window.visibleTextEditors) {
          if (editor.document === e.document) this.apply(editor);
        }
      }),
    );
    this.refreshAll();
  }

  private refreshAll(): void {
    for (const editor of vscode.window.visibleTextEditors) this.apply(editor);
  }

  private apply(editor: vscode.TextEditor): void {
    const repoRel = this.repos.relativePath(editor.document.uri);
    if (!repoRel) {
      editor.setDecorations(this.hotDeco, []);
      editor.setDecorations(this.deadDeco, []);
      return;
    }
    const lineCount = editor.document.lineCount;
    const toRanges = (symbols: AnalyzeSymbol[]) =>
      symbols
        .filter(s => s.start_line && s.start_line > 0 && s.start_line <= lineCount)
        .map(s => {
          const line = Math.max(0, (s.start_line ?? 1) - 1);
          const range = new vscode.Range(line, 0, line, 0);
          return { range, hoverMessage: tooltipFor(s) };
        });
    editor.setDecorations(this.hotDeco, toRanges(this.cache.hotspotsFor(repoRel)));
    editor.setDecorations(this.deadDeco, toRanges(this.cache.deadFor(repoRel)));
  }

  dispose(): void {
    this.hotDeco.dispose();
    this.deadDeco.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

function tooltipFor(s: AnalyzeSymbol): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  md.appendMarkdown(`**${s.name}** \`${s.kind}\`\n\n`);
  if (s.fan_in !== undefined)            md.appendMarkdown(`- fan-in: **${s.fan_in}**\n`);
  if (s.fan_out !== undefined)           md.appendMarkdown(`- fan-out: ${s.fan_out}\n`);
  if (s.complexity_score !== undefined)  md.appendMarkdown(`- complexity: ${s.complexity_score.toFixed(1)}\n`);
  return md;
}
