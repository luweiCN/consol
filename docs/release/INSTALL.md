# Install ConSol

ConSol is distributed as the `consol` CLI/TUI binary.

## Requirements

- macOS or Linux.
- Rust stable if installing from source.
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
cargo install --locked --path apps/cli
consol --help
```

For a clean local smoke test:

```bash
consol --json detect
consol --json dev examples/counter-single-file/Counter.sol:Counter
```

## Troubleshooting

- `forge`, `cast`, or `anvil` is reported as missing: install Foundry and restart the terminal so `PATH` is updated.
- Homebrew source build is slow: the current formula builds Rust dependencies from source. Binary artifacts are planned for a later release flow.
- Remote writes fail with signer errors: select an explicit account with `consol account use <name>` or set `ETH_PRIVATE_KEY` for the temporary `env` signer.
- Remote JSON deploy/send fails with `remote_confirmation_required`: run in human output for interactive confirmation, or use `--confirm-network <name>` with a named network profile.
- `ETH_RPC_URL` changes the active network only for the current shell environment. Use `consol network add` and `consol network use` for persistent profiles.
