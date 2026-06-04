# Linux Distribution

Linux package-manager releases should use Bun-compiled release artifacts.

Common targets:

```bash
bun run package:build -- --target bun-linux-x64 --binary-name consol
bun run package:build -- --target bun-linux-arm64 --binary-name consol
```

Package formats can include Debian, RPM, Arch/AUR, or a tarball formula. Each path must install the `consol` binary on `PATH`.

Required smoke after installation:

```bash
consol --version
consol doctor --json
```

The JSON smoke must report `"ok": true`.
