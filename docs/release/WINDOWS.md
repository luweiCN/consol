# Windows Distribution

Windows package-manager releases should use Bun-compiled release artifacts.

Target names:

```bash
bun run package:build -- --target bun-windows-x64 --binary-name consol.exe
```

Scoop and Chocolatey manifests should install the tagged `consol.exe` artifact and expose `consol` on `PATH`.

Required smoke after installation:

```powershell
consol --version
consol doctor --json
```

The JSON smoke must report `"ok": true`.
