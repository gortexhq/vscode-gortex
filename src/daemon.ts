import { spawn, execFile, ExecFileOptions } from 'child_process';
import * as vscode from 'vscode';
import { readConfig } from './config';

export interface TrackedRepo {
  name: string;
  workspace: string;
  path: string;
  files: number;
  nodes: number;
  edges: number;
}

export interface DaemonStatus {
  running: boolean;
  version?: string;
  pid?: number;
  uptime?: string;
  state?: string;
  sessions?: number;
  memory?: string;
  socket?: string;
  workspaces?: { name: string; repos: number; files: number; nodes: number; edges: number }[];
  repos: TrackedRepo[];
  raw: string;
}

export class GortexCli {
  constructor(private readonly output: vscode.OutputChannel) {}

  binary(): string {
    return readConfig().binaryPath;
  }

  /**
   * Run gortex with the given args and return stdout. Logs the invocation to
   * the output channel. Rejects with a CliError on non-zero exit.
   */
  run(args: string[], opts: ExecFileOptions = {}): Promise<string> {
    const bin = this.binary();
    const display = `$ ${bin} ${args.join(' ')}`;
    this.output.appendLine(display);
    return new Promise((resolve, reject) => {
      execFile(bin, args, { maxBuffer: 16 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
        if (stdout) this.output.append(stdout.toString());
        if (stderr) this.output.append(stderr.toString());
        if (err) {
          reject(new CliError(`${bin} ${args.join(' ')} failed: ${err.message}`, err));
          return;
        }
        resolve(stdout.toString());
      });
    });
  }

  /**
   * Spawn a long-running command (e.g. `daemon start --detach`) without
   * waiting. Output streams into the channel.
   */
  spawnDetached(args: string[]): void {
    const bin = this.binary();
    this.output.appendLine(`$ ${bin} ${args.join(' ')} (detached)`);
    const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
    child.unref();
  }

  async version(): Promise<string> {
    const out = await this.run(['version']);
    return out.split('\n')[0].trim();
  }

  /**
   * `gortex daemon status` is a rich text dump (header + workspace table +
   * repo table). We parse the bits we care about.
   *
   * If the daemon isn't running, gortex prints "daemon is not running" and
   * exits non-zero. We treat that as "not running" rather than an error.
   */
  async daemonStatus(): Promise<DaemonStatus> {
    let raw: string;
    try {
      raw = await this.run(['daemon', 'status']);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (/not running/i.test(msg) || /no such file/i.test(msg)) {
        return { running: false, repos: [], raw: msg };
      }
      throw err;
    }
    return parseDaemonStatus(raw);
  }

  async track(absPath: string): Promise<string> {
    return this.run(['track', absPath]);
  }

  async untrack(absPath: string): Promise<string> {
    return this.run(['untrack', absPath]);
  }

  async findSymbol(query: string, indexPath: string, limit = 25): Promise<SymbolHit[]> {
    const out = await this.run([
      'query',
      'symbol',
      query,
      '--format',
      'json',
      '--index',
      indexPath,
      '--limit',
      String(limit),
    ]);
    return parseJsonArray<SymbolHit>(out);
  }

  async callers(symbolId: string, indexPath: string, depth = 2): Promise<GraphHit[]> {
    const out = await this.run([
      'query',
      'callers',
      symbolId,
      '--format',
      'json',
      '--index',
      indexPath,
      '--depth',
      String(depth),
    ]);
    return parseJsonArray<GraphHit>(out);
  }

  async usages(symbolId: string, indexPath: string): Promise<GraphHit[]> {
    const out = await this.run([
      'query',
      'usages',
      symbolId,
      '--format',
      'json',
      '--index',
      indexPath,
    ]);
    return parseJsonArray<GraphHit>(out);
  }

  async dependents(symbolId: string, indexPath: string, depth = 3): Promise<GraphHit[]> {
    const out = await this.run([
      'query',
      'dependents',
      symbolId,
      '--format',
      'json',
      '--index',
      indexPath,
      '--depth',
      String(depth),
    ]);
    return parseJsonArray<GraphHit>(out);
  }
}

export interface SymbolHit {
  id: string;
  kind: string;
  name: string;
  file_path: string;
  start_line?: number;
  end_line?: number;
  language?: string;
  meta?: Record<string, unknown>;
}

export interface GraphHit {
  id: string;
  kind?: string;
  name?: string;
  file_path?: string;
  start_line?: number;
  end_line?: number;
  depth?: number;
}

export class CliError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'CliError';
  }
}

/**
 * The CLI sometimes mixes a JSON array with leading zap logger lines. We pull
 * out the first JSON array we can find so callers don't have to worry about it.
 */
function parseJsonArray<T>(out: string): T[] {
  const trimmed = out.trim();
  const start = trimmed.indexOf('[');
  if (start === -1) return [];
  const slice = trimmed.slice(start);
  try {
    return JSON.parse(slice) as T[];
  } catch {
    return [];
  }
}

const HEADER_RE = /^\s*(daemon|pid|socket|uptime|state|sessions|memory)\s+(.+)$/i;

export function parseDaemonStatus(raw: string): DaemonStatus {
  const status: DaemonStatus = { running: true, repos: [], raw };
  const lines = raw.split('\n');

  let section: 'header' | 'workspaces' | 'repos' | null = 'header';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^workspaces\s*:/i.test(line)) { section = 'workspaces'; continue; }
    if (/^tracked\s*repos\s*:/i.test(line)) { section = 'repos'; continue; }
    if (section === 'header') {
      const m = line.match(HEADER_RE);
      if (m) {
        const key = m[1].toLowerCase();
        const val = m[2].trim();
        switch (key) {
          case 'daemon':   status.version = val; break;
          case 'pid':      status.pid = Number(val) || undefined; break;
          case 'socket':   status.socket = val; break;
          case 'uptime':   status.uptime = val; break;
          case 'state':    status.state = val; break;
          case 'sessions': status.sessions = Number(val) || 0; break;
          case 'memory':   status.memory = val; break;
        }
      }
    } else if (section === 'workspaces') {
      const cells = splitTableRow(line);
      if (cells.length === 6 && cells[0] !== 'workspace' && /^\d/.test(cells[1])) {
        status.workspaces ??= [];
        status.workspaces.push({
          name:  cells[0],
          repos: Number(cells[1]) || 0,
          files: Number(cells[3]) || 0,
          nodes: Number(cells[4]) || 0,
          edges: Number(cells[5]) || 0,
        });
      }
    } else if (section === 'repos') {
      const cells = splitTableRow(line);
      if (cells.length >= 11 && cells[0] !== 'repo') {
        status.repos.push({
          name:      cells[0],
          workspace: cells[1],
          files:     Number(cells[3]) || 0,
          nodes:     Number(cells[4]) || 0,
          edges:     Number(cells[5]) || 0,
          path:      cells[cells.length - 1],
        });
      }
    }
  }
  return status;
}

/**
 * Box-drawing tables come back like `│ a │ b │ c │`. Split on the vertical bar
 * and trim each cell. Decorative rows (`├`, `┌`, `└`) get filtered out by the
 * caller via length / header checks.
 */
function splitTableRow(line: string): string[] {
  if (!line.includes('│')) return [];
  return line.split('│').map(s => s.trim()).filter(s => s.length > 0);
}
