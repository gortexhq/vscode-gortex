import * as vscode from 'vscode';
import { GraphQueries, GraphNode, SymbolHit } from '../query';
import { RepoIndex } from '../repoIndex';

export function registerSymbolCommands(
  context: vscode.ExtensionContext,
  queries: GraphQueries,
  repos: RepoIndex,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gortex.symbol.find', () => findSymbol(queries, repos)),
    vscode.commands.registerCommand('gortex.symbol.callers', () => graphFromCursor(queries, repos, 'callers')),
    vscode.commands.registerCommand('gortex.symbol.usages', () => graphFromCursor(queries, repos, 'usages')),
    vscode.commands.registerCommand('gortex.symbol.blastRadius', () => graphFromCursor(queries, repos, 'dependents')),
  );
}

async function findSymbol(queries: GraphQueries, repos: RepoIndex): Promise<void> {
  const query = await vscode.window.showInputBox({
    prompt: 'Find symbol in graph',
    placeHolder: 'e.g. parseDaemonStatus, UserService',
  });
  if (!query) return;
  const hits = await withProgress(`Gortex: searching for "${query}"…`, () =>
    queries.searchSymbols(query, 50),
  );
  if (hits.length === 0) {
    vscode.window.showInformationMessage(`No symbols matched "${query}".`);
    return;
  }
  const pick = await pickSymbolHit(hits, `${hits.length} match${hits.length === 1 ? '' : 'es'} — pick one to open`);
  if (!pick) return;
  await openHit(repos, pick);
}

type GraphKind = 'callers' | 'usages' | 'dependents';

async function graphFromCursor(queries: GraphQueries, repos: RepoIndex, kind: GraphKind): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a file and place the cursor on a symbol first.');
    return;
  }
  const word = wordAtCursor(editor);
  if (!word) {
    vscode.window.showWarningMessage('No symbol under cursor.');
    return;
  }
  const candidates = await withProgress(`Gortex: resolving "${word}"…`, () =>
    queries.searchSymbols(word, 25),
  );
  if (candidates.length === 0) {
    vscode.window.showInformationMessage(`No graph node found for "${word}".`);
    return;
  }
  const symbol = candidates.length === 1
    ? candidates[0]
    : await pickSymbolHit(candidates, `Multiple matches for "${word}" — pick the one you mean`);
  if (!symbol) return;

  const label = labelFor(kind);
  const nodes = await withProgress(`Gortex: ${label} of ${symbol.name}…`, () => {
    switch (kind) {
      case 'callers':    return queries.callers(symbol.id, 2, 50);
      case 'usages':     return queries.usages(symbol.id, 50);
      case 'dependents': return queries.dependents(symbol.id, 3, 50);
    }
  });
  if (nodes.length === 0) {
    vscode.window.showInformationMessage(`No ${label} for ${symbol.name}.`);
    return;
  }
  const pick = await pickGraphNode(nodes, `${nodes.length} ${label} of ${symbol.name} — pick one to open`);
  if (!pick) return;
  await openHit(repos, pick);
}

async function pickSymbolHit(hits: SymbolHit[], placeHolder: string): Promise<SymbolHit | undefined> {
  const items = hits.map(h => ({
    label: `$(symbol-${iconForKind(h.kind)}) ${h.name}`,
    description: h.kind,
    detail: `${h.file_path}${h.start_line ? `:${h.start_line}` : ''}`,
    hit: h,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    matchOnDescription: true,
    matchOnDetail: true,
    placeHolder,
  });
  return picked?.hit;
}

async function pickGraphNode(nodes: GraphNode[], placeHolder: string): Promise<GraphNode | undefined> {
  const items = nodes.map(n => ({
    label: `$(symbol-${iconForKind(n.kind)}) ${n.name ?? n.id}`,
    description: n.kind ?? '',
    detail: `${n.file_path ?? ''}${n.start_line ? `:${n.start_line}` : ''}`,
    hit: n,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    matchOnDescription: true,
    matchOnDetail: true,
    placeHolder,
  });
  return picked?.hit;
}

async function openHit(repos: RepoIndex, hit: SymbolHit): Promise<void> {
  if (!hit.file_path) return;
  const uri = repos.resolve(hit.file_path);
  if (!uri) {
    vscode.window.showWarningMessage(`Couldn't locate ${hit.file_path} on disk.`);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  if (hit.start_line && hit.start_line > 0) {
    const pos = new vscode.Position(Math.max(0, hit.start_line - 1), 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }
}

function wordAtCursor(editor: vscode.TextEditor): string | undefined {
  const range = editor.document.getWordRangeAtPosition(editor.selection.active);
  if (!range) return undefined;
  return editor.document.getText(range);
}

function iconForKind(kind: string | undefined): string {
  switch ((kind ?? '').toLowerCase()) {
    case 'function': case 'func':   return 'function';
    case 'method':                  return 'method';
    case 'type': case 'class':      return 'class';
    case 'interface':               return 'interface';
    case 'struct':                  return 'struct';
    case 'enum':                    return 'enum';
    case 'variable': case 'var':    return 'variable';
    case 'constant': case 'const':  return 'constant';
    case 'field':                   return 'field';
    case 'module': case 'package':  return 'namespace';
    default:                        return 'misc';
  }
}

function labelFor(kind: GraphKind): string {
  switch (kind) {
    case 'callers':    return 'callers';
    case 'usages':     return 'usages';
    case 'dependents': return 'blast radius';
  }
}

function withProgress<T>(title: string, work: () => Promise<T>): Thenable<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title },
    work,
  );
}
