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
   the command palette or via keybindings. Queries go through a long-lived
   `gortex mcp` subprocess that proxies to the daemon, so every call lands
   in ~30-100ms instead of re-indexing the repo from scratch.

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
code --install-extension gortex-0.2.1.vsix
```

## What you get

### Status bar

A status bar item polls `gortex daemon status` every 60 seconds (configurable)
and shows the daemon state, tracked-repo count, and total graph nodes. Click
it for the full status dump or to start a stopped daemon. Daemon-control
commands trigger an immediate refresh.

### Activity Bar panel

A new **Gortex** icon in the activity bar opens two tree views:

- **Tracked Repositories** — every repo the daemon is indexing, grouped by
  workspace. Click a repo to open it in a new window or add it to the current
  workspace.
- **Daemon** — version, PID, uptime, memory, sessions, totals.

### Native VS Code integrations (always on)

Gortex plugs into VS Code's built-in surfaces, so you get graph-aware results
through UI you already know:

- **`⌘T` / `Ctrl+T`** — *Go to Symbol in Workspace* now searches Gortex's
  BM25 index across **every tracked repo**, not just the open folder. Find a
  symbol in any of your indexed repos with one shortcut.
- **Call Hierarchy** — right-click any function → *Show Call Hierarchy* opens
  VS Code's native panel, populated from Gortex's `get_callers` (incoming)
  and `get_call_chain` (outgoing).
- **Blast-radius webview** (`⌘K B`) — interactive panel grouped by ring depth,
  click any node to navigate to the file.

### Native integrations (opt-in)

These shadow your language server, so they're **off by default** — turn each
on individually:

- **`gortex.references.enabled`** — `⇧F12` Find All References via
  `find_usages` (zero false positives, cross-repo).
- **`gortex.implementations.enabled`** — `⌘F12` Go to Implementations via
  `find_implementations`.
- **`gortex.hover.enabled`** — hover any symbol → "X callers · Y dependents ·
  Z usages" with clickable links.
- **`gortex.codeLens.enabled`** — inline "X callers · Y dependents" above
  every function declaration.

### Commands (palette: `Gortex: …`)

Every command is available via the Command Palette (`⌘⇧P` / `Ctrl+Shift+P`,
then start typing `Gortex: …`). The most common four also have **chord**
keyboard shortcuts:

| Command | Default chord (Mac) | Default chord (Win/Linux) |
|---|---|---|
| Find Symbol… | `⌘K` then `G` | `Ctrl+K` then `G` |
| Find Callers of Symbol Under Cursor | `⌘K` then `C` | `Ctrl+K` then `C` |
| Find Usages of Symbol Under Cursor | `⌘K` then `U` | `Ctrl+K` then `U` |
| Show Blast Radius (interactive webview) | `⌘K` then `B` | `Ctrl+K` then `B` |
| Start / Stop / Restart Daemon | — | — |
| Track / Untrack Current Workspace | — | — |
| Show Daemon Status | — | — |
| Show Daemon Logs | — | — |
| Refresh Gortex Views | — | — |

> **About chord shortcuts.** A chord is *two* keystrokes in sequence — not
> pressed together. For `⌘K G`: hold `⌘` and tap `K`, release both, then
> tap `G` on its own. VS Code shows
> *"(⌘K) was pressed. Waiting for second key of chord…"* at the bottom of
> the screen between the two presses — that's confirmation you got the
> first half right. If you accidentally hit `⇧⌘K` instead of `⌘K`, VS Code
> will delete the current line; that's a built-in shortcut, not us.
>
> Prefer non-chord shortcuts? Open `File → Preferences → Keyboard Shortcuts`,
> search `gortex`, click the pencil next to the command, and press whatever
> combo you want. The commands always work from the palette too — the chord
> defaults are just a convenience.

### Settings

| Setting | Default | What it does |
|---|---|---|
| `gortex.binaryPath` | `gortex` | Path to the gortex executable. |
| `gortex.autoTrackWorkspace` | `true` | Prompt to track newly opened folders. |
| `gortex.statusBar.enabled` | `true` | Toggle the status bar item. |
| `gortex.statusBar.refreshIntervalSec` | `60` | Daemon poll cadence. Daemon-control commands also force an immediate refresh. |
| `gortex.references.enabled` | `false` | Route `⇧F12` Find All References through Gortex (opt-in — shadows your language server). |
| `gortex.implementations.enabled` | `false` | Route `⌘F12` Go to Implementations through Gortex (opt-in). |
| `gortex.hover.enabled` | `false` | Show `X callers · Y dependents · Z usages` when hovering a symbol (opt-in). |
| `gortex.codeLens.enabled` | `false` | Render `X callers · Y dependents` inline above every function declaration (opt-in — polarizing). |

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
npm run package      # → gortex-0.1.1.vsix
npm run publish      # requires `vsce login gortexhq`
```

## License

MIT — see [LICENSE](./LICENSE).
