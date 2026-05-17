# Start the daemon

Gortex runs a long-lived daemon that holds the knowledge graph for every
tracked repo in memory. One daemon serves Copilot Chat, this extension's tree
views, the CLI, and any other MCP client all at once — so you only pay the
indexing cost once.

## From the extension

Click **Start Daemon** above (or run **Gortex: Start Daemon** from the command
palette). The daemon detaches and continues running after VS Code closes.

## From the terminal

```sh
gortex daemon start --detach
gortex daemon status
```

## Run it as a login service

If you want the daemon to come up automatically on login:

```sh
gortex daemon install-service
```

This installs a user-level launchd (macOS) or systemd (Linux) unit. Remove
with `gortex daemon uninstall-service`.

## Watching the logs

The **Gortex: Show Daemon Logs** command opens an integrated terminal tailing
`gortex daemon logs`. Use it whenever something looks off.
