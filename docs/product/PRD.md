# ConSol Product Requirements

## 1. Positioning

**ConSol — the smart contract console.**

中文定位：**ConSol：智能合约开发控制台。**

ConSol 是面向 Solidity / EVM 开发者的 terminal-first 开发工具。它把 Remix 里方便的“部署、调用、查看状态、观察事件”能力带回专业开发者真实使用的本地工作流：VS Code / NeoVim / 其他编辑器写代码，旁边开终端运行 `consol dev`，持续看到编译、链、账户、合约、状态、交易和事件。

核心产品不是编辑器插件，而是 `consol` CLI + TUI。编辑器插件只是后续入口。

## 2. Product Bet

Solidity 开发工具链现在两端都不够理想：

- Remix 上手快、交互方便，但和真实工程工作流割裂。
- Foundry 强大、专业、可测试、可 CI，但交互层很原子化，开发者需要手写大量 `forge` / `cast` / `anvil` 命令。

ConSol 的机会是成为 Foundry 生态上方的智能交互层：

- 不是“又一个 forge wrapper”，而是带状态、带上下文、带 TUI 的合约开发控制台。
- 不是“网页 IDE”，而是可以常驻在开发者终端里的 smart contract console。
- 不是“编辑器插件优先”，而是先把所有核心能力沉到 CLI 和可机器读取的协议输出里。

## 3. Target Users

### Solidity Learner

正在学习合约开发，只想快速看到部署、调用和状态变化。

他们需要：

- 零配置启动本地链。
- 自动识别合约 ABI。
- 直接选择函数并传参数。
- 不必理解一长串 `cast call` / `cast send`。

### Foundry Developer

已经使用 Foundry、VS Code 或 NeoVim 写合约，平时会跑 `forge test`、`anvil`、`cast`。

他们需要：

- 在真实项目中工作，不离开 Git 和本地文件。
- 旁边常驻一个终端面板，像前端开发时看 dev server 一样看合约状态。
- 部署缓存、链上代码校验、交易历史和事件流。
- 命令可脚本化，也可 TUI 操作。

### Protocol Engineer

开发 DeFi、NFT、Account Abstraction、DAO、跨合约系统。

他们需要：

- 多合约部署状态。
- 合约依赖和增量部署。
- Storage layout、事件、Gas、测试、trace、debug 能力。
- 更强的本地链和多账户工作流。

## 4. Product Principles

1. **CLI first**：任何能力先在 `consol` CLI 成立，再考虑 TUI 和编辑器插件。
2. **TUI is the cockpit**：`consol dev` 是核心体验，不是附属 demo。
3. **Foundry native**：优先复用 `forge`、`cast`、`anvil`，不重建编译器和链。
4. **Stateful interaction**：ConSol 要记住当前链、账户、合约、部署地址、交易历史和 ABI 上下文。
5. **JSON/NDJSON protocol**：所有命令都能输出机器可读结果，watch 类命令使用 NDJSON 流。
6. **Safe by default**：所有写操作清楚展示 network、chain id、from、to、value、gas、calldata 摘要。
7. **Editor agnostic**：VS Code、NeoVim、JetBrains、普通终端都应该能受益。
8. **No plugin-first trap**：插件不能拥有核心业务逻辑，只能调用 `consol`。
9. **Network and signer are first-class**：网络、账户地址和签名来源必须分开建模，不能只靠一个 RPC URL 和一个私钥变量。
10. **Gas numbers need provenance**：Gas 不是一个单一数字，每个 gas 结果都必须说明来源、置信度和上下文。

## 5. Remix Parity

ConSol 要追平 Remix 里真正有价值的 Deploy & Run 体验，但不要变成浏览器 IDE。

Remix 的关键能力不是“网页界面”，而是这几个模型：

- **Environment / Network**：用户可以选择本地 VM、本地 Anvil、远程 HTTP RPC、浏览器钱包注入的 provider、WalletConnect 等环境。
- **Account / Signer**：用户可以选择当前账户；写交易时由当前环境或钱包负责签名。
- **Deploy & interact**：编译后选择合约，填 constructor 参数，部署；部署后按 ABI 生成函数交互入口。
- **Gas hints**：编译成功后在函数声明行展示 gas estimates。

ConSol 对应的设计：

