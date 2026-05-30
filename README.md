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

- [Product PRD](/Users/luwei/code/ai/consol/docs/product/PRD.md)
- [CLI Spec](/Users/luwei/code/ai/consol/docs/product/CLI_SPEC.md)
- [Roadmap](/Users/luwei/code/ai/consol/docs/product/ROADMAP.md)
- [Iteration Plan](/Users/luwei/code/ai/consol/docs/product/ITERATION_PLAN.md)
- [Tech Stack](/Users/luwei/code/ai/consol/docs/architecture/TECH_STACK.md)
- [Repo Structure](/Users/luwei/code/ai/consol/docs/architecture/REPO_STRUCTURE.md)
- [Homebrew Distribution](/Users/luwei/code/ai/consol/docs/release/HOMEBREW.md)
- [Project Context](/Users/luwei/code/ai/consol/PROJECT_CONTEXT.md)
- [Overseer Prototype Reference](/Users/luwei/code/ai/consol/docs/research/OVERSEER_REFERENCE.md)
- [Original technical spec](/Users/luwei/code/ai/consol/docs/research/solidity-devtools-spec.md)
- [Original conversation notes](/Users/luwei/code/ai/consol/docs/research/solidity-devtools-conversation.md)

## Install

Source build:

```bash
cargo install --locked --path apps/cli
consol --help
```

Homebrew tap:

```bash
brew tap luweiCN/consol
brew install consol
```

The Homebrew formula lives in `luweiCN/homebrew-consol`.

## Development Focus

The first implementation milestone is `apps/cli`:

1. Detect Foundry projects and toolchain state.
2. Support both Foundry project mode and single-file demo mode.
3. Wrap `forge`, `cast`, and `anvil` with stable structured output.
4. Model network, account, signer, and transaction confirmation explicitly.
5. Add ABI-aware deploy/call/send/state workflows.
6. Add deployment cache and chain-code validation.
7. Add `consol dev` TUI as the always-on smart contract console.
