# solidity-devtools 开发讨论记录

> 日期：2025-05-25 ~ 2025-05-30
> 总结了从 overseer 模板到独立 Rust CLI + Neovim 插件的完整讨论过程

---

## 一、项目起源：从 overseer 模板开始

最初的需求是在 Neovim 里为 Foundry/Solidity 开发提供类似 Remix IDE 的体验。通过 overseer.nvim 的模板系统，实现了一套基于 bash 脚本的 Foundry 工作流：

- 自动编译（保存时 forge build）
- ABI 解析（从编译产物 JSON 提取函数列表）
- 合约部署（forge create + 部署缓存）
- 函数调用（cast call/send）
- 合约状态面板（批量读取 + watch 模式）
- 行内 Gas 估算（cast estimate）
- 枚举显示（从源码正则提取 enum 定义）

在开发 overseer 模板过程中解决的关键技术问题：

1. **"Contract code is empty" bug** — anvil 重启后链数据丢失，但部署缓存保留旧地址。通过 `cast code` 验证链上合约是否仍然存在来修复。
2. **任务列表重复** — overseer 硬编码了 `"overseer/template"` 扫描目录，用户配置的 `template_dirs` 指向同一路径导致双重扫描。
3. **字节码变更检测** — 用 SHA256 前 8 位作为缓存 key，合约代码变更自动触发重新部署。
4. **模板缓存失效** — 移除 `cache_key`，每次 `:OverseerRun` 都重新生成模板。

---

## 二、从 overseer 模板到独立插件

用户表达了将 overseer 模板升级为独立开源 Neovim 插件的意愿：

> "我有点想做这个插件，因为这可以作为一个开源项目。然后也可以写在简历里面。"

### 命名讨论

最终确定项目名为 **solidity-devtools**：
- Neovim 插件：`solidity-devtools.nvim`
- Rust CLI 工具：`sd`

### 技术方案文档

编写了完整的技术方案文档 `solidity-devtools-spec.md`，涵盖：
- 项目概述与定位
- 环境兼容性（单文件模式、工具链检测）
- 功能列表（P0/P1/P2 三个优先级）
- 架构设计（模块划分、数据流）
- 命令与 API 设计
- 配置选项
- 开发计划

### 快捷键设计决策

用户明确要求不内置快捷键绑定：

> "你可以先不要指定快捷键，我们应该暴露函数或者命令，让用户自己指定快捷键"

改为暴露 `:SolidityDevtools*` 用户命令和 `require("solidity-devtools").*` Lua API，附带 keymap.set 绑定示例。

---

## 三、参考 Remix IDE 补充功能

研究了 Remix IDE 的功能，确定了 5 个新增特性：

1. **静态分析（Static Analysis）** — 集成 Slither，检测重入攻击、整数溢出等漏洞，结果通过 vim.diagnostic 标注
2. **单元测试内联结果** — 在 .t.sol 文件中用 virtual text 标注 ✓/✗
3. **合约交互 UI 自动生成** — 根据 ABI 自动生成类似 Remix Deploy & Run 的交互面板
4. **多钱包/多账户管理** — 支持 anvil 默认账户 + 自定义账户 + 切换
5. **交易调试器集成** — 与 nvim-dap 联动（P2 阶段）

---

## 四、架构重大决策：从纯 Lua 插件到 Rust CLI + Neovim 薄壳

用户提出了关键问题：

> "我突然想到一个点 就是有没有符合我们需求的命令行工具"

### 调研结果

搜索了现有 CLI 工具：
- **foundry-tui** — Rust TUI，包装 forge/cast 命令，但没有 ABI 解析、部署缓存、状态面板等智能功能
- **Foundry 本身** — forge/cast/anvil 是原子操作，缺少"智能交互层"

**结论：没有现成的 CLI 工具能替代我们要做的"智能层"。**

### 架构转变

用户提出：

> "我其实在想 我们如果做一款终端软件 然后再把这个终端软件集成进 nvim 里 是不是更好"

最终选择了 **方案 B：Rust CLI + Neovim 薄壳**：

```
CLI（sd）= 数据 + 逻辑（调 forge/cast，解析输出，管理状态）
插件 = 调用 CLI + 渲染 UI（解析 JSON，画浮动窗口，标 diagnostic）
```

### 语言选择

用户选择了 **Rust**：
- 和 Foundry 同语言，未来可复用 Foundry 的 crate
- 性能最好
- 简历加分最大

### CLI 命令设计

所有命令支持 `--json` 标志：

