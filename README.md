# ConSol

**ConSol — the smart contract console.**

[English](README.md) | [Chinese](README.zh-CN.md)

ConSol is a terminal-first Solidity/EVM development console built on Foundry. It wraps `forge`, `cast`, and `anvil` with a scriptable CLI plus an always-on TUI cockpit. The command name is `consol`.

ConSol does not replace Foundry. It adds the interactive layer that smart contract development usually lacks: choosing the right contract target, deploying, reading state, sending transactions, viewing decoded events, tracing transactions, and preserving deployment/transaction context.

## Features

- **Source-first TUI**: `consol dev` scans Solidity files under `src`, `contracts`, `test`, `script`, and root-level demo `.sol` files, then drives the workspace from the selected file/contract.
- **Foundry project and single-file mode**: use a normal Foundry project, or point ConSol at a standalone file such as `./Counter.sol:Counter`. Single-file mode creates a scratch Foundry project under `~/.cache/consol/scratch/` and does not write `.consol/` next to the standalone source by default.
- **File-qualified project targets**: use `src/Counter.sol:Counter` to select a concrete source file when duplicate contract names exist across `src`, `test`, `script`, mocks, or examples.
- **Deploy / call / send / state loop**: deployment cache, chain-code validation, ABI-aware calls/sends, no-argument state reads, decoded logs, and transaction history all use the same command layer.
- **Always-on contract cockpit**: the TUI can build, deploy, run read/write/payable functions, show State Watch, Activity, Build diagnostics, and equivalent CLI commands.
- **Activity and trace**: `consol activity` combines deployment, state, logs, and transactions; the TUI Activity panel supports wrapped long rows, scrollback, and tracing the latest recorded transaction.
- **Network / account / signer safety**: named networks, env private keys, Foundry keystore signers, active accounts, signer overrides, remote write confirmation, and chain-id guards are modeled explicitly.
- **Gas, diagnostics, and editor protocol**: `gas compile/estimate/report/snapshot`, `analyze`, `hints`, `storage`, `trace`, and `verify` provide structured data for the CLI, TUI, CI, and future editor integrations.
- **Machine output**: most commands support `--json`; watch commands and write transaction lifecycle events support `--ndjson`.
- **Local diagnostics with redaction**: TUI session/crash logs are written to `~/.config/consol/logs/consol-dev.log`; remote RPC URL paths, query strings, userinfo, and private-key-like arguments are redacted.
- **English and Chinese TUI text**: `consol dev` user-facing strings are available in `en-US` and `zh-CN`, selected with `[ui] language`.

## Install

Requirements:

- macOS or Linux.
- Foundry tools on `PATH`: `forge`, `cast`, and `anvil`.
- Rust stable for source builds.
- Homebrew for the tap install path.

Homebrew:

```bash
brew tap luweiCN/consol
brew install consol
consol --help
```

Source build:

```bash
cargo install --locked --path apps/cli
consol --help
```

See [Install Guide](docs/release/INSTALL.md) for verification, upgrade, uninstall, and troubleshooting notes.

## Quick Start

From a Foundry project:

```bash
consol detect
consol build
consol dev
```

For a single Solidity file:

```bash
consol dev ./Counter.sol:Counter
consol demo ./Counter.sol:Counter 0
```

A local CLI loop against Anvil:

```bash
consol chain start
consol deploy Counter 0
consol call Counter number
consol send Counter setNumber 42 --yes
consol state Counter
consol logs Counter
consol activity Counter
```

`--yes` only skips local/dev confirmations. Remote writes require an explicit signer and a network confirmation policy.

## Target Syntax

Most target-aware commands accept:

```text
Counter                         # Foundry project artifact contract name
src/Counter.sol:Counter         # Foundry project source-file-qualified target
./Counter.sol                   # single-file mode, valid when only one deployable contract exists
./Counter.sol:Counter           # single-file mode with explicit contract
./lesson/ERC20Demo.sol:MyToken  # single-file demo path with explicit contract
```

Use file-qualified project targets when a workspace has duplicate contract names across `src`, `test`, `script`, mocks, or examples.

## TUI Cockpit

`consol dev [target]` opens the main product experience.

Key workflows:

- `/` opens fuzzy file/contract search.
- `Tab` / `Shift-Tab` changes pane focus.
- `[` / `]` changes workspace tab.
- `b` builds and refreshes ABI/functions.
- `d` opens deploy/status for the active target.
- `D` fresh redeploys the active target.
- `Enter` / `c` runs the selected ABI action.
- `n` cycles configured networks when no explicit network override is active.
- `a` cycles available accounts/signers when no explicit account override is active.
- `PageUp` / `PageDown` or mouse wheel scrolls Activity when Activity is focused.
- `t` traces the latest transaction when Activity is focused.
- `Esc` closes sheets/modals; `q` or `Ctrl-C` exits the main TUI.

