import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as vscode from 'vscode';
import { readConfig } from './config';

/**
 * Minimal MCP client over child_process stdio. `gortex mcp` is a thin proxy to
 * the long-lived daemon — by holding one connection open we avoid the multi-
 * second re-index cost of every `gortex query` CLI invocation.
 *
 * Protocol: newline-delimited JSON-RPC 2.0. We only need `initialize`,
 * `notifications/initialized`, and `tools/call`.
 */
export class McpClient implements vscode.Disposable {
  private proc: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buf = '';
  private readyPromise: Promise<void> | undefined;
  private restartingAt = 0;

  constructor(private readonly output: vscode.OutputChannel) {}

  private async ensureReady(): Promise<void> {
    if (this.proc && !this.proc.killed && this.readyPromise) return this.readyPromise;
    this.readyPromise = this.spawn();
    return this.readyPromise;
  }

  private spawn(): Promise<void> {
    const bin = readConfig().binaryPath;
    this.output.appendLine(`$ ${bin} mcp (long-lived)`);
    const proc = spawn(bin, ['mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    this.buf = '';

    proc.stdout.on('data', d => this.onStdout(d.toString()));
    proc.stderr.on('data', d => this.output.append(d.toString()));
    proc.on('exit', code => {
      this.output.appendLine(`gortex mcp exited (code=${code})`);
      this.failAllPending(new Error(`gortex mcp exited with code ${code}`));
      this.proc = undefined;
      this.readyPromise = undefined;
    });

    return this.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'vscode-gortex', version: '0.1.0' },
    }).then(() => {
      this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    });
  }

  /**
   * Call a Gortex MCP tool and parse the JSON payload returned in
   * `result.content[0].text`. The daemon's tools wrap their JSON output in
   * that envelope, so unwrapping it here keeps callers ergonomic.
   */
  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    await this.ensureReady();
    const res = (await this.request('tools/call', { name, arguments: args })) as ToolResponse;
    const text = res?.content?.[0]?.text;
    if (typeof text !== 'string') return res as unknown as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.proc) {
      // Re-spawn on demand — but not in a tight loop if the binary is broken.
      const now = Date.now();
      if (now - this.restartingAt < 2_000) {
        return Promise.reject(new Error('gortex mcp is not running'));
      }
      this.restartingAt = now;
      this.readyPromise = this.spawn();
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
      // 30s ceiling — symbol queries on a warm daemon return in <100ms;
      // anything that takes longer is almost certainly stuck.
      setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`MCP request '${method}' timed out after 30s`));
        }
      }, 30_000);
    });
  }

  private send(msg: unknown): void {
    if (!this.proc) return;
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
  }

  private onStdout(chunk: string): void {
    this.buf += chunk;
    let nl;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        // Non-JSON lines (e.g. log preamble) — ignore.
        continue;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const handler = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) handler.reject(new Error(msg.error.message ?? 'MCP error'));
        else handler.resolve(msg.result);
      }
      // Notifications (no id) are currently ignored — wire subscription
      // handlers here when v0.2 adds subscribe_daemon_health.
    }
  }

  private failAllPending(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }

  dispose(): void {
    this.failAllPending(new Error('MCP client disposed'));
    if (this.proc && !this.proc.killed) {
      try { this.proc.kill(); } catch { /* ignore */ }
    }
    this.proc = undefined;
    this.readyPromise = undefined;
  }
}

interface ToolResponse {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}
