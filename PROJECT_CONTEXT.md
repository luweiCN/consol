# ConSol Project Context

This file is the compact restart context for future Codex runs.

## Product

ConSol is a terminal-first Solidity / EVM development tool.

- Brand: `ConSol`
- Binary: `consol`
- Slogan: `ConSol — the smart contract console.`
- Chinese: `ConSol：智能合约开发控制台。`
- Main product: TS/Bun CLI + OpenTUI/Solid TUI.
- Deferred integrations: `consol.nvim` and VS Code extension.

The goal is not only to match Remix. The goal is to beat Remix for professional local development by keeping Remix-like deploy/call/state UX inside a real terminal, Foundry, Git, and editor workflow.

## Current Repository

Path:

```text
/Users/luwei/code/ai/consol
```

Current layout:

```text
packages/cli
packages/core
packages/foundry
packages/i18n
packages/packaging
packages/protocol
packages/testkit
packages/tui
docs/product
docs/architecture
docs/release
examples
plugins/consol.nvim
extensions/vscode
```

Use `packages/cli` for the current TS/Bun implementation.

## Core Decisions

- Use TypeScript with Bun as the runtime and package build tool.
- Ship the `consol` command from `packages/cli`.
- Keep product logic split across `packages/protocol`, `packages/i18n`, `packages/core`, `packages/foundry`, `packages/tui`, `packages/cli`, `packages/testkit`, and `packages/packaging`.
- Use Zod schemas and typed protocol envelopes for machine contracts.
- Use Foundry commands as external tools first.
- Use OpenTUI + Solid for TUI rendering, layout, keyboard, mouse, scroll, modal, input, and selector behavior.
- Use Bun compile for release binaries and keep package smoke checks in the repo.
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

ConSol should preserve the behavior but move it from Lua/Bash snippets to tested TS packages with structured output.

## Important Docs

- `docs/product/PRD.md`
- `docs/product/CLI_SPEC.md`
- `docs/product/ROADMAP.md`
- `docs/product/ITERATION_PLAN.md`
- `docs/architecture/TECH_STACK.md`
- `docs/architecture/REPO_STRUCTURE.md`
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

Current released version:

```text
v0.10.0
```

The `v0.10.0` release includes:

- The Contract workspace is the main `consol dev` surface, with action rows for ABI reads, writes, payable calls, deploy, and fresh redeploy.
- Activity supports wrapped rows, timestamps, scrollback, mouse-wheel coalescing, and tracing the latest recorded transaction.
- TUI copy supports `en-US` and `zh-CN`, selected with `[ui] language`.
- Project targets can be source-file-qualified, for example `src/Counter.sol:Counter`, to disambiguate duplicate contract names.
- Single-file demo mode copies local import graphs under the entry file directory and rejects parent-directory imports with `single_file_import_outside_root`.
- Diagnostics redact remote RPC URL paths, queries, userinfo, and private-key-like arguments.
- README is split into English and Simplified Chinese versions.

Release state:

- GitHub Release target: `https://github.com/luweiCN/consol/releases/tag/v0.10.0`
- Homebrew formula: `luweiCN/homebrew-consol`, formula version `0.10.0`
- Verified locally with `brew info`, `brew audit luweiCN/consol/consol`, `brew fetch --force --build-from-source luweiCN/consol/consol`, `brew reinstall luweiCN/consol/consol --build-from-source`, `brew test luweiCN/consol/consol`, and `consol --version`.
- Current installed Homebrew version on this machine after tap update: `consol 0.10.0`.

## Implemented Surface

CLI:

- project: `init`, `detect`, `build`, `test`, `snapshot`
- inspect: `inspect`, `abi`, `storage`
- local chain: `chain start/status/stop/restart`
- network/account/signer: `network`, `account`, `signer`
- Anvil fork profiles: `network add <name> --fork-url-env <ENV> [--fork-block-number <block>]`, local write policy, and `chain start/restart` managed fork startup
- Foundry keystore signer profiles: `account import <name> --keystore <ACCOUNT> [--keystore-dir <dir>] --password-env <ENV>`
- Signer registry: `signer list` and `signer status [name]` expose profile name, source, account, address, active flag, and availability.
- interaction: `deploy`, `call`, `send`, `state`, `logs`, `console`, `demo`
- multi-contract deployment: `deploy --all`, `deploy --list`, and `deploy --forget <target>`
- NDJSON streams: `state --watch`, `logs --watch`, and deploy/send transaction lifecycle events (`tx.preview`, `tx.sent`, `tx.mined`)
- transaction history: `tx list`, `.consol/transactions.json`, and `snapshot.recent_history`
- gas: `gas compile`, `gas estimate`, `gas report`, `gas snapshot`
- professional workflows: `analyze`, `trace`, `verify`
- editor protocol: `hints --file <path> [--contract <name>]`
- NeoVim: `plugins/consol.nvim` consumes `hints` for diagnostics and gas virtual text
- VS Code: `extensions/vscode` consumes `hints` for diagnostics and gas decorations

TUI:

- `consol dev [target]` has Status, State, Events, Functions, Diagnostics, Feed, and Commands panels.
- Bare `consol dev` in a built Foundry project discovers artifacts, selects the first contract, and supports `[` / `]` contract switching.
- Functions panel supports read calls, argument forms, local write confirmation, and local send.
- `d` deploys the open target on local networks, including constructor args and confirmation.
- `n` / `a` switch configured network/account profiles when no global override blocks the change.
- The Feed panel records TUI actions, low-frequency live refresh changes, and recent deploy/send transaction activity from local transaction history.
- Remote deploy/write actions remain blocked in the TUI and should use CLI confirmation flows.

Important safety behavior:

- Remote RPC URL paths, query strings, and userinfo are redacted in JSON and human output; localhost RPC URLs remain visible for debugging.
- `--json` errors print an `ok:false` envelope to stdout; `--ndjson` errors print an `error` event. Both return a non-zero process exit code without duplicate human stderr.
- Config and local `.consol/*.json` state files are written with private Unix/macOS permissions: parent directories `0700`, files `0600`.
- Write previews validate signer/account consistency before broadcasting and surface signer, nonce, gas price, and calldata prefix/hash where available.
- Non-local JSON/NDJSON deploy/send automation uses `--confirm-network <name>` instead of `--yes`; the token confirms only the resolved network name, requires a chain-id guard, and does not bypass signer checks or wallet approval.

## Goal

Implement all phases, not just a document plan:

1. CLI foundation.
2. Stateful dev loop.
3. TUI cockpit.
4. Professional workflows.
5. Editor integrations.
6. Release and Homebrew distribution.
