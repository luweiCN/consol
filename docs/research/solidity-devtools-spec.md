# solidity-devtools 技术方案

## 项目概述

**双层架构**：Rust CLI 工具 + Neovim 插件，为 Solidity 开发者提供 Remix IDE 级别的开发体验。

- **`sd`（CLI 工具）**：Rust 编写，处理所有业务逻辑（ABI 解析、部署缓存、合约交互、状态管理）。所有命令输出 JSON，可独立使用。
- **`solidity-devtools.nvim`（Neovim 插件）**：Lua 编写，调用 `sd` CLI，专注 UI 渲染（浮动面板、diagnostic、virtual text）。

**定位**: 开源社区项目，面向所有 Solidity 开发者。CLI 面向所有人，Neovim 插件面向 Neovim 用户。

**仓库**:
- `github.com/luweiCN/sd` — Rust CLI 工具
- `github.com/luweiCN/solidity-devtools.nvim` — Neovim 插件

## 架构总览

```
┌─────────────────────────────────────┐
│           Neovim 插件（Lua）          │
│  ┌─────────────────────────────┐    │
│  │ UI: 浮动面板 / diagnostic    │    │
│  │ UI: virtual text / 状态栏    │    │
│  │ UI: 参数输入表单             │    │
│  └──────────┬──────────────────┘    │
│             │ vim.fn.jobstart()      │
│             │ 异步调用 sd --json     │
└─────────────┼───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│          sd CLI（Rust）              │
│  ┌─────────────────────────────┐    │
│  │ ABI 解析 / 部署缓存          │    │
│  │ 合约交互 / 状态读取          │    │
│  │ 类型解码 / Gas 解析          │    │
│  │ 测试解析 / 静态分析          │    │
│  │ 账户管理                     │    │
│  └──────────┬──────────────────┘    │
│             │ 调用 forge/cast/anvil  │
└─────────────┼───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│      Foundry 工具链（已有）          │
│      forge / cast / anvil           │
└─────────────────────────────────────┘
```

**核心原则**：CLI 是大脑（逻辑），插件是眼睛和手（UI）。CLI 输出结构化 JSON，插件只管解析和渲染。

## CLI 工具设计（`sd`）

### 技术栈

| 组件 | 选型 | 原因 |
|------|------|------|
| CLI 框架 | `clap` (derive) | Rust 生态标准，自动补全生成 |
| 异步运行时 | `tokio` | forge/cast 调用需要异步 |
| JSON 处理 | `serde` + `serde_json` | 标准，Foundry artifact 是 JSON |
| Ethereum 交互 | 直接调 `cast` 命令 | 不引入 alloy 重依赖，保持轻量 |
| 配置 | `toml` | 和 foundry.toml 风格一致 |
| 日志 | `tracing` | Rust 标准日志 |

### 命令设计

所有命令支持 `--json` 标志输出机器可读的 JSON，不带 `--json` 时输出人类可读的彩色文本。

```bash
# 编译
sd build [--json]                          # forge build，返回编译结果

# ABI
sd abi <contract> [--json]                 # 解析 ABI，返回函数/事件/enum 列表

# 部署
sd deploy <contract> [--json] [--force]    # 部署合约（带缓存）
sd deploy --list [--json]                  # 列出已部署合约

# 合约交互
sd call <contract> <function> [args...] [--json]      # 读函数
sd send <contract> <function> [args...] [--json]      # 写函数
sd send <contract> <function> [args...] --value 1eth  # payable

# 状态
sd state <contract> [--json]               # 读取全部无参数 view 函数
sd state <contract> --watch                # 持续轮询，变化时输出

# Gas
sd gas <contract> [--json]                 # forge build --gas-report，返回每行 gas

# 测试
sd test [--json] [-vvvv]                   # forge test，返回结构化结果

# 链管理
sd chain start [--port 8545]               # 启动 anvil
sd chain stop                              # 停止 anvil
sd chain restart                           # 重启 anvil
sd chain status [--json]                   # 链状态（运行中/停止/网络信息）

# 账户
sd account list [--json]                   # 列出可用账户
sd account use <index_or_name>             # 切换活跃账户
sd account current [--json]                # 当前活跃账户

# 分析
sd analyze [--json] [--severity medium]    # 运行 slither 静态分析

# 验证
sd verify <contract> [--json]              # forge verify-contract

# 事件
sd logs <contract> [--json] [--watch]      # 监听合约事件

# 工具
sd detect [--json]                         # 检测当前项目状态
sd init                                    # 初始化配置文件
```

