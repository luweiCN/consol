# Iteration And PR Plan

The phases in the roadmap are milestones, not optional ideas. The product target is to complete all of them, with each phase split into reviewable PR-sized iterations.

## Repository Strategy

- Main repo: `luweiCN/consol`
- Visibility: public
- Main branch: `main`
- Development style: one branch per PR-sized iteration.
- Local branch naming: `phase-<n>/<short-topic>`
- Release target: GitHub Releases + Homebrew tap.
- Homebrew tap: `luweiCN/homebrew-consol`, installed with `brew tap luweiCN/consol` after the tap repo exists.

## Phase 0: Foundation

PR 0.1: Product and architecture documents

- PRD
- CLI spec
- roadmap
- tech stack
- repo structure
- Overseer reference
- release/Homebrew plan

PR 0.2: Rust workspace scaffold

- root `Cargo.toml`
- `apps/cli/Cargo.toml`
- `consol --help`
- CI skeleton
- formatting/lint/test commands

## Phase 1: CLI Foundation

PR 1.1: Output, errors, and command shell

- `clap` command tree
- JSON envelope
- NDJSON event helper
- stable error codes
- human output formatter

PR 1.2: Detection and target resolution

- Foundry project detection
- single-file target grammar
- `consol init`
- `consol init --from-file <file.sol> --to <dir>`
- toolchain version detection
- `consol detect`
- `consol snapshot` skeleton

Implemented so far:

- `init` creates a minimal Foundry-compatible project.
- `init --from-file` migrates a single Solidity file into `src/` without overwriting existing project files.

PR 1.3: Build and inspect

- `consol build`
- `consol test`
- artifact discovery
- ABI summary
- bytecode hash
- diagnostics schema
- compiler gas estimates when available

Implemented so far:

- `build` wraps `forge build`.
- `build --json` includes parsed compiler diagnostics.
- `test` wraps `forge test`.
- `inspect` exposes ABI, bytecode, and compiler gas estimate context.
- `abi` exports raw artifact ABI for scripts, TUI, and editor integrations.

PR 1.4: Local chain, network, and account primitives

- `consol chain start/status/stop`
- local network profile
- chain-id guard
- Anvil account listing
- basic `account list/use/balance`

PR 1.5: Deploy, call, send, state

- deployment cache
- `cast code` validation
- transaction preview
- deploy/call/send/state commands
- gas estimate in write preview
- history append

PR 1.6: End-to-end examples

- `examples/counter-foundry`
- `examples/counter-single-file`
- E2E local Anvil tests
- stale cache after Anvil restart test

## Phase 2: Stateful Dev Loop

PR 2.1: Watch streams

- `state --watch`
- `logs --watch`
- NDJSON event streams

PR 2.2: REPL and demo mode

- `consol console <target>`
- `consol demo <target>`
- single-file scratch project lifecycle

PR 2.3: Remote read-only networks

- named remote network profiles
- `network add/use/status`
- remote `call/state/logs`
- no remote writes yet unless signer policy is configured

PR 2.4: Testnet signer support

- env private-key signer
- strict confirmation
- testnet deploy/send
- chain fingerprint in cache

Implemented so far:

- `anvil0` is refused for non-local writes.
- `deploy` and `send` now share a write-policy gate.
- `--yes` only auto-approves `write_policy=local`; non-local writes require interactive confirmation and JSON/NDJSON remote writes are refused until a machine-safe confirmation policy exists.
- built-in `local` expects chain id `31337`, and local RPC detection uses parsed host matching instead of substring matching.

PR 2.5: Gas commands

- `gas compile`
- `gas estimate`
- `gas report`
- `gas snapshot`
- provenance model

Implemented so far:

- `gas compile` returns Foundry compiler estimates.
- `gas estimate` simulates deployed contract calls with `cast estimate`, including optional `--value`, without sending a transaction or requiring private key access.

## Phase 3: TUI Cockpit

PR 3.1: TUI shell

- ratatui app skeleton
- project status bar
- keyboard/focus model
- command palette skeleton

PR 3.2: Contract workspace

- file-aware contract explorer
- deployment state badges
- State/Functions/Deploy/Events/Diagnostics tabs

Implemented so far:

- `consol dev` has switchable `Status`, `State`, `Events`, `Functions`, and `Commands` tabs.
- `State` and `Events` reuse the command-layer snapshot logic from `consol state` and `consol logs`.
- `Functions` reads ABI functions from the artifact when available.
- missing artifacts or deployments are shown as panel status instead of terminating the TUI.

PR 3.3: Action sheets

- constructor args form
- function args form
- call/send/deploy actions
- copy equivalent CLI command

Implemented so far:

- Functions tab supports `j/k` selection.
- `Enter` or `c` calls selected `view`/`pure` functions in the TUI.
- read functions with arguments open a small input sheet for whitespace-separated values.
- local write functions open the same argument sheet plus a gas-aware `y`/`n` confirmation sheet before broadcasting.
- remote write functions remain blocked in the TUI and point users to the stricter `consol send` confirmation flow.
- `d` deploys the open target on local networks, including constructor args and an explicit confirmation sheet.
- remote deploy remains blocked in the TUI and points users to the stricter `consol deploy` confirmation flow.
- Diagnostics tab can run `consol build` with `b` and show parsed compiler diagnostics.

PR 3.4: Confirmation and live feed

- deploy/send confirmation sheet
- gas/fee preview
- tx lifecycle feed
- decoded event feed
- error drawer

PR 3.5: Network/account switching

- network switcher
- account/signer switcher
- revalidate deployments on switch
- small-terminal fallback

## Phase 4: Professional Workflows

PR 4.1: Testing and diagnostics depth

- structured `test --json`
- trace integration
- richer compiler diagnostics

PR 4.2: Storage and trace views

- `storage <target>`
- storage layout view
- `trace <tx_hash>`

PR 4.3: Multi-contract deployment

- dependency discovery
- deploy plan
- incremental deploy exploration

PR 4.4: Advanced signers and forks

- keystore signer
- browser wallet exploration
- WalletConnect exploration
- hardware/KMS planning or first adapter
- Anvil fork helpers

## Phase 5: Editor Integrations

PR 5.1: Plugin protocol hardening

- `consol hints --json --file <path>`
- source mapping for gas hints
- protocol compatibility tests

PR 5.2: NeoVim plugin

- `plugins/consol.nvim`
- diagnostics
- virtual text / ghost gas hints
- floating panels

PR 5.3: VS Code extension

- command palette
- context menu deploy/call/send
- network/account picker
- state/log panels

## Release And Distribution

PR R.1: Release automation

- GitHub Actions build matrix
- checksums
- GitHub Releases

PR R.2: Homebrew tap

- create `luweiCN/homebrew-consol`
- formula for `consol`
- install test

PR R.3: Documentation site or docs polish

- quickstart
- tutorial
- local project guide
- single-file demo guide
- testnet deployment guide
