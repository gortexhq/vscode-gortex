import * as vscode from 'vscode';
import { McpClient } from '../mcpClient';

/**
 * Forwards the daemon's `notifications/diagnostics` push stream into VS Code's
 * Problems panel via a DiagnosticCollection. Each push carries a per-file
 * snapshot — we replace the file's diagnostics wholesale.
 *
 * The plumbing is in place but currently dormant: the daemon registers
 * subscriptions but doesn't yet publish the matching notifications back
 * through `gortex mcp` stdio. This will start working with no extension-side
 * changes once the daemon's publish path is wired up.
 */
export class GortexDiagnostics implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;
  private subscription: vscode.Disposable | undefined;

  constructor(private readonly mcp: McpClient, private readonly output: vscode.OutputChannel) {
    this.collection = vscode.languages.createDiagnosticCollection('gortex');
  }

  async start(): Promise<void> {
    try {
      this.subscription = await this.mcp.subscribe('diagnostics', payload => {
        try { this.handle(payload); } catch (err) { this.output.appendLine(`diag handler: ${(err as Error).message}`); }
      });
    } catch (err) {
      this.output.appendLine(`subscribe_diagnostics failed: ${(err as Error).message}`);
    }
  }

  private handle(payload: unknown): void {
    const event = payload as DiagnosticsEvent | undefined;
    if (!event || typeof event !== 'object') return;
    const uri = event.uri
      ? vscode.Uri.parse(event.uri)
      : event.path
        ? vscode.Uri.file(event.path)
        : undefined;
    if (!uri) return;
    const items = (event.diagnostics ?? []).map(toDiagnostic);
    this.collection.set(uri, items);
  }

  dispose(): void {
    this.subscription?.dispose();
    this.collection.dispose();
  }
}

function toDiagnostic(d: RawDiagnostic): vscode.Diagnostic {
  const range = new vscode.Range(
    Math.max(0, (d.range?.start?.line ?? 1) - 1),
    d.range?.start?.character ?? 0,
    Math.max(0, (d.range?.end?.line ?? d.range?.start?.line ?? 1) - 1),
    d.range?.end?.character ?? 0,
  );
  const diag = new vscode.Diagnostic(range, d.message ?? '', toSeverity(d.severity));
  if (d.source) diag.source = d.source;
  if (d.code !== undefined) diag.code = String(d.code);
  return diag;
}

function toSeverity(s: number | undefined): vscode.DiagnosticSeverity {
  switch (s) {
    case 1: return vscode.DiagnosticSeverity.Error;
    case 2: return vscode.DiagnosticSeverity.Warning;
    case 3: return vscode.DiagnosticSeverity.Information;
    case 4: return vscode.DiagnosticSeverity.Hint;
    default: return vscode.DiagnosticSeverity.Warning;
  }
}

interface DiagnosticsEvent {
  uri?: string;
  path?: string;
  diagnostics?: RawDiagnostic[];
}

interface RawDiagnostic {
  message?: string;
  severity?: number;
  source?: string;
  code?: string | number;
  range?: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } };
}
