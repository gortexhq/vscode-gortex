import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as vscode from 'vscode';
import { readConfig } from './config';

/**
 * Minimal MCP client over child_process stdio. `gortex mcp` is a thin proxy to
 * the long-lived daemon — by holding one connection open we avoid the multi-
 * second re-index cost of every `gortex query` CLI invocation.
 *
 * Protocol: newline-delimited JSON-RPC 2.0. We use `initialize`, `tools/call`,
 * and JSON-RPC notifications (id-less messages) for the daemon's push streams
 * — daemon_health, workspace_readiness, stale_refs, diagnostics.
 */
export class McpClient implements vscode.Disposable {
  private proc: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buf = '';
  private readyPromise: Promise<void> | undefined;
  private restartingAt = 0;

  private readonly notificationListeners = new Map<string, Set<NotificationListener>>();
  private readonly activeSubscriptions = new Set<string>();

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
      this.activeSubscriptions.clear();
    });

    return this.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: { resources: { subscribe: true } },
      clientInfo: { name: 'vscode-gortex', version: '0.2.0' },
    }).then(async () => {
      this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      await this.promoteDeferredTools();
    });
  }

  /**
   * Promote the subscribe/unsubscribe tool pairs out of the daemon's lazy
   * tool catalog. Gortex's lazy-tool registration withholds non-"hot"
   * tools — including every `subscribe_*` / `unsubscribe_*` pair — from
   * `tools/list`, and they are not callable via `tools/call` until
   * promoted. `tools_search` is itself eagerly registered; a `select:`
   * query promotes the named tools into the live server for the rest of
   * the daemon's lifetime.
   *
   * Best-effort: an older daemon (no lazy tools) already has these tools
   * live and treats the `select:` as a harmless lookup; a daemon with
   * the registry disabled likewise. Failures are swallowed so a hiccup
   * here never blocks startup — worst case the subscriptions degrade
   * gracefully (their call sites all defend against a failed subscribe).
   */
  private async promoteDeferredTools(): Promise<void> {
    const names = SUBSCRIPTION_TOPICS.flatMap(t => [`subscribe_${t}`, `unsubscribe_${t}`]);
    try {
      // request() directly, not callTool() — callTool awaits ensureReady(),
      // which would deadlock on the still-pending spawn promise we're inside.
      await this.request('tools/call', {
        name: 'tools_search',
        arguments: { query: `select:${names.join(',')}` },
      });
    } catch (err) {
      this.output.appendLine(`tools_search promotion failed: ${(err as Error).message}`);
    }
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

  /**
   * Subscribe to a server-pushed notification topic. Returns a Disposable that
   * removes the listener. The first subscriber on a topic also calls the
   * matching `subscribe_<topic>` tool on the daemon; the last one to remove
   * calls `unsubscribe_<topic>`.
   *
   * Topics: 'daemon_health', 'workspace_readiness', 'stale_refs',
   * 'diagnostics'. The protocol method name is `notifications/<topic>`.
   */
  async subscribe(
    topic: NotificationTopic,
    listener: NotificationListener,
    subscribeArgs: Record<string, unknown> = {},
  ): Promise<vscode.Disposable> {
    const method = `notifications/${topic}`;
    let listeners = this.notificationListeners.get(method);
    if (!listeners) {
      listeners = new Set();
      this.notificationListeners.set(method, listeners);
    }
    listeners.add(listener);

    // Server-side subscribe on first listener.
    if (!this.activeSubscriptions.has(topic)) {
      try {
        await this.callTool(`subscribe_${topic}`, subscribeArgs);
        this.activeSubscriptions.add(topic);
      } catch (err) {
        listeners.delete(listener);
        if (listeners.size === 0) this.notificationListeners.delete(method);
        throw err;
      }
    }

    return new vscode.Disposable(() => {
      const set = this.notificationListeners.get(method);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) {
        this.notificationListeners.delete(method);
        if (this.activeSubscriptions.delete(topic)) {
          // Fire-and-forget — the server is idempotent and we don't want to
          // wait inside a dispose handler.
          this.callTool(`unsubscribe_${topic}`, {}).catch(() => undefined);
        }
      }
    });
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
      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(line) as JsonRpcMessage;
      } catch {
        // Non-JSON lines (e.g. log preamble) — ignore.
        continue;
      }
      if (msg.id !== undefined && this.pending.has(msg.id as number)) {
        const handler = this.pending.get(msg.id as number)!;
        this.pending.delete(msg.id as number);
        if (msg.error) handler.reject(new Error(msg.error.message ?? 'MCP error'));
        else handler.resolve(msg.result);
      } else if (msg.method && msg.method.startsWith('notifications/')) {
        this.dispatchNotification(msg.method, msg.params);
      }
    }
  }

  private dispatchNotification(method: string, params: unknown): void {
    const listeners = this.notificationListeners.get(method);
    if (!listeners) return;
    for (const fn of listeners) {
      try {
        fn(params);
      } catch (err) {
        this.output.appendLine(`subscription handler error (${method}): ${(err as Error).message}`);
      }
    }
  }

  private failAllPending(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }

  dispose(): void {
    this.failAllPending(new Error('MCP client disposed'));
    this.notificationListeners.clear();
    this.activeSubscriptions.clear();
    if (this.proc && !this.proc.killed) {
      try { this.proc.kill(); } catch { /* ignore */ }
    }
    this.proc = undefined;
    this.readyPromise = undefined;
  }
}

/**
 * The server-push topics the extension knows about. Doubles as the list
 * of `subscribe_*` / `unsubscribe_*` tool pairs promoted out of the
 * daemon's lazy-tool catalog at connect time — see promoteDeferredTools.
 */
export const SUBSCRIPTION_TOPICS = [
  'daemon_health',
  'workspace_readiness',
  'stale_refs',
  'diagnostics',
] as const;

export type NotificationTopic = (typeof SUBSCRIPTION_TOPICS)[number];

export type NotificationListener = (params: unknown) => void;

interface ToolResponse {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

interface JsonRpcMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}