### JSON 输出格式

每个命令的 JSON 输出遵循统一信封格式：

```json
{
  "ok": true,
  "data": { ... },
  "error": null
}
```

失败时：

```json
{
  "ok": false,
  "data": null,
  "error": {
    "message": "compilation failed",
    "details": [ ... ]
  }
}
```

#### 关键命令的 JSON 结构

**`sd build --json`**:
```json
{
  "ok": true,
  "data": {
    "status": "success",
    "contracts": ["Counter", "Token"],
    "errors": [],
    "warnings": [
      { "file": "src/Counter.sol", "line": 10, "message": "..." }
    ]
  }
}
```

**`sd abi Counter --json`**:
```json
{
  "ok": true,
  "data": {
    "name": "Counter",
    "file": "src/Counter.sol",
    "functions": [
      {
        "name": "setNumber",
        "signature": "setNumber(uint256)",
        "selector": "0x3fb5c1cb",
        "mutability": "nonpayable",
        "inputs": [
          { "name": "newNumber", "type": "uint256" }
        ],
        "outputs": []
      }
    ],
    "enums": [
      { "name": "Status", "values": ["Active", "Paused", "Stopped"] }
    ],
    "public_variables": [
      { "name": "number", "type": "uint256", "getter": "number()" }
    ]
  }
}
```

**`sd deploy Counter --json`**:
```json
{
  "ok": true,
  "data": {
    "contract": "Counter",
    "address": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    "tx_hash": "0x...",
    "deployed": true,
    "from_cache": false,
    "chain_id": 31337
  }
}
```

**`sd call Counter number --json`**:
```json
{
  "ok": true,
  "data": {
    "contract": "Counter",
    "function": "number",
    "raw": "0x0000000000000000000000000000000000000000000000000000000000000005",
    "decoded": {
      "type": "uint256",
      "value": "5"
    }
  }
}
```

**`sd state Counter --json`**:
```json
{
  "ok": true,
  "data": {
    "contract": "Counter",
    "address": "0x5FbDB...",
    "values": [
      { "name": "number", "type": "uint256", "value": "5" },
      { "name": "owner", "type": "address", "value": "0xf39F..." },
      { "name": "locked", "type": "bool", "value": "false" },
      { "name": "status", "type": "enum:Status", "value": "0", "enum_name": "Active" }
    ]
  }
}
```

**`sd test --json`**:
```json
{
  "ok": true,
  "data": {
    "total": 5,
    "passed": 4,
    "failed": 1,
    "results": [
      {
        "name": "testIncrement",
        "file": "test/Counter.t.sol",
        "line": 15,
        "status": "passed",
        "gas": 45230
      },
      {
        "name": "testSetNumber",
        "file": "test/Counter.t.sol",
        "line": 25,
        "status": "failed",
        "error": "assertion failed: expected 5, got 4",
        "gas": 32100
      }
    ]
  }
}
```

**`sd analyze --json`**:
```json
{
  "ok": true,
  "data": {
    "tool": "slither",
    "findings": [
      {
        "severity": "high",
        "check": "reentrancy-eth",
        "file": "src/Token.sol",
        "line": 42,
        "message": "Reentrancy in Token.withdraw()"
      }
    ]
  }
}
```

### 项目结构（Rust）

