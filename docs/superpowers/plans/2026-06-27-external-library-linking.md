# External Library Auto-Deploy & Linking 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `consol deploy` 自动检测、部署、按 hash 缓存并 link external(public/external) Solidity library,使依赖 library 的合约能一键部署,并支持独立部署 library 拿地址、用 `--libraries Name:0xAddr` 注入外部地址。

**Architecture:** 在现有 `forge create` + `.consol/deployments.json` 缓存模型上扩展。`@consol/core` 新增 `linkReferences` 解析;`@consol/foundry` 的 `runForgeCreate` 支持 `--libraries`;`@consol/cli` 新增 `deploy-libraries.ts` 递归编排(部署/复用依赖 library),接入 `deploy-execute.ts`。library 缓存键含 `bytecodeHash`,源码变更自动重部,杜绝 stale。

**Tech Stack:** TypeScript, Bun, `bun:test`, Foundry(forge/cast)。

**约定:** 所有 commit 遵循项目规范(conventional commits),并按全局规则在 message 末尾追加 `Co-Authored-By` trailer。测试运行器为 `bun test`;可对单文件运行 `bun test <path>`。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `packages/core/src/project/link-references.ts` | 解析 artifact 的 `bytecode.linkReferences` → `LibraryRequirement[]` | 新建 |
| `packages/core/src/project/link-references.test.ts` | 上者单测 | 新建 |
| `packages/core/src/project/artifacts.ts` | `ContractArtifact` 补 `linkReferences` 字段并填充 | 修改 |
| `packages/core/src/project/index.ts` | 导出 link-references | 修改 |
| `packages/core/src/project/deploy-plan.ts` | `deploy --all` 计划识别占位符(边界修正) | 修改 |
| `packages/foundry/src/commands.ts` | `runForgeCreate` 支持 `--libraries` | 修改 |
| `packages/foundry/src/commands.test.ts` | `librariesFlags` 单测 | 修改 |
| `packages/cli/src/commands/deploy-cache.ts` | library 缓存键 + entry `kind` | 修改 |
| `packages/cli/src/commands/deploy-options.ts` | 解析 `--libraries` 用户输入 | 修改 |
| `packages/cli/src/commands/deploy-libraries.ts` | 编排:library target 判定 + 递归 `resolveLibraries` | 新建 |
| `packages/cli/src/commands/deploy-libraries.test.ts` | 编排单测(依赖注入) | 新建 |
| `packages/cli/src/commands/deploy-execute.ts` | 接入编排,主合约 `forge create` 传 `--libraries` | 修改 |
| `packages/testkit/src/fake-foundry.ts` | fake build 为 library 生成 artifact、为引用方生成 linkReferences | 修改 |
| `packages/cli/src/main.test.ts` | 端到端:依赖 library 的合约部署 | 修改 |
| `examples/` | external library fixture | 新建 |

---

## Task 1: 解析 linkReferences 并填充 ContractArtifact(core)

**Files:**
- Create: `packages/core/src/project/link-references.ts`
- Create: `packages/core/src/project/link-references.test.ts`
- Modify: `packages/core/src/project/artifacts.ts`(类型 `:20-28`、`readContractArtifact` `:64-86`)
- Modify: `packages/core/src/project/index.ts:1-10`

- [ ] **Step 1: 写失败测试**

`packages/core/src/project/link-references.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { parseLinkReferences } from "./link-references";

describe("parseLinkReferences", () => {
  test("returns empty when there are no linkReferences (internal library / plain contract)", () => {
    expect(parseLinkReferences({ bytecode: { object: "0x6000" } })).toEqual([]);
    expect(parseLinkReferences({ bytecode: { object: "0x6000", linkReferences: {} } })).toEqual([]);
    expect(parseLinkReferences({})).toEqual([]);
  });

  test("extracts source and name for a single external library", () => {
    expect(
      parseLinkReferences({
        bytecode: { linkReferences: { "src/MathLib.sol": { MathLib: [{ start: 10, length: 20 }] } } },
      }),
    ).toEqual([{ source: "src/MathLib.sol", name: "MathLib" }]);
  });

  test("dedupes repeated placeholders and lists every required library", () => {
    expect(
      parseLinkReferences({
        bytecode: {
          linkReferences: {
            "src/MathLib.sol": { MathLib: [{ start: 1 }, { start: 99 }] },
            "src/StrLib.sol": { StrLib: [{ start: 50 }] },
          },
        },
      }),
    ).toEqual([
      { source: "src/MathLib.sol", name: "MathLib" },
      { source: "src/StrLib.sol", name: "StrLib" },
    ]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test packages/core/src/project/link-references.test.ts`
Expected: FAIL — `Cannot find module './link-references'`.

- [ ] **Step 3: 实现 `link-references.ts`**

`packages/core/src/project/link-references.ts`:

