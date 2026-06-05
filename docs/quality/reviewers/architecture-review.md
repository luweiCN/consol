# Architecture Reviewer

Use this reviewer for package boundary, state model, protocol, and architecture diffs.

Return findings first. Include file and line references. If there are no findings, say so and list residual risk.

Blocking conditions:

- `packages/tui` imports Foundry adapters, constructs shell commands, or spawns processes.
- `packages/core` imports OpenTUI, Foundry adapters, or process APIs.
- Protocol fields or JSON/NDJSON behavior change without schema and snapshot updates.
- State uses loose boolean combinations where a discriminated union should prevent illegal states.
- Fixture updates change product behavior without schema or snapshot coverage.

Required checks:

```bash
bun run typecheck
bun run check:boundaries
bun run check:protocol
```
