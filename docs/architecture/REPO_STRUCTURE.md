# Repository Structure

## Decision

Use one monorepo named `consol`.

Reasoning:

- ConSol is a product brand, not only a Rust package.
- The CLI/TUI, future NeoVim plugin, and future VS Code extension must share command semantics and JSON/NDJSON protocol.
- A monorepo keeps product docs, examples, fixtures, and integration tests in one place while the core shape is still evolving.
- Separate repositories can be created later if distribution or community contribution pressure makes that useful.

## Current Structure

```text
consol/
├── README.md
├── apps/
│   └── cli/
│       └── README.md
├── crates/
│   └── README.md
├── docs/
│   ├── architecture/
│   │   └── REPO_STRUCTURE.md
│   ├── product/
│   │   ├── CLI_SPEC.md
│   │   ├── PRD.md
│   │   └── ROADMAP.md
│   └── research/
│       ├── solidity-devtools-conversation.md
│       └── solidity-devtools-spec.md
├── examples/
├── extensions/
│   └── vscode/
│       └── README.md
└── plugins/
    └── consol.nvim/
        └── README.md
```

## Naming Rules

- Product/brand: `ConSol`.
- CLI binary: `consol`.
- Root repo: `consol`.
- App directory: `apps/cli`.
- Rust binary crate/package: `consol-cli`.
- Future shared Rust crates: `consol-core`, `consol-foundry`, `consol-protocol`, `consol-tui`.
- Future signer/network crates if needed: `consol-signer`, `consol-network`.
- NeoVim plugin: `consol.nvim`.
- VS Code extension display name: `ConSol`.

Avoid using the old `sd` / `solidity-devtools` names for new code. They remain only in archived research notes.

## Active vs Deferred Areas

Active now:

- `apps/cli`
- `docs/product`
- `docs/architecture`
- `examples`

Deferred:

- `plugins/consol.nvim`
- `extensions/vscode`
- extra Rust crates under `crates`

The deferred folders exist to document ownership and future boundaries, not to start implementation now.

## Rust Workspace Strategy

Start pragmatic:

```text
apps/cli/
├── Cargo.toml
└── src/
```

Keep the first implementation mostly inside the CLI app until real sharing pressure appears. Extract crates when a boundary becomes stable:

- `consol-core`: config, project model, cache, output envelope.
- `consol-foundry`: forge/cast/anvil process adapters and parsers.
- `consol-protocol`: JSON/NDJSON structs shared by CLI, TUI, tests, and plugins.
- `consol-tui`: TUI app state and rendering if it grows too large for the CLI crate.
- `consol-signer`: signer adapters and transaction confirmation policy, if this becomes too large for the CLI app.
- `consol-network`: network profiles, chain fingerprints, fork metadata, if this becomes independently testable.

This avoids premature abstraction while still leaving room for a clean workspace.

## Future Cargo Workspace

When extraction starts, root `Cargo.toml` can become:

```toml
[workspace]
resolver = "2"
members = [
  "apps/cli",
  "crates/consol-core",
  "crates/consol-foundry",
  "crates/consol-protocol",
  "crates/consol-tui",
  "crates/consol-signer",
  "crates/consol-network",
]
```

## Documentation Ownership

- `docs/product/PRD.md`: product definition and scope.
- `docs/product/CLI_SPEC.md`: command and protocol contract.
- `docs/product/ROADMAP.md`: implementation sequence.
- `docs/architecture/REPO_STRUCTURE.md`: repo layout and package boundaries.
- `docs/research/`: raw notes, prior AI conversations, competitor research, naming research.

Only `docs/product` and `docs/architecture` should be treated as current project direction. `docs/research` is historical input.
