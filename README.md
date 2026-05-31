# ConSol

**ConSol — the smart contract console.**

ConSol 是一个 terminal-first 的 Solidity / EVM 开发控制台。它站在 Foundry 之上，把 `forge`、`cast`、`anvil` 的能力组织成一个可脚本化的 CLI 和一个常驻终端的 TUI cockpit。核心命令是全小写的 `consol`。

ConSol 不替代 Foundry。它解决的是合约开发里重复、容易出错的交互层：选择目标合约、部署、读取状态、发送交易、查看事件、追踪交易、保留部署和交易上下文。

## Features

- **Source-first TUI**：`consol dev` 扫描 `src`、`contracts`、`test`、`script` 和根目录 demo `.sol` 文件，按文件/合约驱动 workspace，而不是要求先记住 artifact 名称。
- **Foundry project and single-file mode**：支持标准 Foundry 项目，也支持 `./Counter.sol:Counter` 这种教学/demo 文件。single-file mode 会在 `~/.cache/consol/scratch/` 创建 scratch Foundry project，不在源码旁边写 `.consol/`。
- **File-qualified targets**：项目里可以用 `src/Counter.sol:Counter` 指定具体源文件，避免 `src`、`test`、`script` 中重名合约互相混淆。
- **Deploy / call / send / state loop**：部署缓存、链上代码校验、ABI-aware `call` / `send`、无参数 state reader、decoded logs、transaction history 都走同一套命令层。
- **Always-on contract cockpit**：TUI 里可以 build、deploy、运行 read/write/payable 函数、查看 State Watch、Activity、Build diagnostics 和 CLI equivalents。
- **Activity and trace**：`consol activity` 汇总 deployment、state、logs、transactions；TUI Activity 支持滚动、长日志换行、最新交易 trace。
- **Network / account / signer safety**：支持 named network、env private key、Foundry keystore、active account、signer override、远程写入确认策略和 chain-id guard。
- **Gas, diagnostics, and editor protocol**：`gas compile/estimate/report/snapshot`、`analyze`、`hints`、`storage`、`trace`、`verify` 为 CI、TUI 和未来编辑器集成提供结构化数据。
- **Machine output**：大部分命令支持 `--json`；watch 和写交易生命周期支持 `--ndjson`。
- **Local diagnostics with redaction**：TUI session/crash 日志写到 `~/.config/consol/logs/consol-dev.log`，远程 RPC URL 路径、query、userinfo 和 private-key-like 参数会被脱敏。
- **English / Chinese UI text**：`consol dev` 的主要 TUI 文案支持 `en-US` 和 `zh-CN`，可通过 `[ui] language` 配置。

## Install

Requirements:

- macOS or Linux.
- Foundry tools on `PATH`: `forge`, `cast`, and `anvil`.
- Rust stable for source builds.
- Homebrew for the tap install path.

Homebrew:

```bash
brew tap luweiCN/consol
brew install consol
consol --help
```

Source build:

```bash
cargo install --locked --path apps/cli
consol --help
```

See [Install Guide](docs/release/INSTALL.md) for verification, upgrade, uninstall, and troubleshooting notes.

## Quick Start

From a Foundry project:

```bash
consol detect
consol build
consol dev
```

For a single Solidity file:

```bash
consol dev ./Counter.sol:Counter
consol demo ./Counter.sol:Counter
```

A local CLI loop against Anvil:

```bash
consol chain start
consol deploy Counter
consol call Counter number
consol send Counter setNumber 42 --yes
consol state Counter
consol logs Counter
consol activity Counter
```

`--yes` only skips local/dev confirmations. Remote writes require explicit signer and network confirmation policy.

## Target Syntax

Most commands accept a `<target>`:

```text
Counter                         # Foundry project artifact contract name
src/Counter.sol:Counter         # Foundry project source-file-qualified target
./Counter.sol                   # single-file mode, valid when only one deployable contract exists
./Counter.sol:Counter           # single-file mode with explicit contract
./lesson/ERC20Demo.sol:MyToken  # single-file demo path with explicit contract
```

Use file-qualified project targets when a workspace has duplicate contract names across `src`, `test`, `script`, mocks, or examples.

## TUI Cockpit

`consol dev [target]` opens the main product experience.

Key workflows:

- `/` opens fuzzy file/contract search.
- `Tab` / `Shift-Tab` changes pane focus.
- `[` / `]` changes workspace tab.
- `b` runs build and refreshes ABI/functions.
- `d` opens deploy/status for the active target.
- `D` fresh redeploys the active target.
- `Enter` / `c` runs the selected ABI action.
- `n` cycles configured networks when no explicit network override is active.
- `a` cycles available accounts/signers when no explicit account override is active.
- `PageUp` / `PageDown` or mouse wheel scroll Activity when Activity is focused.
- `t` traces the latest transaction when Activity is focused.
- `Esc` closes sheets/modals; `q` or `Ctrl-C` exits the main TUI.

The Contract workspace keeps the active file/contract at the center: runnable ABI list, selected action detail, State Watch, Activity, deployment status, and Build diagnostics all follow the selected target.

## CLI Commands

Project and inspection:

```bash
consol init
consol init --from-file ./Counter.sol --to ./counter-foundry
consol detect [target]
consol build [target]
consol test
consol snapshot
consol inspect <target>
consol abi <target>
consol storage <target>
```

Local chain, profiles, and signers:

```bash
consol chain start|status|stop|restart
consol network list|add|use|status|remove
consol account list|use|import|balance
consol signer list|status
```

Contract interaction:

```bash
consol deploy <target> [constructor_args...]
consol deploy --fresh <target> [constructor_args...]
consol deploy --all
consol deploy --list
consol deploy --forget <target>
consol call <target> <function> [args...]
consol send <target> <function> [args...] [--value <amount>]
consol state <target> [--watch]
consol logs <target> [--watch]
consol activity <target> [--limit <n>]
consol tx list [target] [--limit <n>]
consol console <target>
consol demo <target> [constructor_args...]
```

Diagnostics and professional workflows:

```bash
consol gas compile <target>
consol gas estimate <target> <function> [args...] [--value <amount>]
consol gas report [--match-contract <name>]
consol gas snapshot [--diff|--check]
consol analyze
consol hints --file <path> [--contract <name>]
consol trace <tx_hash>
consol verify <target> [--address <address>] [--chain <chain>] [--verifier <name>]
```

## State and Safety

- Deployment cache and transaction history live under the project `.consol/` directory for Foundry project mode.
- Single-file mode uses scratch projects under `~/.cache/consol/scratch/` and does not create `.consol/` beside the standalone source by default.
- Remote RPC paths, query strings, and userinfo are redacted in JSON/human output and diagnostic logs.
- Remote deploy/send requires an explicit signer profile or `ETH_PRIVATE_KEY`, and cannot be approved with bare `--yes`.
- Machine confirmation uses `--confirm-network <name>` and requires a named network profile plus chain-id guard.

## Configuration

User profiles live in `~/.config/consol/config.toml` by default.

Useful environment/config overrides:

- `CONSOL_CONFIG`: use a specific config file.
- `CONSOL_CONFIG_DIR`: move the ConSol config/log directory.
- `CONSOL_LOG_DIR`: override only the diagnostic log directory.
- `ETH_RPC_URL`: one-command RPC override.
- `ETH_PRIVATE_KEY`: temporary env signer.
- `[ui] language = "en-US" | "zh-CN" | "system"`: TUI language selector. Config wins over locale environment variables.

## Repository Layout

```text
consol/
├── apps/
│   └── cli/                 # Rust CLI/TUI binary, command name consol
├── crates/                  # Future shared Rust library crates
├── docs/
│   ├── architecture/        # Repo and technical architecture
│   ├── product/             # PRD, roadmap, CLI spec
│   └── release/             # Install and Homebrew release notes
├── examples/                # Foundry and single-file demo fixtures
├── extensions/
│   └── vscode/              # Future thin client over CLI/protocol
└── plugins/
    └── consol.nvim/         # Future thin client over CLI/protocol
```

## Documentation

- [CLI Spec](docs/product/CLI_SPEC.md)
- [Product PRD](docs/product/PRD.md)
- [Roadmap](docs/product/ROADMAP.md)
- [Iteration Plan](docs/product/ITERATION_PLAN.md)
- [Tech Stack](docs/architecture/TECH_STACK.md)
- [Repo Structure](docs/architecture/REPO_STRUCTURE.md)
- [Install Guide](docs/release/INSTALL.md)
- [Homebrew Distribution](docs/release/HOMEBREW.md)
- [Overseer Prototype Reference](docs/research/OVERSEER_REFERENCE.md)
- [Original technical spec](docs/research/solidity-devtools-spec.md)
- [Original conversation notes](docs/research/solidity-devtools-conversation.md)

## Development

```bash
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --all-targets --all-features -- -D warnings
```

The main product is the `consol` Rust CLI/TUI in `apps/cli`. VS Code and NeoVim integrations are planned as thin clients over the same CLI/JSON/NDJSON protocol, not separate product forks.
