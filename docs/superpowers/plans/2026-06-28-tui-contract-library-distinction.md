# TUI 区分展示 contract/library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 dev TUI 的文件选择器(F)、已部署列表(c)、ContractPanel 三个面统一区分展示 contract / library / interface / abstract,用后缀文字标签(名字主色 + kind 弱化色,不可部署声明整行 muted)。

**Architecture:** 纯渲染层改动 + 一个字段透传。kind 数据已就绪(声明侧 `DevSourceTarget.declarationKind`,部署侧第一个 spec 写入的 `DeployListItem.kind`)。kind 词走 i18n catalog(`tui.declarationKind.*`),通过 `createTranslator` 生成的 translate 渲染。文件选择器从「按文件分组」改为「按声明平铺」。

**Tech Stack:** TypeScript, Bun, `bun:test`, SolidJS + OpenTUI, `@consol/i18n`。

**约定:** commit 遵循 conventional commits + `Co-Authored-By` trailer。测试 `bun test <path>`;类型 `bun run typecheck`;i18n `bun run check:i18n`。分支基于 `feat/external-library-linking`(依赖第一个 spec 的 `kind`)。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `packages/i18n/src/locales/en-US.ts` / `zh-CN.ts` | 四个 `tui.declarationKind.*` 词条 | 修改 |
| `packages/tui/src/dev-selector-options.ts` | `declarationKindLabel` + `declarationKindPart` helper;`sourceTargetOptions`(按声明平铺);移除 `sourceFileGroups`/`sourceTargetIndexForOption` | 修改 |
| `packages/tui/src/dev-selector-options.test.ts` | helper + 选项构造单测 | 修改 |
| `packages/tui/src/runtime-types.ts` | `DevDeployedContract` 加 `kind` | 修改 |
| `packages/cli/src/commands/dev-deployments.ts` | `deployedContractFromCacheEntry` 透传 `entry.kind` | 修改 |
| `packages/tui/src/dev-shell-selector-state.ts` | `sourceOptions` 调用 `sourceTargetOptions`;`deployedOptions` 追加 kind part;input 加 `translate`;选中解析简化 | 修改 |
| `packages/tui/src/DevShellController.tsx` | 把 `translator` 传入 selector state | 修改 |
| `packages/tui/src/ContractPanel.tsx` | 非可部署声明按 kind 细分展示 | 修改 |
| `packages/tui/src/DevPanels.test.tsx` | ContractPanel kind 渲染断言 | 修改 |

---

## Task 1: i18n declarationKind 词条

**Files:**
- Modify: `packages/i18n/src/locales/en-US.ts`(`tui.contract.*` 块,`:147` 附近)
- Modify: `packages/i18n/src/locales/zh-CN.ts`(同上,`:148` 附近)

`MessageKey = keyof typeof enUSCatalog`(`catalog.ts:10`),所以加到 en-US 即进入 key 类型;zh-CN 必须对齐(否则 `check:i18n` 失败)。

- [ ] **Step 1: 加 en-US 词条**

`packages/i18n/src/locales/en-US.ts` — 在 `"tui.contract.notDeployable": ...`(`:147`)之前插入:

```ts
  "tui.declarationKind.contract": "contract",
  "tui.declarationKind.library": "library",
  "tui.declarationKind.interface": "interface",
  "tui.declarationKind.abstract": "abstract",
```

- [ ] **Step 2: 加 zh-CN 词条**

`packages/i18n/src/locales/zh-CN.ts` — 在 `"tui.contract.notDeployable": ...` 之前插入:

```ts
  "tui.declarationKind.contract": "合约",
  "tui.declarationKind.library": "库",
  "tui.declarationKind.interface": "接口",
  "tui.declarationKind.abstract": "抽象合约",
```

- [ ] **Step 3: 验证 i18n 对齐**

Run: `bun run check:i18n`
Expected: 通过(两 catalog key 对齐)。

- [ ] **Step 4: Commit**

```bash
git add packages/i18n/src/locales/en-US.ts packages/i18n/src/locales/zh-CN.ts
git commit -m "feat(i18n): add declarationKind labels"
```

---

## Task 2: declarationKind 标签 helper

