# Gortex for VS Code

Graph-aware code intelligence inside VS Code — powered by the
[Gortex](https://gortex.dev) daemon.

The extension does three jobs at once:

1. **Registers Gortex as an MCP server** for GitHub Copilot Chat / agent
   mode (VS Code 1.99+). Copilot picks up ~30 graph-aware tools —
   `search_symbols`, `find_usages`, `get_call_chain`, `get_dependents`,
   `edit_symbol`, `explain_change_impact`, and more — with zero `mcp.json`
   editing.
2. **Surfaces the daemon directly in VS Code**: a status bar item with live
   health, a side-panel tree view of every tracked repo (with file / node /
   edge counts), and a daemon-info panel with version, uptime, memory, and
   session count.
3. **Adds first-class graph commands**: find symbols, jump to callers or
   usages of the symbol under the cursor, compute blast radius — all from
   the command palette or via keybindings.

## Prerequisites

The `gortex` binary must be on your `PATH`:

```sh
brew install zzet/tap/gortex
# or
curl -fsSL https://get.gortex.dev | sh
```

Verify with `gortex version` (extension v0.1.0 expects `v0.27` or newer).

If the binary lives somewhere unusual, set **`gortex.binaryPath`** in your
VS Code settings.

## Install

VS Code → Extensions panel → search **Gortex** → Install.

Or sideload a local build:

```sh
code --install-extension gortex-0.1.0.vsix
```

## What you get

### Status bar

A status bar item polls `gortex daemon status` every 15 seconds (configurable)
and shows the daemon state, tracked-repo count, and total graph nodes. Click
it for the full status dump or to start a stopped daemon.

### Activity Bar panel

A new **Gortex** icon in the activity bar opens two tree views:

- **Tracked Repositories** — every repo the daemon is indexing, grouped by
  workspace. Click a repo to open it in a new window or add it to the current
  workspace.
- **Daemon** — version, PID, uptime, memory, sessions, totals.

### Commands (palette: `Gortex: …`)

| Command | Default keybinding |
|---|---|
| Find Symbol… | `⌘⌥G` / `Ctrl+Alt+G` |
| Find Callers of Symbol Under Cursor | `⌘⌥C` / `Ctrl+Alt+C` |
| Find Usages of Symbol Under Cursor | — |
| Show Blast Radius of Symbol Under Cursor | — |
| Start / Stop / Restart Daemon | — |
| Track / Untrack Current Workspace | — |
| Show Daemon Status | — |
| Show Daemon Logs | — |
| Refresh Gortex Views | — |

### Settings

| Setting | Default | What it does |
|---|---|---|
| `gortex.binaryPath` | `gortex` | Path to the gortex executable. |
| `gortex.autoTrackWorkspace` | `true` | Prompt to track newly opened folders. |
| `gortex.statusBar.enabled` | `true` | Toggle the status bar item. |
| `gortex.statusBar.refreshIntervalSec` | `15` | Daemon poll cadence. |

## URL-handler install

You can also install via VS Code's MCP URL handler — useful for "install"
buttons on docs pages:

```
vscode:mcp/install?%7B%22name%22%3A%22gortex%22%2C%22command%22%3A%22gortex%22%2C%22args%22%3A%5B%22mcp%22%5D%7D
```

## Develop

```sh
npm install
npm run watch        # TypeScript watch mode
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host with
this extension loaded.

## Package + publish

```sh
npm run package      # → gortex-0.1.0.vsix
npm run publish      # requires `vsce login gortexhq`
```

## License

MIT — see [LICENSE](./LICENSE).
