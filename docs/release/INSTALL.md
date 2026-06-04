# Install ConSol

ConSol is distributed as the `consol` CLI/TUI binary.

## Requirements

- macOS or Linux.
- Bun if installing from source or building a local release binary.
- Foundry installed and available on `PATH`: `forge`, `cast`, and `anvil`.
- Homebrew if using the Homebrew tap.

Verify the external toolchain:

```bash
forge --version
cast --version
anvil --version
```

## Homebrew

```bash
brew tap luweiCN/consol
brew install consol
consol --help
consol detect
```

Upgrade:

```bash
brew update
brew upgrade consol
```

Uninstall:

```bash
brew uninstall consol
brew untap luweiCN/consol
```

## Source Build

From a checkout:

```bash
bun install --frozen-lockfile
bun run package:build
bun run package:smoke
./dist/consol --help
```

For a clean local smoke test:

```bash
./dist/consol --json detect
./dist/consol --json dev examples/counter-single-file/Counter.sol:Counter
./dist/consol --json --project examples/counter-foundry dev src/Counter.sol:Counter
```

## Troubleshooting

- `forge`, `cast`, or `anvil` is reported as missing: install Foundry and restart the terminal so `PATH` is updated.
- Homebrew source build is slow: prefer tagged release binaries once the tap formula switches from source build to artifacts.
- Remote writes fail with signer errors: select an explicit account with `consol account use <name>`, pass `--signer <name>` for a temporary signer override, or set `ETH_PRIVATE_KEY` for the temporary `env` signer.
- Remote JSON/NDJSON deploy/send fails with `remote_confirmation_required`: run in human output for interactive confirmation, or use `--confirm-network <name>` with a named network profile.
- `ETH_RPC_URL` changes the active network only for the current shell environment. Use `consol network add` and `consol network use` for persistent profiles.