```bash
sd build [--json]                     # 编译
sd abi <contract> [--json]            # ABI 解析
sd deploy <contract> [--json] [--force] # 部署（带缓存）
sd call <contract> <function> [args...] # 读函数
sd send <contract> <function> [args...] # 写函数
sd state <contract> [--json] [--watch]  # 全部状态
sd gas <contract> [--json]             # Gas 报告
sd test [--json]                       # 测试
sd chain start/stop/restart            # 链管理
sd account list/use/current            # 账户管理
sd analyze [--json]                    # 静态分析
sd verify <contract>                   # 合约验证
```

### 双层架构的优势

1. **用户群更大** — CLI 不限编辑器，所有终端用户都能用
2. **简历价值翻倍** — "做了 CLI 工具 + 编辑器集成" > "做了 Neovim 插件"
3. **工程更干净** — CLI 输出 JSON，插件只管渲染
4. **这个模式已被验证** — ripgrep → telescope.nvim，prettier → conform.nvim

### 职责分界

CLI 负责：
- 所有 forge/cast/anvil 交互
- ABI 解析、enum 提取、类型解码
- 部署缓存管理、字节码哈希
- Gas report 解析、测试结果解析
- 静态分析（Slither 调用 + 输出解析）
- 账户管理

Neovim 插件负责：
- 异步调 `sd --json`
- 解析 JSON 输出
- 渲染浮动面板、diagnostic、virtual text
- 自动编译触发（BufWritePost）

插件代码量估计约 500 行 Lua，因为所有逻辑都在 CLI 侧。

---

## 五、CLI 与插件的详细功能分界

### 编译
- **CLI**: `sd build --json`，执行 forge build，解析错误到 JSON（含文件/行号/消息）
- **插件**: BufWritePost 自动调 CLI，渲染 vim.diagnostic

### ABI 解析
- **CLI**: `sd abi Counter --json`，从编译产物提取函数/enum/struct，从源码正则提取 enum 定义
- **插件**: 渲染函数列表到 Telescope / 浮动面板

### 部署
- **CLI**: `sd deploy Counter`，完整封装缓存查找 → 链上验证 → 部署 → 写缓存
- **插件**: 调命令，vim.notify 显示结果

### 合约交互
- **CLI**: `sd call/send Counter function args --json`，构造 calldata、执行 cast、解码返回值、enum 映射
- **插件**: 函数列表 UI + 参数输入表单 + 结果浮动面板

### 状态面板
- **CLI**: `sd state Counter --watch`，批量 cast call + ndjson 流式输出变化
- **插件**: 浮动面板渲染 + vim.loop.timer 刷新

### Gas 估算
- **CLI**: `sd gas Counter --json`，forge build --gas-report 输出解析，映射到行号
- **插件**: vim.api.nvim_buf_set_extmark() 渲染行内虚文本

### 测试
- **CLI**: `sd test --json`，解析 forge test 输出，结构化结果含行号
- **插件**: .t.sol 文件中渲染 ✓/✗ virtual text + diagnostic

### 静态分析
- **CLI**: `sd analyze --json`，调用 slither，解析 JSON 输出
- **插件**: 复用 diagnostic 渲染（和编译错误同一套）

---

## 六、专业开发者的真实工作流

### 他们不用 Remix

专业 Solidity 开发者的标配是 **Foundry + VS Code/Neovim**。Remix 的致命缺陷：
- 浏览器运行，文件存在缓存里
- 没有 Git 集成
- 测试能力弱
- 项目管理差
- 无法 CI/CD

### 他们怎么和合约交互

专业开发者主要通过**写测试文件**和合约交互：

```solidity
// test/Counter.t.sol
function testIncrement() public {
    counter.increment();
    assertEq(counter.number(), 1);
}
```

`forge test` 一跑就行，不需要手动调命令。

### 痛点在哪

**Foundry 生态里没有一个好的交互式合约交互工具：**

| 工具 | 问题 |
|------|------|
| cast | 每次都是完整命令，无状态，痛苦 |
| chisel (Solidity REPL) | 不能调已部署合约的函数 |
| hardhat console | 好用但 Foundry 用户用不了 |
| ape console | 要会 Python |

这正好是 `sd` 的切入点——成为 Foundry 生态里的 "hardhat console"。

### 建议新增：交互式 REPL 模式

```bash
$ sd console Counter

Counter (0x5FbDB...) on localhost:8545
Account: 0xf39F... (anvil-0)

> number
← 5

> setNumber 42
→ tx: 0xabc... gas: 35800

> .state
  number:  5
  owner:   0xf39F...
  locked:  false
  status:  0 (Active)

> .watch number
  number: 5 → 6 (changed at block 15)
```

---

## 七、Solidity 项目结构：从单文件到复杂工程

### 核心区别：没有"入口文件"

