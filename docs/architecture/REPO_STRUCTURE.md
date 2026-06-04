# Repository Structure

## Decision

Use one monorepo named `consol`.

Reasoning:

- ConSol is a product brand, not only a package.
- The CLI/TUI, future NeoVim plugin, and future VS Code extension must share command semantics and JSON/NDJSON protocol.
- A monorepo keeps product docs, examples, fixtures, TS packages, and packaging checks in one place while the core shape is still evolving.
- Separate repositories can be created later if distribution or community contribution pressure makes that useful.

## Current Structure

```text
consol/
├── README.md
├── README.zh-CN.md
├── package.json
├── packages/
│   ├── cli/
│   ├── core/
│   ├── foundry/
│   ├── i18n/
│   ├── packaging/
│   ├── protocol/
│   ├── testkit/
│   └── tui/
├── docs/
│   ├── architecture/
│   ├── product/
│   ├── quality/
│   └── release/
├── examples/
├── extensions/
│   └── vscode/
└── plugins/
    └── consol.nvim/
```

## Naming Rules

- Product/brand: `ConSol`.
- CLI binary: `consol`.
- Root repo: `consol`.
- Current CLI package: `packages/cli`.
- Current TUI package: `packages/tui`.
- NeoVim plugin: `consol.nvim`.
- VS Code extension display name: `ConSol`.

Avoid using the old `sd` / `solidity-devtools` names for new code.

## Active vs Deferred Areas

Active now:

- `packages/protocol`
- `packages/i18n`
- `packages/core`
- `packages/foundry`
- `packages/tui`
- `packages/cli`
- `packages/testkit`
- `packages/packaging`
- `docs/product`
- `docs/architecture`
- `docs/quality`
- `docs/release`
- `examples`

Deferred integrations:

- `plugins/consol.nvim`
- `extensions/vscode`

The deferred folders document ownership and future integration points. They should stay thin over the CLI/JSON/NDJSON protocol.

## TS Package Strategy

The rewrite keeps package boundaries explicit:

- `packages/protocol`: JSON envelopes, NDJSON events, error contracts, snapshots.
- `packages/i18n`: typed message keys and locale catalogs.
- `packages/core`: config, project model, target resolver, account/network state, transaction state.
- `packages/foundry`: `forge`/`cast`/`anvil` process adapters and parsers.
- `packages/tui`: OpenTUI/Solid rendering, layout, focus, mouse, scroll, modals, inputs, selectors.
- `packages/cli`: argument parser, command router, exit codes, and installable `consol` entry.
- `packages/testkit`: fake Foundry tools and test fixtures.
- `packages/packaging`: Bun compile and installed-binary smoke checks.

This avoids rebuilding a monolithic CLI file while keeping the rewrite small enough to verify.

## Documentation Ownership

- `docs/product/PRD.md`: product definition and scope.
- `docs/product/CLI_SPEC.md`: command and protocol contract.
- `docs/product/ROADMAP.md`: implementation sequence.
- `docs/architecture/TECH_STACK.md`: current technical stack.
- `docs/architecture/REPO_STRUCTURE.md`: repo layout and package boundaries.
- `docs/quality/`: test, i18n, reviewer, and engineering gates.
- `docs/release/`: install, package-manager, and release smoke paths.

Only `docs/product`, `docs/architecture`, `docs/quality`, and `docs/release` should be treated as current project direction.