**Files:**
- Modify: `packages/tui/src/dev-selector-options.ts`(顶部 import + 新增 helper)
- Modify: `packages/tui/src/dev-selector-options.test.ts`

`Translate` 类型已被 `ContractPanel.tsx` 使用(`import type { Translate }`);沿用同一来源。`SolidityDeclarationKind` 从 `@consol/core` 导入。

- [ ] **Step 1: 写失败测试**

`packages/tui/src/dev-selector-options.test.ts` — 顶部 import 增加,并在 `describe("dev selector options", ...)` 内追加:

```ts
import { declarationKindLabel, declarationKindPart } from "./dev-selector-options";
import { createTranslator } from "@consol/i18n";

  test("declarationKindLabel translates each kind", () => {
    const en = createTranslator("en-US");
    const zh = createTranslator("zh-CN");
    expect(declarationKindLabel("library", en)).toBe("library");
    expect(declarationKindLabel("contract", zh)).toBe("合约");
    expect(declarationKindLabel("interface", zh)).toBe("接口");
    expect(declarationKindLabel("abstract", en)).toBe("abstract");
  });

  test("declarationKindPart is a muted part carrying the kind label", () => {
    const part = declarationKindPart("library", createTranslator("en-US"));
    expect(part.text).toContain("library");
    expect(part.kind).toBe("muted");
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test packages/tui/src/dev-selector-options.test.ts`
Expected: FAIL — `declarationKindLabel` / `declarationKindPart` 未导出。

- [ ] **Step 3: 实现 helper**

`packages/tui/src/dev-selector-options.ts` — 顶部 import 增加:

```ts
import type { SolidityDeclarationKind } from "@consol/core";
import type { Translate } from "./DevShellLabels";
import type { MessageKey } from "@consol/i18n";
```

(若 `Translate` 实际来源不同,与 `ContractPanel.tsx:16` 的 `import type { Translate }` 保持一致。)

文件内新增:

```ts
const declarationKindMessageKey = {
  contract: "tui.declarationKind.contract",
  library: "tui.declarationKind.library",
  interface: "tui.declarationKind.interface",
  abstract: "tui.declarationKind.abstract",
} as const satisfies Record<SolidityDeclarationKind, MessageKey>;

export function declarationKindLabel(kind: SolidityDeclarationKind, translate: Translate): string {
  return translate(declarationKindMessageKey[kind]);
}

export function declarationKindPart(kind: SolidityDeclarationKind, translate: Translate): SelectorOptionPart {
  return { text: declarationKindLabel(kind, translate), kind: "muted" };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test packages/tui/src/dev-selector-options.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/dev-selector-options.ts packages/tui/src/dev-selector-options.test.ts
git commit -m "feat(tui): add declarationKind label/part helpers"
```

---

## Task 3: 面 2 — 已部署列表区分 kind

**Files:**
- Modify: `packages/tui/src/runtime-types.ts`(`DevDeployedContract` `:241-262`)
- Modify: `packages/cli/src/commands/dev-deployments.ts`(`deployedContractFromCacheEntry` `:195`)
- Modify: `packages/tui/src/dev-shell-selector-state.ts`(input 加 `translate`;`deployedOptions` `:66`)
- Modify: `packages/tui/src/DevShellController.tsx`(传 `translator` 给 selector state)
- Modify: `packages/cli/src/commands/dev-deployments.ts` 对应测试覆盖在 main 集成层;此处加 cli 透传单测可选

- [ ] **Step 1: 写失败测试(透传)**

`packages/tui/src/dev-selector-options.test.ts` 的 `contract` fixture 加 `kind: "contract"`,并追加:

```ts
  test("deployedTitleParts shows the deployment kind", () => {
    const en = createTranslator("en-US");
    const libContract = { ...contract, kind: "library" } as const satisfies DevDeployedContract;
    const title = deployedTitleParts(libContract, 1_001, "en-US", en).map((part) => part.text).join("");
    expect(title).toContain("library");
  });
```

> `deployedTitleParts` 增加第 4 参数 `translate`,在合约名后追加 `declarationKindPart`。现有调用(`dev-shell-selector-state.ts:71`)与现有三参测试同步更新。

- [ ] **Step 2: 运行确认失败**

