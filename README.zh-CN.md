# ConSol

**ConSol：智能合约开发控制台。**

[English](README.md) | [简体中文](README.zh-CN.md)

ConSol 是一个终端优先的 Solidity / EVM 开发控制台。它基于 Foundry，把 `forge`、`cast`、`anvil` 组织成可脚本化的 CLI 和可常驻终端的 TUI 控制台。命令名是 `consol`。

ConSol 不替代 Foundry。它补的是智能合约开发里最容易重复、出错的交互层：选择正确的合约目标、部署、读取状态、发送交易、查看解码事件、追踪交易，并保留部署与交易上下文。

## 功能

- **以源码为中心的 TUI**：`consol dev` 扫描 `src`、`contracts`、`test`、`script` 和根目录示例 `.sol` 文件，并以当前文件/合约驱动整个工作区。
- **Foundry 项目和单文件模式**：既支持标准 Foundry 项目，也支持 `./Counter.sol:Counter` 这类独立教学/示例文件。单文件模式会在 `~/.cache/consol/scratch/` 创建临时 Foundry 项目，默认不会在源码旁边写 `.consol/`。
- **文件限定项目目标**：项目里可以用 `src/Counter.sol:Counter` 指定具体源文件，避免 `src`、`test`、`script`、mock、example 中的重名合约互相混淆。
- **Deploy / call / send / state 闭环**：部署缓存、链上代码校验、基于 ABI 的调用/交易、无参数状态读取、解码日志和交易历史都走同一套命令层。
- **常驻合约控制台**：TUI 里可以构建、部署、运行 read/write/payable 函数，查看 State Watch、Activity、构建诊断和等价 CLI 命令。
- **Activity 和 trace**：`consol activity` 汇总部署、状态、日志和交易；TUI Activity 支持长日志换行、滚动回看和追踪最新记录的交易。
- **Network / account / signer 安全模型**：显式建模具名网络、环境变量私钥、Foundry keystore signer、当前账户、signer 临时覆盖、远程写入确认和 chain-id guard。
- **Gas、诊断和编辑器协议**：`gas compile/estimate/report/snapshot`、`analyze`、`hints`、`storage`、`trace`、`verify` 为 CLI、TUI、CI 和后续编辑器集成提供结构化数据。
- **机器输出**：大多数命令支持 `--json`；watch 命令和写交易生命周期支持 `--ndjson`。
- **本地诊断日志脱敏**：TUI 会话/崩溃日志写入 `~/.config/consol/logs/consol-dev.log`；远程 RPC URL 的 path、query、userinfo 和疑似私钥参数会被脱敏。
- **中英文 TUI 文案**：`consol dev` 的用户可见文案支持 `en-US` 和 `zh-CN`，通过 `[ui] language` 选择。

## 安装

要求：

- macOS 或 Linux。
- `PATH` 上有 Foundry 工具：`forge`、`cast`、`anvil`。
- 从源码构建需要 Rust stable。
- 使用 tap 安装需要 Homebrew。

Homebrew：

```bash
brew tap luweiCN/consol
brew install consol
consol --help
```

源码构建：

```bash
cargo install --locked --path apps/cli
consol --help
```

验证、升级、卸载和排错见 [安装指南](docs/release/INSTALL.md)。

## 快速开始

在 Foundry 项目里：

```bash
consol detect
consol build
consol dev
```

对单个 Solidity 文件：

```bash
consol dev ./Counter.sol:Counter
consol demo ./Counter.sol:Counter 0
```

基于 Anvil 的本地命令行闭环：

```bash
consol chain start
consol deploy Counter 0
consol call Counter number
consol send Counter setNumber 42 --yes
consol state Counter
consol logs Counter
consol activity Counter
```

`--yes` 只跳过本地/开发网络确认。远程写入需要显式 signer 和网络确认策略。

## 目标语法

大多数需要目标合约的命令接受：

```text
Counter                         # Foundry 项目 artifact 合约名
src/Counter.sol:Counter         # Foundry 项目源文件限定目标
./Counter.sol                   # 单文件模式；文件里只有一个可部署合约时可用
./Counter.sol:Counter           # 单文件模式，显式指定合约
./lesson/ERC20Demo.sol:MyToken  # 单文件 demo 路径，显式指定合约
```

当工作区里 `src`、`test`、`script`、mock 或 example 有重名合约时，使用文件限定项目目标。

## TUI 控制台

