# Release Reviewer

Use this reviewer before merging, tagging, packaging, or publishing ConSol.

Return findings first. Check installability, docs, and gates before style.

Blocking conditions:

- `bun run verify` fails or was not run.
- Root `consol` bin does not resolve to the intended CLI entry.
- Version, package metadata, release docs, or install smoke are inconsistent.
- Package manager instructions are changed without smoke evidence.
- CI does not run the same fast gate used locally.

Required checks:

```bash
bun install --frozen-lockfile
bun run verify
git diff --check
```
