# Library 功能补完 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补完外置 library 的 4 项遗留:gas preview 检测提示、`deploy --all` 支持 link library 的合约、library 部署写 history、library 在 TUI 成为可部署目标。

**Architecture:** 纯增量,复用已有能力。gas preview 加 `parseLinkReferences` 检测;`deploy --all` 撤销第一个 spec 的 non-deployable 分支(executeDeployment 已能 link);history/部署语义沿用现有结构加 `kind`。

**Tech Stack:** TypeScript, Bun, `bun:test`, SolidJS + OpenTUI。

**约定:** commit 用 conventional commits + `Co-Authored-By` trailer。验证用 `bun run check`(完整,含 `check:size`——吸取第一个 spec 漏跑教训)+ `bun test`。分支 `feat/library-gaps-completion`(base main)。

---

## File Structure

| 文件 | 改动 | 项 |
|---|---|---|
| `cli/src/commands/dev-deploy-gas-preview.ts` | 检测 linkReferences → 提示 | #1 |
| `core/src/project/deploy-plan.ts` + `.test.ts` | 撤销 linksLibraries non-deployable | #2 |
| `cli/src/commands/transaction-history.ts` | `RecordDeployInput`/record 加 `kind` | #3 |
| `cli/src/commands/deploy-history.ts` | `recordDeployHistory` 加 `kind` | #3 |
| `cli/src/commands/deploy-execute.ts` | `deployLibrary` 写 history | #3 |
| `core/src/project/solidity-declarations.ts` + `.test.ts` | library `deployable=true` | #4 |
| `tui/src/ContractPanel.tsx` | 可部署 tabs 加 kind 标签 | #4 |
| `tui/src/DevShell.test.tsx` | library 在 tabs 断言 | #4 |

---

## Task 1: #1 gas preview 检测 external library

**Files:**
- Modify: `packages/cli/src/commands/dev-deploy-gas-preview.ts`(import + `:34-51`)

- [ ] **Step 1: 写失败测试**

`packages/cli/src/commands/dev-deploy-gas-preview.test.ts`(新建):

```ts
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeFoundry } from "@consol/testkit";
import { createDeployGasPreview } from "./dev-deploy-gas-preview";

describe("createDeployGasPreview with external libraries", () => {
  test("returns a clear hint instead of estimating with placeholder bytecode", async () => {
    const fake = createFakeFoundry();
    const projectRoot = mkdtempSync(join(tmpdir(), "consol-gas-lib-"));
    const artifactPath = join(projectRoot, "out", "Uses.sol", "Uses.json");
    mkdirSync(join(artifactPath, ".."), { recursive: true });
    writeFileSync(
      artifactPath,
      JSON.stringify({
        abi: [],
        bytecode: { object: "0x73__$abc$__6000", linkReferences: { "src/L.sol": { L: [{ start: 1 }] } } },
        metadata: { settings: { compilationTarget: { "src/Uses.sol": "Uses" } } },
      }),
    );

    const gas = await createDeployGasPreview({
      env: fake.env,
      cwd: projectRoot,
      target: "src/Uses.sol:Uses",
      rpcUrl: "http://127.0.0.1:8545",
      account: { name: "anvil0", address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", signer: "anvil-index" },
      action: "deploy",
      signature: "",
      args: [],
      value: null,
    });

    expect(gas.estimate).toBeUndefined();
    expect(gas.context?.["error"]).toContain("external librar");
    const creates = fake.readCalls().filter((c) => c.tool === "cast" && c.args[0] === "estimate");
    expect(creates).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test packages/cli/src/commands/dev-deploy-gas-preview.test.ts`
Expected: FAIL — 当前会调用 cast estimate(creates 非空)且无 error 提示。

- [ ] **Step 3: 实现检测**

`packages/cli/src/commands/dev-deploy-gas-preview.ts`:import 加 `parseLinkReferences`:

```ts
import { ProjectError, parseLinkReferences, readContractArtifact, resolveArtifactPath, resolveTarget } from "@consol/core";
```

在 `if (artifact.bytecode === null) { ... }` 块(`:34-40`)之后、`runCastEstimateCreate`(`:42`)之前插入:

```ts
    if (parseLinkReferences(artifact.raw).length > 0) {
      return {
        source: "rpc_estimate",
        confidence: "low",
        context: {
          ...baseContext,
          error: "Contract links external libraries; deploy the libraries first to estimate deploy gas.",
        },
      };
    }
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test packages/cli/src/commands/dev-deploy-gas-preview.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/dev-deploy-gas-preview.ts packages/cli/src/commands/dev-deploy-gas-preview.test.ts
git commit -m "feat(cli): detect external libraries in deploy gas preview"
```

