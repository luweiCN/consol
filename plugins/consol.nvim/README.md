# consol.nvim

Future NeoVim plugin for ConSol.

This is intentionally deferred. The plugin should not contain core business logic. It should call `consol --json` and consume NDJSON streams from the CLI/TUI layer.

Expected future responsibilities:

- diagnostics from `consol build --json`
- function/state panels from `consol inspect` and `consol state`
- virtual text for tests and gas
- user commands and Lua API