```ts
export type LibraryRequirement = {
  readonly source: string;
  readonly name: string;
};

export function parseLinkReferences(raw: unknown): readonly LibraryRequirement[] {
  const linkReferences = getRecord(getRecord(raw, "bytecode"), "linkReferences");
  if (linkReferences === undefined) {
    return [];
  }

  const requirements = new Map<string, LibraryRequirement>();
  for (const [source, names] of Object.entries(linkReferences)) {
    if (!isRecord(names)) {
      continue;
    }
    for (const name of Object.keys(names)) {
      requirements.set(`${source}:${name}`, { source, name });
    }
  }
  return [...requirements.values()];
}

function getRecord(raw: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const value = raw[key];
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test packages/core/src/project/link-references.test.ts`
Expected: PASS(3 tests)。

- [ ] **Step 5: 给 `ContractArtifact` 补 `linkReferences` 字段**

`packages/core/src/project/artifacts.ts` — 顶部 import 旁加:

```ts
import { parseLinkReferences, type LibraryRequirement } from "./link-references";
```

类型(`:20-28`)在 `bytecode` 字段后加一行:

```ts
  readonly bytecode: string | null;
  readonly linkReferences: readonly LibraryRequirement[];
  readonly bytecodeHash: string | null;
```

`readContractArtifact`(`:77-85` 的返回对象)加一行:

```ts
  return {
    path,
    abi,
    abiSummary: summarizeAbi(abi),
    bytecode: bytecode ?? null,
    linkReferences: parseLinkReferences(raw),
    bytecodeHash: bytecode === undefined ? null : stableHash(bytecode),
    compilerGasEstimates: getRecordProperty(raw, "gasEstimates") ?? null,
    raw,
  };
```

- [ ] **Step 6: 在 `artifacts.test.ts` 加断言**

`packages/core/src/project/artifacts.test.ts` 的 `"reads abi summary..."` 测试(`:178`)的 `toMatchObject` 里加一行:

```ts
    expect(readContractArtifact(artifactPath)).toMatchObject({
      path: artifactPath,
      bytecode: "0x6000",
      linkReferences: [],
      bytecodeHash: "2a63e0e2aae52643",
```

- [ ] **Step 7: 导出 + 全量验证**

`packages/core/src/project/index.ts` 在 `export * from "./detect";` 后加:

```ts
export * from "./link-references";
```

Run: `bun test packages/core/src/project/`
Expected: PASS(含 artifacts + link-references)。

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/project/link-references.ts packages/core/src/project/link-references.test.ts packages/core/src/project/artifacts.ts packages/core/src/project/artifacts.test.ts packages/core/src/project/index.ts
git commit -m "feat(core): parse linkReferences into ContractArtifact"
```

---

## Task 2: runForgeCreate 支持 --libraries(foundry)

**Files:**
- Modify: `packages/foundry/src/commands.ts`(`ForgeCreateOptions` `:36-43`、`runForgeCreate` `:147-167`、helpers `:369-379`)
- Modify: `packages/foundry/src/commands.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/foundry/src/commands.test.ts` 顶部确保 `import { librariesFlags } from "./commands";`(若已有 import 块则追加 `librariesFlags`),并在文件末尾追加:

```ts
import { describe, expect, test } from "bun:test";
import { librariesFlags } from "./commands";

describe("librariesFlags", () => {
  test("returns no flags for empty libraries", () => {
    expect(librariesFlags(undefined)).toEqual([]);
    expect(librariesFlags([])).toEqual([]);
  });

  test("emits one --libraries flag per library as source:name:address", () => {
    expect(
      librariesFlags([
        { source: "src/MathLib.sol", name: "MathLib", address: "0xabc" },
        { source: "src/StrLib.sol", name: "StrLib", address: "0xdef" },
      ]),
    ).toEqual([
      "--libraries",
      "src/MathLib.sol:MathLib:0xabc",
      "--libraries",
      "src/StrLib.sol:StrLib:0xdef",
    ]);
  });
});
```

> 注:若 `commands.test.ts` 顶部已有 `import { describe, expect, test } from "bun:test";`,不要重复 import,仅追加 `describe("librariesFlags", ...)` 块并把 `librariesFlags` 加入现有的 `./commands` import。

- [ ] **Step 2: 运行确认失败**

Run: `bun test packages/foundry/src/commands.test.ts`
Expected: FAIL — `librariesFlags` 未导出。

- [ ] **Step 3: 实现 `ForgeLibrary` 类型 + `librariesFlags` + 接入 `runForgeCreate`**

`packages/foundry/src/commands.ts`:

`ForgeCreateOptions`(`:36-43`)加 `libraries` 字段,并在其上方新增 `ForgeLibrary` 类型:

```ts
export type ForgeLibrary = {
  readonly source: string;
  readonly name: string;
  readonly address: string;
};

export type ForgeCreateOptions = FoundryCommandOptions & {
  readonly contractId: string;
  readonly rpcUrl: string;
  readonly wallet: FoundryWallet;
  readonly constructorArgs: readonly string[];
  readonly value?: string;
  readonly gasLimit?: string;
  readonly libraries?: readonly ForgeLibrary[];
};
```

`runForgeCreate`(`:147-167`)在 `constructorArgsFlag` 一行后加 `librariesFlags`:

```ts
      ...gasLimitFlag(options.gasLimit),
      ...constructorArgsFlag(options.constructorArgs),
      ...librariesFlags(options.libraries),
    ],
    withWalletEnv(options),
  );
