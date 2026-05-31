# ConSol Roadmap

## Phase 0: Product and Repository Foundation

Status: current.

Deliverables:

- Product PRD.
- CLI command spec.
- Repository structure.
- Original notes archived under `docs/research/`.
- Decide first implementation shape for `apps/cli`.

Exit criteria:

- New contributors can understand what ConSol is without reading the old AI conversation logs.
- The project clearly states that CLI/TUI is the main product and editor plugins are later integrations.
- Product docs explicitly model network/account/signer, gas provenance, TUI state, and single-file mode.

## Phase 1: CLI Foundation v0.1

Goal: `consol` can complete a local Foundry development loop without TUI.

Build:

- Rust binary scaffold in `apps/cli`.
- `clap` command router.
- unified output layer: human text + `--json`.
- stable error codes and hints.
- Foundry project detection.
- source target resolver for project and single-file mode.
- toolchain detection for `forge`, `cast`, `anvil`.
- network/account/signer primitives, even if only local/anvil is fully supported.

Commands:

- `consol detect`
- `consol build`
- `consol snapshot`
- `consol inspect <target>`
- `consol chain start/status/stop`
- `consol network list/status/use`
- `consol account list/status/use/balance`
- `consol deploy <target>`
- `consol call <target> <function> [args...]`
- `consol send <target> <function> [args...]`
- `consol state <target>`

Tests:

- Create `examples/counter-foundry`.
- Create `examples/counter-single-file`.
- Run end-to-end test against local `anvil`.
- Validate JSON snapshot shape.
- Validate deployment cache after anvil restart.
- Validate single-file scratch project does not write local state beside the `.sol` file.
- Validate chain-id mismatch fails.

## Phase 2: Stateful Dev Loop v0.2

Goal: ConSol becomes meaningfully better than raw `forge`/`cast` for daily interaction.

Features:

- `.consol/deployments.json`.
- `.consol/history.ndjson`.
- workspace id, network fingerprint, deployer, bytecode hash, and constructor args hash.
- chain-code validation before cache reuse.
- `consol state --watch`.
- `consol logs --watch`.
- `consol console <target>` REPL.
- `consol demo ./Counter.sol:Counter`.
- `consol init --from-file ./Counter.sol --to ./counter-foundry`.
- remote RPC read-only profile support.
- env private-key signer for testnet profile support with strict confirmation.
- `consol gas compile/estimate`.
- richer ABI decoding for tuples, arrays, enums where possible.

Exit criteria:

- Repeated deploy/call/send/state is fast and stateful.
- Users do not need to manually copy deployed addresses into later commands.
- anvil restart does not produce the stale address bug.
- Switching network invalidates stale deployment assumptions.
- Gas output clearly labels `actual`, `rpc_estimate`, or `compiler_estimate`.

## Phase 3: TUI Cockpit v0.3

Goal: `consol dev` becomes the main product experience.

Features:

- project status bar.
- network/account switcher.
- source-first contract explorer with search.
- deployment panel.
- ABI function panel with constructor/read/write/payable categories.
- state watch panel.
- live output panel.
- transaction history panel.
- transaction confirmation sheet.
- deploy constructor args form.
- function args form with validation.
- error drawer mapped from JSON error codes.
- keyboard-driven actions.
- copy equivalent CLI command from TUI actions.
- single-file `consol dev` and `consol dev ./File.sol:Contract`.
- responsive wide, short, and narrow terminal layout.

Exit criteria:

- A developer can keep `consol dev` open beside VS Code/NeoVim and complete the normal contract interaction loop without leaving the TUI.
- TUI remains useful in a medium-sized Foundry project, not just Counter.sol.
- A user can switch network/account in TUI and see deployment status revalidated.

## Phase 4: Professional Workflows v0.4

Goal: Support serious protocol development.

Features:

- `consol test --json`.
- `consol gas report/snapshot`.
- event decode improvements.
- multi-account profiles.
- mainnet fork profile helpers.
- `consol storage <target>`.
- `consol trace <tx_hash>`.
- `consol deploy --all` incremental deployment exploration.
- keystore signer.
- browser wallet / WalletConnect exploration.
- dependency/remapping support for richer single-file demos.

Exit criteria:

- The tool helps with debugging, not only clicking ABI functions.
- The output can feed future editor integrations without format redesign.

## Phase 5: Editor Integrations v0.5+

Goal: VS Code and NeoVim become thin clients over the same CLI/protocol.

NeoVim:

- `plugins/consol.nvim`.
- diagnostics from `consol build --json`.
- virtual text for tests/gas.
- Remix-like ghost gas hints based on compiler gas estimates.
- floating panels powered by `consol inspect/state`.

VS Code:

- `extensions/vscode`.
- command palette actions.
- context menu deploy/call/send.
- network/account picker.
- gas hints and diagnostics.
- panels powered by `consol --json` / NDJSON streams.

Possible shared layer:

- `consol server`, if repeated process startup or watch sharing becomes a real bottleneck.
