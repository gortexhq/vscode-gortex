import * as vscode from 'vscode';
import { DaemonStatus, TrackedRepo } from './daemon';

/**
 * The daemon returns file paths as `<repo_prefix>/<relative/path>`, e.g.
 * `vscode-gortex/src/daemon.ts`. To open them in VS Code we need to map that
 * prefix back to the absolute repo root. We keep the mapping fresh by
 * subscribing to the status bar's updates.
 */
export class RepoIndex {
  private byPrefix = new Map<string, TrackedRepo>();

  update(status: DaemonStatus): void {
    this.byPrefix.clear();
    for (const repo of status.repos) {
      // The daemon's repo *name* doubles as the prefix in tool responses; the
      // last path segment is a sensible fallback for older daemon versions.
      this.byPrefix.set(repo.name, repo);
      const lastSeg = repo.path.split('/').pop();
      if (lastSeg && !this.byPrefix.has(lastSeg)) {
        this.byPrefix.set(lastSeg, repo);
      }
    }
  }

  /**
   * Best-effort resolve a daemon-style file path to an absolute URI.
   * Strategy:
   *   1. If the path is already absolute, use it as-is.
   *   2. Pull the first segment as the repo prefix and look it up.
   *   3. Fall back to joining against the first workspace folder.
   */
  resolve(filePath: string): vscode.Uri | undefined {
    if (!filePath) return undefined;
    if (filePath.startsWith('/')) return vscode.Uri.file(filePath);
    const slash = filePath.indexOf('/');
    if (slash > 0) {
      const prefix = filePath.slice(0, slash);
      const rest = filePath.slice(slash + 1);
      const repo = this.byPrefix.get(prefix);
      if (repo) return vscode.Uri.file(`${repo.path}/${rest}`);
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) return vscode.Uri.joinPath(folder.uri, filePath);
    return undefined;
  }

  /**
   * Reverse of `resolve`: given a local URI, return the daemon-style
   * `<repo_prefix>/<relative/path>` if the URI is inside a tracked repo. Used
   * by providers that need to disambiguate hits in the current file from
   * same-named symbols elsewhere.
   */
  relativePath(uri: vscode.Uri): string | undefined {
    const fsPath = uri.fsPath;
    for (const repo of this.byPrefix.values()) {
      if (fsPath === repo.path) return repo.name;
      const prefix = repo.path.endsWith('/') ? repo.path : repo.path + '/';
      if (fsPath.startsWith(prefix)) {
        return `${repo.name}/${fsPath.slice(prefix.length)}`;
      }
    }
    return undefined;
  }
}
