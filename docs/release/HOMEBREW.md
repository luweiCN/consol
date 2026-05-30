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

1. Tag a release in `luweiCN/consol`.
2. GitHub Actions builds macOS/Linux artifacts.
3. Attach checksums to GitHub Release.
4. Update formula in `luweiCN/homebrew-consol`.
5. Verify:

```bash
brew install luweiCN/consol/consol
consol --version
```

## Formula Shape

The formula should use GitHub release artifacts rather than building from source for normal users.

Source build can be kept as a fallback later, but binary installation should be the primary path because ConSol is a CLI/TUI tool.