---

## Task 2: #2 deploy --all 支持 link library 的合约

**Files:**
- Modify: `packages/core/src/project/deploy-plan.ts`(import `:4`、`:47-52`、`:66-74`)
- Modify: `packages/core/src/project/deploy-plan.test.ts`

- [ ] **Step 1: 改测试为可部署**

`packages/core/src/project/deploy-plan.test.ts` — 把现有 "marks a contract with unresolved linkReferences as non-deployable" 测试整体替换为:

```ts
  test("treats a contract that links external libraries as deployable (executeDeployment links them)", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "consol-plan-lib-"));
    const path = join(projectRoot, "out", "Uses.sol", "Uses.json");
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        abi: [],
        bytecode: { object: "0x73__$abc$__6000", linkReferences: { "src/L.sol": { L: [{ start: 1 }] } } },
        metadata: { settings: { compilationTarget: { "src/Uses.sol": "Uses" } } },
      }),
    );

    const plan = discoverDeployPlan(projectRoot);
    const item = plan.find((entry) => entry.contract === "Uses");
    expect(item?.deployable).toBe(true);
    expect(item?.reason).toBeNull();
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test packages/core/src/project/deploy-plan.test.ts`
Expected: FAIL — 当前标 non-deployable。

- [ ] **Step 3: 撤销 linksLibraries 分支**

`packages/core/src/project/deploy-plan.ts`:

移除 import(`:4`):删掉 `import { parseLinkReferences } from "./link-references";`

`planItemFromArtifact`(`:47-52`)恢复为不算 linksLibraries:

```ts
  const bytecode = bytecodeObject(artifact);
  const constructorInputs = constructorInputCount(artifact);
  const hasBytecode = bytecode !== null && isDeployableBytecode(bytecode);
  const reason = deployBlocker(hasBytecode, constructorInputs);
```

`deployBlocker`(`:66-74`)去掉第三参与分支:

```ts
function deployBlocker(hasBytecode: boolean, constructorInputs: number): string | null {
  if (!hasBytecode) {
    return "artifact has no deployable bytecode";
  }
  if (constructorInputs > 0) {
    return `constructor requires ${constructorInputs} argument(s); deploy --all only handles zero-argument constructors`;
  }
  return null;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test packages/core/src/project/deploy-plan.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/project/deploy-plan.ts packages/core/src/project/deploy-plan.test.ts
git commit -m "feat(core): let deploy --all deploy contracts that link external libraries"
```

---

## Task 3: #3 library 部署写 history

**Files:**
- Modify: `packages/cli/src/commands/transaction-history.ts`(`RecordDeployInput` `:36-48`、`recordDeploy` record)
- Modify: `packages/cli/src/commands/deploy-history.ts`(`recordDeployHistory` `:29-56`)
- Modify: `packages/cli/src/commands/deploy-execute.ts`(`deployLibrary` 尾部)

- [ ] **Step 1: 写失败测试**

`packages/cli/src/commands/transaction-history.test.ts` — 若文件存在则追加,否则新建:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordDeploy } from "./transaction-history";

