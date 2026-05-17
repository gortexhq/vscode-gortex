# Try the graph

Three ways to put Gortex to work:

## 1. Find Symbol… ( ⌘⌥G / Ctrl+Alt+G )

Open the command palette and run **Gortex: Find Symbol…**. Type any part of a
symbol name — Gortex uses BM25 ranking and camelCase-aware tokenization, so
`parseDaemon` matches `parseDaemonStatus`. Pick a result to jump straight to
its definition.

## 2. Callers / Usages from the cursor

Put the cursor on any symbol and run:

- **Gortex: Find Callers of Symbol Under Cursor** ( ⌘⌥C / Ctrl+Alt+C )
- **Gortex: Find Usages of Symbol Under Cursor**
- **Gortex: Show Blast Radius of Symbol Under Cursor**

Results appear in a quick-pick — pick one to navigate.

## 3. Copilot Chat (agent mode)

Open Copilot Chat, switch to **agent mode**, and just ask:

> Who calls `parseDaemonStatus` and what would break if I change its return
> type?

Gortex's ~30 tools (`search_symbols`, `find_usages`, `get_call_chain`,
`get_dependents`, `edit_symbol`, `explain_change_impact`, …) are now available
to the agent. No `mcp.json` editing required.

## Inspecting state

The **Gortex** activity-bar panel shows every tracked repo, grouped by
workspace, with file / node / edge counts; and a Daemon panel with version,
PID, uptime, memory, and session count.