Run: `bun test packages/tui/src/dev-selector-options.test.ts`
Expected: FAIL — `DevDeployedContract` 无 `kind` / `deployedTitleParts` 签名不符。

- [ ] **Step 3: 加 `DevDeployedContract.kind`**

`packages/tui/src/runtime-types.ts` — `DevDeployedContract`(`:243` 附近)在 `contract` 后加:

```ts
  readonly contract: string;
  readonly kind: "contract" | "library";
```

- [ ] **Step 4: 透传 + 渲染**

`packages/cli/src/commands/dev-deployments.ts` — `deployedContractFromCacheEntry`(`:196` 返回对象)加:

```ts
    contract: entry.contract,
    kind: entry.kind,
```

`packages/tui/src/dev-selector-options.ts` — `deployedTitleParts`(`:55`)加 `translate` 参数并追加 kind part:

```ts
export function deployedTitleParts(
  contract: DevDeployedContract,
  nowUnix = currentUnix(),
  locale: Locale = "en-US",
  translate?: Translate,
): readonly SelectorOptionPart[] {
  return [
    { text: contract.contract, kind: "selected" },
    ...(translate === undefined ? [] : [{ text: " ", kind: "muted" as const }, declarationKindPart(contract.kind, translate)]),
    { text: `  ${deployedContractAgeLabel(contract.createdAtUnix, nowUnix, locale)}`, kind: "muted" },
  ];
}
```

- [ ] **Step 5: selector state 接入 translate**

`packages/tui/src/dev-shell-selector-state.ts`:
- input 类型加 `readonly translate: Accessor<Translate>;`(与 `locale: Accessor<Locale>` `:34` 并列)。
- `deployedOptions`(`:71`)改为:

```ts
      titleParts: deployedTitleParts(contract, input.nowUnix(), input.locale(), input.translate()),
```

`packages/tui/src/DevShellController.tsx` — 创建 selector state 处,把已有的 `translator`(`createMemo`,`:142`)作为 `translate` 传入(与 `locale` 并列)。

- [ ] **Step 6: 运行确认通过 + 类型**

Run: `bun test packages/tui/src/dev-selector-options.test.ts && bun run typecheck`
Expected: PASS;typecheck 通过(透传字段、签名收口)。

- [ ] **Step 7: Commit**

```bash
git add packages/tui/src/runtime-types.ts packages/cli/src/commands/dev-deployments.ts packages/tui/src/dev-selector-options.ts packages/tui/src/dev-shell-selector-state.ts packages/tui/src/DevShellController.tsx packages/tui/src/dev-selector-options.test.ts
git commit -m "feat(tui): show deployment kind in deployed contract picker"
```

---

## Task 4: 面 1 — 文件选择器按声明平铺

**Files:**
- Modify: `packages/tui/src/dev-selector-options.ts`(新增 `sourceTargetOptions`;移除 `sourceFileGroups`/`sourceTargetIndexForOption`)
- Modify: `packages/tui/src/dev-selector-options.test.ts`
- Modify: `packages/tui/src/dev-shell-selector-state.ts`(`sourceOptions` `:87`;选中解析 `:178`)

- [ ] **Step 1: 写失败测试**

`packages/tui/src/dev-selector-options.test.ts` 追加:

```ts
import { sourceTargetOptions } from "./dev-selector-options";
import type { DevSourceTarget } from "@consol/core";

  test("sourceTargetOptions flattens one option per declaration with kind label", () => {
    const targets: readonly DevSourceTarget[] = [
      { sourceFile: "src/Counter.sol", contract: "Counter", target: "src/Counter.sol:Counter", declarationKind: "contract", deployable: true },
      { sourceFile: "src/MathLib.sol", contract: "MathLib", target: "src/MathLib.sol:MathLib", declarationKind: "library", deployable: false },
    ];
    const options = sourceTargetOptions(targets, 1, createTranslator("en-US"));
    expect(options).toHaveLength(2);
    expect(options[0]?.name).toBe("0");
    expect(options[0]?.titleParts?.map((p) => p.text).join("")).toContain("Counter");
    expect(options[0]?.titleParts?.map((p) => p.text).join("")).toContain("contract");
    expect(options[1]?.titleParts?.map((p) => p.text).join("")).toContain("library");
    expect(options[1]?.active).toBe(true);
    expect(options[1]?.titleParts?.[0]?.kind).toBe("muted"); // deployable=false 名字降 muted
    expect(options[0]?.titleParts?.[0]?.kind).toBe("selected"); // 可部署名字主色
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test packages/tui/src/dev-selector-options.test.ts`
Expected: FAIL — `sourceTargetOptions` 未导出。

