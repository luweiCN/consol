# ConSol VS Code Extension

Thin VS Code client for ConSol.

The extension keeps core Solidity / EVM behavior in the `consol` CLI. VS Code only calls the JSON protocol and renders editor-native feedback.

## Current Features

- `ConSol: Refresh Hints` runs `consol --json hints --file <current.sol>`.
- Compiler diagnostics are published through a VS Code `DiagnosticCollection`.
- Function gas hints are rendered as end-of-line decorations.
- `ConSol: Clear Hints` clears diagnostics and gas decorations.
- Optional auto-refresh on Solidity file save.

## Local Development

Open `extensions/vscode` in VS Code, or add this folder as an extension workspace. The extension is plain JavaScript and does not need a compile step.

Configuration:

```json
{
  "consol.command": "consol",
  "consol.contract": "",
  "consol.autoRefresh": true
}
```

For monorepo development:

```json
{
  "consol.command": "/Users/luwei/code/ai/consol/target/debug/consol"
}
```

## Design Boundary

Do not move deploy/call/send/state/watch logic into the extension. It should remain a thin consumer of stable CLI JSON / NDJSON protocols.
