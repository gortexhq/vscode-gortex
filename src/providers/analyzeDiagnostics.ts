import * as vscode from 'vscode';
import { AnalyzeCache, AnalyzeSymbol } from '../metadata';
import { RepoIndex } from '../repoIndex';

/**
 * Surfaces AnalyzeCache results as Problems-panel entries so dead code and
 * cycles are visible without opening a side panel. Uses Hint/Info severity
 * (not Warning) — these are insights, not errors.
 */
export class AnalyzeDiagnostics implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly cache: AnalyzeCache, private readonly repos: RepoIndex) {
    this.collection = vscode.languages.createDiagnosticCollection('gortex-insights');
    this.disposables.push(this.cache.onDidUpdate(() => this.refresh()));
    this.refresh();
  }

  private refresh(): void {
    this.collection.clear();
    const byUri = new Map<string, vscode.Diagnostic[]>();
    const push = (uri: vscode.Uri, diag: vscode.Diagnostic) => {
      const key = uri.toString();
      const arr = byUri.get(key) ?? [];
      arr.push(diag);
      byUri.set(key, arr);
    };

    for (const sym of this.cache.allDead()) {
      const uri = this.uriFor(sym);
      if (!uri) continue;
      push(uri, this.deadDiag(sym));
    }
    // Cap hotspots in Problems panel — these are common, surface the worst.
    const hot = this.cache.allHotspots()
      .filter(s => (s.fan_in ?? 0) > 50)
      .sort((a, b) => (b.fan_in ?? 0) - (a.fan_in ?? 0))
      .slice(0, 50);
    for (const sym of hot) {
      const uri = this.uriFor(sym);
      if (!uri) continue;
      push(uri, this.hotDiag(sym));
    }
    for (const cycle of this.cache.allCycles()) {
      if (cycle.path.length === 0) continue;
      const first = cycle.path[0];
      const file = first.includes('::') ? first.slice(0, first.indexOf('::')) : '';
      if (!file) continue;
      const uri = this.repos.resolve(file);
      if (!uri) continue;
      push(uri, this.cycleDiag(cycle.path, cycle.kind));
    }

    for (const [key, diags] of byUri.entries()) {
      this.collection.set(vscode.Uri.parse(key), diags);
    }
  }

  private uriFor(sym: AnalyzeSymbol): vscode.Uri | undefined {
    if (!sym.file_path) return undefined;
    if (sym.file_path.startsWith('/')) return vscode.Uri.file(sym.file_path);
    return this.repos.resolve(sym.file_path);
  }

  private deadDiag(sym: AnalyzeSymbol): vscode.Diagnostic {
    const line = Math.max(0, (sym.start_line ?? 1) - 1);
    const d = new vscode.Diagnostic(
      new vscode.Range(line, 0, line, 0),
      `Dead code: ${sym.name} (${sym.kind}) has no callers or references`,
      vscode.DiagnosticSeverity.Hint,
    );
    d.source = 'gortex';
    d.code = 'dead_code';
    d.tags = [vscode.DiagnosticTag.Unnecessary];
    return d;
  }

  private hotDiag(sym: AnalyzeSymbol): vscode.Diagnostic {
    const line = Math.max(0, (sym.start_line ?? 1) - 1);
    const d = new vscode.Diagnostic(
      new vscode.Range(line, 0, line, 0),
      `Hotspot: ${sym.name} has ${sym.fan_in} incoming references — changes here have large blast radius`,
      vscode.DiagnosticSeverity.Information,
    );
    d.source = 'gortex';
    d.code = 'hotspot';
    return d;
  }

  private cycleDiag(path: string[], kind: string | undefined): vscode.Diagnostic {
    const d = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 0),
      `Dependency cycle (${kind ?? 'cycle'}): ${path.map(p => shortenId(p)).join(' → ')}`,
      vscode.DiagnosticSeverity.Information,
    );
    d.source = 'gortex';
    d.code = 'cycle';
    return d;
  }

  dispose(): void {
    this.collection.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

function shortenId(id: string): string {
  const sep = id.indexOf('::');
  return sep > 0 ? id.slice(sep + 2) : id;
}