- 用户可以选择 named network，例如 `local`, `sepolia`, `mainnet-fork`, `custom-rpc`。
- 用户可以选择 account/signer，且 signer 独立于 network。
- 读操作不要求 signer；写操作必须经过 preview -> simulation/estimate -> confirm/sign -> broadcast -> receipt。
- 切换 network 后，所有 deployment cache 都必须重新按 network fingerprint 校验，不能沿用旧地址假设。
- 切换 signer 不应自动切换 network；切换 network 也不应自动切换 signer。
- 远程链和主网写操作需要比本地 Anvil 更强的确认。

第一版可以不完整支持浏览器钱包，但必须预留签名器模型。现实可行的顺序是：

1. MVP：Anvil 默认账户 + env private key + keystore profile。
2. P1：远程 RPC profile + testnet 写操作 + 严格确认。
3. P2：Foundry browser wallet、WalletConnect、Ledger/Trezor、AWS/GCP KMS、Turnkey 等外部 signer。

## 6. Source Modes

ConSol 必须支持两种源码模式。

### Project Mode

已有 Foundry 项目：

```bash
consol dev
consol inspect Counter
consol deploy Counter
```

ConSol 读取 `foundry.toml`、`out/` artifacts、remappings、profiles、script/test 目录。这个模式服务专业工程。

### Single-file Mode

单个 Solidity 文件：

```bash
consol demo ./Counter.sol:Counter
consol dev ./Counter.sol:Counter
consol deploy ./Counter.sol:Counter
```

ConSol 在内部 scratch 目录生成临时 Foundry 项目，隐藏 `forge init`、目录结构、artifact 输出等细节。这个模式服务教学、演示、快速验证和小 demo。

Selector grammar：

```text
Counter                         # project mode，按 artifact contract name 查找
./Counter.sol                   # single-file mode，仅当文件内只有一个可部署合约
./Counter.sol:Counter           # single-file mode，显式选择合约
./lesson/ERC20Demo.sol:MyToken  # single-file mode，多目录 demo
```

单文件模式默认不在用户文件旁写 `.consol/`。状态、scratch project 和 cache 放到 ConSol 的全局 cache/state 目录；只有用户执行 `consol init --from-file` 或显式 `--local-state` 时，才把它迁移成真实项目。

## 7. Core Experience

### Primary Workflow

```bash
consol dev
```

`consol dev` 启动一个常驻 TUI 面板：

- 自动检测 Foundry 项目。
- 自动扫描 `src`、`contracts`、`test`、`script` 和根目录单文件 demo 里的 `.sol` 文件。
- 检测 `forge`、`cast`、`anvil`、RPC、当前账户。
- 显示编译状态、测试状态、当前链和区块高度。
- 列出可用合约、部署地址和 ABI 函数。
- 支持选中合约后查看 state、调用 view 函数、发送交易。
- 持续显示交易历史、事件日志和错误诊断。

开发者在编辑器里写合约，在旁边终端里看 ConSol。这是产品的核心画面。

### Command Workflow

```bash
consol detect
consol build
consol inspect Counter
consol chain start
consol deploy Counter
consol call Counter number
consol send Counter setNumber 42
consol state Counter --watch
consol logs Counter --watch
```

命令模式服务三类场景：

- 普通终端用户。
- shell 脚本和 CI。
- 编辑器插件通过 `--json` 调用。

### REPL Workflow

```bash
consol console Counter
```

进入合约上下文：

```text
Counter 0x5FbD... on anvil:31337
from 0xf39F...

> number
5

> setNumber 42
tx 0xabc... gas 35800

> .state
number 42
owner  0xf39F...

> .watch number
number 42 -> 43 at block 16
```

REPL 是 TUI 之外的轻量交互模式，适合快速调试。

## 8. TUI Layout

`consol dev` 的第一版不追求复杂动画，先追求信息密度、键盘效率和安全确认。TUI 不能只是把命令输出拼到几个面板里，它需要一套稳定的 project snapshot / contract workspace / action sheet 状态模型。

