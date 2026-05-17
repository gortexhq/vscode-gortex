import * as vscode from 'vscode';
import { GraphQueries, SymbolHit } from './query';
import { RepoIndex } from './repoIndex';

/**
 * Single source of truth for "what symbol is the cursor on right now". A
 * handful of surfaces (cursor status bar, Symbol Insight panel, occurrence
 * underlines) all need this — we resolve once, debounced, and broadcast.
 */
export class ActiveSymbolTracker implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<ActiveSymbol | undefined>();
  readonly onDidChange = this._onDidChange.event;

  private current: ActiveSymbol | undefined;
  private debounceTimer: NodeJS.Timeout | undefined;
  private generation = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly queries: GraphQueries, private readonly repos: RepoIndex) {
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection(e => this.schedule(e.textEditor)),
      vscode.window.onDidChangeActiveTextEditor(editor => this.schedule(editor)),
    );
    if (vscode.window.activeTextEditor) this.schedule(vscode.window.activeTextEditor);
  }

  get(): ActiveSymbol | undefined {
    return this.current;
  }

  private schedule(editor: vscode.TextEditor | undefined): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    // 150ms is the sweet spot — slower than human cursor jitter, faster than
    // perceptible UI lag.
    this.debounceTimer = setTimeout(() => void this.resolve(editor), 150);
  }

  private async resolve(editor: vscode.TextEditor | undefined): Promise<void> {
    const gen = ++this.generation;
    if (!editor) return this.publish(undefined, gen);

    const document = editor.document;
    const position = editor.selection.active;
    const range = document.getWordRangeAtPosition(position);
    if (!range) return this.publish(undefined, gen);

    const word = document.getText(range);
    if (!word || word.length < 2) return this.publish(undefined, gen);

    // Skip language keywords so we don't waste a search on `if` / `return`.
    if (LANGUAGE_KEYWORDS.has(word.toLowerCase())) return this.publish(undefined, gen);

    let hits: SymbolHit[] = [];
    try {
      hits = await this.queries.searchSymbols(word, 10);
    } catch {
      return this.publish(undefined, gen);
    }
    if (gen !== this.generation) return; // a newer resolve has started

    const repoRel = this.repos.relativePath(document.uri);
    const best =
      hits.find(h => repoRel && h.file_path === repoRel && nearLine(h, position.line)) ??
      hits.find(h => repoRel && h.file_path === repoRel) ??
      hits[0];

    if (!best) return this.publish(undefined, gen);
    this.publish({ hit: best, word, uri: document.uri, position }, gen);
  }

  private publish(symbol: ActiveSymbol | undefined, gen: number): void {
    if (gen !== this.generation) return;
    // Skip identical re-publishes — the cursor often moves within the same
    // word and there's no value re-firing.
    if (symbol?.hit.id === this.current?.hit.id) return;
    this.current = symbol;
    this._onDidChange.fire(symbol);
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    for (const d of this.disposables) d.dispose();
    this._onDidChange.dispose();
  }
}

export interface ActiveSymbol {
  hit: SymbolHit;
  word: string;
  uri: vscode.Uri;
  position: vscode.Position;
}

function nearLine(hit: SymbolHit, line: number): boolean {
  if (!hit.start_line) return false;
  // VS Code lines are 0-based, Gortex are 1-based.
  return Math.abs(hit.start_line - 1 - line) <= 5;
}

const LANGUAGE_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'return', 'function', 'func', 'class', 'interface', 'type', 'struct', 'enum',
  'const', 'var', 'let', 'new', 'this', 'self', 'super', 'import', 'export',
  'from', 'as', 'in', 'of', 'is', 'and', 'or', 'not', 'true', 'false', 'null',
  'undefined', 'nil', 'void', 'public', 'private', 'protected', 'static',
  'async', 'await', 'try', 'catch', 'finally', 'throw', 'package',
]);
