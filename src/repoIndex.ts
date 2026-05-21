import * as vscode from 'vscode';
import { DaemonStatus, TrackedRepo } from './daemon';

/** Windows file systems are case-insensitive; Unix is case-sensitive. */
const FOLD_CASE = process.platform === 'win32';

/**
 * Convert backslashes to forward slashes — a no-op off Windows. The
 * forward-slash form matches the daemon's graph node IDs, which are
 * `/`-separated on every host OS regardless of native path style.
 */
export function toForwardSlash(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Normalise a path for comparison: forward slashes, no trailing slash,
 * case-folded on case-insensitive (Windows) file systems. */
function normForCompare(p: string): string {
  const fwd = toForwardSlash(p).replace(/\/+$/, '');
  return FOLD_CASE ? fwd.toLowerCase() : fwd;
}

/**
 * Compare two filesystem paths for equality, tolerating separator and
 * (on Windows) drive-letter / case differences. Used to match a workspace
 * folder against the daemon's tracked-repo list.
 */
export function samePath(a: string, b: string): boolean {
  return normForCompare(a) === normForCompare(b);
}

/**
 * Does `absPath` end with the daemon-style (forward-slash) `relPath`?
 * Both sides are separator- and case-normalised first, so a Windows
 * `C:\…\src\foo.ts` correctly matches a daemon `repo/src/foo.ts`.
 */
export function pathEndsWith(absPath: string, relPath: string): boolean {
  return normForCompare(absPath).endsWith(normForCompare(relPath));
}

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
      // Split on `/` after normalising — `repo.path` is backslash-separated
      // on Windows, where a raw `split('/')` would yield the whole string.
      const lastSeg = toForwardSlash(repo.path).replace(/\/+$/, '').split('/').pop();
      if (lastSeg && !this.byPrefix.has(lastSeg)) {
        this.byPrefix.set(lastSeg, repo);
      }
    }
  }

  /**
   * Best-effort resolve a daemon-style file path to an absolute URI.
   * Strategy:
   *   1. If the path is already absolute (Unix `/…` or Windows `C:\…`), use it.
   *   2. Pull the first segment as the repo prefix and look it up.
   *   3. Fall back to joining against the first workspace folder.
   */
  resolve(filePath: string): vscode.Uri | undefined {
    if (!filePath) return undefined;
    if (filePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(filePath)) {
      return vscode.Uri.file(filePath);
    }
    const slash = filePath.indexOf('/');
    if (slash > 0) {
      const prefix = filePath.slice(0, slash);
      const rest = filePath.slice(slash + 1);
      const repo = this.byPrefix.get(prefix);
      // `Uri.file` normalises the repo root (drive letter, backslashes);
      // `joinPath` then appends the daemon's forward-slash relative segments.
      if (repo) return vscode.Uri.joinPath(vscode.Uri.file(repo.path), rest);
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
    // `uri.fsPath` is backslash-separated on Windows; the daemon's graph IDs
    // are always `/`-separated. Compare on a normalised form, but slice the
    // relative tail from the slash-converted yet case-preserved string so the
    // emitted ID keeps the file's real casing.
    const fwd = toForwardSlash(uri.fsPath).replace(/\/+$/, '');
    const probe = FOLD_CASE ? fwd.toLowerCase() : fwd;
    for (const repo of this.byPrefix.values()) {
      const repoProbe = normForCompare(repo.path);
      if (probe === repoProbe) return repo.name;
      const prefix = repoProbe + '/';
      if (probe.startsWith(prefix)) {
        return `${repo.name}/${fwd.slice(prefix.length)}`;
      }
    }
    return undefined;
  }
}
