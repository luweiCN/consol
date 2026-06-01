# Homebrew Distribution

ConSol should be installable with Homebrew.

## Repositories

Main project:

```text
github.com/luweiCN/consol
```

Homebrew tap:

```text
github.com/luweiCN/homebrew-consol
```

User-facing install flow:

```bash
brew tap luweiCN/consol
brew install consol
```

Homebrew maps `brew tap luweiCN/consol` to the GitHub repository `luweiCN/homebrew-consol`.

## Release Flow

Current flow builds from the tagged source archive inside the Homebrew formula:

1. Merge release-ready code to `main`.
2. Run the local release checks from the repository root.
3. Tag a release in `luweiCN/consol`, for example `v0.10.0`.
4. Compute the SHA-256 of the GitHub source archive:

```bash
curl -L https://github.com/luweiCN/consol/archive/refs/tags/v0.10.0.tar.gz | shasum -a 256
```

5. Update `Formula/consol.rb` in `luweiCN/homebrew-consol`.
6. Verify:

```bash
brew install luweiCN/consol/consol
consol --version
```

The current release path is a source-build Homebrew release. It is protected by local formatting, tests, clippy, tag/version matching, Cargo packaging, and Homebrew formula verification.

The formula builds `apps/cli` with:

```bash
cargo install --locked --path apps/cli --root <prefix>
```

## Formula Shape

The first public formula can build from source because the repository is small and Rust/Homebrew handles the build dependency cleanly.

Longer term, tagged binary artifacts should become the primary path because ConSol is a CLI/TUI tool. At that point the formula should switch from source archive builds to release artifacts with platform-specific checksums.
