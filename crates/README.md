# crates

Shared Rust crates will live here after the CLI implementation reveals stable boundaries.

Do not split crates too early. The first version should be allowed to move quickly inside `apps/cli`; extract only when code is clearly shared or independently testable.

Likely future crates:

- `consol-core`
- `consol-foundry`
- `consol-protocol`
- `consol-tui`
