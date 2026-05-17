# Changelog

All notable changes to **Gortex for VS Code** are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
versions follow [Semantic Versioning](https://semver.org/).

## [0.3.3] - 2026-05-17

### Changed
- **Inlay hints + CodeLens now construct graph IDs directly** instead of
  going through fuzzy `search_symbols`. We already have everything we need
  locally — file path, bare identifier (from `selectionRange`), and receiver
  type (parsed from the `func (recv *T)` line for Go, or taken from the
  parent class/struct/interface DocumentSymbol for TS/Python/Java/Rust). So
  we build the ID — `<repoRel>::<name>` or `<repoRel>::<Receiver>.<name>` —
  and call `get_symbol(id)` directly. One ~1-2ms round trip per symbol.
  Deterministic.
- This eliminates an entire class of bugs that the previous search-based
  approach had — wrong-attribution to same-named symbols in other repos,
  flaky behavior on common short names like `Test`/`Run`/`init`, and the
  whole BM25-limit-threshold tuning rabbit hole. The v0.3.1 and v0.3.2
  patches were really attempts to make a wrong-tool-for-the-job (search)
  behave; this replaces it with the right tool (direct lookup).

### Added
- `GraphQueries.getSymbol(id)` — single-shot lookup by graph ID.
- `src/symbolId.ts` — shared `candidateSymbolIds()` and `walkFunctions()`
  helpers consumed by both the inlay-hints and code-lens providers.

## [0.3.2] - 2026-05-17

### Fixed
- **Inlay hints + CodeLens were showing stats from same-named symbols in
  other repos.** When a freshly-added method like `func (b *Node) Test()`
  didn't have a graph node yet (or its in-file hit fell off the top 25),
  the provider silently fell back to `hits[0]` — whichever popular `Test`
  function BM25 ranked first — and rendered its 36 callers / 46 dependents
  as if they belonged to your function. Now requires both same `file_path`
  **and** `start_line` within 10 lines of the document symbol; if no hit
  matches, no hint renders. Output channel logs the symbol as "unresolved".

### Note
- If your `.gortex.yaml` has `watch.enabled: false`, freshly-edited symbols
  won't appear in the graph until you re-index. Until then, those symbols
  legitimately have no hint — which is what you now see.

## [0.3.1] - 2026-05-17

### Fixed
- **Inlay hints missing on Go methods** (and any language whose LSP returns
  qualified symbol names). Gopls emits `(*Handler).foo` as the symbol name;
  passing that straight to `search_symbols` poisoned the BM25 ranking
  ("Handler" matched 15+ unrelated symbols) and the in-file hit was rarely
  in the top 5, so the provider silently failed for every method while plain
  functions worked. Now reads the bare identifier from
  `document.getText(selectionRange)` and falls back to the qualified name if
  needed. Bumped per-symbol search limit from 5 to 25.

### Added
- Output channel logging on every inlay-hint pass. Format:
  `[inlayHints] <path>: N rendered, M hidden (zero stats), K unresolved (of T targets)`
  Open `View → Output → Gortex` to debug missing hints in 30 seconds.

## [0.3.0] - 2026-05-17

The "ambient enrichment" release. Gortex data now shows up in the main UI
without anyone running a command — graph-aware information at the points in
VS Code where users already look.

### Added — passive editor enrichment

- **Inlay hints** (default on). Faint `Nc · Md` after every function
  declaration line (caller / dependent counts). Zero vertical space cost.
  `gortex.inlayHints.enabled`.
- **Live occurrence underlines** (default on). When the cursor lands on a
  symbol, every occurrence **across the workspace** gets a subtle
  underline — backed by `find_usages`. VS Code's built-in highlight only
  spans the open file. `gortex.occurrences.enabled`.
- **Gutter icons** (default on). 🔥 for hotspots, 💀 for dead-code
  candidates, driven by `analyze hotspots` / `analyze dead_code`. Tooltip
  carries fan-in and complexity. `gortex.gutterIcons.enabled`.

### Added — workspace-level enrichment

- **File-tree + tab decorations** (default on). Color tint and small badge
  on every file in the Explorer (and on tab labels) based on hotspot
  density and dead-symbol count. Hover for stats. Dead-only files greyed.
  `gortex.fileDecorations.enabled`.
- **Cursor-context status bar** (default on). A second status-bar item
  shows `name · 12c · 28d · 3u` for the symbol under the cursor. Click to
  open symbol search. `gortex.cursorStatusBar.enabled`.

### Added — Symbol Insight panel

- **Third tree view** in the Gortex activity bar (default on). Updates as
  the cursor moves. Four sections: *Callers · Usages · Blast radius ·
  Implementations.* No commands, no chords — just look at the panel after
  moving the cursor and the answer is there. `gortex.symbolInsight.enabled`.

### Added — Problems-panel insights

- **Analyze diagnostics** (default off — opt in). Dead code (Hint
  severity, struck through), hotspots > 50 fan-in (Info), and dependency
  cycles (Info) appear in the Problems panel. `gortex.analyzeDiagnostics.enabled`,
  `gortex.analyze.refreshIntervalMinutes` (default 5).

### Foundations

- **`MetadataCache`** — per-symbol caller/dependent/usage counts with TTL
  and stale_refs invalidation. One source of truth for inlay hints, hover,
  code lens, and the cursor status bar.
- **`AnalyzeCache`** — workspace-wide hot/dead/cycle sets, refreshed on a
  slow timer. Drives gutter icons, file decorations, and Problems panel.
- **`ActiveSymbolTracker`** — debounced cursor → resolved symbol mapping
  with cancellation. Drives occurrences, status bar, and Symbol Insight.

### Notes

- All new surfaces are **on by default** except `analyzeDiagnostics`
  (potentially noisy in large workspaces). Toggle anything off in
  Settings → Gortex.
- Inlay hints and occurrence underlines depend on the daemon-backed query
  layer added in v0.1.1 — a fresh ~30-100ms per request, far below
  perceptible.

## [0.2.1] - 2026-05-17

Documentation pass. No behavior changes.

- Made the **chord shortcuts** (`⌘K G/C/U/B`) much more explicit in the README
  and the `Try the graph` walkthrough — including how to recognize VS Code's
  "waiting for second key of chord…" indicator and a clear note that
  `⇧⌘K` is VS Code's built-in *Delete Line* (which is easy to hit instead
  of `⌘K`).
