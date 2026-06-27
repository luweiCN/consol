# 外置 Library 自动部署与 Linking(第一版 · CLI/核心)

- 日期:2026-06-25
- 状态:设计已逐项确认,待 spec 评审
- 范围:`@consol/core` / `@consol/foundry` / `@consol/cli`(TUI 可视化拆到紧接的第二个 spec)

## 1. 背景与问题

ConSol 是 Foundry 的交互层,部署走 `forge create`(`packages/foundry/src/commands.ts:147` `runForgeCreate`)。当前对 Solidity 两类 library 的支持是割裂的:

- **Internal library**(函数全 `internal`/`private`):编译器内联进调用合约字节码,产物 bytecode 完整、`linkReferences` 为空,无需单独部署。→ **已开箱即用**,`forge create` 直接部署。
- **External / public library**(含 `public`/`external` 函数):编译器在 bytecode 留占位符 `__$<34位hash>$__`,并在 artifact 的 `bytecode.linkReferences` 标出占位位置;必须先单独部署 library,再把地址 link 进字节码。→ **当前不支持**:

  1. `packages/core/src/project/artifacts.ts:283-291` `bytecodeObject` 只取 `bytecode.object` 原样返回;`ContractArtifact` 类型(`artifacts.ts:20-28`)无 `linkReferences` 字段。
  2. `ForgeCreateOptions`(`commands.ts:36-43`)无 library 字段,`runForgeCreate`(`commands.ts:147-167`)不拼 `--libraries`。
  3. 全 `packages` 无 `linkReferences` / 占位符 / `libraries` 处理逻辑。
  4. `runCastEstimateCreate`(`commands.ts:282-289`)对 external library 会用带占位符的脏 bytecode 估 gas。

## 2. 目标 / 非目标

### 目标(本 spec)
- `consol deploy` 自动检测 external library,自动按依赖顺序部署/复用 library,`forge create --libraries` link 并部署主合约。
- 支持独立部署单个 library 并输出地址(用户可能在 ConSol 之外 link 主合约)。
- 支持 `--libraries Name:0xAddr` 接收外部已部署地址。
- library 地址按 bytecode hash 缓存复用;源码变更自动重部,杜绝 stale。
- 支持嵌套 library(library 依赖其他 external library),递归部署 + 拓扑顺序。

### 非目标(留后续 spec)
- TUI 文件列表区分 contract / library、TUI 查看已部署 library(第二个 spec)。
- `consol deploy --all` 的完整自动编排(本 spec 仅修正确性,见 §8)。
- external library 的 gas preview(本 spec 标为已知限制,见 §8)。
- internal library 行为变更(保持现状,完全不动)。

## 3. 术语

- **占位符**:Solidity ≥0.5 编译产物中 `__$` + `keccak256(完全限定库名)` 前 34 hex + `$__`(共 40 hex = 20 字节地址位)。
- **linkReferences**:artifact `bytecode.linkReferences`,形如 `{ "src/MyLib.sol": { "MyLib": [{ "start": N, "length": 20 }] } }`,标出每个 library 占位符在字节码中的位置。
- **link**:把已部署 library 的地址填入占位符。本设计交由 `forge create --libraries` 完成,ConSol 不直接改字节码。

## 4. 命令入口(已定:deploy 一个命令全包)

| 命令 | 行为 |
|---|---|
| `consol deploy MyLib` | 识别 target 为 library → 部署 → 打印并缓存地址 |
| `consol deploy MyContract` | 检测 `linkReferences` → 自动连带部署/复用依赖 library → link → 部署主合约;输出附带用到的 library 地址清单 |
| `consol deploy MyContract --libraries Foo:0xAddr [...]` | `Foo` 用外部地址、不自部署;其余依赖仍自动部署 |

target 是 contract 还是 library:复用 ConSol 现有 source 声明识别(source explorer 已能区分 `library`,见 `docs/product/DEV_TUI_NEXT_GOAL.md`)。

`--libraries` 输入格式:`Name:0xAddr`(两段,对用户友好);ConSol 从主合约 `linkReferences` 解析出该 `Name` 对应的 `source`,补全为 forge 要求的三段 `source:Name:address`。同名 library 跨多个 source 冲突时报错,要求改用三段 `source:Name:0xAddr` 显式指定。

## 5. 数据模型与缓存(正确性核心)

复用现有 `.consol/` 缓存层(`deploy-cache.ts` 的 `readDeploymentCache`/`writeDeploymentCache`),library 用独立 key 命名空间:

```
lib:<source>:<Name>:<network>:<libBytecodeHash>
```

