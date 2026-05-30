# ConSol Project Context

This file is the compact restart context for future Codex runs.

## Product

ConSol is a terminal-first Solidity / EVM development tool.

- Brand: `ConSol`
- Binary: `consol`
- Slogan: `ConSol — the smart contract console.`
- Chinese: `ConSol：智能合约开发控制台。`
- Main product: Rust CLI + TUI.
- Deferred integrations: `consol.nvim` and VS Code extension.

The goal is not only to match Remix. The goal is to beat Remix for professional local development by keeping Remix-like deploy/call/state UX inside a real terminal, Foundry, Git, and editor workflow.

## Current Repository

Path:

```text
/Users/luwei/code/ai/consol
```

Current layout:

```text
apps/cli
crates
docs/product
docs/architecture
docs/release
docs/research
examples
plugins/consol.nvim
extensions/vscode
```

Use `apps/cli`, not `apps/consol-cli`.

## Core Decisions

- Use Rust.
- Start as one binary in `apps/cli`.
- Use `clap`, `tokio`, `serde`, `toml`, `tracing`, `thiserror`, `miette`.
- Use Foundry commands as external tools first.
- Use Alloy for ABI/RPC/signing as ConSol matures.
- Use `ratatui` + `crossterm` for TUI.
- Keep editor plugins thin over JSON/NDJSON.

## Product Models

- `target`: `Counter`, `./Counter.sol`, or `./Counter.sol:Counter`.
- `network`: named profile with chain-id guard and fingerprint.
- `account`: selected address.
- `signer`: signing source, independent from network.
- `deployment`: keyed by workspace id, contract, bytecode hash, constructor args hash, network fingerprint, deployer.
- `gas`: always includes provenance; do not show one unqualified gas number.

## Required Modes

Project mode:

```bash
consol dev
consol inspect Counter
consol deploy Counter
```

Single-file mode:

```bash
consol demo ./Counter.sol:Counter
consol dev ./Counter.sol:Counter
consol deploy ./Counter.sol:Counter
```

Single-file mode must use an internal scratch Foundry project and must not write `.consol/` beside the `.sol` file by default.

## Existing Prototype To Preserve

Reference:

```text
/Users/luwei/.config/nvim/lua/overseer/template/user/foundry.lua
```

It already proves:

- Foundry root detection.
- artifact ABI parsing.
- enum source parsing.
- bytecode hash cache key.
- Anvil auto-start.
- deploy with `forge create`.
- cache validation with `cast code`.
- `cast call`/`cast send`.
- `cast estimate` before write.
- state watch over no-arg view/pure functions.
- stale cache recovery after Anvil reset.

ConSol should preserve the behavior but move it from Lua/Bash snippets to tested Rust with structured output.

## Important Docs

- `docs/product/PRD.md`
- `docs/product/CLI_SPEC.md`
- `docs/product/ROADMAP.md`
- `docs/product/ITERATION_PLAN.md`
- `docs/architecture/TECH_STACK.md`
- `docs/architecture/REPO_STRUCTURE.md`
- `docs/research/OVERSEER_REFERENCE.md`
- `docs/release/HOMEBREW.md`

## GitHub / Release

Main public repo:

```text
luweiCN/consol
```

Homebrew tap:

```text
luweiCN/homebrew-consol
```

Install target:

```bash
brew tap luweiCN/consol
brew install consol
```

## Goal

Implement all phases, not just a document plan:

1. CLI foundation.
2. Stateful dev loop.
3. TUI cockpit.
4. Professional workflows.
5. Editor integrations.
6. Release and Homebrew distribution.