```text
┌─ ConSol ─ local-anvil 31337 ─ block 18 ─ deployer 0xf39F... ─ build OK ─┐
│ src/Counter.sol          │ Counter                                      │
│ > Counter  deployed      │ [State] [Functions] [Deploy] [Events] [Diag] │
│   Token    not deployed  │ number()                 42                  │
│   Vault    stale args    │ owner()                  0xf39F...           │
├──────────────────────────┼──────────────────────────────────────────────┤
│ Deployments              │ Action / Inspector                           │
│ Counter 0x5FbD...        │ setNumber(uint256 newNumber)                 │
│ bytecode OK              │ newNumber: [42                              ]│
│ constructor args OK      │ gas estimate: 35,800 from RPC @ block 18      │
├──────────────────────────┴──────────────────────────────────────────────┤
│ Activity: build, tx lifecycle, decoded events, diagnostics              │
└─────────────────────────────────────────────────────────────────────────┘
```

必要面板：

- **Project Status**：toolchain、RPC、chain id、block、account、build/test 状态。
- **Network / Account Strip**：当前 network、RPC、chain id、block、signer、余额、write policy。
- **Contract Picker**：按需弹出的合约选择器，识别 `src` / `contracts` / `test` / `script` / demo 文件，支持输入式模糊搜索、键盘移动和 Enter 切换当前 file/contract。
- **Contract Workspace**：默认主工作区，展示下一步、部署状态、constructor / read / write / payable ABI 项、最近结果，并在空间允许时常驻 State Watch 和 Activity；read/write/payable 在未部署时先打开部署参数/预览，而不是要求用户切换面板手动部署。
- **Deployment State**：not deployed、pending、deployed、stale bytecode、stale constructor args、no code、wrong network、reverted。
- **Workspace tabs**：Overview、State、Events、Contract、Build、Activity、Help；所有 workspace 内容跟随当前选中的 file/contract 自动切换。
- **State Watch**：无参数 view/pure 函数和 public getter 批量读取，并随 live refresh tick 更新。
- **Action Panel**：部署、call、send、参数输入、value、gas/fee、展示等价 CLI 命令。
- **Activity / Live Output**：部署、write 交易、read 结果、解码事件、state/activity 刷新、编译错误和最近操作历史；durable 数据必须来自 `consol activity` / `consol logs` / `consol tx list` 这类命令层能力，TUI 只叠加当前会话内的临时消息。
- **History**：部署和交易记录。
- **Command Palette**：build、deploy、call、send、switch network、switch account、show CLI、refresh。

基础键盘模型：

- `Tab` / `Shift-Tab`：切换焦点区域。
- 方向键：移动选择。
- `/`：搜索合约、函数、事件。
- `Enter` / `c`：打开或执行当前选中的 ABI action。
- `r`：刷新当前状态。
- `d`：查看部署状态或部署当前合约。
- `D`：fresh redeploy 当前合约。
- `b`：运行 build 并刷新诊断。
- `t`：在 Activity 焦点内 trace 最新交易。
- `n`：切换 network。
- `a`：切换 account/signer。
- `[` / `]`：切换 workspace。
- `q` / `Ctrl-C`：退出 TUI。
- `Esc`：返回或关闭当前 action sheet。

部署和写交易必须打开 confirmation sheet：

```text
Network: sepolia 11155111 via SEPOLIA_RPC_URL
Signer: deployer 0xabc... source env:ETH_PRIVATE_KEY
Contract: Counter 0x123...
Function: setNumber(uint256)
Args: 42
Value: 0 ETH
Gas / fees: estimate 35,800, max fee 12 gwei
Calldata: 0x3fb5c1cb...
Simulation: success
```

## 9. Gas Signal Taxonomy

ConSol 不能把所有 gas 都显示成一个“预计 gas”。至少要区分四类：

1. **Actual gas used**：来自已上链 deploy/send receipt，最准确。
2. **RPC gas estimate**：来自当前链状态、当前 from/to/value/calldata 的 `eth_estimateGas` 或 `cast estimate`，用于交易预览，不保证最终一致。
3. **Compiler gas estimate**：来自编译 artifact / `forge inspect <target> gasEstimates`，适合做 Remix-like inline hint，但可能缺失或显示 unbounded/infinite。
4. **Test gas report/snapshot**：来自 `forge test --gas-report`、`forge snapshot` 或 gas snapshot cheatcodes，适合回归对比，不代表任意调用成本。

每个 gas 字段必须带 provenance：