- README now documents the v0.2.0 native integrations (`⌘T`, Call Hierarchy,
  blast-radius webview) and the four opt-in provider settings.
- README settings table updated with the new defaults and opt-in toggles.

## [0.2.0] - 2026-05-17

The "first-class VS Code citizen" release. Gortex now plugs into VS Code's
native surfaces — `⌘T`, the Call Hierarchy view, `⇧F12`, `⌘F12`, hover,
CodeLens, the Problems panel — so users get graph-aware results through UI
they already know.

### Added — native provider integrations

- **`WorkspaceSymbolProvider`** — `⌘T` (Go to Symbol in Workspace) now
  searches Gortex's BM25 across *every tracked repo*, not just the open
  folder. Find a symbol in any of your 26 indexed repos with one shortcut.
  Always on (additive — VS Code merges with built-in providers).
- **`CallHierarchyProvider`** — VS Code's native Call Hierarchy view
  (`right-click → Show Call Hierarchy`) is now backed by Gortex.
  Incoming calls via `get_callers`, outgoing via `get_call_chain`. Always on.
- **`ReferenceProvider`** — opt-in (`gortex.references.enabled`). `⇧F12`
  routes through `find_usages` — zero false positives, cross-repo.
- **`ImplementationProvider`** — opt-in (`gortex.implementations.enabled`).
  `⌘F12` routes through `find_implementations`.
- **`HoverProvider`** — opt-in (`gortex.hover.enabled`). Hover a symbol →
  `X callers · Y dependents · Z usages` with clickable links.
- **`CodeLensProvider`** — opt-in (`gortex.codeLens.enabled`). Inline
  `X callers · Y dependents` above every function declaration. Per-file
  cached, invalidated on stale_refs events.
- **DiagnosticCollection** — daemon diagnostics flow into the Problems
  panel. Currently dormant (see Known Limitations).
