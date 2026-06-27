# TUI 区分展示 contract / library 设计

- 日期:2026-06-27
- 状态:设计已逐项确认,待 spec 评审
- 范围:`@consol/tui`(+ `@consol/cli` 一处透传、`@consol/i18n` 词条)
- 依赖:第一个 spec(外置 library,PR #74)写入的 `DeployListItem.kind` 与 `lib:` 缓存。代码分支基于 `feat/external-library-linking`。

## 1. 背景与现状

ConSol 的 dev TUI 在三个面展示声明/合约,但都不区分 contract / library / interface / abstract:

- **文件选择器(按 `f`)**:`sourceFileGroups`(`dev-selector-options.ts:145`)把每组声明当**纯名字字符串**(`contracts: readonly string[]`),`sourceOptions`(`dev-shell-selector-state.ts:87`)只显示文件名 + "N contracts"。
- **已部署列表(按 `c`)**:`deployedContractFromCacheEntry`(`dev-deployments.ts:195`)不透传 `entry.kind`,`DevDeployedContract`(`runtime-types.ts:241`)无 `kind` 字段;`deployedTitleParts`(`dev-selector-options.ts:55`)不标 kind。
- **ContractPanel**:`nonDeployableDeclarations`(`ContractPanel.tsx:81`)把 library/interface/abstract **合并**成一个"不可部署"计数,不细分。

**关键:数据层已就绪。** 声明侧 `DevSourceTarget.declarationKind`(`dev-session.ts:46`)由 `listSourceTargets`(`:191`)用 `solidityDeclarations` 填好;部署侧 `DeployListItem.kind` 由第一个 spec 写入缓存。`declarationKind` 在整个 TUI 渲染层**零引用**。本 spec 本质是把已有的 kind 数据接到渲染层。

## 2. 目标 / 非目标

### 目标
- 三个面(文件选择器、已部署列表、ContractPanel)统一区分展示 contract / library / interface / abstract。
- 文件选择器改为**按声明平铺**(每行一个声明)。
- 视觉:后缀文字标签(名字主色 + kind 弱化色),`deployable=false` 的声明整行再暗一级。
- kind 词走 i18n(en-US / zh-CN)。

### 非目标
- 不改部署逻辑、缓存、数据采集(纯渲染 + 一个字段透传)。
- 不改 internal library 的编译/部署行为(第一个 spec 范畴)。
- 不新增"按 kind 过滤/分组折叠"等交互(YAGNI)。

## 3. 视觉规则(统一)

```
名字(主色 selected)   kind 标签(弱化色 muted)   [上下文如文件路径]
```

- contract:名字主色 + `contract` 标签。
- library:名字主色 + `library` 标签。
- interface / abstract(`deployable=false`):整行用更暗的 part kind(见 §6 颜色),标 `interface` / `abstract`。
- 复用现有 `SelectorOptionPart.kind` 着色机制,不引入新的颜色体系。

## 4. i18n

新增四个 kind 词条(键名 `tui.declarationKind.<kind>`):

| key | en-US | zh-CN |
|---|---|---|
| `tui.declarationKind.contract` | contract | 合约 |
| `tui.declarationKind.library` | library | 库 |
| `tui.declarationKind.interface` | interface | 接口 |
| `tui.declarationKind.abstract` | abstract | 抽象合约 |

通过 `check:i18n` 校验两个 catalog 完整对齐。渲染处用 `translate(\`tui.declarationKind.${kind}\`)`。

## 5. 三个面的设计

### 5.1 文件选择器(按 `f`)— 按声明平铺
- 选项从「一文件一行」改为「一声明一行」:直接遍历 `session.sourceTargets`,每个 `DevSourceTarget` 生成一个 `SelectorOption`。
- option:标题 = 声明名(主色)+ kind 标签(弱化);meta/description = 所在文件路径;`deployable=false` 整行更暗。
- 选中一行直接定位到该声明的 `target`(`sourceFile:contract`),替代原先"选文件 → 进入文件 active target"。
- `searchText` 含声明名 + kind + 文件路径。
- `sourceFileGroups` 与 `sourceTargetIndexForOption` 的唯一消费者都是 `dev-shell-selector-state.ts`(`:88` 生成选项、`:178` 解析选中 index)。按声明平铺后两者都不再需要,随本次重构移除——选中 index 直接来自 option(每 option 即一个声明),无需按文件分组或 fuzzy 反查。

### 5.2 已部署列表(按 `c`)
- `DevDeployedContract` 新增 `readonly kind: "contract" | "library"`(部署产物只有这两类)。
- `deployedContractFromCacheEntry`(`dev-deployments.ts:195`)透传 `kind: entry.kind`。
- `deployedTitleParts`(`dev-selector-options.ts:55`)在合约名后追加 kind 标签 part(弱化色)。

### 5.3 ContractPanel
- 把 `nonDeployableDeclarations` 的合并计数改为**按 kind 细分展示**:在"当前文件声明"区,每个同文件兄弟声明显示名字 + kind 标签,沿用 §3 视觉规则。
- 保留现有 active 声明高亮与可运行 contract 的 tab 行为;interface/abstract/library 仍不可作为部署目标,但**显式标注 kind** 而非笼统"N non-deployable"。

## 6. 组件改动(按文件)

| 文件 | 改动 |
|---|---|
| `packages/tui/src/runtime-types.ts` | `DevDeployedContract` 加 `kind` |
| `packages/cli/src/commands/dev-deployments.ts` | `deployedContractFromCacheEntry` 透传 `entry.kind` |
| `packages/tui/src/dev-selector-options.ts` | `deployedTitleParts` 标 kind;`sourceFileGroups` 视情况移除 |
| `packages/tui/src/dev-shell-selector-state.ts` | `sourceOptions` 改为按声明平铺、带 kind 标签 |
| `packages/tui/src/ContractPanel.tsx` | 兄弟声明按 kind 细分展示 |
| `packages/tui/src/panel-format.ts` 或新 helper | kind 标签 part 构造(主色名字 + 弱化 kind) |
| `packages/i18n/*` | 四个 `tui.declarationKind.*` 词条 |

**颜色:** 现有 `SelectorOptionPart.kind` 取值为 `selected`/`muted`/`address`/`code`/`warning`/`balance`,最暗是 `muted`。规则:contract/library 名字用 `selected` + kind 标签用 `muted`;interface/abstract(`deployable=false`)名字也降为 `muted`,整行 muted 自然比可部署声明暗一级。**不新增 part kind 级别**。

## 7. 测试

- **单测**:`sourceOptions` 按声明平铺且每项带正确 kind 标签;`deployedTitleParts` 含 kind;`deployedContractFromCacheEntry` 透传 kind(cli)。
- **渲染/快照**:`DevPanels.test.tsx` / `DevShell.test.tsx` 覆盖四类 kind 的展示与 `deployable=false` 暗化。
- **i18n**:`check:i18n` 通过(两 catalog 对齐)。
- 现有文件选择器测试(按文件)随结构调整更新断言。

## 8. self-review 已核对

- `sourceFileGroups` / `sourceTargetIndexForOption` 仅被 `dev-shell-selector-state.ts` 消费,按声明平铺后随重构移除(见 §5.1)。
- `SelectorOptionPart.kind` 最暗为 `muted`,interface/abstract 复用 `muted` 名字实现整行暗化,不新增级别(见 §6)。