- [ ] **Step 3: 实现 `sourceTargetOptions`,移除旧函数**

`packages/tui/src/dev-selector-options.ts` — 删除 `sourceFileGroups`(`:145`)与 `sourceTargetIndexForOption`(`:120`),新增:

```ts
export function sourceTargetOptions(
  sourceTargets: readonly DevSourceTarget[],
  selectedSourceTargetIndex: number,
  translate: Translate,
): readonly SelectorOption[] {
  return sourceTargets.map((target, index) => {
    const kind = target.declarationKind ?? "contract";
    const nameColor = target.deployable === false ? "muted" : "selected";
    return {
      name: String(index),
      label: target.target,
      active: index === selectedSourceTargetIndex,
      titleParts: [
        { text: target.contract, kind: nameColor },
        { text: "  ", kind: "muted" },
        declarationKindPart(kind, translate),
      ],
      meta: target.sourceFile,
      searchText: `${target.contract} ${kind} ${target.sourceFile} ${target.target}`,
    };
  });
}
```

(`DevSourceTarget` 从 `@consol/core` 导入,文件已 `import type { DevSourceTarget }`。)

- [ ] **Step 4: dev-shell-selector-state 改用平铺 + 简化选中**

`packages/tui/src/dev-shell-selector-state.ts`:
- import:移除 `sourceFileGroups`/`sourceTargetIndexForOption`,加 `sourceTargetOptions`。
- `sourceOptions`(`:87`)改为:

```ts
  const sourceOptions = createMemo((): readonly SelectorOption[] => {
    const targets = input.session()?.sourceTargets ?? [];
    const baseOptions = sourceTargetOptions(targets, input.selectedSourceTargetIndex(), input.translate());
    return baseOptions.map((option) => ({
      ...option,
      previewLines: sourcePreviewByTarget().get(option.label) ?? sourcePreviewByTarget().get(option.meta ?? "") ?? [],
    }));
  });
```

- 选中解析(`:178`)简化:

```ts
      const sourceTargets = input.session()?.sourceTargets ?? [];
      const selectedIndex = Number(option.name);
      const sourceTarget = sourceTargets[selectedIndex];
```

(删除 `sourceTargetIndexForOption` 调用。)

- [ ] **Step 5: 运行确认通过 + 类型**

Run: `bun test packages/tui/src/dev-selector-options.test.ts && bun run typecheck`
Expected: PASS;typecheck 通过(无对已删函数的悬挂引用)。

- [ ] **Step 6: Commit**

```bash
git add packages/tui/src/dev-selector-options.ts packages/tui/src/dev-selector-options.test.ts packages/tui/src/dev-shell-selector-state.ts
git commit -m "feat(tui): flatten source picker to one option per declaration with kind"
```

---

## Task 5: 面 3 — ContractPanel 非可部署声明细分

**Files:**
- Modify: `packages/tui/src/ContractPanel.tsx`(`:78-84` 非可部署计数块)

`targets()`(`:32` = `contractTargets`)每项是 `IndexedSourceTarget`(含 `declarationKind`/`deployable`)。当前把 `deployable === false` 的合并为一个计数(`:78-84`)。改为逐条列出名字 + kind 标签。

- [ ] **Step 1: 替换合并计数为逐条声明**

`packages/tui/src/ContractPanel.tsx` — 把 `:78-84` 的块:

```tsx
              {nonDeployableCount() === 0 ? null : (
                <text
                  fg={theme.color.muted}
                  content={props.translate("tui.contract.nonDeployableDeclarations", { count: nonDeployableCount() })}
                  wrapMode="word"
                />
              )}
```

替换为:

```tsx
              <For each={targets().filter((target) => target.deployable === false)}>
                {(target) => (
                  <text
                    fg={theme.color.muted}
                    content={`${target.contract}  ${props.translate(declarationKindMessageKey[target.declarationKind ?? "contract"])}`}
                    wrapMode="word"
                  />
                )}
              </For>
```

