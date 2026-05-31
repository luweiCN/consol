# ConSol CLI

This folder contains the Rust binary that ships the `consol` command.

The CLI is the product core: the TUI, future editor integrations, CI scripts, and automation should all consume the same command layer and JSON/NDJSON protocol.

## Current Command Surface

```bash
consol init [--from-file <file.sol> --to <dir>]
consol detect [target]
consol build [target]
consol test
consol snapshot
consol inspect <target>
consol abi <target>
consol storage <target>
consol chain start|status|stop|restart
consol network list|add|use|status|remove
consol account list|use|import|balance
consol signer list|status
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
consol dev [target]
consol console <target>
consol demo <target> [constructor_args...]
consol gas compile|estimate|report|snapshot
consol analyze
consol hints --file <path> [--contract <name>]
consol trace <tx_hash>
consol verify <target> [options...]
```

Most commands support `--json`; watch commands and transaction lifecycle writes support `--ndjson`.

## Target Syntax

`<target>` can be:

```text
Counter                         # Foundry artifact contract name
src/Counter.sol:Counter         # Foundry project source-file-qualified target
./Counter.sol                   # single-file mode when only one deployable contract exists
./Counter.sol:Counter           # single-file explicit contract target
```

Use file-qualified project targets when duplicate contract names exist across `src`, `test`, `script`, mocks, or examples.

## `consol dev`

`consol dev` is the source-first TUI cockpit.

- Bare `consol dev` scans Solidity files before artifacts.
- `/` opens fuzzy file/contract search.
- `b` builds and refreshes ABI/functions.
- `d` deploys or shows deployment status.
- `D` fresh redeploys.
- `Enter` / `c` runs the selected ABI action.
- `n` and `a` cycle persisted network/account profiles when no explicit override is active.
- Activity scroll, decoded logs, recent transactions, and trace preview stay tied to the active target.

The TUI can also be inspected without full-screen mode:

```bash
consol --json dev
consol --json dev src/Counter.sol:Counter
```

## Safety and Local State

- Foundry project deployments and transaction history are persisted under project `.consol/`.
- Single-file mode uses scratch Foundry projects under `~/.cache/consol/scratch/`.
- Remote writes require an explicit signer and confirmation policy.
- `--yes` is local/dev only; remote automation should use `--confirm-network <name>` with a named network and `--chain-id`.
- Diagnostic logs redact remote RPC URL secrets and private-key-like arguments.

## Development Checks

```bash
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --all-targets --all-features -- -D warnings
```

See:

- [Root README](../../README.md)
- [CLI Spec](../../docs/product/CLI_SPEC.md)
- [Roadmap](../../docs/product/ROADMAP.md)
