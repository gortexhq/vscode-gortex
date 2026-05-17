# Changelog

All notable changes to **Gortex for VS Code** are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
versions follow [Semantic Versioning](https://semver.org/).

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
