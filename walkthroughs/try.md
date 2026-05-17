# Try the graph

Several ways to put Gortex to work — pick whichever fits your muscle memory.

## 1. Find Symbol… anywhere

Open the command palette (`⌘⇧P`) and run **Gortex: Find Symbol…**, or use
the chord shortcut **`⌘K`** then **`G`** (two keystrokes in sequence — hold
`⌘`, tap `K`, release both, then tap `G`).

Gortex's BM25 + camelCase-aware tokenizer means `parseDaemon` matches
`parseDaemonStatus`. Pick a result to jump to its definition.

## 2. `⌘T` — workspace-wide symbol search

VS Code's built-in **Go to Symbol in Workspace** (`⌘T` / `Ctrl+T`) is now
backed by Gortex. Unlike the default, it searches **every tracked repo**, not
just the open folder — find a symbol in any of your indexed repos with one
shortcut, no extension UI needed.

## 3. Right-click → Show Call Hierarchy

VS Code's native Call Hierarchy view is now powered by Gortex. Put the cursor
on any function, right-click, choose **Show Call Hierarchy**. Expand any
caller to keep drilling. Outgoing calls work too (toggle with the arrow icon
at the top of the panel).

## 4. Callers / Usages / Blast Radius from the cursor

Put the cursor on a symbol and run one of:

- **Gortex: Find Callers of Symbol Under Cursor** — chord **`⌘K C`**
- **Gortex: Find Usages of Symbol Under Cursor** — chord **`⌘K U`**
- **Gortex: Show Blast Radius of Symbol Under Cursor** — chord **`⌘K B`**
  (opens an interactive webview grouped by ring depth)

> **Chords confusing you?** A chord is two keystrokes in sequence. VS Code
> shows *"(⌘K) was pressed. Waiting for second key of chord…"* between the
> first and second keystroke. If you accidentally hit `⇧⌘K` instead of `⌘K`,
> VS Code's built-in *Delete Line* fires — that's a built-in shortcut, not
> Gortex. Rebind from `File → Preferences → Keyboard Shortcuts` (search
> `gortex`) if the defaults don't fit.

## 5. Copilot Chat (agent mode)

Open Copilot Chat, switch to **agent mode**, and just ask:

> Who calls `parseDaemonStatus` and what would break if I change its return
> type?

Gortex's ~30 tools (`search_symbols`, `find_usages`, `get_call_chain`,
`get_dependents`, `edit_symbol`, `explain_change_impact`, …) are available
to the agent. No `mcp.json` editing required.

## Opt-in surfaces

Want graph-aware stats inline, or for Gortex to back `⇧F12` / `⌘F12`? Open
Settings, search `gortex`, and toggle:

- `gortex.references.enabled` — `⇧F12` Find All References → `find_usages`
- `gortex.implementations.enabled` — `⌘F12` Go to Implementations →
  `find_implementations`
- `gortex.hover.enabled` — hover any symbol for graph stats
- `gortex.codeLens.enabled` — inline `X callers · Y dependents` above every
  function declaration

## Inspecting state

The **Gortex** activity-bar panel shows every tracked repo, grouped by
workspace, with file / node / edge counts; and a Daemon panel with version,
PID, uptime, memory, and session count.