```
sd/
├── Cargo.toml
├── src/
│   ├── main.rs              -- 入口，clap 命令路由
│   ├── cli.rs               -- clap 命令定义
│   ├── output.rs            -- JSON/彩色文本输出格式化
│   ├── config.rs            -- 配置文件读写（~/.config/sd/config.toml）
│   ├── foundry/
│   │   ├── mod.rs
│   │   ├── detect.rs        -- Foundry 项目检测（foundry.toml 搜索）
│   │   ├── compile.rs       -- forge build 封装
│   │   ├── abi.rs           -- ABI 解析 + enum 提取
│   │   ├── deploy.rs        -- 部署 + 缓存管理
│   │   ├── interact.rs      -- cast call/send 封装
│   │   ├── chain.rs         -- anvil 生命周期管理
│   │   ├── gas.rs           -- gas report 解析
│   │   └── test_runner.rs   -- forge test 输出解析
│   ├── analyze.rs           -- Slither 静态分析
│   ├── account.rs           -- 多账户管理
│   ├── cache.rs             -- 部署缓存（.sd-cache.json）
│   └── standalone.rs        -- 单文件模式（临时 Foundry 项目）
├── tests/                   -- 集成测试
└── completions/             -- shell 补全（bash/zsh/fish）
```

### 缓存策略

**部署缓存** `.sd-cache.json`（项目根目录）：

```json
{
  "version": 1,
  "entries": {
    "Counter:a1b2c3d4": {
      "address": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      "chain_id": 31337,
      "deployed_at": "2025-05-26T07:00:00Z",
      "bytecode_hash": "a1b2c3d4",
      "deploy_tx": "0x..."
    }
  }
}
```

部署流程：
1. 计算 bytecode SHA256 前 8 位 → cache key
2. 查缓存，命中则 `cast code` 验证链上合约是否存在
3. 缓存未命中或链上无代码 → `forge create` 部署
4. 写入缓存

### 配置文件

`~/.config/sd/config.toml`（首次 `sd init` 生成）：

```toml
[rpc]
url = "http://localhost:8545"        # 默认 RPC URL

[account]
# 使用 anvil 第一个账户（默认）
auto = true

# 或指定私钥
# private_key = "0xac0974..."

# 或使用硬件钱包
# hardware = "ledger"

[deploy]
cache = ".sd-cache.json"             # 部署缓存文件名

[analyze]
tool = "slither"                     # slither / solc-warnings
severity = "medium"                  # 最低显示级别

[standalone]
tmp_dir = "/tmp/sd-projects"         # 单文件模式临时目录
```

项目级配置 `.sd.toml`（可选，覆盖全局配置）：

```toml
[rpc]
url = "https://sepolia.infura.io/v3/YOUR_KEY"

[account]
private_key_env = "DEPLOYER_KEY"     # 从环境变量读取
```

## Neovim 插件设计（`solidity-devtools.nvim`）

### 职责

插件**只做 UI**，所有业务逻辑委托给 `sd` CLI：

1. **调 `sd` 命令** — 通过 `vim.fn.jobstart()` 异步调用
2. **解析 JSON** — `vim.json.decode()` 解析 `sd` 输出
3. **渲染 UI** — 浮动面板、diagnostic、virtual text、状态栏

### 模块结构

```
lua/solidity-devtools/
├── init.lua              -- 入口：setup()、注册命令、导出 API
├── config.lua            -- 插件配置
├── client.lua            -- sd CLI 调用封装（异步 + JSON 解析）
├── ui/
│   ├── panel.lua         -- 浮动面板基础组件
│   ├── state_panel.lua   -- 合约状态面板（调 sd state，渲染浮动窗口）
│   ├── interact.lua      -- 合约交互 UI（调 sd abi，渲染函数列表）
│   ├── param_input.lua   -- 参数输入表单
│   ├── history.lua       -- 交易历史面板
│   └── statusline.lua    -- 状态栏组件
├── render/
│   ├── diagnostic.lua    -- vim.diagnostic 渲染（编译错误、分析结果）
│   ├── virtual_text.lua  -- 行内 virtual text（gas、测试结果）
│   └── highlights.lua    -- 高亮组定义
├── health.lua            -- :checkhealth（检测 sd、forge、cast、anvil）
└── utils.lua             -- 工具函数
```