```json
{
  "kind": "rpc_estimate",
  "source": "eth_estimateGas",
  "value": "35800",
  "unit": "gas",
  "confidence": "estimate",
  "contract": "Counter",
  "function_signature": "setNumber(uint256)",
  "chain_id": 31337,
  "block": "18",
  "from": "0xf39F...",
  "generated_at": "2026-05-30T10:00:00Z"
}
```

显示规则：

- 缺失估算显示 `unknown`，不能显示 `0`。
- Solidity/solc 返回 `infinite` 时显示 `unbounded` 或隐藏 inline hint。
- RPC estimate 只能标注为 estimate，不能写成 “will cost”。
- 跨 compiler settings、optimizer、EVM version、chain 的 gas 不允许直接比较，除非标记 baseline invalid。
- ETH/USD 成本默认不显示，除非用户显式开启。

Remix-like ghost gas hints 是 P2 编辑器集成能力。CLI/TUI 先提供结构化 `compiler_estimate` 和 `rpc_estimate`，后续插件再把它渲染成 ghost text。

## 10. Functional Scope

### MVP: v0.1 CLI Foundation

目标：不用完整 TUI，`consol` 命令已经能完成本地合约开发主流程，并且为 TUI 提供正确的数据模型。

- `consol detect`：识别 Foundry 项目、工具链版本、RPC、账户。
- `consol snapshot`：输出当前 project/network/account/contracts/deployments 的 TUI-friendly project snapshot。
- `consol build`：调用 `forge build`，输出结构化 diagnostics。
- `consol inspect <target>`：解析 artifact ABI、bytecode hash、函数、事件、public getters、compiler gas estimates。
- `consol chain start/status/stop`：管理本地 `anvil`。
- `consol network status/use/list`：本地 network profile 和 chain-id guard。
- `consol account list/use/balance`：Anvil 默认账户和 env signer 的基础选择。
- `consol deploy <target>`：部署并写入缓存，带 transaction preview。
- `consol call <target> <function> [args...]`：调用 view/pure 函数并解码。
- `consol send <target> <function> [args...]`：发送交易并记录 history，默认需要确认。
- `consol state <target>`：读取全部无参数 view/public getter。
- `consol build ./Counter.sol`：单文件无外部依赖的 scratch Foundry project 编译。
- `--json`：所有命令支持统一 JSON envelope。

### v0.2 Dev Loop

目标：做出比直接 `cast` 明显更舒服的日常循环。

- 部署缓存：workspace id + network fingerprint + deployer + bytecode hash + constructor args hash + address + tx hash。
- 链上代码校验：缓存命中时用 `cast code` 验证地址仍有代码。
- `consol state --watch`：持续轮询并展示变化。
- `consol logs --watch`：按合约 ABI 解码事件。
- `consol test`：结构化解析 `forge test` 结果。
- `consol gas compile/estimate/report/snapshot`：明确区分不同 gas 来源。
- `consol console <target>`：REPL 模式。
- `consol demo ./Counter.sol:Counter`：单文件 demo 一键 build/start chain/deploy/console。
- `consol init --from-file ./Counter.sol --to ./counter-foundry`：把单文件迁移成真实 Foundry 项目。

### v0.3 TUI

目标：`consol dev` 成为主体验。

- TUI 面板布局。
- 合约选择。
- 函数选择和参数输入。
- 部署按钮/快捷操作。
- State watch 面板。
- Activity / tx history。
- Diagnostics 面板。
- 从 TUI 内复制等价 CLI 命令。
- network/account switcher。
- deploy/send confirmation sheet。
- 单文件 target 的 `consol dev ./File.sol:Contract`。

### v0.4 Professional Workflows

目标：支持更复杂的真实项目。

- 多合约部署列表。
- stale deployment 检测。
- `consol deploy --all` 增量部署。
- 合约依赖分析。
- Storage layout inspect。
- Trace inspect。
- Sepolia / mainnet fork 工作流。
- keystore、hardware wallet、browser wallet、WalletConnect、KMS signer。

### v0.5 Editor Integrations

目标：插件只做入口，不重复业务逻辑。

- `consol.nvim`：调用 `consol --json` 和 watch stream，渲染 diagnostic、virtual text、ghost gas hints、浮动面板。
- VS Code extension：右键部署、调用函数、查看 state、显示 gas hints，底层仍调用 `consol`。
- 可选 `consol server`：长期后台进程，为多个编辑器客户端复用项目状态。

## 11. Configuration

全局配置：

