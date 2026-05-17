import * as vscode from 'vscode';
import { GraphQueries } from './query';
import { McpClient } from './mcpClient';

/**
 * Per-symbol stats (caller / dependent / usage counts) cached in memory so the
 * editor surfaces (inlay hints, hover, code lens, status bar) don't pay
 * latency for every render. Sub-millisecond on cache hit, ~5-50ms on miss.
 *
 * Cache entries are invalidated when the daemon publishes a `stale_refs`
 * notification for that symbol — dormant today but the wiring is in place.
 * A safety TTL keeps the cache fresh even when notifications never arrive.
 */
export class MetadataCache implements vscode.Disposable {
  private readonly cache = new Map<string, { stats: SymbolStats; at: number }>();
  private readonly inflight = new Map<string, Promise<SymbolStats>>();
  private subscription: vscode.Disposable | undefined;
  private readonly ttlMs = 60_000;

  constructor(private readonly queries: GraphQueries, mcp: McpClient) {
    // Once the daemon's publish path is wired up, every stale_refs event
    // invalidates the affected symbol. Until then, the TTL keeps us fresh.
    mcp.subscribe('stale_refs', payload => this.invalidateFromEvent(payload))
      .then(d => { this.subscription = d; })
      .catch(() => undefined);
  }

  async stats(id: string): Promise<SymbolStats> {
    const fresh = this.cache.get(id);
    if (fresh && Date.now() - fresh.at < this.ttlMs) return fresh.stats;
    const existing = this.inflight.get(id);
    if (existing) return existing;
    const p = this.fetch(id);
    this.inflight.set(id, p);
    try {
      const stats = await p;
      this.cache.set(id, { stats, at: Date.now() });
      return stats;
    } finally {
      this.inflight.delete(id);
    }
  }

  invalidate(id: string): void {
    this.cache.delete(id);
    this.inflight.delete(id);
  }

  invalidateAll(): void {
    this.cache.clear();
    this.inflight.clear();
  }

  private async fetch(id: string): Promise<SymbolStats> {
    // Three counts in parallel — they're independent and the daemon serves
    // each in 0-5ms when warm.
    const [callers, dependents, usages] = await Promise.all([
      this.queries.callers(id, 1, 500).catch(() => []),
      this.queries.dependents(id, 2, 500).catch(() => []),
      this.queries.usages(id, 500).catch(() => []),
    ]);
    return {
      callers: callers.length,
      dependents: dependents.length,
      usages: usages.length,
    };
  }

  private invalidateFromEvent(payload: unknown): void {
    const event = payload as { ids?: string[]; symbols?: string[] } | undefined;
    const ids = event?.ids ?? event?.symbols;
    if (Array.isArray(ids)) {
      for (const id of ids) this.invalidate(id);
    } else {
      // Coarser signal — wipe everything; cheaper than guessing.
      this.invalidateAll();
    }
  }

  dispose(): void {
    this.subscription?.dispose();
    this.cache.clear();
    this.inflight.clear();
  }
}

export interface SymbolStats {
  callers: number;
  dependents: number;
  usages: number;
}

/**
 * Workspace-level analysis results (hotspots, dead code, cycles). These come
 * from a single `analyze` call per kind and are refreshed on a slow timer
 * (default every 5 minutes) — they don't change moment-to-moment.
 */
export class AnalyzeCache implements vscode.Disposable {
  private hotspotsByFile = new Map<string, AnalyzeSymbol[]>();
  private deadByFile = new Map<string, AnalyzeSymbol[]>();
  private cycles: AnalyzeCycle[] = [];
  private hotIds = new Set<string>();
  private deadIds = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  private readonly _onDidUpdate = new vscode.EventEmitter<void>();
  readonly onDidUpdate = this._onDidUpdate.event;

  constructor(private readonly queries: GraphQueries) {}