The Contract workspace keeps the active file/contract at the center: runnable ABI list, selected action details, State Watch, Activity, deployment status, and Build diagnostics all follow the selected target.

## CLI Commands

Project and inspection:

```bash
consol init [--from-file <file.sol> --to <dir>]
consol detect [target]
consol build [target]
consol test
consol snapshot
consol inspect <target>
consol abi <target>
consol storage <target>
```

Local chain, profiles, and signers:

```bash
consol chain start|status|stop|restart
consol network list|add|use|status|remove
consol account list|use|import|balance
consol signer list|status
```

Contract interaction:

```bash
consol deploy <target> [constructor_args...]
consol deploy --fresh <target> [constructor_args...]
consol deploy --all
consol deploy --list
consol deploy --forget <target>
consol call <target> <function> [args...]
consol send <target> <function> [args...] [--value <amount>]
consol state <target> [--watch]
consol logs <target> [--watch]
consol activity <target> [--limit <n>]
consol tx list [target] [--limit <n>]
consol console <target>
consol demo <target> [constructor_args...]
```

Diagnostics and professional workflows:

```bash
consol gas compile <target>
consol gas estimate <target> <function> [args...] [--value <amount>]
consol gas report [--match-contract <name>]
consol gas snapshot [--diff|--check]
consol analyze
consol hints --file <path> [--contract <name>]
consol trace <tx_hash>
consol verify <target> [--address <address>] [--chain <chain>] [--verifier <name>]
```

## State and Safety

- Foundry project deployments and transaction history live under the project `.consol/` directory.
- Single-file mode uses scratch projects under `~/.cache/consol/scratch/` and does not create `.consol/` next to standalone source files by default.
- Remote RPC paths, query strings, and userinfo are redacted in JSON output, human output, and diagnostic logs.
- Remote deploy/send requires an explicit signer profile or `ETH_PRIVATE_KEY`; bare `--yes` cannot approve remote writes.
- Machine confirmation uses `--confirm-network <name>` and requires a named network profile plus `--chain-id`.

## Configuration

User profiles live in `~/.config/consol/config.toml` by default.

Useful environment/config overrides:

- `CONSOL_CONFIG`: use a specific config file.
- `CONSOL_CONFIG_DIR`: move the ConSol config/log directory.
- `CONSOL_LOG_DIR`: override only the diagnostic log directory.
- `ETH_RPC_URL`: one-command RPC override.
- `ETH_PRIVATE_KEY`: temporary env signer.
- `[ui] language = "en-US" | "zh-CN" | "system"`: TUI language selector. Config wins over locale environment variables.

## Repository Layout

```text
consol/
├── apps/
│   └── cli/                 # Rust CLI/TUI binary, command name consol
├── crates/                  # Future shared Rust library crates
├── docs/
│   ├── architecture/        # Repo and technical architecture
│   ├── product/             # PRD, roadmap, CLI spec
│   └── release/             # Install and Homebrew release notes
├── examples/                # Foundry and single-file demo fixtures
├── extensions/
│   └── vscode/              # Future thin client over CLI/protocol
└── plugins/
    └── consol.nvim/         # Future thin client over CLI/protocol
```

## Documentation

- [CLI Spec](docs/product/CLI_SPEC.md)
- [Product PRD](docs/product/PRD.md)
- [Roadmap](docs/product/ROADMAP.md)
- [Iteration Plan](docs/product/ITERATION_PLAN.md)
- [Tech Stack](docs/architecture/TECH_STACK.md)
- [Repo Structure](docs/architecture/REPO_STRUCTURE.md)
- [Install Guide](docs/release/INSTALL.md)
- [Homebrew Distribution](docs/release/HOMEBREW.md)
- [Overseer Prototype Reference](docs/research/OVERSEER_REFERENCE.md)
- [Original technical spec](docs/research/solidity-devtools-spec.md)
- [Original conversation notes](docs/research/solidity-devtools-conversation.md)

## Development

```bash
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --all-targets --all-features -- -D warnings
```

The main product is the `consol` Rust CLI/TUI in `apps/cli`. VS Code and NeoVim integrations are planned as thin clients over the same CLI/JSON/NDJSON protocol, not separate product forks.
