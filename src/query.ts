import { McpClient } from './mcpClient';

/**
 * Daemon-backed graph queries. These hit the long-lived `gortex mcp` proxy
 * over MCP/JSON-RPC, so each call is ~1-40ms instead of the 6-12 seconds
 * the equivalent `gortex query` CLI invocation takes (which re-indexes the
 * whole repo from scratch every time).
 */
export class GraphQueries {
  constructor(private readonly mcp: McpClient) {}

  /**
   * Exact lookup of a graph node by ID. Use when you can construct the ID
   * locally (e.g. `repoRel::funcName` or `repoRel::Receiver.methodName`) —
   * far more reliable than searching by name, which can return same-named
   * symbols from anywhere in the workspace.
   */
  async getSymbol(id: string): Promise<SymbolHit | undefined> {
    try {
      const res = await this.mcp.callTool<SymbolHit | string>('get_symbol', { id });
      // The daemon returns the raw string "symbol not found" for misses,
      // which our unwrap step deserialises to a string. Treat that as a miss.
      if (typeof res === 'string') return undefined;
      return res;
    } catch {
      return undefined;
    }
  }

  async searchSymbols(query: string, limit = 25): Promise<SymbolHit[]> {
    const res = await this.mcp.callTool<SearchSymbolsResponse>('search_symbols', {
      query,
      limit,
    });
    return res.results ?? [];
  }

  async callers(id: string, depth = 2, limit = 50): Promise<GraphNode[]> {
    const res = await this.mcp.callTool<GraphResponse>('get_callers', { id, depth, limit });
    return excludeSelf(res.nodes ?? [], id);
  }

  async usages(id: string, limit = 50): Promise<GraphNode[]> {
    const res = await this.mcp.callTool<GraphResponse>('find_usages', { id, limit });
    return excludeSelf(res.nodes ?? [], id);
  }

  async dependents(id: string, depth = 3, limit = 50): Promise<GraphNode[]> {
    const res = await this.mcp.callTool<GraphResponse>('get_dependents', { id, depth, limit });
    return excludeSelf(res.nodes ?? [], id);
  }

  /** Outgoing call graph (what this function calls, transitively). */
  async callChain(id: string, depth = 2, limit = 50): Promise<GraphNode[]> {
    const res = await this.mcp.callTool<GraphResponse>('get_call_chain', { id, depth, limit });
    return excludeSelf(res.nodes ?? [], id);
  }

  /** Upstream dependencies (what this symbol depends on). */
  async dependencies(id: string, depth = 2, limit = 50): Promise<GraphNode[]> {
    const res = await this.mcp.callTool<GraphResponse>('get_dependencies', { id, depth, limit });
    return excludeSelf(res.nodes ?? [], id);
  }

  /** Implementations of an interface. */
  async implementations(id: string): Promise<GraphNode[]> {
    const res = await this.mcp.callTool<GraphResponse>('find_implementations', { id });
    return excludeSelf(res.nodes ?? [], id);
  }

  /**
   * Unified analyzer dispatch. The return shape is kind-specific — callers
   * should know which key to read (e.g. `{hotspots: [...]}`, `{dead_code:
   * [...]}`, `{cycles: [...]}`).
   */
  async analyze<T = unknown>(kind: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.mcp.callTool<T>('analyze', { kind, ...args });
  }
}

export interface SymbolHit {
  id: string;
  name: string;
  kind: string;
  file_path: string;
  start_line?: number;
  end_line?: number;
  visibility?: string;
  language?: string;
  repo_prefix?: string;
  project_id?: string;
  workspace_id?: string;
}

export interface GraphNode extends SymbolHit {
  depth?: number;
}

interface SearchSymbolsResponse {
  results: SymbolHit[] | null;
  total?: number;
  truncated?: boolean;
}

interface GraphResponse {
  nodes: GraphNode[] | null;
  edges?: unknown;
}

function excludeSelf(nodes: GraphNode[], id: string): GraphNode[] {
  return nodes.filter(n => n.id !== id);
}
