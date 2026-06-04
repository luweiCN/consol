# npm-compatible Distribution

ConSol's primary release artifact is the compiled `consol` binary from:

```bash
bun run package:build
bun run package:smoke
```

The npm-compatible path is useful for development installs and package-manager shims:

```bash
bun install --frozen-lockfile
bun run package:build
./dist/consol --version
./dist/consol doctor --json
```

If ConSol is published to npm later, the package must keep the `bin.consol` entry pointing at a Bun shebang entry or a generated platform wrapper, and release CI must run:

```bash
bun test packages/cli/src/bin-smoke.test.ts
bun run package:build
bun run package:smoke
```
