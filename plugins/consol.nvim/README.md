# consol.nvim

Thin NeoVim client for ConSol.

The plugin keeps core Solidity / EVM behavior in the `consol` CLI. NeoVim only calls the JSON protocol and renders editor-native feedback.

## Current Features

- `:ConsolHints [Contract]` runs `consol --json hints --file <current.sol>`.
- Compiler diagnostics are published through `vim.diagnostic`.
- Function gas hints are rendered as end-of-line virtual text.
- Public getter gas hints are mapped back to state variable lines when possible.
- `:ConsolClear` clears ConSol diagnostics and virtual text for the current buffer.

## Setup

With any plugin manager that adds this directory to `runtimepath`:

```lua
require("consol").setup({
  command = "consol",
  auto = true,
  diagnostics = true,
  gas_virtual_text = true,
})
```

For local development from this monorepo:

```lua
vim.opt.runtimepath:append("/Users/luwei/code/ai/consol/plugins/consol.nvim")
require("consol").setup({
  command = "/Users/luwei/code/ai/consol/dist/consol",
})
```

## Commands

```vim
:ConsolHints
:ConsolHints Counter
:ConsolClear
```

Use the optional contract name when a Solidity file contains multiple contracts.

## Design Boundary

Do not move deploy/call/send/state/watch logic into Lua. This plugin should remain a thin consumer of stable CLI JSON / NDJSON protocols.