```toml
# ~/.config/consol/config.toml
[networks.local]
kind = "anvil"
rpc_url = "http://localhost:8545"
expected_chain_id = 31337
write_policy = "local"

[networks.sepolia]
kind = "remote"
rpc_url_env = "SEPOLIA_RPC_URL"
expected_chain_id = 11155111
write_policy = "confirm"

[accounts.anvil0]
signer = "anvil-index"
index = 0
allowed_networks = ["local"]

[accounts.deployer]
signer = "env-private-key"
private_key_env = "ETH_PRIVATE_KEY"
allowed_networks = ["local", "sepolia"]

[deploy]
cache = ".consol/deployments.json"

[ui]
language = "system"
theme = "system"
```

项目配置：

```toml
# consol.toml
[project]
name = "my-protocol"

[defaults]
network = "local"
account = "anvil0"

[networks.fork]
kind = "anvil-fork"
fork_url_env = "MAINNET_RPC_URL"
fork_block_number = 18000000
expected_chain_id = 1
write_policy = "local"
```

本地状态目录：

```text
.consol/
├── deployments.json
├── history.ndjson
├── sessions/
└── cache/
```

`.consol/deployments.json` 可以根据团队习惯决定是否提交。默认本地开发缓存不提交，正式网络部署记录可以显式导出。

## 12. Data Model

基础 JSON envelope：

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "meta": {
    "version": "0.1.0",
    "project_root": "/path/to/project",
    "network": {
      "name": "local",
      "kind": "anvil",
      "chain_id": 31337,
      "fingerprint": "local-anvil:31337:genesis-0x..."
    },
    "account": {
      "name": "anvil0",
      "address": "0xf39F...",
      "signer": "anvil-index"
    }
  }
}
```

watch 类命令使用 NDJSON：

```json
{"type":"network.changed","name":"sepolia","chain_id":11155111}
{"type":"account.changed","name":"deployer","address":"0xabc..."}
{"type":"diagnostic","severity":"error","file":"src/Counter.sol","line":12,"column":5,"message":"..."}
{"type":"gas.estimate","kind":"rpc_estimate","value":"35800","source":"eth_estimateGas"}
{"type":"state.changed","contract":"Counter","name":"number","before":"41","after":"42","block":16}
{"type":"tx.confirmation_requested","contract":"Counter","function":"setNumber","network":"sepolia"}
{"type":"tx.rejected","reason":"user_cancelled"}
{"type":"tx.mined","hash":"0xabc","status":"success","gas_used":"35800"}
{"type":"event","contract":"Counter","event":"NumberChanged","args":{"value":"42"}}
```

Deployment cache key：

```text
workspace_id + contract_name + creation_bytecode_hash + constructor_args_hash + network_fingerprint + deployer
```

Single-file scratch metadata：

```text
scratch.json:
- original file
- selected contract
- import graph
- remappings
- dependency lock
- forge version
- artifact path
- build id
```

## 13. Non-goals

当前阶段不做：

- 不自研 Solidity 编译器。
- 不替代 Foundry 的测试框架。
- 不先做 VS Code / NeoVim 插件。
- 不做浏览器版 IDE。
- 不优先支持 Solana / Move / 非 EVM。
- 不把私钥保存到明文项目文件。
- 不把远程链写操作伪装成本地开发一样轻松；安全确认优先。

## 14. Success Criteria

v0.1 成功标准：

- 在标准 Foundry Counter 项目中，用户能用 `consol` 完成 build、inspect、chain start、deploy、call、send、state 全流程。
- 在单文件 `Counter.sol` 中，用户能用 `consol build ./Counter.sol`、`consol deploy ./Counter.sol:Counter` 完成本地 demo 流程。
- 每个核心命令都有稳定 `--json` 输出。
- 部署缓存能避免重复部署，并能识别 anvil 重启后的空代码地址。
- 错误信息能指出缺少哪个工具、哪个 RPC、哪个账户或哪个 artifact。
- JSON meta 必须包含 network/account/signer 上下文。

v0.3 成功标准：

- `consol dev` 能作为开发时常驻终端使用。
- 用户不用离开 TUI，就能看合约、部署、调用函数、观察 state 和事件。
- TUI 里每个关键操作都能复制等价 CLI 命令，便于学习和脚本化。
- TUI 能切换 network/account，且切换后重新校验部署状态。