```

在 helpers 区(`:369` 附近 `constructorArgsFlag` 旁)新增**导出**函数:

```ts
export function librariesFlags(libraries: readonly ForgeLibrary[] | undefined): readonly string[] {
  return (libraries ?? []).flatMap((library) => [
    "--libraries",
    `${library.source}:${library.name}:${library.address}`,
  ]);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test packages/foundry/src/commands.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/foundry/src/commands.ts packages/foundry/src/commands.test.ts
git commit -m "feat(foundry): support --libraries in runForgeCreate"
```

---

## Task 3: library 缓存键 + entry kind(cli)

**Files:**
- Modify: `packages/cli/src/commands/deploy-cache.ts`(`DeployListItem` `:7-19`、`deploymentEntry` `:108-144`、新增 key 函数)
- Create: `packages/cli/src/commands/deploy-cache.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/cli/src/commands/deploy-cache.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { deploymentEntry, libraryDeploymentCacheKey } from "./deploy-cache";

describe("libraryDeploymentCacheKey", () => {
  test("binds source, name, network and bytecode hash with a lib: namespace", () => {
    expect(
      libraryDeploymentCacheKey({
        source: "src/MathLib.sol",
        name: "MathLib",
        networkName: "anvil",
        bytecodeHash: "deadbeef",
      }),
    ).toBe("lib:src/MathLib.sol:MathLib:anvil:deadbeef");
  });
});

describe("deploymentEntry kind", () => {
  const base = {
    contract: "MathLib",
    address: "0xabc",
    network: "anvil",
    deployed_at_unix: 1,
    bytecode_hash: "deadbeef",
    constructor_args_hash: "0",
  };

  test("defaults to contract when kind is absent", () => {
    expect(deploymentEntry(base)?.kind).toBe("contract");
  });

  test("reads library kind when present", () => {
    expect(deploymentEntry({ ...base, kind: "library" })?.kind).toBe("library");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test packages/cli/src/commands/deploy-cache.test.ts`
Expected: FAIL — `libraryDeploymentCacheKey` 未导出 / `kind` 不存在。

- [ ] **Step 3: 实现**

`packages/cli/src/commands/deploy-cache.ts`:

`DeployListItem`(`:7-19`)加 `kind` 字段:

```ts
export type DeployListItem = {
  readonly kind: "contract" | "library";
  readonly contract: string;
  readonly address: string;
  // ...(其余字段不变)
```

`deploymentEntry`(`:131-143` 返回对象)加 `kind`:

```ts
  return {
    kind: record.kind === "library" ? "library" : "contract",
    contract,
    address,
    // ...(其余字段不变)
```

在 `deploymentCacheKey`(`:150`)旁新增导出函数:

```ts
export function libraryDeploymentCacheKey(input: {
  readonly source: string;
  readonly name: string;
  readonly networkName: string;
  readonly bytecodeHash: string;
}): string {
  return `lib:${input.source}:${input.name}:${input.networkName}:${input.bytecodeHash}`;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test packages/cli/src/commands/deploy-cache.test.ts`
Expected: PASS。

> 注:`DeployListItem` 加了必填 `kind`,会让 `deploy-execute.ts` 构造的 entry 缺字段。Task 6 会补 `kind: "contract"`;在那之前 `bun test` 的类型检查可能对 `deploy-execute.ts` 报错——本 task 只需 `deploy-cache.test.ts` 通过即可,跨文件类型在 Task 6 收口。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/deploy-cache.ts packages/cli/src/commands/deploy-cache.test.ts
git commit -m "feat(cli): add library deployment cache key and entry kind"
```

---

## Task 4: 解析 --libraries 输入 + library target 判定(cli)

**Files:**
- Modify: `packages/cli/src/commands/deploy-options.ts`(`DeployOptions` `:3-10`、`parseDeployOptions` `:12-95`)
- Create: `packages/cli/src/commands/deploy-libraries.ts`
- Create: `packages/cli/src/commands/deploy-libraries.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/cli/src/commands/deploy-libraries.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { parseLibraryOverrides } from "./deploy-libraries";

describe("parseLibraryOverrides", () => {
  test("parses Name:0xAddr pairs into a name->address map", () => {
    const map = parseLibraryOverrides(["MathLib:0xabc", "StrLib:0xdef"]);
    expect(map.get("MathLib")).toBe("0xabc");
    expect(map.get("StrLib")).toBe("0xdef");
  });

  test("supports three-part source:Name:0xAddr by keying on Name", () => {
    const map = parseLibraryOverrides(["src/MathLib.sol:MathLib:0xabc"]);
    expect(map.get("MathLib")).toBe("0xabc");
  });

  test("throws on malformed input", () => {
    expect(() => parseLibraryOverrides(["MathLib"])).toThrow();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test packages/cli/src/commands/deploy-libraries.test.ts`
Expected: FAIL — `Cannot find module './deploy-libraries'`.

- [ ] **Step 3: 实现 `parseLibraryOverrides` + `isLibraryTarget`**

`packages/cli/src/commands/deploy-libraries.ts`(本 task 仅这两个导出,编排在 Task 5 追加):

```ts
import { readFileSync } from "node:fs";
import { ProjectError, solidityDeclarations } from "@consol/core";
import type { ResolvedTarget } from "@consol/core";

export function parseLibraryOverrides(values: readonly string[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const value of values) {
    const parts = value.split(":");
    const address = parts.at(-1);
    const name = parts.at(-2);
    if (parts.length < 2 || name === undefined || address === undefined || !address.startsWith("0x")) {
      throw new ProjectError({
        code: "library_override_invalid",
        message: `Invalid --libraries entry: ${value}`,
        hint: "Use Name:0xAddress, or source:Name:0xAddress to disambiguate.",
      });
    }
    map.set(name, address);
  }
  return map;
}

export function isLibraryTarget(resolved: ResolvedTarget): boolean {
  if (resolved.sourceFile === undefined) {
    return false;
  }
  const source = safeReadSource(resolved.sourceFile);
  if (source === null) {
    return false;
  }
  return solidityDeclarations(source).some(
    (declaration) => declaration.name === resolved.contractName && declaration.kind === "library",
  );
}

function safeReadSource(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test packages/cli/src/commands/deploy-libraries.test.ts`
Expected: PASS(parseLibraryOverrides 3 tests)。

- [ ] **Step 5: 在 `deploy-options.ts` 解析 `--libraries`**

`DeployOptions`(`:3-10`)加字段:

```ts
  readonly skipBuild?: boolean;
  readonly libraries: readonly string[];
```

`parseDeployOptions`:在循环上方声明 `const libraries: string[] = [];`;在 `--gas-limit` 分支后、`--confirm-network` 分支前加:

```ts
    if (arg === "--libraries") {
      const entry = commandArgs[index + 1];
      if (entry === undefined) {
        throw new ProjectError({
          code: "missing_flag_value",
          message: "Missing value for --libraries.",
          hint: "Pass Name:0xAddress after --libraries.",
        });
      }
      libraries.push(entry);
      index += 1;
      continue;
    }
```

返回对象(`:88-94`)加 `libraries`:

```ts
  return {
    target,
    constructorArgs,
    fresh,
    libraries,
    ...(value === undefined ? {} : { value }),
    ...(gasLimit === undefined ? {} : { gasLimit }),
  };
```

- [ ] **Step 6: 运行确认通过**

Run: `bun test packages/cli/src/commands/`
Expected: PASS(deploy-libraries + deploy-cache,deploy-options 无独立测试但编译通过)。

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/deploy-libraries.ts packages/cli/src/commands/deploy-libraries.test.ts packages/cli/src/commands/deploy-options.ts
git commit -m "feat(cli): parse --libraries overrides and detect library targets"
```

---

## Task 5: library 编排 resolveLibraries(递归 + 依赖注入)(cli)

**Files:**
- Modify: `packages/cli/src/commands/deploy-libraries.ts`(追加 `resolveLibraries` + 类型)
- Modify: `packages/cli/src/commands/deploy-libraries.test.ts`(追加编排测试)

- [ ] **Step 1: 写失败测试**

`packages/cli/src/commands/deploy-libraries.test.ts` 追加:

```ts
import type { ContractArtifact } from "@consol/core";
import { resolveLibraries, type LibraryResolver } from "./deploy-libraries";

function artifact(linkReferences: readonly { source: string; name: string }[]): ContractArtifact {
  return {
    path: "out/x.json",
    abi: [],
    abiSummary: { functions: 0, events: 0, errors: 0, constructor: false },
    bytecode: "0x60",
    linkReferences,
    bytecodeHash: "h",
    compilerGasEstimates: null,
    raw: {},
  };
}

function recordingResolver(overrides?: Partial<LibraryResolver>): LibraryResolver & { deployed: string[] } {
  const deployed: string[] = [];
  return {
    deployed,
    loadArtifact: (req) => artifact([]),
    resolveCached: async () => null,
    deploy: async (req) => {
      deployed.push(req.name);
      return `0x${req.name}`;
    },
    ...overrides,
  };
}

describe("resolveLibraries", () => {
  test("returns empty when the artifact needs no libraries", async () => {
    const resolver = recordingResolver();
    expect(await resolveLibraries(artifact([]), new Map(), resolver)).toEqual([]);
    expect(resolver.deployed).toEqual([]);
  });

  test("deploys a required library and links it by source:name:address", async () => {
    const resolver = recordingResolver();
    const links = await resolveLibraries(
      artifact([{ source: "src/MathLib.sol", name: "MathLib" }]),
      new Map(),
      resolver,
    );
    expect(links).toEqual([{ source: "src/MathLib.sol", name: "MathLib", address: "0xMathLib" }]);
    expect(resolver.deployed).toEqual(["MathLib"]);
  });

  test("reuses a cached library address instead of deploying", async () => {
    const resolver = recordingResolver({ resolveCached: async () => "0xCACHED" });
    const links = await resolveLibraries(
      artifact([{ source: "src/MathLib.sol", name: "MathLib" }]),
      new Map(),
      resolver,
    );
    expect(links[0]?.address).toBe("0xCACHED");
    expect(resolver.deployed).toEqual([]);
  });

  test("user-provided address wins and skips deploy", async () => {
    const resolver = recordingResolver();
    const links = await resolveLibraries(
      artifact([{ source: "src/MathLib.sol", name: "MathLib" }]),
      new Map([["MathLib", "0xUSER"]]),
      resolver,
    );
    expect(links[0]?.address).toBe("0xUSER");
    expect(resolver.deployed).toEqual([]);
  });

  test("deploys nested dependency before its dependent (topological order)", async () => {
    const resolver = recordingResolver({
      loadArtifact: (req) =>
        req.name === "Outer" ? artifact([{ source: "src/Inner.sol", name: "Inner" }]) : artifact([]),
    });
    const links = await resolveLibraries(
      artifact([{ source: "src/Outer.sol", name: "Outer" }]),
      new Map(),
      resolver,
    );
    expect(resolver.deployed).toEqual(["Inner", "Outer"]);
    expect(links.map((link) => link.name)).toEqual(["Inner", "Outer"]);
  });

  test("detects circular dependencies", async () => {
    const resolver = recordingResolver({
      loadArtifact: (req) =>
        req.name === "A" ? artifact([{ source: "src/B.sol", name: "B" }]) : artifact([{ source: "src/A.sol", name: "A" }]),
    });
    await expect(
      resolveLibraries(artifact([{ source: "src/A.sol", name: "A" }]), new Map(), recordingResolverCircular(resolver)),
    ).rejects.toThrow();
  });
});

function recordingResolverCircular(resolver: LibraryResolver): LibraryResolver {
  return resolver;
}
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test packages/cli/src/commands/deploy-libraries.test.ts`
Expected: FAIL — `resolveLibraries` / `LibraryResolver` 未导出。

- [ ] **Step 3: 实现 `resolveLibraries`**

`packages/cli/src/commands/deploy-libraries.ts` 追加(顶部 import 增加 `ContractArtifact`、`LibraryRequirement`、`ForgeLibrary`):

```ts
import type { ContractArtifact, LibraryRequirement } from "@consol/core";
import type { ForgeLibrary } from "@consol/foundry";

export type LibraryResolver = {
  readonly loadArtifact: (req: LibraryRequirement) => ContractArtifact;
  readonly resolveCached: (req: LibraryRequirement, bytecodeHash: string) => Promise<string | null>;
  readonly deploy: (req: LibraryRequirement, artifact: ContractArtifact, libraries: readonly ForgeLibrary[]) => Promise<string>;
};

export async function resolveLibraries(
  artifact: ContractArtifact,
  userProvided: ReadonlyMap<string, string>,
  resolver: LibraryResolver,
  inProgress: ReadonlySet<string> = new Set(),
  resolved: Map<string, ForgeLibrary> = new Map(),
): Promise<readonly ForgeLibrary[]> {
  const links: ForgeLibrary[] = [];
  for (const req of artifact.linkReferences) {
    const link = await resolveOne(req, userProvided, resolver, inProgress, resolved);
    links.push(link);
  }
  return links;
}

async function resolveOne(
  req: LibraryRequirement,
  userProvided: ReadonlyMap<string, string>,
  resolver: LibraryResolver,
  inProgress: ReadonlySet<string>,
  resolved: Map<string, ForgeLibrary>,
): Promise<ForgeLibrary> {
  const key = `${req.source}:${req.name}`;
  const already = resolved.get(key);
  if (already !== undefined) {
    return already;
  }

  const provided = userProvided.get(req.name);
  if (provided !== undefined) {
    return remember(resolved, key, { ...req, address: provided });
  }

  if (inProgress.has(key)) {
    throw new ProjectError({
      code: "library_cycle_detected",
      message: `Circular library dependency at ${key}.`,
      hint: "Break the cycle between these libraries before deploying.",
    });
  }

  const libArtifact = resolver.loadArtifact(req);
  const nextInProgress = new Set(inProgress).add(key);
  const dependencies = await resolveLibraries(libArtifact, userProvided, resolver, nextInProgress, resolved);

  const bytecodeHash = libArtifact.bytecodeHash ?? "";
  const cached = await resolver.resolveCached(req, bytecodeHash);
  const address = cached ?? (await resolver.deploy(req, libArtifact, dependencies));
  return remember(resolved, key, { ...req, address });
}

function remember(resolved: Map<string, ForgeLibrary>, key: string, link: ForgeLibrary): ForgeLibrary {
  resolved.set(key, link);
  return link;
}
```

> 设计说明:`resolveLibraries` 是纯编排(递归顺序、缓存复用、用户覆盖、循环检测),全部 IO 通过 `LibraryResolver` 注入,故可单测。真实 `LibraryResolver` 由 Task 6 在 `deploy-execute.ts` 提供。

- [ ] **Step 4: 运行确认通过**

Run: `bun test packages/cli/src/commands/deploy-libraries.test.ts`
Expected: PASS(parseLibraryOverrides + resolveLibraries 全部)。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/deploy-libraries.ts packages/cli/src/commands/deploy-libraries.test.ts
git commit -m "feat(cli): recursive library deploy orchestration with cache reuse"
```

---

## Task 6: 接入 deploy-execute(cli)

**Files:**
- Modify: `packages/cli/src/commands/deploy-execute.ts`(`:81` 读 artifact 之后、`:136` forge create 之前插入;`:167-179` entry 加 `kind`)

- [ ] **Step 1: 实现真实 LibraryResolver + 编排接入**

`packages/cli/src/commands/deploy-execute.ts`:

import 区追加:

```ts
import { runCastCode, runForgeBuild, runForgeCreate } from "@consol/foundry";
import type { ForgeLibrary } from "@consol/foundry";
import {
  readContractArtifact,
  resolveArtifactPath,
  resolveTarget,
} from "@consol/core";
import type { LibraryRequirement } from "@consol/core";
import { parseLibraryOverrides, resolveLibraries } from "./deploy-libraries";
import { libraryDeploymentCacheKey } from "./deploy-cache";
```

在 `const artifact = readContractArtifact(...)`(`:81`)之后、`preview`(`:130`)之前插入编排:

```ts
  const userLibraries = parseLibraryOverrides(options.libraries);
  const libraryLinks = await resolveLibraries(artifact, userLibraries, {
    loadArtifact: (req) =>
      readContractArtifact(
        resolveArtifactPath({
          sourceMode: "project",
          projectRoot: resolved.projectRoot,
          sourceFile: join(resolved.projectRoot, req.source),
          contractName: req.name,
        }),
      ),
    resolveCached: async (req, bytecodeHash) => {
      const cache = readDeploymentCache(resolved.projectRoot);
      const key = libraryDeploymentCacheKey({
        source: req.source,
        name: req.name,
        networkName: network.meta.fingerprint ?? network.meta.name,
        bytecodeHash,
      });
      const entry = deploymentEntry(cache.entries[key]);
      if (entry === null) {
        return null;
      }
      const code = await runCastCode({
        cwd: resolved.projectRoot,
        env: input.env,
        rpcUrl: network.rpc_url,
        address: entry.address,
      });
      return code.ok && hasCode(code.stdout) ? entry.address : null;
    },
    deploy: (req, libArtifact, libraries) =>
      deployLibrary({ req, libArtifact, libraries, input, resolved, network, signer }),
  });
```

文件顶部 import `join`:

```ts
import { join } from "node:path";
```

新增 `deployLibrary` 辅助(放文件末尾,`requiredBytecodeHash` 旁):

```ts
async function deployLibrary(args: {
  readonly req: LibraryRequirement;
  readonly libArtifact: ContractArtifact;
  readonly libraries: readonly ForgeLibrary[];
  readonly input: RunDeployCommandInput;
  readonly resolved: ResolvedTarget;
  readonly network: { readonly meta: NetworkMeta; readonly rpc_url: string };
  readonly signer: ReturnType<typeof resolveWriteSigner>;
}): Promise<string> {
  const created = await runForgeCreate({
    cwd: args.resolved.projectRoot,
    projectRoot: args.resolved.projectRoot,
    env: args.input.env,
    contractId: `${args.req.source}:${args.req.name}`,
    rpcUrl: args.network.rpc_url,
    wallet: foundryWalletForNetwork(args.signer, args.network.meta),
    constructorArgs: [],
    libraries: args.libraries,
  });
  if (!created.ok) {
    throw new ProjectError({
      code: "forge_create_failed",
      message: `forge create failed while deploying library ${args.req.name}.`,
      hint: created.stderr.trim() || created.stdout.trim() || created.error,
    });
  }
  const address = parseRequiredCreateField(created.stdout, /^Deployed to:\s*(\S+)$/m, "deployment_address_missing");
  const bytecodeHash = args.libArtifact.bytecodeHash ?? "";
  const key = libraryDeploymentCacheKey({
    source: args.req.source,
    name: args.req.name,
    networkName: args.network.meta.fingerprint ?? args.network.meta.name,
    bytecodeHash,
  });
  const cache = readDeploymentCache(args.resolved.projectRoot);
  writeDeploymentCache(args.resolved.projectRoot, {
    version: cache.version,
    entries: {
      ...cache.entries,
      [key]: {
        kind: "library",
        contract: args.req.name,
        address,
        chain_id: args.network.meta.chain_id,
        network: args.network.meta.name,
        network_fingerprint: args.network.meta.fingerprint,
        deployer: args.signer.account.address ?? args.signer.account.name,
        bytecode_hash: bytecodeHash,
        constructor_args_hash: argsHash([]),
        deployment_value: null,
        deploy_tx: parseOptionalCreateField(created.stdout, /^Transaction hash:\s*(\S+)$/m),
        deployed_at_unix: Math.floor(Date.now() / 1000),
      },
    },
  });
  return address;
}
```

`runForgeCreate` 主合约调用(`:136`)加 `libraries: libraryLinks`:

```ts
  const created = await runForgeCreate({
    cwd: resolved.projectRoot,
    projectRoot: resolved.projectRoot,
    env: input.env,
    contractId: contractIdentifier(resolved, artifact),
    rpcUrl: network.rpc_url,
    wallet: foundryWalletForNetwork(signer, network.meta),
    constructorArgs: options.constructorArgs,
    libraries: libraryLinks,
    ...(options.value === undefined ? {} : { value: options.value }),
    ...(options.gasLimit === undefined ? {} : { gasLimit: options.gasLimit }),
  });
```

主合约 entry(`:167-179`)加 `kind: "contract"`:

```ts
  const entry = {
    kind: "contract" as const,
    contract: resolved.contractName,
    address,
    // ...(其余不变)
```

- [ ] **Step 2: 运行单测确认无回归**

Run: `bun test packages/cli/src/commands/`
Expected: PASS(类型在所有 cli 文件收口)。

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/deploy-execute.ts
git commit -m "feat(cli): deploy and link external libraries during deploy"
```

---

## Task 7: deploy --all 占位符识别(边界修正)(core)

**Files:**
- Modify: `packages/core/src/project/deploy-plan.ts`(`isDeployableBytecode` `:127-130`、`deployBlocker` `:66-74`、`planItemFromArtifact` `:35-64`)
- Create: `packages/core/src/project/deploy-plan.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/core/src/project/deploy-plan.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverDeployPlan } from "./deploy-plan";

describe("discoverDeployPlan with external libraries", () => {
  test("marks a contract with unresolved linkReferences as non-deployable", () => {
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
    expect(item?.deployable).toBe(false);
    expect(item?.reason).toBe("contract links external libraries; deploy it directly with `consol deploy <target>`");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test packages/core/src/project/deploy-plan.test.ts`
Expected: FAIL — 当前把它当 deployable。

- [ ] **Step 3: 实现**

`packages/core/src/project/deploy-plan.ts`:

顶部加 import:

```ts
import { parseLinkReferences } from "./link-references";
```

`planItemFromArtifact`(`:47-50`)在算 `hasBytecode` 后加 link 检测,并把它纳入 `deployBlocker`:

```ts
  const bytecode = bytecodeObject(artifact);
  const constructorInputs = constructorInputCount(artifact);
  const hasBytecode = bytecode !== null && isDeployableBytecode(bytecode);
  const linksLibraries = parseLinkReferences(artifact).length > 0;
  const reason = deployBlocker(hasBytecode, constructorInputs, linksLibraries);
```

`deployBlocker`(`:66-74`)加参数与分支:

```ts
function deployBlocker(hasBytecode: boolean, constructorInputs: number, linksLibraries: boolean): string | null {
  if (!hasBytecode) {
    return "artifact has no deployable bytecode";
  }
  if (linksLibraries) {
    return "contract links external libraries; deploy it directly with `consol deploy <target>`";
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
git commit -m "fix(core): exclude library-linking contracts from deploy --all plan"
```

---

## Task 8: 端到端集成测试 + fake-foundry 扩展 + fixture

**Files:**
- Modify: `packages/testkit/src/fake-foundry.ts`(`contractNames` `:339-344`、`writeFakeArtifacts` `:268-295`)
- Modify: `packages/cli/src/main.test.ts`(追加一个部署用例)
- Create: `examples/library-demo/src/MathLib.sol`、`examples/library-demo/src/Calculator.sol`

- [ ] **Step 1: 扩展 fake-foundry — 为 library 生成 artifact 并给引用方加 linkReferences**

`packages/testkit/src/fake-foundry.ts`:

`contractNames`(`:339-344`)改为同时匹配 `contract` 与 `library`(保留排序):

```ts
function contractNames(source) {
  return [...source.matchAll(/\\b(?:contract|library)\\s+([A-Za-z_$][\\w$]*)/g)]
    .map((match) => match[1])
    .filter((name) => name !== undefined)
    .sort();
}
```

`writeFakeArtifacts`(`:279-292` 的 `JSON.stringify` 对象)把 `bytecode` 改为带条件 linkReferences:

```ts
      writeFileSync(
        artifactPath,
        JSON.stringify({
          abi: functionAbi(source),
          bytecode: bytecodeFor(source, contract, projectRoot),
          metadata: {
            settings: {
              compilationTarget: {
                [sourcePath]: contract,
              },
            },
          },
        }),
      );
```

在 `writeFakeArtifacts` 函数下方新增 helper:

```ts
function bytecodeFor(source, contract, projectRoot) {
  const libraries = libraryDeclarations(projectRoot);
  const linkReferences = {};
  for (const lib of libraries) {
    if (lib.name !== contract && new RegExp("\\\\b" + lib.name + "\\\\.").test(source)) {
      linkReferences[lib.sourcePath] = { [lib.name]: [{ start: 0, length: 20 }] };
    }
  }
  return Object.keys(linkReferences).length > 0
    ? { object: "0x60016002", linkReferences }
    : { object: "0x60016002" };
}

function libraryDeclarations(projectRoot) {
  const found = [];
  for (const sourceFile of solidityFiles(projectRoot)) {
    const source = readFileSync(sourceFile, "utf8");
    const sourcePath = relative(projectRoot, sourceFile).split(sep).join("/");
    for (const match of source.matchAll(/\\blibrary\\s+([A-Za-z_$][\\w$]*)/g)) {
      if (match[1] !== undefined) {
        found.push({ name: match[1], sourcePath });
      }
    }
  }
  return found;
}
```

> 说明:fake `forge create` 仍对所有合约返回固定地址 `0x…c0Fe`,集成测试通过 `readCalls()` 断言**调用顺序**与**`--libraries` 参数**,而非地址差异——这足以验证编排正确性。

- [ ] **Step 2: 写端到端测试**

`packages/cli/src/main.test.ts` 追加一个用例(沿用文件中已有的 fake-foundry + runMain 模式;若辅助函数名不同,套用同文件既有 deploy 用例的写法):

```ts
test("deploy links and deploys an external library before the dependent contract", async () => {
  const fake = createFakeFoundry();
  const projectRoot = mkdtempSync(join(tmpdir(), "consol-lib-e2e-"));
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
  writeFileSync(join(projectRoot, "src", "MathLib.sol"), "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\nlibrary MathLib { function add(uint a, uint b) external pure returns (uint) { return a + b; } }\n");
  writeFileSync(
    join(projectRoot, "src", "Calculator.sol"),
    "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\nimport './MathLib.sol';\ncontract Calculator { function go(uint a, uint b) external pure returns (uint) { return MathLib.add(a, b); } }\n",
  );

  await runMain(["deploy", "src/Calculator.sol:Calculator", "--yes"], {
    cwd: projectRoot,
    env: { ...fake.env, ETH_RPC_URL: "http://127.0.0.1:8545", ETH_PRIVATE_KEY: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" },
  });

  const creates = fake.readCalls().filter((call) => call.tool === "forge" && call.args[1] === "create");
  expect(creates[0]?.args).toContain("src/MathLib.sol:MathLib");
  const dependent = creates.at(-1);
  expect(dependent?.args.join(" ")).toContain("--libraries src/MathLib.sol:MathLib:0x000000000000000000000000000000000000c0Fe");
});
```

> 注:`runMain`/`createFakeFoundry` 的具体 import 与签名请对齐 `main.test.ts` 顶部已有用例;上面参数名与现有 deploy 用例保持一致即可。

- [ ] **Step 3: 运行确认通过**

Run: `bun test packages/cli/src/main.test.ts`
Expected: PASS(新用例 + 原有用例)。

- [ ] **Step 4: 加 examples fixture**

`examples/library-demo/src/MathLib.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library MathLib {
    function add(uint256 a, uint256 b) external pure returns (uint256) {
        return a + b;
    }
}
```

`examples/library-demo/src/Calculator.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {MathLib} from "./MathLib.sol";

contract Calculator {
    function go(uint256 a, uint256 b) external pure returns (uint256) {
        return MathLib.add(a, b);
    }
}
```

- [ ] **Step 5: 全量回归**

Run: `bun test`
Expected: PASS(全仓库)。

- [ ] **Step 6: 手动 E2E(可选,需真实 Foundry)**

```bash
consol chain start
consol deploy examples/library-demo/src/Calculator.sol:Calculator
# 预期:先看到 MathLib 部署 + 地址,再看到 Calculator 部署且自动 link
consol deploy examples/library-demo/src/MathLib.sol:MathLib
# 预期:单独部署 library 并打印地址
```

- [ ] **Step 7: Commit**

```bash
git add packages/testkit/src/fake-foundry.ts packages/cli/src/main.test.ts examples/library-demo
git commit -m "test(cli): end-to-end external library deploy + linking"
```

---

## Self-Review 备注(写计划时已核对)

- **Spec 覆盖:** 检测(T1)、link(T2)、缓存级联(T3+T6)、命令入口/独立部署/`--libraries`(T4+T6)、递归嵌套(T5)、deploy --all 边界(T7)、E2E+fixture(T8)。gas preview 按 spec 标为已知限制,无对应 task(刻意)。
- **类型一致:** `LibraryRequirement{source,name}`(core)、`ForgeLibrary{source,name,address}`(foundry)贯穿 T1/T2/T5/T6;`LibraryResolver` 在 T5 定义、T6 实现;`DeployListItem.kind` 在 T3 引入、T6 填充。
- **已知耦合:** T3 引入必填 `kind` 后,`deploy-execute.ts` 在 T6 完成前类型不完整——已在 T3 Step 4 备注,T6 收口。