  start(intervalMs = 5 * 60_000): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), intervalMs);
  }

  hotspotsFor(file: string): AnalyzeSymbol[] { return this.hotspotsByFile.get(file) ?? []; }
  deadFor(file: string): AnalyzeSymbol[] { return this.deadByFile.get(file) ?? []; }
  isHot(id: string): boolean { return this.hotIds.has(id); }
  isDead(id: string): boolean { return this.deadIds.has(id); }
  allHotspots(): AnalyzeSymbol[] { return [...this.hotspotsByFile.values()].flat(); }
  allDead(): AnalyzeSymbol[] { return [...this.deadByFile.values()].flat(); }
  allCycles(): AnalyzeCycle[] { return this.cycles; }

  async refresh(): Promise<void> {
    // `max_bytes: 0` opts out of the daemon's per-response byte budget;
    // a generous `limit` overrides the row-count cap. Without both, the
    // response is sorted alphabetically by file path then truncated, so
    // any hotspot or dead symbol whose file sorts past the cut never
    // reaches the gutter or file decorations. We're populating a local
    // cache that's tens of KB at most — a full payload is the right
    // call here, even on workspaces with 100k+ dead entries.
    const wideOpts = { limit: 100000, max_bytes: 0 };
    const [hot, dead, cycles] = await Promise.all([
      this.queries.analyze('hotspots', wideOpts).catch(() => ({ hotspots: [] })),
      this.queries.analyze('dead_code', wideOpts).catch(() => ({ dead_code: [] })),
      this.queries.analyze('cycles', wideOpts).catch(() => ({ cycles: [] })),
    ]);
    const deadRaw = (dead as { dead_code?: AnalyzeSymbol[] }).dead_code ?? [];
    this.hotspotsByFile = bucketByFile((hot as { hotspots?: AnalyzeSymbol[] }).hotspots ?? []);
    this.deadByFile = bucketByFile(deadRaw.filter(isMeaningfulDeadCodeKind));
    this.cycles = (cycles as { cycles?: AnalyzeCycle[] }).cycles ?? [];
    this.hotIds = new Set([...this.hotspotsByFile.values()].flat().map(s => s.id));
    this.deadIds = new Set([...this.deadByFile.values()].flat().map(s => s.id));
    this._onDidUpdate.fire();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this._onDidUpdate.dispose();
  }
}

export interface AnalyzeSymbol {
  id: string;
  name: string;
  kind: string;
  file_path: string;
  start_line?: number;
  fan_in?: number;
  fan_out?: number;
  complexity_score?: number;
}

export interface AnalyzeCycle {
  path: string[];
  kind?: string;
  severity?: number;
}

function bucketByFile(symbols: AnalyzeSymbol[]): Map<string, AnalyzeSymbol[]> {
  const out = new Map<string, AnalyzeSymbol[]>();
  for (const s of symbols) {
    if (!s.file_path) continue;
    const arr = out.get(s.file_path) ?? [];
    arr.push(s);
    out.set(s.file_path, arr);
  }
  return out;
}

/**
 * The daemon's `dead_code` analyzer ships its own kind filter (functions,
 * methods, types, interfaces by default), but the extension applies a
 * second pass as defense-in-depth: if a future daemon version regresses
 * and starts surfacing fields / params / npm modules / TODO comments
 * again, the user shouldn't see skulls plastered on every line of every
 * file. The set below is the agreed visual contract — show gutters and
 * decorations only for top-level definitional symbols where "is this
 * dead?" has an unambiguous answer.
 *
 * Mirror the daemon's `neverDeadCodeKinds` set
 * (gortex/internal/analysis/deadcode.go) — both sides must agree.
 */
const MEANINGFUL_DEAD_CODE_KINDS = new Set([
  'function', 'method', 'type', 'interface',
  // The opt-in kinds: if the user explicitly enabled them on the
  // daemon side, the extension still shows them. Skip param / closure
  // / module / string / enum_member / etc. unconditionally — those
  // are noise regardless of opt-in.
  'field', 'variable', 'constant',
]);

function isMeaningfulDeadCodeKind(s: AnalyzeSymbol): boolean {
  return MEANINGFUL_DEAD_CODE_KINDS.has(s.kind);
}