### 插件核心代码示例

```lua
-- client.lua：和 sd CLI 的通信层
local M = {}

function M.call(cmd, args, opts)
  opts = opts or {}
  local cmd_str = "sd " .. cmd .. " --json"
  for _, arg in ipairs(args) do
    cmd_str = cmd_str .. " " .. vim.fn.shellescape(arg)
  end

  if opts.sync then
    local output = vim.fn.system(cmd_str)
    return vim.json.decode(output)
  else
    -- 异步：callback 模式
    vim.fn.jobstart(cmd_str, {
      stdout_buffered = true,
      on_stdout = function(_, data)
        local result = vim.json.decode(table.concat(data))
        if opts.callback then opts.callback(result) end
      end,
    })
  end
end

return M
```

```lua
-- init.lua：API 示例
local client = require("solidity-devtools.client")

local M = {}

function M.build()
  client.call("build", {}, {
    callback = function(result)
      if result.ok then
        vim.notify("Build succeeded", vim.log.levels.INFO)
      else
        -- 渲染 diagnostic
        require("solidity-devtools.render.diagnostic").show_build_errors(result.data)
      end
    end,
  })
end

function M.state()
  local contract = require("solidity-devtools.utils").current_contract()
  client.call("state", { contract }, {
    callback = function(result)
      if result.ok then
        require("solidity-devtools.ui.state_panel").open(result.data)
      end
    end,
  })
end

return M
```

### 用户命令

| 命令 | 对应 sd CLI |
|------|------------|
| `:SolidityDevtoolsBuild` | `sd build --json` |
| `:SolidityDevtoolsDeploy` | `sd deploy <contract> --json` |
| `:SolidityDevtoolsInteract` | `sd abi <contract> --json` → 渲染函数列表 |
| `:SolidityDevtoolsState` | `sd state <contract> --json` → 渲染面板 |
| `:SolidityDevtoolsTest` | `sd test --json` → 渲染 inline 结果 |
| `:SolidityDevtoolsGas` | `sd gas <contract> --json` → 渲染 virtual text |
| `:SolidityDevtoolsChainStart` | `sd chain start` |
| `:SolidityDevtoolsChainStop` | `sd chain stop` |
| `:SolidityDevtoolsChainRestart` | `sd chain restart` |
| `:SolidityDevtoolsAnalyze` | `sd analyze --json` → 渲染 diagnostic |
| `:SolidityDevtoolsSelectAccount` | `sd account list --json` → 选择器 |
| `:SolidityDevtoolsHistory` | `sd history --json` → 渲染面板 |
| `:SolidityDevtoolsVerify` | `sd verify <contract> --json` |

### Lua API

```lua
local sd = require("solidity-devtools")

sd.build()                    -- 编译
sd.deploy()                   -- 部署
sd.interact()                 -- 交互面板
sd.show_state()               -- 状态面板
sd.test(opts)                 -- 测试
sd.toggle_gas()               -- 切换 gas 显示
sd.chain_start()              -- 启动链
sd.chain_stop()               -- 停止链
sd.chain_restart()            -- 重启链
sd.analyze()                  -- 静态分析
sd.select_account()           -- 切换账户
sd.verify()                   -- 验证
sd.show_history()             -- 交易历史
```

### 配置