describe("recordDeploy kind", () => {
  test("records the deployment kind (library)", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "consol-txhist-kind-"));
    recordDeploy({
      projectRoot,
      kind: "library",
      contract: "MathLib",
      target: "src/MathLib.sol:MathLib",
      address: "0x000000000000000000000000000000000000c0Fe",
      txHash: "0xdeploytx",
      receipt: null,
      network: { name: "local", kind: "anvil", chain_id: 31337, rpc_url: "http://localhost:8545", fork_url: null, fork_block_number: null, fingerprint: "local:31337:localhost", write_policy: "local" },
      account: { name: "anvil0", address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", signer: "anvil-index" },
      signerAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      nonce: null,
      gasPrice: null,
    });
    const history = JSON.parse(readFileSync(join(projectRoot, ".consol", "transactions.json"), "utf8")) as { readonly entries: readonly { readonly kind?: string }[] };
    expect(history.entries[0]?.kind).toBe("library");
  });
});
```

> `transactions.json` 顶层是 `{ entries: [...] }`(见 `transaction-history.ts:136` readHistory)。

- [ ] **Step 2: 运行确认失败**

Run: `bun test packages/cli/src/commands/transaction-history.test.ts`
Expected: FAIL — `RecordDeployInput` 无 `kind` / record 不含 kind。

- [ ] **Step 3: 实现 kind 透传**

`packages/cli/src/commands/transaction-history.ts`:

`RecordDeployInput`(`:36`)在 `contract` 前加:

```ts
export type RecordDeployInput = {
  readonly projectRoot: string;
  readonly kind: "contract" | "library";
  readonly contract: string;
```

`recordDeploy` 的 record 对象在 `action: "deploy",` 后加:

```ts
    action: "deploy",
    kind: input.kind,
    contract: input.contract,
```

`packages/cli/src/commands/deploy-history.ts`:`recordDeployHistory` 入参(`:29`)加 `kind`,并透传给 `recordDeploy`:

```ts
export function recordDeployHistory(input: {
  readonly projectRoot: string;
  readonly kind: "contract" | "library";
  readonly contract: string;
```

`recordDeploy({ ... })` 调用(`:44`)加 `kind: input.kind,`(放 `projectRoot` 后)。

- [ ] **Step 4: 主合约调用补 kind**

`packages/cli/src/commands/deploy-execute.ts` — `executeDeployment` 里现有的 `recordDeployHistory({ ... })` 调用(主合约,`:192` 附近)加 `kind: "contract",`(放 `projectRoot` 后)。

- [ ] **Step 5: deployLibrary 写 history**

`packages/cli/src/commands/deploy-execute.ts` — `deployLibrary` 尾部 `return address;` 之前插入(`deployLibrary` 已有 `created.stdout`、`address`):

```ts
  const libTxHash = parseOptionalCreateField(created.stdout, /^Transaction hash:\s*(\S+)$/m);
  if (libTxHash !== null) {
    recordDeployHistory({
      projectRoot: args.resolved.projectRoot,
      kind: "library",
      contract: args.req.name,
      target: `${args.req.source}:${args.req.name}`,
      address,
      txHash: libTxHash,
      receipt: null,
      network: args.network.meta,
      account: args.signer.account,
      signerAddress: args.signer.account.address,
      nonce: null,
      gasPrice: null,
    });
  }
```

(`recordDeployHistory` 已在 `deploy-execute.ts:20` import;`parseOptionalCreateField` 已从 `forge-create-output` import。)

- [ ] **Step 6: 运行确认通过 + 类型**

Run: `bun test packages/cli/src/commands/transaction-history.test.ts && bun run typecheck`
Expected: PASS;typecheck 通过(所有 `recordDeployHistory`/`recordDeploy` 调用都带 kind)。

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/transaction-history.ts packages/cli/src/commands/transaction-history.test.ts packages/cli/src/commands/deploy-history.ts packages/cli/src/commands/deploy-execute.ts
git commit -m "feat(cli): record library deployments in tx history with kind"
```

---

## Task 4: #4 library 进可部署 tabs

**Files:**
- Modify: `packages/core/src/project/solidity-declarations.ts`(`deployBlocker` `:142-156`)
- Modify: `packages/core/src/project/solidity-declarations.test.ts`
- Modify: `packages/tui/src/ContractPanel.tsx`(`ContractTargetTabs` `:224-259`、调用 `:73-77`)
- Modify: `packages/tui/src/DevShell.test.tsx`

- [ ] **Step 1: 写失败测试(solidity-declarations)**

`packages/core/src/project/solidity-declarations.test.ts` — 追加(或改现有 library 断言):

```ts
  test("libraries are deployable (deployable from CLI/TUI after linking support)", () => {
    const declarations = solidityDeclarations("library MathLib { function add() external {} }");
    const lib = declarations.find((d) => d.name === "MathLib");
    expect(lib?.kind).toBe("library");
    expect(lib?.deployable).toBe(true);
    expect(lib?.deployReason).toBeNull();
  });
```

> 若现有测试断言 library `deployable: false`,把那处断言改为 `true`、`deployReason` 改为 `null`。

- [ ] **Step 2: 运行确认失败**

Run: `bun test packages/core/src/project/solidity-declarations.test.ts`
Expected: FAIL — 当前 library deployable=false。

- [ ] **Step 3: 实现 library deployable**

`packages/core/src/project/solidity-declarations.ts` — `deployBlocker`(`:142-156`)删除 library 分支:

```ts
function deployBlocker(kind: SolidityDeclarationKind): string | null {
  if (kind === "interface") {
    return "interface declarations do not have deployable bytecode";
  }

  if (kind === "abstract") {
    return "abstract contracts do not have deployable bytecode";
  }

  return null;
}
```

(`solidityDeclarations` 里 `deployable: kind === "contract"` 需改为 `deployable: deployBlocker(kind) === null` —— 见 `:35`,确保 library 也 deployable。)

具体:`:35-36` 改为:

```ts
      deployable: deployBlocker(kind) === null,
      deployReason: deployBlocker(kind),
```

- [ ] **Step 4: 运行确认通过(core)**

Run: `bun test packages/core/src/project/solidity-declarations.test.ts`
Expected: PASS。

- [ ] **Step 5: ContractTargetTabs 加 kind 标签**

`packages/tui/src/ContractPanel.tsx`:

`ContractTargetTabs` props(`:224-228`)加 `translate`:

```ts
function ContractTargetTabs(props: {
  readonly rows: readonly (readonly IndexedSourceTarget[])[];
  readonly selectedSourceTargetIndex: number;
  readonly translate: Translate;
  readonly onSourceTargetSelect?: (index: number) => void;
}) {
```

tab 渲染(`:237-254`)对 library 加后缀 + 调宽:

```ts
          {row.map((target) => {
            const active = target.index === props.selectedSourceTargetIndex;
            const kindSuffix = target.declarationKind === "library" ? ` ${props.translate(declarationKindMessageKey.library)}` : "";
            const label = `${target.contract}${kindSuffix}`;
            const tabWidth = label.length + 2;
            return (
              <box
                height={1}
                width={tabWidth}
                {...selectedBoxBackground(active)}
                onMouseDown={() => {
                  props.onSourceTargetSelect?.(target.index);
                }}
              >
                <text
                  fg={active ? theme.color.selected : theme.color.muted}
                  content={` ${label} `}
                  wrapMode="none"
                />
              </box>
            );
          })}
```

(`declarationKindMessageKey` 已在 `ContractPanel.tsx` 顶部 import——第二个 spec 加的。`deployable===false` 的 `danger` 色分支移除:primary tabs 现在都可部署。)

`ContractTargetTabs` 调用(`:73-77`)加 `translate`:

```tsx
              <ContractTargetTabs
                rows={targetRows()}
                selectedSourceTargetIndex={props.selectedSourceTargetIndex}
                translate={props.translate}
                {...(props.onSourceTargetSelect === undefined ? {} : { onSourceTargetSelect: props.onSourceTargetSelect })}
              />
```

- [ ] **Step 6: 更新 DevShell 测试**

`packages/tui/src/DevShell.test.tsx` — 找含 library 声明的 source 渲染用例(第二个 spec 加的 library E2E 用例,或文件选择器用例),断言 library 现在出现在可部署 tabs。新增/调整一个 ContractPanel 渲染断言:

```ts
  // library 现在在可部署 tabs 且带 library 标签
  expect(frame).toContain("MathLib");
  expect(frame).toContain("library");
```

若某用例曾断言 library `not.toContain` 在 tabs 区,删除该反向断言。

- [ ] **Step 7: 运行确认通过 + 类型**

Run: `bun test packages/tui/ && bun run typecheck`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/project/solidity-declarations.ts packages/core/src/project/solidity-declarations.test.ts packages/tui/src/ContractPanel.tsx packages/tui/src/DevShell.test.tsx
git commit -m "feat: make libraries deployable targets in TUI with kind label"
```

---

## Task 5: 全量回归

- [ ] **Step 1: 完整 check + 全量 test**

Run: `bun run check && bun test`
Expected: 全部通过(含 `check:size`、`check:boundaries`、`check:i18n` 等)。

- [ ] **Step 2: 手动 E2E(可选,需真实 Foundry)**

```bash
consol dev examples/library-demo/src/MathLib.sol:MathLib
# MathLib 应出现在可部署 tabs,带 library 标签;按 d 可部署
consol deploy --all
# 含 link library 的 Calculator 应被部署(不再 skip)
consol activity
# library 部署应出现在历史
consol gas estimate examples/library-demo/src/Calculator.sol:Calculator
# 应提示"含未链接 library,需先部署 library"
```

- [ ] **Step 3: 无新增 commit(仅验证)**

---

## Self-Review 备注(写计划时已核对)

- **Spec 覆盖:** #1(T1)、#2(T2)、#3(T3)、#4(T4)、回归(T5)一一对应。
- **类型一致:** `kind: "contract" | "library"` 贯穿 `RecordDeployInput`/`recordDeployHistory`/`deployLibrary`/主合约调用(T3 全部补齐,typecheck 兜底);`deployBlocker(kind)` 单参签名(T4);`ContractTargetTabs` 的 `translate` prop(T4 定义 + 调用同步)。
- **连带正确性:** T4 library deployable=true 后,第二个 spec 的「非可部署列表」(filter `deployable===false`)与文件选择器名字色自动调整,无需改码;T3 主合约 `recordDeployHistory` 调用必须同步加 `kind: "contract"`(否则 typecheck 失败)——已列为 T3 Step 4。
- **placeholder:** 无。T3 测试断言 `history.entries[0].kind`(已核实 `transactions.json` 顶层为 `{ entries }`)。
