import * as vscode from 'vscode';
import { GortexCli, GraphHit, SymbolHit } from '../daemon';

export function registerSymbolCommands(
  context: vscode.ExtensionContext,
  cli: GortexCli,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gortex.symbol.find', () => findSymbol(cli)),
    vscode.commands.registerCommand('gortex.symbol.callers', () => graphFromCursor(cli, 'callers')),
    vscode.commands.registerCommand('gortex.symbol.usages', () => graphFromCursor(cli, 'usages')),
    vscode.commands.registerCommand('gortex.symbol.blastRadius', () => graphFromCursor(cli, 'dependents')),
  );
}

async function findSymbol(cli: GortexCli): Promise<void> {
  const folder = activeFolder();
  if (!folder) return;
  const query = await vscode.window.showInputBox({
    prompt: 'Find symbol in graph',
    placeHolder: 'e.g. parseDaemonStatus, UserService',
  });
  if (!query) return;
  const hits = await withProgress(`Gortex: searching for "${query}"…`, () =>
    cli.findSymbol(query, folder.uri.fsPath, 50),
  );
  if (hits.length === 0) {
    vscode.window.showInformationMessage(`No symbols matched "${query}".`);
    return;
  }
  const items: (vscode.QuickPickItem & { hit: SymbolHit })[] = hits.map(hit => ({
    label: `$(symbol-${iconForKind(hit.kind)}) ${hit.name}`,
    description: hit.kind,
    detail: `${hit.file_path}${hit.start_line ? `:${hit.start_line}` : ''}`,
    hit,
  }));
  const pick = await vscode.window.showQuickPick(items, {
    matchOnDescription: true,
    matchOnDetail: true,
    placeHolder: `${hits.length} match${hits.length === 1 ? '' : 'es'} — pick one to open`,
  });
  if (!pick) return;
  await openHit(folder, pick.hit.file_path, pick.hit.start_line);
}

type GraphKind = 'callers' | 'usages' | 'dependents';

async function graphFromCursor(cli: GortexCli, kind: GraphKind): Promise<void> {
  const folder = activeFolder();
  if (!folder) return;
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
  const hits = await withProgress(`Gortex: resolving "${word}"…`, () =>
    cli.findSymbol(word, folder.uri.fsPath, 25),
  );
  if (hits.length === 0) {
    vscode.window.showInformationMessage(`No graph node found for "${word}".`);
    return;
  }
  const symbol = hits.length === 1
    ? hits[0]
    : (await pickSymbol(hits, word));
  if (!symbol) return;

  const label = labelFor(kind);
  const results = await withProgress(`Gortex: ${label} of ${symbol.name}…`, () => {
    switch (kind) {
      case 'callers':    return cli.callers(symbol.id, folder.uri.fsPath, 2);
      case 'usages':     return cli.usages(symbol.id, folder.uri.fsPath);
      case 'dependents': return cli.dependents(symbol.id, folder.uri.fsPath, 3);
    }
  });
  if (results.length === 0) {
    vscode.window.showInformationMessage(`No ${label} for ${symbol.name}.`);
    return;
  }
  const items: (vscode.QuickPickItem & { hit: GraphHit })[] = results.map(hit => ({
    label: `$(symbol-${iconForKind(hit.kind)}) ${hit.name ?? hit.id}`,
    description: hit.kind ?? '',
    detail: `${hit.file_path ?? ''}${hit.start_line ? `:${hit.start_line}` : ''}` +
            (hit.depth ? `   depth ${hit.depth}` : ''),
    hit,
  }));
  const pick = await vscode.window.showQuickPick(items, {
    matchOnDescription: true,
    matchOnDetail: true,
    placeHolder: `${results.length} ${label} of ${symbol.name} — pick one to open`,
  });
  if (!pick) return;
  await openHit(folder, pick.hit.file_path ?? '', pick.hit.start_line);
}

async function pickSymbol(hits: SymbolHit[], word: string): Promise<SymbolHit | undefined> {
  const items: (vscode.QuickPickItem & { hit: SymbolHit })[] = hits.map(h => ({
    label: `$(symbol-${iconForKind(h.kind)}) ${h.name}`,
    description: h.kind,
    detail: `${h.file_path}${h.start_line ? `:${h.start_line}` : ''}`,
    hit: h,
  }));
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `Multiple matches for "${word}" — pick the one you mean`,
  });
  return pick?.hit;
}

async function openHit(
  folder: vscode.WorkspaceFolder,
  filePath: string,
  line?: number,
): Promise<void> {
  if (!filePath) return;
  const uri = filePath.startsWith('/')
    ? vscode.Uri.file(filePath)
    : vscode.Uri.joinPath(folder.uri, filePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  if (line && line > 0) {
    const pos = new vscode.Position(Math.max(0, line - 1), 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }
}

function wordAtCursor(editor: vscode.TextEditor): string | undefined {
  const range = editor.document.getWordRangeAtPosition(editor.selection.active);
  if (!range) return undefined;
  return editor.document.getText(range);
}

function activeFolder(): vscode.WorkspaceFolder | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const f = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (f) return f;
  }
  return vscode.workspace.workspaceFolders?.[0];
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
