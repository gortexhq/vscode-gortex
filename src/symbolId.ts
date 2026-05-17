import * as vscode from 'vscode';

/**
 * Build the most likely Gortex graph ID for a DocumentSymbol, given the
 * symbol's file path (in `repoPrefix/rest.ext` form) and the surrounding
 * source. Format follows the daemon's extractors:
 *
 *   <repoRel>::<funcName>                 plain function / top-level
 *   <repoRel>::<Receiver>.<methodName>    method on a class/struct/interface
 *
 * Method receivers are detected two ways:
 *   1. Ancestor class/struct/interface in the DocumentSymbol tree (works for
 *      TypeScript / Python / Java / Rust impl blocks — LSPs that nest
 *      methods under their owning type).
 *   2. Source-line parse for `func (recv *T) name(...)` — Go's gopls returns
 *      methods as top-level symbols, so we have to recover the receiver
 *      from the line of source.
 *
 * Returns the most-specific guess first; callers can fall back to the
 * function-only form when get_symbol comes back empty.
 */
export function candidateSymbolIds(
  repoRel: string,
  sym: vscode.DocumentSymbol,
  bareName: string,
  document: vscode.TextDocument,
  ancestors: vscode.DocumentSymbol[],
): string[] {
  const ids: string[] = [];

  // 1. Use class-like ancestor from the symbol tree (TS, Py, Java, …).
  const cls = [...ancestors].reverse().find(a =>
    a.kind === vscode.SymbolKind.Class ||
    a.kind === vscode.SymbolKind.Interface ||
    a.kind === vscode.SymbolKind.Struct ||
    a.kind === vscode.SymbolKind.Namespace ||
    a.kind === vscode.SymbolKind.Module,
  );
  if (cls?.name) {
    ids.push(`${repoRel}::${cls.name}.${bareName}`);
  }

  // 2. Parse the Go-style receiver from source line.
  try {
    const line = document.lineAt(sym.selectionRange.start.line).text;
    // Matches `func (h *Handler) name(...)` or `func (h Handler) name(...)`.
    const m = line.match(/^\s*func\s*\(\s*\w+\s+\*?(\w+)\s*\)\s*\w/);
    if (m && m[1]) {
      const id = `${repoRel}::${m[1]}.${bareName}`;
      if (!ids.includes(id)) ids.push(id);
    }
  } catch { /* lineAt can throw for stale ranges; fall through */ }

  // 3. Plain top-level form — always offered as a fallback.
  ids.push(`${repoRel}::${bareName}`);

  return ids;
}

/**
 * Walk a DocumentSymbol forest, yielding every function/method/constructor
 * together with its ancestor chain (outermost first). Callers use the
 * ancestors to construct accurate IDs for class methods without re-walking
 * the tree.
 */
export function walkFunctions(
  symbols: vscode.DocumentSymbol[],
): { sym: vscode.DocumentSymbol; ancestors: vscode.DocumentSymbol[] }[] {
  const out: { sym: vscode.DocumentSymbol; ancestors: vscode.DocumentSymbol[] }[] = [];
  const walk = (sym: vscode.DocumentSymbol, stack: vscode.DocumentSymbol[]) => {
    if (sym.kind === vscode.SymbolKind.Function ||
        sym.kind === vscode.SymbolKind.Method ||
        sym.kind === vscode.SymbolKind.Constructor) {
      out.push({ sym, ancestors: stack });
    }
    const childStack = [...stack, sym];
    for (const child of sym.children ?? []) walk(child, childStack);
  };
  for (const s of symbols) walk(s, []);
  return out;
}

/**
 * The unambiguous identifier text for a DocumentSymbol — what the user
 * actually typed in source. Avoids LSP-specific `sym.name` quirks like
 * gopls's qualified `(*Handler).foo`.
 */
export function bareIdentifier(document: vscode.TextDocument, sym: vscode.DocumentSymbol): string {
  try {
    const text = document.getText(sym.selectionRange).trim();
    return text || sym.name;
  } catch {
    return sym.name;
  }
}