- 无 constructor args 段(library 部署无构造参数)。
- 命中条件:key 命中 **且** 链上该地址有 code(沿用 `runCastCode` + `hasCode`,见 `deploy-execute.ts:99-105`)。
- library 部署同样写 `deploy-history`,记录标注 `kind = library`(第二个 spec 的 TUI "查看已部署 library" 据此区分并读取)。

### 级联失效(根治 stale)
`libBytecodeHash` 入 key:library 源码改 → bytecode 变 → hash 变 → 缓存 miss → 自动重部。同时主合约 bytecode 也随占位符内容变化 → 主合约缓存(本就含 `bytecodeHash`,见 `deploy-execute.ts:82,89`)也 miss → 用新 library 地址重新 link。两层 hash 缓存自然级联,stale 不可能发生。

## 6. 组件改动(按现有 package 边界)

- **`@consol/core` 新增 `link-references.ts`**
  - `parseLinkReferences(artifact)`:解析 `bytecode.linkReferences` → `readonly { source: string; name: string }[]`。
  - `ContractArtifact`(`artifacts.ts:20-28`)补 `linkReferences` 字段;`readContractArtifact` 填充。
- **`@consol/core` library 缓存键/读写**:在 deploy-cache 命名空间内新增 library key 构造与查询。
- **`@consol/foundry` `commands.ts`**:`ForgeCreateOptions` 增加 `libraries?: readonly { source: string; name: string; address: string }[]`;`runForgeCreate` 拼 `--libraries <source>:<name>:<address>`(每项一个 flag)。
- **`@consol/cli` 新增 `deploy-libraries.ts`**:library 解析 + 编排(部署/复用/递归),保持 `deploy-execute.ts` 聚焦。
- **`@consol/cli` `deploy-execute.ts`**:在"读 artifact"(`:81`)与"forge create 主合约"(`:136`)之间插入编排步骤,把收齐的地址传入 `runForgeCreate` 的 `libraries`。

## 7. 编排流程(`deploy-libraries.ts`)

```
resolveLibraries(target artifact, userProvided, network):
  linkRefs = parseLinkReferences(artifact)
  若 linkRefs 为空 → 返回 {}(主合约走现有流程,无变化)
  for each { source, name } in linkRefs:
    若 userProvided 有 name 的地址 → addrs[name] = 该地址; continue
    libArtifact = readContractArtifact(resolve(source, name))
    deps = resolveLibraries(libArtifact, userProvided, network)   # 递归:先满足嵌套依赖
    libHash = libArtifact.bytecodeHash
    cached = 查 library 缓存(source, name, network, libHash)
    若 cached 命中且链上有 code → addr = cached
    否则 → addr = runForgeCreate(libArtifact, libraries=deps); 写 library 缓存 + history
    addrs[name] = addr
  返回 addrs

# 主合约部署:
addrs = resolveLibraries(主合约 artifact, userProvided, network)
runForgeCreate(主合约, libraries=addrs)   # 现有缓存/历史逻辑接在其后
```

递归保证嵌套 library 先于依赖者部署(拓扑顺序);循环依赖在递归路径上检测并报错。

独立部署(`consol deploy MyLib`)时 library 即 target,走同一 `resolveLibraries` + 部署流程,统一处理它自身的嵌套依赖。

## 8. 边界决策

- **嵌套 library**:**支持递归 + 拓扑排序**(见 §7)。
- **`consol deploy --all`**:本版仅**修正确性**——`deploy-plan.ts:127` `isDeployableBytecode` 识别占位符,不再把含占位符的合约误判为可直接部署;完整 --all 自动编排留后续。
- **gas preview**:`runCastEstimateCreate`(`commands.ts:282-289`)对 external library **标为已知限制**,本 spec 不修。

## 9. 错误处理

- library artifact 缺失 → 提示 `consol build`。
- `--libraries` 传入地址链上无 code → 明确报错。
- 嵌套依赖出现循环 → 检测并报错(含依赖链)。
- `forge create` 部署 library 失败 → 透传 forge stderr(沿用 `forge_create_failed` 模式,`deploy-execute.ts:147-153`)。

## 10. 测试策略

- **单测**:`parseLinkReferences`(空 / 单 / 多 / 嵌套 fixture);library 缓存 key 的 hash 绑定(hash 变 → miss)。
- **集成**:扩展 `packages/testkit/src/fake-foundry.ts`,模拟带 library 的部署链;断言 `forge create` 收到正确的 `--libraries`;断言 library 改动触发重部、未改动复用缓存。
- **fixture**:`examples/` 增加一个含 external library 的合约。

## 11. 后续(第二个 spec:TUI 可视化)

- `consol dev` 文件选择(按 `F`)列出 contract 与 library 并**视觉区分**。
- TUI 查看已部署 contract 与已部署 library(读取本 spec 写入的 library 缓存 / history)。
