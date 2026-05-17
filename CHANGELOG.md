# Changelog

All notable changes to **Gortex for VS Code** are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
versions follow [Semantic Versioning](https://semver.org/).

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