```lua
require("solidity-devtools").setup({
  -- sd CLI 路径（默认从 PATH 查找）
  sd_bin = "sd",

  -- 自动编译
  auto_compile = true,

  -- 状态面板
  state_panel = {
    auto_refresh = true,
    refresh_interval = 1000,
    position = "float",          -- float / right / bottom
  },

  -- Gas 估算
  gas_estimation = {
    inline = true,
    refresh_on_save = true,
  },

  -- UI
  ui = {
    border = "rounded",
    width = 0.8,
    height = 0.8,
  },
})
```

## 环境兼容性

### 单文件模式

不要求用户必须在 Foundry 项目里。`sd detect` 检测到独立 .sol 文件时：

1. 在 `/tmp/sd-<hash>/` 创建临时 Foundry 项目
2. `forge init` 初始化标准结构
3. 复制 .sol 文件到 `src/`
4. 后续所有操作照常运行
5. `sd build` 可带 `--watch` 标志自动同步文件变更

### 工具链检测

- `sd detect --json` — 返回 forge/cast/anvil/sd 版本信息
- `:checkhealth solidity-devtools` — 在 Neovim 中检测所有依赖
- 缺失 sd 时提示 `cargo install sd` 或 `brew install sd`

### 编译器版本管理

**不需要处理。** Foundry 自动根据 `pragma solidity ^0.x.x;` 下载对应 solc 版本。

## 核心设计原则

1. **零配置启动** — 在 Foundry 项目里运行 `sd`，立即可用
2. **JSON 优先** — 所有命令输出 JSON，人类和机器都能读
3. **关注点分离** — CLI 只管逻辑，插件只管 UI
4. **自动编译** — 保存时自动 `sd build`，错误标在代码里
5. **智能部署** — 字节码哈希 + 链上验证，自动重部署
6. **实时反馈** — 行内 gas、状态面板 watch、交易即时显示

## 功能列表

### P0 — 核心（MVP）

1. **自动编译** — `sd build`，编译错误 JSON 输出含文件/行号
2. **ABI 智能解析** — `sd abi <contract>`，提取函数/enum/struct/public 变量
3. **合约部署** — `sd deploy <contract>`，缓存 + 链上验证 + 字节码版本化
4. **函数调用** — `sd call` / `sd send`，自动编码参数，解码返回值
5. **合约状态** — `sd state <contract>`，批量读取 + watch 模式
6. **本地链管理** — `sd chain start/stop/restart`
7. **网络配置** — 遵循 Foundry 标准（ETH_RPC_URL / ETH_PRIVATE_KEY）

### P1 — 增强

8. **行内 Gas 估算** — `sd gas <contract>`，返回每行 gas 数据
9. **交易历史** — `sd history`，记录所有 send 交易
10. **事件监听** — `sd logs <contract>`，实时事件流
11. **测试集成** — `sd test`，结构化结果含行号映射
12. **参数类型校验** — CLI 侧校验参数格式

### P2 — 进阶

13. **Storage Layout** — `sd storage <contract>`，可视化存储槽
14. **调试器集成** — 与 nvim-dap 联动
15. **合约验证** — `sd verify <contract>`
16. **静态分析** — `sd analyze`，Slither 集成
17. **测试内联结果** — Neovim 侧渲染 ✓/✗ virtual text
18. **合约交互 UI** — Neovim 侧自动生成函数列表面板
19. **多账户管理** — `sd account list/use/current`

## 数据流

```
保存 .sol 文件（Neovim）
    │
    ▼
插件调 sd build --json（异步）
    │
    ├─ 编译失败 → 插件渲染 diagnostic
    │
    └─ 编译成功 → 插件调 sd abi <contract> --json
                       │
                       ▼
                 渲染函数列表到交互面板
                 更新部署缓存
                 刷新状态面板
                 更新 gas virtual text
```

## 依赖

### CLI 工具（sd）

**必需**：
- Rust (edition 2021)
- Foundry（forge, cast, anvil）

**可选**：
- Slither（静态分析）
- solc（直接编译，不通过 forge）

### Neovim 插件