`consol dev [target]` 打开主要产品体验。

常用按键：

- `/` 打开文件/合约模糊搜索。
- `Tab` / `Shift-Tab` 切换 pane 焦点。
- `[` / `]` 切换工作区标签。
- `b` 构建并刷新 ABI/functions。
- `d` 打开当前目标的部署/状态。
- `D` fresh redeploy 当前目标。
- `Enter` / `c` 运行选中的 ABI action。
- `n` 在没有显式 network override 时切换已配置网络。
- `a` 在没有显式 account override 时切换可用账户/signer。
- Activity 聚焦时，`PageUp` / `PageDown` 或鼠标滚轮滚动 Activity。
- Activity 聚焦时，`t` 追踪最新交易。
- `Esc` 关闭 sheet/modal；`q` 或 `Ctrl-C` 退出主 TUI。

Contract 工作区以当前文件/合约为中心：可运行 ABI 列表、选中动作详情、State Watch、Activity、部署状态和构建诊断都跟随当前目标。

## CLI 命令

项目与检查：

```bash
consol init [--from-file <file.sol> --to <dir>]
consol detect [target]
consol build [target]
consol test
consol snapshot
consol inspect <target>
consol abi <target>
consol storage <target>
```

本地链、配置档和 signer：

```bash
consol chain start|status|stop|restart
consol network list|add|use|status|remove
consol account list|use|import|balance
consol signer list|status
```

合约交互：

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

诊断和专业工作流：

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

## 状态与安全

- Foundry 项目的部署缓存和交易历史写在项目 `.consol/` 目录下。
- 单文件模式使用 `~/.cache/consol/scratch/` 下的临时项目，默认不在独立源码旁边创建 `.consol/`。
- 远程 RPC 的 path、query、userinfo 会在 JSON 输出、人类输出和诊断日志里脱敏。
- 远程 deploy/send 需要显式 signer 配置档或 `ETH_PRIVATE_KEY`；裸 `--yes` 不能批准远程写入。
- 机器确认使用 `--confirm-network <name>`，并要求具名网络配置档和 `--chain-id`。

## 配置

用户配置档默认在 `~/.config/consol/config.toml`。

常用环境变量/配置：

- `CONSOL_CONFIG`：指定配置文件。
- `CONSOL_CONFIG_DIR`：移动 ConSol 配置目录和日志目录。
- `CONSOL_LOG_DIR`：只覆盖诊断日志目录。
- `ETH_RPC_URL`：单次命令 RPC 覆盖。
- `ETH_PRIVATE_KEY`：临时环境变量 signer。
- `[ui] language = "en-US" | "zh-CN" | "system"`：TUI 语言选择。配置优先于 locale 环境变量。

## 仓库结构

```text
consol/
├── apps/
│   └── cli/                 # Rust CLI/TUI 二进制程序，命令名 consol
├── crates/                  # 后续共享 Rust library crate
├── docs/
│   ├── architecture/        # 仓库和技术架构
│   ├── product/             # PRD、roadmap、CLI spec
│   └── release/             # 安装和 Homebrew 发布说明
├── examples/                # Foundry 和单文件示例夹具
├── extensions/
│   └── vscode/              # 后续基于 CLI/protocol 的轻量客户端
└── plugins/
    └── consol.nvim/         # 后续基于 CLI/protocol 的轻量客户端
```

## 文档

- [CLI 规格](docs/product/CLI_SPEC.md)
- [产品 PRD](docs/product/PRD.md)
- [路线图](docs/product/ROADMAP.md)
- [迭代计划](docs/product/ITERATION_PLAN.md)
- [技术栈](docs/architecture/TECH_STACK.md)
- [仓库结构](docs/architecture/REPO_STRUCTURE.md)
- [安装指南](docs/release/INSTALL.md)
- [Homebrew 分发说明](docs/release/HOMEBREW.md)
- [Overseer 原型参考](docs/research/OVERSEER_REFERENCE.md)
- [原始技术规格](docs/research/solidity-devtools-spec.md)
- [原始对话记录](docs/research/solidity-devtools-conversation.md)

## 开发

```bash
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --all-targets --all-features -- -D warnings
```

主产品是 `apps/cli` 里的 `consol` Rust CLI/TUI。VS Code 和 NeoVim 集成计划作为同一套 CLI/JSON/NDJSON protocol 上的轻量客户端，而不是新的产品分支。
