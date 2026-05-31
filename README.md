# ConSol

**ConSol — the smart contract console.**

ConSol 是一个 terminal-first 的 Solidity / EVM 开发工具。它的核心命令是全小写的 `consol`，当前项目主线是 CLI + TUI，不先做 VS Code 扩展或 NeoVim 插件。

## Product Positioning

ConSol 不是要替代 Foundry，而是站在 Foundry 之上，补齐专业合约开发中最缺的交互层：

- 像前端开发时常驻终端一样，提供 `consol dev` TUI 面板。
- 像 Remix 一样能快速部署、调用、查看状态，但工作在真实本地项目、Git、测试和终端工作流里。
- 像 `cast` 一样可脚本化，但保留项目状态、ABI 上下文、部署缓存、交易历史和 watch 能力。
- 后续可被 `consol.nvim`、VS Code 扩展等编辑器集成复用，但 CLI/TUI 永远是主产品。

## Repository Layout

```text
consol/
├── apps/
│   └── cli/                 # 当前主线：Rust CLI/TUI binary，命令名 consol
├── crates/                  # 后续按需拆分 Rust library crates
├── docs/
│   ├── architecture/        # 仓库结构、技术分层
│   ├── product/             # PRD、路线图、CLI spec
│   └── research/            # 原始讨论材料与外部调研记录
├── extensions/
│   └── vscode/              # 后续 VS Code 扩展，当前冻结
├── plugins/
│   └── consol.nvim/         # 后续 NeoVim 插件，当前冻结
└── examples/                # 后续端到端示例项目
```

## Current Docs

- [Product PRD](docs/product/PRD.md)
- [CLI Spec](docs/product/CLI_SPEC.md)
- [Roadmap](docs/product/ROADMAP.md)
- [Iteration Plan](docs/product/ITERATION_PLAN.md)
- [Tech Stack](docs/architecture/TECH_STACK.md)
- [Repo Structure](docs/architecture/REPO_STRUCTURE.md)
- [Install Guide](docs/release/INSTALL.md)
- [Homebrew Distribution](docs/release/HOMEBREW.md)
- [Project Context](PROJECT_CONTEXT.md)
- [Overseer Prototype Reference](docs/research/OVERSEER_REFERENCE.md)
- [Original technical spec](docs/research/solidity-devtools-spec.md)
- [Original conversation notes](docs/research/solidity-devtools-conversation.md)

## Install

Requirements:

- Rust stable for source builds.
- Foundry tools on `PATH`: `forge`, `cast`, and `anvil`.
- Homebrew for the tap install path.

Source build:

```bash
cargo install --locked --path apps/cli
consol --help
```

Run the TUI developer console from a Foundry project or a small single-file demo directory:

```bash
consol dev
consol dev ./Counter.sol:Counter
```

`consol dev` scans Solidity sources under `src`, `contracts`, `test`, `script`, and root-level demo `.sol` files. The TUI centers on the currently selected contract: press `/` to open a fuzzy contract picker, `b` to build the ABI, `d` to preview/deploy, and arrow keys plus `Enter` or `c` to run read/write functions. The Contract workspace follows a terminal cockpit model with a compact context strip, focused runnable ABI list, selected-row details, persistent State Watch, Activity, and bottom keybar. If a function needs a deployment first, ConSol opens the deploy preview instead of leaving you at a dead `no deployment` state. Argument input is remembered per function during the session, zero-argument read state is shown in the Contract workspace and State panel, and durable panel data comes from the same CLI layer as `consol state`, `consol logs`, `consol tx list`, and `consol activity`.

User profiles live in `~/.config/consol/config.toml`. `consol dev` also writes session and crash diagnostics to `~/.config/consol/logs/consol-dev.log` so TUI exits can be debugged after the terminal restores.

Homebrew tap:

```bash
brew tap luweiCN/consol
brew install consol
```

The Homebrew formula lives in `luweiCN/homebrew-consol`.

See [Install Guide](docs/release/INSTALL.md) for verification, upgrade, uninstall, and troubleshooting notes.

## Development Focus

The first implementation milestone is `apps/cli`:

1. Detect Foundry projects and toolchain state.
2. Support both Foundry project mode and single-file demo mode.
3. Wrap `forge`, `cast`, and `anvil` with stable structured output.
4. Model network, account, signer, and transaction confirmation explicitly.
5. Add ABI-aware deploy/call/send/state workflows.
6. Add deployment cache and chain-code validation.
7. Add `consol dev` TUI as the always-on smart contract console.