**必需**：
- Neovim >= 0.10（inline virtual text 支持）
- `sd` CLI 已安装

**可选**：
- nvim-treesitter + solidity parser（语法高亮）
- lualine.nvim（状态栏集成）
- nvim-dap（调试器集成）

## 开发计划

### Phase 1: CLI 核心 (v0.1)

目标：`sd` CLI 可独立完成编译、部署、交互全流程

- [ ] Rust 项目骨架（clap 命令定义、JSON 输出框架）
- [ ] `foundry/detect.rs` — Foundry 项目检测
- [ ] `foundry/compile.rs` — forge build 封装
- [ ] `foundry/abi.rs` — ABI 解析 + enum 提取
- [ ] `foundry/deploy.rs` — 部署 + 缓存管理
- [ ] `foundry/interact.rs` — cast call/send 封装
- [ ] `foundry/chain.rs` — anvil 生命周期管理
- [ ] `cache.rs` — 部署缓存读写
- [ ] `standalone.rs` — 单文件模式
- [ ] `account.rs` — 基础账户管理（anvil 默认账户）
- [ ] `config.rs` — 配置文件支持
- [ ] 集成测试（用 Counter.sol 做端到端测试）

### Phase 2: Neovim 集成 (v0.2)

目标：Neovim 插件调 `sd` CLI，实现核心 UI

- [ ] 插件骨架（setup()、lazy.nvim 配置）
- [ ] `client.lua` — sd CLI 异步调用封装
- [ ] `render/diagnostic.lua` — 编译错误渲染
- [ ] 自动编译（BufWritePost *.sol）
- [ ] `ui/state_panel.lua` — 合约状态面板
- [ ] `ui/interact.lua` — 函数列表 + 参数输入
- [ ] 用户命令注册
- [ ] `:checkhealth` 支持

### Phase 3: Gas + 测试 (v0.3)

- [ ] `foundry/gas.rs` — gas report 解析
- [ ] `render/virtual_text.lua` — 行内 gas 显示
- [ ] `foundry/test_runner.rs` — 测试结果解析
- [ ] 测试结果 virtual text（✗/✓）在 .t.sol 中

### Phase 4: 增强 (v0.4)

- [ ] 交易历史面板
- [ ] 事件日志监听
- [ ] 状态栏集成（lualine component）
- [ ] 多账户管理增强（自定义账户 + 硬件钱包）

### Phase 5: 安全与进阶 (v0.5)

- [ ] `analyze.rs` — Slither 静态分析集成
- [ ] Storage layout 可视化
- [ ] 调试器集成（nvim-dap）
- [ ] 合约验证（forge verify-contract）
- [ ] Shell 补全生成（bash/zsh/fish）

## 安装方式（用户视角）

### 安装 CLI

```bash
# 方式 1：cargo
cargo install sd

# 方式 2：brew（后续上架）
brew install sd

# 方式 3：预编译二进制（GitHub Releases）
curl -L https://github.com/luweiCN/sd/releases/latest/download/sd-$(uname -m)-$(uname -s) -o /usr/local/bin/sd
```

### 安装 Neovim 插件

```lua
-- lazy.nvim
{
  "luweiCN/solidity-devtools.nvim",
  dependencies = { "nvim-lua/plenary.nvim" },
  config = function()
    require("solidity-devtools").setup({})
  end,
}
```

## 参考

- [Remix IDE](https://remix.ethereum.org/) — 功能对标
- [Hardhat VS Code Extension](https://github.com/NomicFoundation/hardhat-vscode) — 参考设计
- [Foundry Book](https://book.getfoundry.sh/) — forge/cast/anvil 文档
- [foundry-tui](https://docs.rs/foundry-tui) — TUI 参考项目
- [clap](https://docs.rs/clap) — Rust CLI 框架
- [ripgrep + telescope.nvim](https://github.com/nvim-telescope/telescope.nvim) — CLI + 编辑器集成模式
