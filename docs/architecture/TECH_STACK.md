# Technology Stack

## Decision

ConSol targets a TypeScript/Bun implementation with an OpenTUI/Solid terminal UI.

The main command remains `consol`. The current implementation is split across `packages/*`.

## Core Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript | Fast iteration, strong enough static checks, and easier OpenTUI/Solid integration |
| Runtime | Bun | Direct TS execution, fast tests, workspace scripts, and standalone binary compilation |
| CLI | `packages/cli` parser/router | Keeps command contracts explicit and testable without a monolithic entry |
| Protocol | Zod + typed envelopes | JSON/NDJSON contracts are product APIs and must be validated at boundaries |
| Core state | `packages/core` | Config, target resolution, source/project state, network/account models |
| Foundry adapter | `packages/foundry` + `Bun.spawn` | Keeps `forge`/`cast`/`anvil` command construction outside UI and core state |
| TUI | OpenTUI + Solid | Modern terminal layout, mouse, wheel, input, modal, and selector behavior |
| i18n | `packages/i18n` catalogs | English and Chinese text share the same typed message keys |
| Testing | Bun test + fake Foundry + OpenTUI test renderer | Behavior-level CLI tests, fake process adapters, TUI character frames, keyboard/mouse/resize checks |
| Packaging | Bun compile | Produces a standalone `consol` binary for package-manager installs |

## Foundry Integration Strategy

Start with Foundry as external tools:

- `forge build`
- `forge inspect`
- `forge test`
- `forge snapshot`
- `forge create`
- `forge verify-contract`
- `cast call`
- `cast send`
- `cast estimate`
- `cast logs`
- `cast receipt`
- `cast run`
- `anvil`

Do not depend on Foundry internals in the TS implementation. Foundry public command behavior and artifact JSON are more stable than internal APIs.

The practical rule:

- Use Foundry commands for compilation, project layout, test/gas report, verification, tracing, and local chain lifecycle.
- Keep ABI/RPC/signing safety state in `packages/core` and command construction in `packages/foundry`.
- Keep terminal rendering in `packages/tui`; it consumes state/actions and must not construct Foundry shell commands directly.

## Architecture Layers

```text
CLI command layer
  packages/cli argument parsing, command routing, exit codes

Application/core layer
  packages/core target resolution, config, network/account state, source/project models

Foundry adapter layer
  packages/foundry forge/cast/anvil process execution and output parsing

Protocol layer
  packages/protocol JSON envelope, NDJSON events, error contracts

i18n layer
  packages/i18n locale catalogs and message-key typing

TUI layer
  packages/tui OpenTUI/Solid screens, panels, selectors, inputs, focus, mouse, scroll

Packaging layer
  packages/packaging Bun compile and binary smoke checks
```

## Package Boundaries

- `packages/protocol` owns machine-readable schemas and events.
- `packages/i18n` owns user-visible message catalogs.
- `packages/core` owns product state and must not import OpenTUI, process APIs, or Foundry adapters.
- `packages/foundry` owns shell command construction and process execution.
- `packages/tui` owns rendering and interaction, and must not import `packages/foundry`.
- `packages/cli` owns argument parsing, command wiring, and the installable `consol` entry.
- `packages/testkit` owns fake tools and test fixtures.
- `packages/packaging` owns compiled release binaries and smoke checks.

## Non-negotiable Engineering Rules

- JSON output must never include human progress text.
- Human output must be generated from the same structured data as JSON output.
- Watch streams use NDJSON, one event per line.
- Every write action goes through preview and confirmation policy.
- Every gas number includes provenance.
- Target resolution must preserve source identity, not just contract name.
- Single-file mode must not write state beside the `.sol` file by default.
- TUI-visible copy must come from `packages/i18n` in both English and Chinese.
- Release readiness requires `bun run verify`, `bun run package:build`, and `bun run package:smoke`.
