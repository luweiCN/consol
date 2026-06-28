# Library 功能补完设计(4 项遗留)

- 日期:2026-06-28
- 状态:设计已确认,待 spec 评审
- 范围:`@consol/cli` / `@consol/core` / `@consol/tui`
- 依赖:第一个 spec(外置 library,#74)、第二个 spec(TUI 区分,#75),均已在 main。base 为 main。

## 1. 背景

前两个 spec 完成后遗留 4 项:#1/#2 是第一个 spec 商定的非目标,#3 是实现漏(spec 写了未做),#4 是语义修正(library 现已可部署,但旧 `deployable=false` 标记未更新)。

## 2. 目标 / 非目标

### 目标
- #1:gas preview 对 external library 不再用脏 bytecode 估,改为清晰提示。
- #2:`deploy --all` 能部署 link 外置 library 的合约(不再 skip)。
- #3:library 部署写入 `deploy-history`,使 `consol activity` / tx 历史可见。
- #4:library 在 TUI 成为可部署目标(进可部署 tabs,带 kind 标签),可按 `d` 部署。

### 非目标
- gas preview 不做 bytecode 手动 linking 或自动部署 library 来估(仅检测提示)。
- internal library 行为不变。

## 3. #1 gas preview 检测提示

`packages/cli/src/commands/dev-deploy-gas-preview.ts`:`runCastEstimateCreate`(`:42`)前,用 `parseLinkReferences(artifact.raw)` 检测。非空 → 返回提示结构(不调用 estimate):

- code: `gas_unlinked_libraries`
- message: 含未链接 external library,gas 预估需先部署 library
- 不把含占位符的 `artifact.bytecode` 传给 `runCastEstimateCreate`。

internal library(无 `linkReferences`)走原路径不变。

## 4. #2 deploy --all 支持 link library 的合约

第一个 spec 的 `deploy-plan.ts` `deployBlocker`(`:68-74`)有 `linksLibraries → "contract links external libraries; deploy directly"` 分支,使这类合约 `deployable=false`,被 `deploy-all.ts:112` skip。

**撤销该分支**:`executeDeployment` 现已能自动 `resolveLibraries`(部署/复用 library + `--libraries` link),所以 link library 的合约可由 `--all` 正常部署。`deployBlocker` 去掉 `linksLibraries` 参数与分支,`planItemFromArtifact` 去掉 `linksLibraries` 计算,并移除随之 unused 的 `parseLinkReferences` import(`deploy-plan.ts:4`)。顺序由 `resolveLibraries` 的 hash 缓存复用兜底(library 先后部署都正确),无需拓扑排序。

更新 `deploy-plan.test.ts`(原 "marks ... non-deployable" 测试改为可部署)。

## 5. #3 library 部署写 history

- `packages/cli/src/commands/transaction-history.ts`:deploy 记录(`recordDeploy`)的数据结构加 `kind: "contract" | "library"` 字段(默认 `contract`,向后兼容)。
- `packages/cli/src/commands/deploy-history.ts`:`recordDeployHistory`(`:29`)入参加 `kind`,透传给 `recordDeploy`。
- `packages/cli/src/commands/deploy-execute.ts`:`deployLibrary`(`:280`)部署成功后调用 `recordDeployHistory({ kind: "library", ... })`(目前只写缓存、未写 history)。

效果:`consol activity` / tx 历史出现 library 部署记录。已部署列表(按 c)本就从缓存读、不受影响。

## 6. #4 library 进可部署 tabs

`packages/core/src/project/solidity-declarations.ts`:`deployBlocker`(`:142-156`)对 `library` 返回 `null`(deployable=true),移除 "libraries are not deployed from the TUI" 分支。这是语义修正——第一个 spec 后 library 已可部署。

连带效果(均为 deployable 变化的自然结果):
- **ContractPanel 可部署 tabs**(`ContractTargetTabs`)现在含 library → 给 tab 渲染加 kind 标签,区分 contract / library(复用 `declarationKindMessageKey` + `props.translate`)。
- **第二个 spec 的「非可部署声明」列表**自动只剩 interface/abstract(library 不再 `deployable===false`),无需改代码。
- **文件选择器**(`sourceTargetOptions`)library 名字变主色(`deployable !== false`),仍带 library 标签——无需改代码。
- **部署**:选中 library 为 active target,按 `d` → 现有 deploy action → `executeDeployment`(`isLibraryTarget`)走 library 部署路径。
- 更新 `solidity-declarations.test.ts`(library deployable=true)、`DevShell.test.tsx`(library 现在出现在 tabs,不在非可部署列表)。

## 7. 组件改动表

| 文件 | 改动 | 项 |
|---|---|---|
| `cli/.../dev-deploy-gas-preview.ts` | 检测 linkReferences,提示 | #1 |
| `core/.../deploy-plan.ts` + `.test` | 去掉 linksLibraries non-deployable 分支 | #2 |
| `cli/.../transaction-history.ts` | deploy 记录加 kind | #3 |
| `cli/.../deploy-history.ts` | recordDeployHistory 加 kind | #3 |
| `cli/.../deploy-execute.ts` | deployLibrary 写 history | #3 |
| `core/.../solidity-declarations.ts` + `.test` | library deployable=true | #4 |
| `tui/.../ContractPanel.tsx` | 可部署 tabs 带 kind 标签 | #4 |
| `tui/.../DevShell.test.tsx` | library 在 tabs 的断言 | #4 |

## 8. 测试

- 单测:gas preview 检测提示(含 linkReferences 的 artifact);`deploy-plan` link library 合约 deployable;`deployLibrary` 写 history(kind=library);`solidity-declarations` library deployable=true;ContractPanel tabs 含 library kind 标签。
- E2E:`deploy --all` 部署 link library 的合约(fake-foundry readCalls 验证);TUI 选中 library 按 `d` 部署(DevShell 渲染 + action)。
- 全量回归用 `bun run check`(含 `check:size` 等全部,吸取第一个 spec 漏跑的教训)+ `bun test`。
