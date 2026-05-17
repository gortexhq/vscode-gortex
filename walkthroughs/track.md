# Track this workspace

The daemon only knows about repos you've explicitly tracked. Once a repo is
tracked, Gortex indexes it (incrementally, watching the filesystem for
changes) and the graph is queryable from this extension, from Copilot Chat,
and from the CLI.

## From the extension

Run **Gortex: Track Current Workspace** from the command palette, or click the
button above. The daemon will start indexing immediately — for most repos
this takes a few seconds.

## What ends up in the graph

For every file the indexer can parse, Gortex extracts symbols (functions,
types, methods, fields, constants) and the edges between them: *defines*,
*calls*, *implements*, *imports*, *references*, *contains*. That's what
powers `find_usages`, `get_call_chain`, `dependents`, and friends.

## Removing a repo

`Gortex: Untrack Current Workspace` removes it from the daemon's config and
frees the associated memory at the next reload.
