import * as vscode from 'vscode';
import { AnalyzeCache } from '../metadata';
import { RepoIndex } from '../repoIndex';

/**
 * Drives the file-tree (Explorer) and tab badges. Same VS Code API powers
 * both: when a file contains hotspots or dead symbols, we publish a small
 * badge + tooltip + a color tint.
 */
export class GortexFileDecorations implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  private subscription: vscode.Disposable;

  constructor(private readonly cache: AnalyzeCache, private readonly repos: RepoIndex) {
    // When the workspace-wide analysis refreshes, ask VS Code to re-poll every
    // file decoration. Undefined = refresh all.
    this.subscription = this.cache.onDidUpdate(() => this._onDidChange.fire(undefined));
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== 'file') return undefined;
    const repoRel = this.repos.relativePath(uri);
    if (!repoRel) return undefined;

    const hot = this.cache.hotspotsFor(repoRel);
    const dead = this.cache.deadFor(repoRel);
    if (hot.length === 0 && dead.length === 0) return undefined;

    // Badge: VS Code allows max 2 chars. We bias toward hot (more useful to
    // know) and fall back to dead-only.
    const badge = hot.length > 0
      ? (hot.length > 9 ? '🔥' : String(hot.length))
      : '💀';

    const parts: string[] = [];
    if (hot.length > 0) parts.push(`${hot.length} hotspot${hot.length === 1 ? '' : 's'}`);
    if (dead.length > 0) parts.push(`${dead.length} dead`);
    const tooltip = `Gortex: ${parts.join(' · ')}`;

    return {
      badge,
      tooltip,
      color: hot.length > 0
        ? new vscode.ThemeColor('charts.orange')
        : new vscode.ThemeColor('disabledForeground'),
      propagate: false,
    };
  }

  dispose(): void {
    this.subscription.dispose();
    this._onDidChange.dispose();
  }
}