- [ ] **Step 2: 导出/导入 kind 消息键映射**

为避免重复,`packages/tui/src/dev-selector-options.ts` 把 `declarationKindMessageKey` 改为 `export const`;`ContractPanel.tsx` 顶部加:

```ts
import { declarationKindMessageKey } from "./dev-selector-options";
```

确保 `For` 已从 solid 导入(文件多处用 `For` 则已存在;否则在现有 solid import 中追加 `For`)。

- [ ] **Step 3: 调整高度计算**

`contractHeaderHeight(...)`(`:65`)的 `nonDeployableCount() > 0` 入参仍有效(有非可部署声明就占行);若高度按行数精确计算,把该入参从布尔改为传 `targets().filter((t) => t.deployable === false).length` 行数。检查 `contractHeaderHeight` 定义并相应更新,使列出 N 行时高度足够。

- [ ] **Step 4: 写/更新组件测试**

`packages/tui/src/DevPanels.test.tsx` — 找到渲染 ContractPanel 且含多声明(含 library)的用例(或新增),断言输出文本包含 `library` 标签且不再是 "N non-deployable declarations" 合并文案。沿用该文件现有 ContractPanel 渲染断言风格(render → 取文本 → `toContain`)。

```ts
  // 在含 library 兄弟声明的 ContractPanel 渲染用例中:
  expect(frame).toContain("library");
  expect(frame).not.toContain("non-deployable declarations");
```

- [ ] **Step 5: 运行确认通过 + 类型**

Run: `bun test packages/tui/src/DevPanels.test.tsx && bun run typecheck`
Expected: PASS。

- [ ] **Step 6: 清理 deadkey + Commit**

若 `tui.contract.nonDeployableDeclarations` 不再被任何文件引用,从 en-US/zh-CN 删除(跑 `grep -rn "nonDeployableDeclarations" packages` 确认零引用),并 `bun run check:i18n`。

```bash
git add packages/tui/src/ContractPanel.tsx packages/tui/src/dev-selector-options.ts packages/tui/src/DevPanels.test.tsx packages/i18n/src/locales/en-US.ts packages/i18n/src/locales/zh-CN.ts
git commit -m "feat(tui): break out library/interface/abstract declarations in ContractPanel"
```

---

## Task 6: 全量回归

- [ ] **Step 1: 全量测试 + 类型 + lint + i18n**

Run: `bun test && bun run typecheck && bun run lint && bun run check:i18n`
Expected: 全部通过。

- [ ] **Step 2: 手动 E2E(可选,需真实 Foundry)**

```bash
consol dev examples/library-demo/src/Calculator.sol:Calculator
# 按 f:文件选择器应列出 Calculator(contract) 与 MathLib(library),各带 kind 标签
# 部署后按 c:已部署列表中 library 标 library
# ContractPanel:同文件的 library 声明显式标 library 而非笼统"non-deployable"
```

- [ ] **Step 3: 无新增 commit(本 task 仅验证)**

---

## Self-Review 备注(写计划时已核对)

- **Spec 覆盖:** 三个面分别由 T4(文件选择器)、T3(已部署)、T5(ContractPanel)实现;视觉规则(主色名字 + muted kind,deployable=false 名字降 muted)在 T3/T4/T5 一致;i18n(T1)+ helper(T2)为共享基座。
- **类型一致:** `declarationKindLabel`/`declarationKindPart`/`declarationKindMessageKey`(T2 定义,T3/T4/T5 复用);`DevDeployedContract.kind`(T3 引入,`deployedTitleParts` T3 消费);`sourceTargetOptions`(T4)替代 `sourceFileGroups`/`sourceTargetIndexForOption`(T4 移除,无悬挂引用——已确认唯一消费者是 dev-shell-selector-state)。
- **已知接线:** selector state 在 T3 引入 `translate`(DevShellController 的 `translator` memo),T4 的 `sourceTargetOptions` 复用之。
- **placeholder 扫描:** T5 Step 3 的 `contractHeaderHeight` 入参调整需读其定义后精确改(已在步骤内说明做法),非占位。
