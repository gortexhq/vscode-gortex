import * as vscode from 'vscode';
import { ActiveSymbolTracker, ActiveSymbol } from './activeSymbol';
import { MetadataCache } from './metadata';

/**
 * Status-bar item that mirrors what's under the cursor:
 *
 *   $(symbol-method) parseDaemonStatus · 12c · 28d · 3i
 *
 * Sits left of the daemon-health item so the two read naturally together.
 * Cheap: piggybacks on MetadataCache (already used by inlay hints + hover).
 */
export class CursorStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private token = 0;

  constructor(private readonly tracker: ActiveSymbolTracker, private readonly metadata: MetadataCache) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    this.item.command = 'gortex.symbol.find';
    this.disposables.push(
      this.tracker.onDidChange(s => void this.render(s)),
    );
  }

  private async render(symbol: ActiveSymbol | undefined): Promise<void> {
    const myToken = ++this.token;
    if (!symbol) {
      this.item.hide();
      return;
    }
    const stats = await this.metadata.stats(symbol.hit.id);
    if (myToken !== this.token) return;
    this.item.text = `${kindIcon(symbol.hit.kind)} ${symbol.hit.name} · ${stats.callers}c · ${stats.dependents}d · ${stats.usages}u`;
    this.item.tooltip = `${symbol.hit.name} (${symbol.hit.kind})\n${stats.callers} callers · ${stats.dependents} dependents · ${stats.usages} usages\nClick to open symbol search`;
    this.item.show();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.item.dispose();
  }
}

function kindIcon(kind: string | undefined): string {
  switch ((kind ?? '').toLowerCase()) {
    case 'function': case 'func':   return '$(symbol-function)';
    case 'method':                  return '$(symbol-method)';
    case 'type': case 'class':      return '$(symbol-class)';
    case 'interface':               return '$(symbol-interface)';
    case 'struct':                  return '$(symbol-struct)';
    case 'enum':                    return '$(symbol-enum)';
    case 'variable': case 'var':    return '$(symbol-variable)';
    case 'constant': case 'const':  return '$(symbol-constant)';
    case 'field':                   return '$(symbol-field)';
    default:                        return '$(symbol-misc)';
  }
}