```
前端：main.ts → 引用 A → 引用 B → 一棵树
Solidity：每个合约独立部署到链上 → 像微服务
```

### 真实项目复杂度梯度

**第一级：单合约（学习阶段）**
```
src/
└── Counter.sol
```

**第二级：小型项目（solmate 风格）**
```
src/
├── auth/
├── tokens/    (ERC20, ERC721, ERC4626)
└── utils/
```

**第三级：中型项目（典型 DeFi 协议）**
```
src/
├── interfaces/
├── libraries/
├── Token.sol
├── Pool.sol
├── Oracle.sol
└── Governance.sol
script/
├── Deploy.s.sol
└── Upgrade.s.sol
```

**第四级：大型项目（Uniswap v4）**
- 40+ 个 .sol 文件
- 23 个库文件
- 多个接口层、自定义类型系统
- 测试文件比源码还多

### 部署顺序与增量部署

复杂项目需要按依赖顺序部署。**Foundry 没有内置变更检测——每次都全量部署。**

我们的 `sd deploy --all` 可以做增量部署：
1. 计算每个合约的 bytecode hash
2. 对比缓存，识别变更
3. 只重新部署变更的合约 + 依赖它的合约
4. 自动更新合约间的引用地址

**这个增量部署能力，目前没有任何工具做。**

---

## 八、为什么 Solidity 工具链这么落后

### 五个深层原因

1. **语言太年轻** — Solidity 2014 年诞生，JavaScript 1995 年，差 19 年
2. **框架反复推翻重来** — Truffle → Hardhat → Foundry，每次生态工具全废
3. **钱不流向开发者工具** — 做 DeFi 能融几亿，做工具几乎没有商业公司
4. **安全 > 体验** — 社区优先做安全工具（Slither、Echidna），打磨体验是次要的
5. **底层还在快速变化** — L1 战争、L2 爆炸、新 EIP 不停出

### 但这恰恰是机会

> 懂 Foundry 的人里，没有多少人同时懂怎么做好用的开发者工具。
> 懂怎么做工具的人里，没有多少人在做 Solidity 开发。

Remix 在 2024 年还有 10 万+ 月活用户——不是因为好，而是因为没有替代品。

---

## 九、跨链对比：Solana 工具链更差

### Foundry 只支持 EVM 链

```
支持：以太坊、Arbitrum、Optimism、Base、Polygon、BSC、Avalanche...
不支持：Solana、Near、Cosmos、Move 系（Sui、Aptos）
```

### Solana 工具链对比

| 能力 | Foundry (EVM) | Anchor (Solana) |
|------|--------------|-----------------|
| 逐步调试 | `forge debug` | **没有** |
| 模糊测试 | `forge fuzz` | **没有** |
| 不变量测试 | 内置 | **没有** |
| 安全工具 | Slither/Mythril/Echidna | **几乎没有** |
| 详细堆栈跟踪 | `forge test -vvvv` | 只有 msg!() 日志 |

Solana 官方承认："Solana does not currently have an equivalent to Foundry"

但 Solana 2024 年吸引新开发者数量超过以太坊（7,625 人，+83% YoY），原因是速度、手续费、用户量，不是工具。

### 对我们的启示

整条 Web3 开发工具链都落后于传统开发。专注 EVM 生态（最大市场），未来架构可复用到 Solana。

---

## 十、最终架构总结

```
┌─────────────────────────────────────┐
│        Neovim 插件（~500 行 Lua）     │
│   UI: 浮动面板 / diagnostic / vt     │
│   调 sd --json → 解析 → 渲染         │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│        sd CLI（Rust）                │
│   ABI 解析 / 部署缓存 / 合约交互     │
│   类型解码 / Gas 解析 / 测试解析     │
│   静态分析 / 账户管理 / REPL        │
│   增量部署 / 依赖分析               │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│      Foundry（forge / cast / anvil）  │
└─────────────────────────────────────┘
```

### 开发阶段

| Phase | 内容 | 目标 |
|-------|------|------|
| 1 | Rust CLI 核心（编译、部署、交互、状态、链管理） | CLI 可独立使用 |
| 2 | Neovim 插件集成 | 编辑器内完整体验 |
| 3 | Gas 估算 + 测试集成 | 行内 virtual text |
| 4 | 交互增强（REPL、多账户、历史） | 终端版 Remix |
| 5 | 安全与进阶（分析、调试、验证） | 专业级工具 |

### 文件

- 技术方案：`/Users/luwei/web3-learning/docs/solidity-devtools-spec.md`
- 本讨论记录：`/Users/luwei/web3-learning/docs/solidity-devtools-conversation.md`
