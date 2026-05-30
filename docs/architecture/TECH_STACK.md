# Technology Stack

## Decision

ConSol will be a Rust-first terminal product.

The main binary is `consol`, implemented under `apps/cli`. The product should ship as a single executable first, then split stable modules into crates only when the boundaries are proven.

## Core Stack

| Layer | Choice | Why |
|---|---|---|
| Language | Rust | Single binary, fast CLI/TUI, strong EVM ecosystem, close to Foundry tooling |
| CLI | `clap` | Mature command parser, shell completion, derive API |
| Async/process | `tokio` | Running `forge`/`cast`/`anvil`, watchers, RPC, background tasks |
| Serialization | `serde`, `serde_json` | JSON envelope, NDJSON events, artifact parsing |
| Config | `toml` | Fits `foundry.toml` / `consol.toml` user expectations |
| Errors | `thiserror`, `miette` | Stable machine errors plus readable diagnostics |
| Logging | `tracing`, `tracing-subscriber` | Structured logs without polluting JSON output |
| EVM/RPC/ABI | `alloy` | ABI encoding/decoding, RPC, transactions, signer model |
| TUI | `ratatui`, `crossterm` | Modern Rust TUI stack, cross-platform terminal backend |
| File watch | `notify` | `consol dev` build/watch loops |
| Testing | `assert_cmd`, `predicates`, `insta`, `tempfile` | CLI tests, JSON snapshots, scratch projects |

## Foundry Integration Strategy

Start with Foundry as external tools:

- `forge build`
- `forge inspect`
- `forge test`
- `forge snapshot`
- `forge create`
- `cast call`
- `cast send`
- `cast estimate`
- `cast code`
- `anvil`

Do not depend on Foundry internal crates in the MVP. Their public command behavior and artifact JSON are more stable than internal Rust APIs.

As ConSol matures, move selected functionality from shelling out to native Rust:

- ABI encoding/decoding via Alloy.
- RPC calls and gas estimates via Alloy providers.
- transaction construction/signing via Alloy signers.
- artifact/build-info parsing directly from JSON.

The practical rule:

- Use Foundry commands for compilation, project layout, test/gas report, and local chain lifecycle.
- Use Alloy for interactive ABI/RPC/signing behavior where ConSol needs structured state and TUI safety.

## Architecture Layers

```text
CLI command layer
  clap command routing and argument parsing

Application layer
  detect/build/inspect/deploy/call/send/state/network/account/dev/demo

Foundry adapter layer
  forge/cast/anvil process execution, artifact discovery, output parsing

EVM layer
  Alloy ABI decoding, calldata building, RPC, transaction previews, signers

State layer
  .consol/deployments.json, history.ndjson, scratch single-file projects

Protocol layer
  JSON envelope, NDJSON events, TUI snapshot structs

TUI layer
  ratatui app state, views, action sheets, keyboard model
```

## Crate Extraction Plan

Keep the first version in `apps/cli` until repeated boundaries become obvious.

Likely future crates:

- `consol-protocol`: JSON/NDJSON structs and error codes.
- `consol-core`: config, project model, target resolver, cache model.
- `consol-foundry`: `forge`/`cast`/`anvil` adapters.
- `consol-network`: network profiles, fingerprints, fork metadata.
- `consol-signer`: signer sources and write-policy enforcement.
- `consol-tui`: ratatui app state and rendering.

## Non-negotiable Engineering Rules

- JSON output must never include human progress text.
- Human output must be generated from the same structured data as JSON output.
- Watch streams use NDJSON, one event per line.
- Every write action goes through preview and confirmation policy.
- Every gas number includes provenance.
- Target resolution must preserve source identity, not just contract name.
- Single-file mode must not write state beside the `.sol` file by default.