- **Blast-radius webview** — `Gortex: Show Blast Radius of Symbol Under
  Cursor` now opens an interactive graph panel grouped by ring depth,
  not just a quick-pick. Click any node to navigate. No external deps —
  pure HTML/SVG, < 5 KB.

### Added — MCP subscription plumbing

- `McpClient.subscribe(topic, listener)` — register handlers for
  `notifications/<topic>` push streams (`daemon_health`,
  `workspace_readiness`, `stale_refs`, `diagnostics`). Server-side
  subscribe/unsubscribe is reference-counted per topic.

### Changed

- Default settings for opt-in providers (references, implementations,
  hover, CodeLens) are all **off** — turn them on only when you want
  Gortex to shadow your language server. Provider toggles prompt for a
  window reload to take full effect.

### Known limitations

- **Daemon push notifications are not yet delivered through `gortex mcp`
  stdio.** Subscriptions succeed (the daemon registers the listener and
  returns `{subscribed: true}`) but the matching `notifications/<topic>`
  events never reach the client. This is a daemon-side gap, not an
  extension bug — once the daemon's publish path is wired up, the live
  status bar, diagnostics panel, and CodeLens invalidation will start
  working with no extension-side changes.

## [0.1.1] - 2026-05-17

### Changed
- **Symbol queries now go through the daemon over MCP** instead of spawning
  `gortex query --index <path>` per call. Cold-call latency drops from ~6-12s
  (the CLI re-indexed the whole repo every invocation) to ~30-100ms on a
  warm daemon. One long-lived `gortex mcp` subprocess is kept open.
- **Status bar poll cadence** default bumped from 15s to 60s. Daemon-control
  commands still trigger an immediate refresh, so the slower cadence is
  invisible during interactive use.
- **Default keybindings** changed to chord-style to avoid collisions with
  built-in VS Code bindings (the previous `⌘⌥G` collided with "Find Next
  Selection"):
  - Find Symbol… → `⌘K G` / `Ctrl+K G`
  - Callers → `⌘K C` / `Ctrl+K C`
  - Usages → `⌘K U` / `Ctrl+K U`
  - Blast Radius → `⌘K B` / `Ctrl+K B`

### Fixed
- Status bar spinner showing forever: the regex `/warmup|warming/` matched
  the parenthetical `(warmup 10s)` annotation that the daemon prints *after*
  it finishes warming. Now we look for `^ready\b` instead.

## [0.1.0] - 2026-05-17

First public release.

### Added
- **MCP server registration** for GitHub Copilot Chat / agent mode (VS Code
  1.99+). Discovers ~30 Gortex graph tools (`search_symbols`, `find_usages`,
  `get_call_chain`, `edit_symbol`, `explain_change_impact`, …) with zero JSON
  to write.
- **Status bar item** that shows live daemon health, tracked-repo count, and
  total graph nodes — click for quick actions (start, stop, restart, logs).
- **Gortex side panel** (Activity Bar) with two tree views:
  - *Tracked Repositories* — every repo the daemon is indexing, grouped by
    workspace, with file / node / edge counts. Click a repo to open it.
  - *Daemon* — version, PID, uptime, memory, session count.
- **Command palette** entries:
  - Daemon: Start, Stop, Restart, Show Logs, Show Status
  - Workspace: Track, Untrack
  - Symbols: Find Symbol…, Find Callers of Symbol Under Cursor, Find Usages
    of Symbol Under Cursor, Show Blast Radius
  - Refresh views
- **Output channel** "Gortex" with every command we invoke against the CLI.
- **Settings** under `gortex.*`:
  - `gortex.binaryPath` (default `gortex`)
  - `gortex.autoTrackWorkspace` (default `true`)
  - `gortex.statusBar.enabled` (default `true`)
  - `gortex.statusBar.refreshIntervalSec` (default `15`)
- **First-run walkthrough** covering install, daemon start, workspace tracking,
  and trying the first query.

### Requires
- VS Code `^1.99.0`
- `gortex` CLI on `PATH` (`brew install zzet/tap/gortex`)
