# Complex State Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a selectable State panel that can summarize and inspect Solidity arrays, structs, and mappings using storage layout plus bounded RPC storage reads.

**Architecture:** Keep decoding and persistence out of the TUI. `packages/core` owns storage layout normalization, slot planning, decoding, and Key Book persistence; `packages/rpc` owns storage RPC reads; `packages/cli` assembles state snapshots; `packages/tui` renders selectable rows, detail modals, and Key Book inputs.

**Tech Stack:** TypeScript, Bun, Foundry `forge inspect storage-layout`, viem encoding/hash helpers, OpenTUI/Solid, existing Bun tests and fake Foundry fixtures.

---

## Product Source

Read first:

- `docs/product/DEV_TUI_COMPLEX_STATE_PANEL.md`
- `docs/architecture/TECH_STACK.md`
- `docs/architecture/REPO_STRUCTURE.md`
- `docs/quality/TESTING.md`

Scope constraints:

- Do not implement automatic mapping key discovery.
- Do not bind keys to a specific deployed address in the first pass.
- Do not read the full Key Book in State panel summaries.
- Do not make TUI components call RPC or Foundry.
- Preserve the existing `state.values` no-argument reader payload.

## File Map

Create:

- `packages/core/src/project/storage-layout.ts`: parse and normalize Foundry storage layout JSON, compute layout ids, expose variable/type descriptors.
- `packages/core/src/project/storage-slots.ts`: compute read plans for scalars, arrays, structs, mappings, and nested mapping tuple keys.
- `packages/core/src/project/storage-decode.ts`: decode 32-byte storage words into display values and default-value flags.
- `packages/core/src/project/state-key-book.ts`: read/write `.consol/state-keys.json`, normalize typed keys, select compatible keys.
- `packages/core/src/project/storage-state.test.ts`: layout, slot, decode, and Key Book unit tests.
- `packages/cli/src/commands/storage-state.ts`: assemble complex storage summaries/details for `state` and `activity`.
- `packages/cli/src/commands/storage-state.test.ts`: CLI-level snapshot builder tests with fake RPC reads.
- `packages/tui/src/StateRows.tsx`: selectable State row rendering and row detail rendering helpers.
- `packages/tui/src/StateKeyBookModal.tsx`: Key Book add/edit/delete modal components.

Modify:

- `packages/core/package.json`: add `viem` dependency if core imports viem hash/encoding helpers.
- `packages/core/src/project/index.ts`: export new storage modules.
- `packages/cli/src/commands/storage.ts`: reuse core storage layout parser.
- `packages/rpc/src/index.ts`: add `getStorageAt`.
- `packages/rpc/src/rpc-adapter.test.ts`: cover `getStorageAt`.
- `packages/cli/src/commands/interact.ts`: add optional complex storage data to `state --json`.
- `packages/cli/src/commands/activity.ts`: include complex storage data in activity state.
- `packages/cli/src/commands/dev-json.ts`: pass complex storage data through dev snapshots.
- `packages/cli/src/commands/dev.ts`: add handlers for State detail and Key Book mutations.
- `packages/tui/src/runtime-types.ts`: add storage state row/detail/action types.
- `packages/tui/src/DevPanels.tsx`: render selectable State rows and details entry point.
- `packages/tui/src/DevShellController.tsx`: manage State row selection, detail modal, and Key Book modal state.
- `packages/tui/src/DevShell.tsx`: wire keyboard shortcuts for State row selection/detail/copy.
- `packages/tui/src/DevShell.test.tsx`, `packages/tui/src/DevPanels.test.tsx`, `packages/tui/src/DevShellController.test.tsx`: behavior tests.
- `packages/i18n/src/locales/en-US.ts`, `packages/i18n/src/locales/zh-CN.ts`: user-visible copy.
- `packages/testkit/src/fake-foundry.ts`: fake `forge inspect storage-layout` and optional fake storage values.

---

### Task 1: Core Storage Layout Model

**Files:**

- Create: `packages/core/src/project/storage-layout.ts`
- Create: `packages/core/src/project/storage-state.test.ts`
- Modify: `packages/core/src/project/index.ts`
- Modify: `packages/cli/src/commands/storage.ts`

- [ ] **Step 1: Write failing layout parser tests**

Add to `packages/core/src/project/storage-state.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  parseStorageLayoutJson,
  storageLayoutId,
  storageVariables,
  storageType,
} from "./storage-layout";

describe("storage layout", () => {
  const layoutJson = JSON.stringify({
    storage: [
      { astId: 1, contract: "src/Counter.sol:Counter", label: "counter", offset: 0, slot: "0", type: "t_uint256" },
      { astId: 2, contract: "src/Counter.sol:Counter", label: "numbers", offset: 0, slot: "1", type: "t_array(t_uint256)dyn_storage" },
      { astId: 3, contract: "src/Counter.sol:Counter", label: "balances", offset: 0, slot: "2", type: "t_mapping(t_address,t_uint256)" },
    ],
    types: {
      t_uint256: { encoding: "inplace", label: "uint256", numberOfBytes: "32" },
      "t_array(t_uint256)dyn_storage": {
        base: "t_uint256",
        encoding: "dynamic_array",
        label: "uint256[]",
        numberOfBytes: "32",
      },
      "t_mapping(t_address,t_uint256)": {
        encoding: "mapping",
        key: "t_address",
        label: "mapping(address => uint256)",
        numberOfBytes: "32",
        value: "t_uint256",
      },
      t_address: { encoding: "inplace", label: "address", numberOfBytes: "20" },
    },
  });

  test("normalizes storage rows and type metadata", () => {
    const layout = parseStorageLayoutJson(layoutJson);
    expect(storageVariables(layout).map((item) => item.label)).toEqual(["counter", "numbers", "balances"]);
    expect(storageType(layout, "t_array(t_uint256)dyn_storage")?.encoding).toBe("dynamic_array");
    expect(storageType(layout, "t_mapping(t_address,t_uint256)")?.key).toBe("t_address");
  });

  test("creates a stable layout id from normalized storage shape", () => {
    const left = parseStorageLayoutJson(layoutJson);
    const right = parseStorageLayoutJson(layoutJson);
    expect(storageLayoutId(left)).toMatch(/^layout:[0-9a-f]{16}$/);
    expect(storageLayoutId(left)).toBe(storageLayoutId(right));
  });
});
```

- [ ] **Step 2: Run parser tests and verify failure**

Run:

```bash
bun test packages/core/src/project/storage-state.test.ts --timeout 30000
```

Expected: FAIL because `./storage-layout` does not exist.

- [ ] **Step 3: Implement storage layout parser**

Create `packages/core/src/project/storage-layout.ts`:

```ts
import { ProjectError, stableHash } from "./artifacts";

export type StorageLayout = {
  readonly storage: readonly StorageVariable[];
  readonly types: Readonly<Record<string, StorageType>>;
};

export type StorageVariable = {
  readonly astId: number | null;
  readonly contract: string;
  readonly label: string;
  readonly offset: number;
  readonly slot: string;
  readonly typeId: string;
};

export type StorageType = {
  readonly id: string;
  readonly encoding: string;
  readonly label: string;
  readonly numberOfBytes: number;
  readonly base?: string;
  readonly key?: string;
  readonly value?: string;
  readonly members?: readonly StorageMember[];
};

export type StorageMember = {
  readonly astId: number | null;
  readonly contract: string;
  readonly label: string;
  readonly offset: number;
  readonly slot: string;
  readonly typeId: string;
};

export function parseStorageLayoutJson(source: string): StorageLayout {
  const raw = parseJson(source);
  const typesRecord = recordProperty(raw, "types") ?? {};
  const types = Object.fromEntries(
    Object.entries(typesRecord).map(([id, value]) => [id, normalizeType(id, value)]),
  );
  const storage = arrayProperty(raw, "storage").map(normalizeVariable);
  return { storage, types };
}

export function storageVariables(layout: StorageLayout): readonly StorageVariable[] {
  return layout.storage;
}

export function storageType(layout: StorageLayout, typeId: string): StorageType | undefined {
  return layout.types[typeId];
}

export function storageLayoutId(layout: StorageLayout): string {
  const normalized = {
    storage: layout.storage.map((item) => ({
      label: item.label,
      slot: item.slot,
      offset: item.offset,
      typeId: item.typeId,
    })),
    types: Object.fromEntries(
      Object.entries(layout.types).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
  return `layout:${stableHash(JSON.stringify(normalized))}`;
}

function normalizeVariable(raw: unknown): StorageVariable {
  return {
    astId: numberProperty(raw, "astId") ?? null,
    contract: stringProperty(raw, "contract") ?? "",
    label: stringProperty(raw, "label") ?? "",
    offset: numberProperty(raw, "offset") ?? 0,
    slot: stringProperty(raw, "slot") ?? "0",
    typeId: stringProperty(raw, "type") ?? "",
  };
}

function normalizeType(id: string, raw: unknown): StorageType {
  return {
    id,
    encoding: stringProperty(raw, "encoding") ?? "",
    label: stringProperty(raw, "label") ?? id,
    numberOfBytes: Number(stringProperty(raw, "numberOfBytes") ?? numberProperty(raw, "numberOfBytes") ?? 32),
    base: stringProperty(raw, "base"),
    key: stringProperty(raw, "key"),
    value: stringProperty(raw, "value"),
    members: arrayProperty(raw, "members").map(normalizeMember),
  };
}

function normalizeMember(raw: unknown): StorageMember {
  return {
    astId: numberProperty(raw, "astId") ?? null,
    contract: stringProperty(raw, "contract") ?? "",
    label: stringProperty(raw, "label") ?? "",
    offset: numberProperty(raw, "offset") ?? 0,
    slot: stringProperty(raw, "slot") ?? "0",
    typeId: stringProperty(raw, "type") ?? "",
  };
}

function parseJson(source: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new ProjectError({
      code: "storage_layout_parse_failed",
      message: `Failed to parse storage layout JSON: ${error instanceof Error ? error.message : String(error)}`,
      hint: source,
    });
  }
}

function arrayProperty(raw: unknown, key: string): readonly unknown[] {
  const value = property(raw, key);
  return Array.isArray(value) ? value : [];
}

function recordProperty(raw: unknown, key: string): Record<string, unknown> | undefined {
  const value = property(raw, key);
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringProperty(raw: unknown, key: string): string | undefined {
  const value = property(raw, key);
  return typeof value === "string" ? value : undefined;
}

function numberProperty(raw: unknown, key: string): number | undefined {
  const value = property(raw, key);
  return typeof value === "number" ? value : undefined;
}

function property(raw: unknown, key: string): unknown {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>)[key] : undefined;
}
```

Modify `packages/core/src/project/index.ts`:

```ts
export * from "./abi";
export * from "./artifacts";
export * from "./deploy-plan";
export * from "./detect";
export * from "./solidity-declarations";
export * from "./storage-layout";
export * from "./target";
```

- [ ] **Step 4: Reuse parser in storage command**

Modify `packages/cli/src/commands/storage.ts` to import `parseStorageLayoutJson` from `@consol/core` and remove the local `parseStorageLayout` JSON parser. Keep output shape unchanged.

The data mapping should read:

```ts
const layout = parseStorageLayoutJson(result.stdout);
const data = {
  target,
  contract: resolved.contractName,
  source_mode: resolved.sourceMode,
  project_root: resolved.projectRoot,
  storage: layout.storage.map((slot) => ({
    label: slot.label,
    slot: slot.slot,
    offset: slot.offset,
    contract: slot.contract,
    type_id: slot.typeId,
    type_label: layout.types[slot.typeId]?.label ?? null,
    encoding: layout.types[slot.typeId]?.encoding ?? null,
    number_of_bytes: layout.types[slot.typeId]?.numberOfBytes === undefined ? null : String(layout.types[slot.typeId]?.numberOfBytes),
  })),
  types: layout.types,
};
```

- [ ] **Step 5: Run tests**

Run:

```bash
bun test packages/core/src/project/storage-state.test.ts --timeout 30000
bun test packages/cli/src/main.test.ts --timeout 30000 --test-name-pattern "storage"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/project/storage-layout.ts packages/core/src/project/storage-state.test.ts packages/core/src/project/index.ts packages/cli/src/commands/storage.ts
git commit -m "feat: normalize storage layout metadata"
```

### Task 2: Storage Slot Planning And Decode

**Files:**

- Create: `packages/core/src/project/storage-slots.ts`
- Create: `packages/core/src/project/storage-decode.ts`
- Modify: `packages/core/src/project/storage-state.test.ts`
- Modify: `packages/core/src/project/index.ts`
- Modify: `packages/core/package.json`

- [ ] **Step 1: Add failing slot/decode tests**

Add tests to `packages/core/src/project/storage-state.test.ts`:

```ts
import {
  decodeStorageWord,
  isDefaultDecodedStorageValue,
} from "./storage-decode";
import {
  arrayElementSlot,
  mappingValueSlot,
  planStorageSummaryReads,
} from "./storage-slots";

test("decodes elementary storage words", () => {
  expect(decodeStorageWord({ typeLabel: "uint256", numberOfBytes: 32, word: `0x${"0".repeat(63)}7` }).readable).toBe("7");
  expect(decodeStorageWord({ typeLabel: "bool", numberOfBytes: 1, word: `0x${"0".repeat(63)}1` }).readable).toBe("true");
  expect(decodeStorageWord({ typeLabel: "address", numberOfBytes: 20, word: `0x${"0".repeat(24)}f39fd6e51aad88f6f4ce6ab8827279cfffb92266` }).readable).toBe("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
});

test("detects default decoded values", () => {
  expect(isDefaultDecodedStorageValue(decodeStorageWord({ typeLabel: "uint256", numberOfBytes: 32, word: `0x${"0".repeat(64)}` }))).toBe(true);
  expect(isDefaultDecodedStorageValue(decodeStorageWord({ typeLabel: "bool", numberOfBytes: 1, word: `0x${"0".repeat(63)}1` }))).toBe(false);
});

test("plans bounded summary reads for arrays and mappings", () => {
  const layout = parseStorageLayoutJson(layoutJson);
  const reads = planStorageSummaryReads({
    layout,
    keyBook: {
      address: [
        { type: "address", value: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", label: "anvil0", enabled: true },
        { type: "address", value: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8", label: "anvil1", enabled: true },
        { type: "address", value: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc", label: "anvil2", enabled: true },
        { type: "address", value: "0x90f79bf6eb2c4f870365e785982e1f101e93b906", label: "anvil3", enabled: true },
      ],
      tuple: [],
    },
    previewLimit: 3,
  });
  expect(reads.filter((item) => item.variable === "balances")).toHaveLength(3);
});

test("computes deterministic dynamic array and mapping slots", () => {
  expect(arrayElementSlot("1", 0)).toMatch(/^0x[0-9a-f]{64}$/);
  expect(mappingValueSlot({ baseSlot: "2", keyType: "address", keyValue: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" })).toMatch(/^0x[0-9a-f]{64}$/);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
bun test packages/core/src/project/storage-state.test.ts --timeout 30000
```

Expected: FAIL because storage slot/decode modules do not exist.

- [ ] **Step 3: Add viem dependency to core**

Modify `packages/core/package.json`:

```json
{
  "name": "@consol/core",
  "version": "0.11.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@consol/protocol": "workspace:*",
    "tree-sitter-solidity": "1.2.13",
    "viem": "^2.52.0",
    "web-tree-sitter": "0.25.10"
  }
}
```

- [ ] **Step 4: Implement decode helpers**

Create `packages/core/src/project/storage-decode.ts` with:

```ts
export type DecodedStorageValue = {
  readonly readable: string;
  readonly raw: string;
  readonly typeLabel: string;
  readonly default: boolean;
};

export function decodeStorageWord(input: {
  readonly typeLabel: string;
  readonly numberOfBytes: number;
  readonly word: string;
  readonly offsetBytes?: number;
}): DecodedStorageValue {
  const raw = normalizedWord(input.word);
  const bytes = input.numberOfBytes;
  const offset = input.offsetBytes ?? 0;
  const extracted = extractBytes(raw, offset, bytes);
  const readable = decodeExtractedValue(input.typeLabel, extracted);
  return {
    readable,
    raw,
    typeLabel: input.typeLabel,
    default: isDefaultRaw(input.typeLabel, extracted),
  };
}

export function isDefaultDecodedStorageValue(value: DecodedStorageValue): boolean {
  return value.default;
}
```

Implementation details:

- `uint*` and `int*`: convert the extracted bytes to `BigInt` and display decimal.
- `bool`: display `true` only when extracted value is `1`.
- `address`: use the last 20 bytes and lowercase `0x` hex.
- `bytesN`: display canonical hex.
- unknown elementary type: display extracted hex.

- [ ] **Step 5: Implement slot planning helpers**

Create `packages/core/src/project/storage-slots.ts` with exported types:

```ts
import { encodeAbiParameters, keccak256, padHex, toHex, type Hex } from "viem";
import type { StorageLayout, StorageType, StorageVariable } from "./storage-layout";

export type StateKeyBookSelection = {
  readonly address: readonly StateKeySelection[];
  readonly uint256?: readonly StateKeySelection[];
  readonly bytes32?: readonly StateKeySelection[];
  readonly tuple: readonly StateTupleKeySelection[];
};

export type StateKeySelection = {
  readonly type: string;
  readonly value: string;
  readonly label: string | null;
  readonly enabled: boolean;
};

export type StateTupleKeySelection = {
  readonly types: readonly string[];
  readonly values: readonly string[];
  readonly label: string | null;
  readonly enabled: boolean;
};

export type StorageReadPlan = {
  readonly id: string;
  readonly variable: string;
  readonly slot: Hex;
  readonly typeId: string;
  readonly typeLabel: string;
  readonly offsetBytes: number;
  readonly numberOfBytes: number;
  readonly path: readonly string[];
  readonly keyLabel?: string | null;
  readonly keyValues?: readonly string[];
};
```

Required exports:

```ts
export function planStorageSummaryReads(input: {
  readonly layout: StorageLayout;
  readonly keyBook: StateKeyBookSelection;
  readonly previewLimit: number;
}): readonly StorageReadPlan[];

export function arrayElementSlot(baseSlot: string, index: number): Hex;

export function mappingValueSlot(input: {
  readonly baseSlot: string;
  readonly keyType: string;
  readonly keyValue: string;
}): Hex;
```

Implementation rules:

- Scalars produce one read plan.
- Dynamic arrays produce one length read and up to `previewLimit` element plans after the length is known in Task 5.
- Fixed arrays produce up to `previewLimit` element plans.
- Structs produce member plans for the first fields that fit the preview limit.
- Single-level mappings use compatible enabled keys up to `previewLimit`.
- Nested mappings use compatible enabled tuple keys up to `previewLimit`.
- Mapping slot calculation must hash the canonical 32-byte key with the canonical 32-byte base slot.

- [ ] **Step 6: Export modules and run tests**

Modify `packages/core/src/project/index.ts`:

```ts
export * from "./storage-decode";
export * from "./storage-layout";
export * from "./storage-slots";
```

Run:

```bash
bun test packages/core/src/project/storage-state.test.ts --timeout 30000
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/package.json packages/core/src/project/storage-decode.ts packages/core/src/project/storage-slots.ts packages/core/src/project/storage-state.test.ts packages/core/src/project/index.ts
git commit -m "feat: plan and decode storage reads"
```

### Task 3: RPC Storage Reads

**Files:**

- Modify: `packages/rpc/src/index.ts`
- Modify: `packages/rpc/src/rpc-adapter.test.ts`

- [ ] **Step 1: Write failing RPC adapter test**

Add to `packages/rpc/src/rpc-adapter.test.ts`:

```ts
test("getStorageAt delegates to public client storage reads", async () => {
  const calls: unknown[] = [];
  const adapter = createRpcAdapterFromPublicClient({
    getBalance: async () => 0n,
    watchBlockNumber: () => () => {},
    waitForTransactionReceipt: async () => ({}),
    getTransactionReceipt: async () => ({}),
    getTransaction: async () => ({}),
    getBlock: async () => ({}),
    getLogs: async () => [],
    getStorageAt: async (input: { address: string; slot: string }) => {
      calls.push(input);
      return "0x0000000000000000000000000000000000000000000000000000000000000007";
    },
  }, { pollingIntervalMs: 1, retryCount: 0 });

  await expect(adapter.getStorageAt({
    address: "0x0000000000000000000000000000000000000001",
    slot: "0x0000000000000000000000000000000000000000000000000000000000000000",
  })).resolves.toBe("0x0000000000000000000000000000000000000000000000000000000000000007");
  expect(calls).toHaveLength(1);
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
bun test packages/rpc/src/rpc-adapter.test.ts --timeout 30000
```

Expected: FAIL because `getStorageAt` is not part of `RpcAdapter`.

- [ ] **Step 3: Implement RPC adapter method**

Modify `packages/rpc/src/index.ts`:

```ts
export type RpcPublicClientLike = {
  readonly getBalance: (input: { readonly address: Address }) => Promise<bigint>;
  readonly getStorageAt?: (input: { readonly address: Address; readonly slot: Hex; readonly blockTag?: RpcBlockTag }) => Promise<Hex | undefined>;
  readonly watchBlockNumber: (input: RpcWatchBlockNumberInput) => () => void;
  readonly watchContractEvent?: (input: RpcWatchContractEventInput) => () => void;
  readonly waitForTransactionReceipt: (input: { readonly hash: Hex }) => Promise<unknown>;
  readonly getTransactionReceipt: (input: { readonly hash: Hex }) => Promise<unknown>;
  readonly getTransaction: (input: { readonly hash: Hex }) => Promise<unknown>;
  readonly getBlock: (input: RpcGetBlockInput) => Promise<unknown>;
  readonly getLogs: (input: RpcGetLogsInput) => Promise<readonly unknown[]>;
};

export type RpcAdapter = {
  readonly getBalance: (address: string) => Promise<bigint>;
  readonly getStorageAt: (input: { readonly address: string; readonly slot: string; readonly blockTag?: RpcBlockTag }) => Promise<string>;
  readonly watchBlockNumber: (onBlockNumber: (blockNumber: bigint) => void) => () => void;
  readonly watchContractEvent: (input: Omit<RpcWatchContractEventInput, "address"> & { readonly address: string | readonly string[] }) => () => void;
  readonly waitForTransactionReceipt: (hash: string) => Promise<unknown>;
  readonly getTransactionReceipt: (hash: string) => Promise<unknown>;
  readonly getTransaction: (hash: string) => Promise<unknown>;
  readonly getBlock: (input?: RpcGetBlockInput) => Promise<unknown>;
  readonly getLogs: (input: RpcGetLogsInput) => Promise<readonly unknown[]>;
};
```

Add implementation:

```ts
getStorageAt: async (input) => {
  if (client.getStorageAt === undefined) {
    throw new Error("RPC client does not support getStorageAt.");
  }
  const value = await withRetry(
    () => client.getStorageAt?.({
      address: input.address as Address,
      slot: input.slot as Hex,
      ...(input.blockTag === undefined ? {} : { blockTag: input.blockTag }),
    }),
    retryOptions,
  );
  return value ?? "0x0000000000000000000000000000000000000000000000000000000000000000";
},
```

- [ ] **Step 4: Run RPC tests**

Run:

```bash
bun test packages/rpc/src/rpc-adapter.test.ts --timeout 30000
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rpc/src/index.ts packages/rpc/src/rpc-adapter.test.ts
git commit -m "feat: add storage reads to rpc adapter"
```

### Task 4: Key Book Persistence

**Files:**

- Create: `packages/core/src/project/state-key-book.ts`
- Modify: `packages/core/src/project/storage-state.test.ts`
- Modify: `packages/core/src/project/index.ts`

- [ ] **Step 1: Add failing Key Book tests**

Add to `packages/core/src/project/storage-state.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addStateKey,
  deleteStateKey,
  readStateKeyBook,
  stateKeyBookPath,
  writeStateKeyBook,
} from "./state-key-book";

test("persists Key Book entries under .consol/state-keys.json", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "consol-state-keys-"));
  try {
    const layoutId = "layout:abc123";
    const book = addStateKey(readStateKeyBook(projectRoot), {
      layoutId,
      target: "src/Counter.sol:Counter",
      contract: "Counter",
      key: { type: "address", value: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", label: "anvil0", enabled: true },
    });
    writeStateKeyBook(projectRoot, book);
    const saved = readStateKeyBook(projectRoot);
    expect(stateKeyBookPath(projectRoot)).toEndWith(join(".consol", "state-keys.json"));
    expect(saved.contracts[layoutId]?.keys).toHaveLength(1);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("deletes a Key Book entry without deleting the contract scope", () => {
  const layoutId = "layout:abc123";
  const book = addStateKey({ version: 1, contracts: {} }, {
    layoutId,
    target: "src/Counter.sol:Counter",
    contract: "Counter",
    key: { type: "uint256", value: "1", label: "token 1", enabled: true },
  });
  const next = deleteStateKey(book, { layoutId, type: "uint256", value: "1" });
  expect(next.contracts[layoutId]?.keys).toEqual([]);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
bun test packages/core/src/project/storage-state.test.ts --timeout 30000
```

Expected: FAIL because `state-key-book` does not exist.

- [ ] **Step 3: Implement Key Book persistence**

Create `packages/core/src/project/state-key-book.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writePrivateFile } from "../config/private-write";
import { ProjectError } from "./artifacts";

export type StateKeyBook = {
  readonly version: 1;
  readonly contracts: Readonly<Record<string, StateKeyBookContract>>;
};

export type StateKeyBookContract = {
  readonly target: string;
  readonly contract: string;
  readonly keys: readonly StateKeyBookEntry[];
  readonly tupleKeys: readonly StateTupleKeyBookEntry[];
};

export type StateKeyBookEntry = {
  readonly type: string;
  readonly value: string;
  readonly label: string | null;
  readonly enabled: boolean;
};

export type StateTupleKeyBookEntry = {
  readonly types: readonly string[];
  readonly values: readonly string[];
  readonly label: string | null;
  readonly enabled: boolean;
};

export function stateKeyBookPath(projectRoot: string): string {
  return join(projectRoot, ".consol", "state-keys.json");
}

export function readStateKeyBook(projectRoot: string): StateKeyBook {
  const path = stateKeyBookPath(projectRoot);
  if (!existsSync(path)) {
    return { version: 1, contracts: {} };
  }
  return normalizeStateKeyBook(parseStateKeyBook(path));
}

export function writeStateKeyBook(projectRoot: string, book: StateKeyBook): void {
  writePrivateFile(stateKeyBookPath(projectRoot), `${JSON.stringify(book, null, 2)}\n`);
}
```

Required helper behavior:

- Invalid JSON throws `ProjectError` with code `state_key_book_invalid`.
- Missing arrays normalize to empty arrays.
- `addStateKey` upserts by `layoutId + type + value`.
- `deleteStateKey` removes by `layoutId + type + value`.
- Tuple keys upsert/delete by `layoutId + types.join(",") + values.join("\u001f")`.

- [ ] **Step 4: Export and run tests**

Modify `packages/core/src/project/index.ts`:

```ts
export * from "./state-key-book";
```

Run:

```bash
bun test packages/core/src/project/storage-state.test.ts --timeout 30000
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/project/state-key-book.ts packages/core/src/project/storage-state.test.ts packages/core/src/project/index.ts
git commit -m "feat: persist state key book"
```

### Task 5: CLI Complex Storage Snapshot Builder

**Files:**

- Create: `packages/cli/src/commands/storage-state.ts`
- Create: `packages/cli/src/commands/storage-state.test.ts`
- Modify: `packages/cli/src/commands/interact.ts`
- Modify: `packages/cli/src/commands/activity.ts`
- Modify: `packages/cli/src/commands/dev-json.ts`

- [ ] **Step 1: Write failing storage snapshot tests**

Create `packages/cli/src/commands/storage-state.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { parseStorageLayoutJson, storageLayoutId } from "@consol/core";
import type { RpcAdapter } from "@consol/rpc";
import { createComplexStorageSnapshot } from "./storage-state";

function fakeRpc(words: Record<string, string>): RpcAdapter {
  return {
    getBalance: async () => 0n,
    getStorageAt: async ({ slot }) => words[slot.toLowerCase()] ?? `0x${"0".repeat(64)}`,
    watchBlockNumber: () => () => {},
    watchContractEvent: () => () => {},
    waitForTransactionReceipt: async () => ({}),
    getTransactionReceipt: async () => ({}),
    getTransaction: async () => ({}),
    getBlock: async () => ({}),
    getLogs: async () => [],
  };
}

describe("complex storage snapshot", () => {
  test("keeps mapping summary bounded to the preview limit", async () => {
    const layoutJson = JSON.stringify(mappingLayoutFixture());
    const layoutId = storageLayoutId(parseStorageLayoutJson(layoutJson));
    const snapshot = await createComplexStorageSnapshot({
      layoutJson,
      projectRoot: "/tmp/project",
      target: "src/Counter.sol:Counter",
      contract: "Counter",
      address: "0x0000000000000000000000000000000000000001",
      rpc: fakeRpc({}),
      keyBook: {
        version: 1,
        contracts: {
          [layoutId]: {
            target: "src/Counter.sol:Counter",
            contract: "Counter",
            keys: [
              { type: "address", value: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", label: "anvil0", enabled: true },
              { type: "address", value: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8", label: "anvil1", enabled: true },
              { type: "address", value: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc", label: "anvil2", enabled: true },
              { type: "address", value: "0x90f79bf6eb2c4f870365e785982e1f101e93b906", label: "anvil3", enabled: true },
            ],
            tupleKeys: [],
          },
        },
      },
      previewLimit: 3,
      mode: "summary",
    });

    const balances = snapshot.rows.find((row) => row.name === "balances");
    expect(balances?.kind).toBe("mapping");
    expect(balances?.checked).toBe(3);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
bun test packages/cli/src/commands/storage-state.test.ts --timeout 30000
```

Expected: FAIL because `storage-state` does not exist.

- [ ] **Step 3: Implement snapshot builder**

Create `packages/cli/src/commands/storage-state.ts` with exported types:

```ts
import {
  parseStorageLayoutJson,
  storageLayoutId,
  type StateKeyBook,
} from "@consol/core";
import type { RpcAdapter } from "@consol/rpc";

export type ComplexStorageSnapshot = {
  readonly layout_id: string;
  readonly rows: readonly ComplexStorageRow[];
  readonly hints: readonly string[];
};

export type ComplexStorageRow =
  | ComplexScalarRow
  | ComplexArrayRow
  | ComplexStructRow
  | ComplexMappingRow
  | ComplexErrorRow;
```

Required row fields:

```ts
type ComplexBaseRow = {
  readonly id: string;
  readonly kind: "scalar" | "array" | "struct" | "mapping" | "error";
  readonly name: string;
  readonly type_label: string;
  readonly summary: string;
  readonly detail_available: boolean;
};

type ComplexMappingRow = ComplexBaseRow & {
  readonly kind: "mapping";
  readonly checked: number;
  readonly non_default: number;
  readonly default_values_hidden: boolean;
  readonly entries: readonly {
    readonly label: string | null;
    readonly key: readonly string[];
    readonly readable: string;
    readonly raw: string;
    readonly default: boolean;
  }[];
};
```

Implementation rules:

- `mode: "summary"` uses `previewLimit` for mapping keys and array items.
- `mode: "detail"` reads all compatible enabled keys for the requested mapping row.
- No-argument ABI reader values stay outside this builder.
- Public scalar duplicates are filtered in Task 6 when ABI values and storage rows are merged.
- All storage read failures produce row-level error data instead of throwing the whole snapshot away.
- Use a small concurrency helper with a default concurrency of 16.

- [ ] **Step 4: Integrate into `state --json` as an additive field**

Modify `packages/cli/src/commands/interact.ts`:

```ts
export type StateData = {
  readonly contract: string;
  readonly address: string;
  readonly values: readonly StateValue[];
  readonly storage_values?: readonly ComplexStorageRow[];
  readonly storage_hints?: readonly string[];
  readonly storage_layout_id?: string | null;
};
```

In `runStateCommand`, after ABI no-arg reads, resolve network runtime and create the default RPC adapter. Add storage data as optional fields:

```ts
const complex = await maybeCreateComplexStorageState({
  context,
  input,
  address: context.address,
});

const data: StateData = {
  contract: context.resolved.contractName,
  address: context.address,
  values,
  ...(complex === null ? {} : {
    storage_values: complex.rows,
    storage_hints: complex.hints,
    storage_layout_id: complex.layout_id,
  }),
};
```

`maybeCreateComplexStorageState` must catch storage-layout/RPC failures and return a storage hint instead of failing existing ABI state reads.

- [ ] **Step 5: Pass additive state through activity/dev snapshots**

Modify `packages/cli/src/commands/activity.ts` return type:

```ts
readonly storage_values?: StateData["storage_values"];
readonly storage_hints?: StateData["storage_hints"];
readonly storage_layout_id?: string | null;
```

Copy those fields from `StateData` into activity state.

`packages/cli/src/commands/dev-json.ts` should not reshape these fields; it already passes `activity.state`.

- [ ] **Step 6: Run CLI tests**

Run:

```bash
bun test packages/cli/src/commands/storage-state.test.ts --timeout 30000
bun test packages/cli/src/main.test.ts --timeout 30000 --test-name-pattern "state --json"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/storage-state.ts packages/cli/src/commands/storage-state.test.ts packages/cli/src/commands/interact.ts packages/cli/src/commands/activity.ts packages/cli/src/commands/dev-json.ts
git commit -m "feat: add complex storage state snapshots"
```

### Task 6: Fake Foundry Fixtures And End-To-End State JSON Tests

**Files:**

- Modify: `packages/testkit/src/fake-foundry.ts`
- Modify: `packages/cli/src/main.test.ts`

- [ ] **Step 1: Add failing CLI behavior tests**

Add to `packages/cli/src/main.test.ts`:

```ts
test("state --json includes dynamic array storage previews", async () => {
  const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-array-state-")));
  writeProject(projectRoot, {
    "src/Counter.sol": `pragma solidity ^0.8.20;
contract Counter {
  uint256[] public numbers = [1, 2, 3, 4];
}`,
  });

  const result = await runCli(["--json", "--project", projectRoot, "state", "Counter", "--address", "0x0000000000000000000000000000000000000001"], {
    cwd: projectRoot,
    env: {},
  });

  expect(result.exitCode).toBe(0);
  const envelope = JSON.parse(result.stdout);
  expect(envelope.data.storage_values.some((row: Record<string, unknown>) => row.kind === "array" && row.name === "numbers")).toBe(true);
});
```

Add a second test for mapping rows without Key Book entries:

```ts
test("state --json reports mapping storage rows before keys are added", async () => {
  const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-cli-mapping-state-")));
  writeProject(projectRoot, {
    "src/Token.sol": `pragma solidity ^0.8.20;
contract Token {
  mapping(address => uint256) public balances;
}`,
  });

  const result = await runCli(["--json", "--project", projectRoot, "state", "Token", "--address", "0x0000000000000000000000000000000000000001"], {
    cwd: projectRoot,
    env: {},
  });

  expect(result.exitCode).toBe(0);
  const envelope = JSON.parse(result.stdout);
  expect(envelope.data.storage_values.some((row: Record<string, unknown>) => row.kind === "mapping" && row.name === "balances")).toBe(true);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
bun test packages/cli/src/main.test.ts --timeout 30000 --test-name-pattern "storage previews|mapping summaries"
```

Expected: FAIL because fake Foundry does not emit storage layout/storage RPC data for these cases.

- [ ] **Step 3: Extend fake Foundry storage layout support**

Modify `packages/testkit/src/fake-foundry.ts`:

- When invoked as `forge inspect ... storage-layout --json`, inspect the fake Solidity source.
- If source contains `uint256[] public numbers`, return a dynamic array layout with `numbers` at slot `0`.
- If source contains `mapping(address => uint256) public balances`, return mapping layout with `balances` at slot `0`.
- Keep existing fake ABI behavior unchanged.

Add storage RPC behavior in the fake command path used by state snapshots:

- Slot `0` for dynamic array length returns `4`.
- Array item slots return `1`, `2`, `3`, `4` for the first four items.
- Unknown mapping values return zero.

- [ ] **Step 4: Run focused tests**

Run:

```bash
bun test packages/cli/src/main.test.ts --timeout 30000 --test-name-pattern "storage previews|mapping summaries"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/testkit/src/fake-foundry.ts packages/cli/src/main.test.ts
git commit -m "test: cover complex state json snapshots"
```

### Task 7: TUI Runtime Types And State Row Rendering

**Files:**

- Create: `packages/tui/src/StateRows.tsx`
- Modify: `packages/tui/src/runtime-types.ts`
- Modify: `packages/tui/src/DevPanels.tsx`
- Modify: `packages/tui/src/DevPanels.test.tsx`

- [ ] **Step 1: Add failing DevPanels tests**

Add to `packages/tui/src/DevPanels.test.tsx`:

```ts
test("state details renders complex storage rows", async () => {
  const frame = await renderStateDetailsFrame({
    snapshot: {
      status: { status: "ready", message: "state loaded", hint: null },
      address: "0x0000000000000000000000000000000000000001",
      values: [],
      storageValues: [
        {
          id: "storage:numbers",
          kind: "array",
          name: "numbers",
          typeLabel: "uint256[]",
          summary: "len=4 [1, 2, 3, ...]",
          detailAvailable: true,
        },
        {
          id: "storage:balances",
          kind: "mapping",
          name: "balances",
          typeLabel: "mapping(address => uint256)",
          summary: "anvil0=100 (3 checked)",
          detailAvailable: true,
          checked: 3,
          nonDefault: 1,
          defaultValuesHidden: true,
        },
      ],
      storageHints: ["mapping default values hidden; Enter shows checked keys"],
    },
  });

  expect(frame).toContain("numbers");
  expect(frame).toContain("len=4");
  expect(frame).toContain("balances");
  expect(frame).toContain("mapping default values hidden");
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
bun test packages/tui/src/DevPanels.test.tsx --timeout 30000 --test-name-pattern "complex storage rows"
```

Expected: FAIL because `storageValues` is not in runtime types/rendering.

- [ ] **Step 3: Extend runtime types**

Modify `packages/tui/src/runtime-types.ts`:

```ts
export type DevStateSnapshot = {
  readonly status: {
    readonly status: string;
    readonly message: string | null;
    readonly hint: string | null;
  };
  readonly address: string | null;
  readonly details?: readonly DevStateDetailSnapshot[];
  readonly values: readonly DevStateValueSnapshot[];
  readonly storageValues?: readonly DevStorageStateRowSnapshot[];
  readonly storageHints?: readonly string[];
  readonly storageLayoutId?: string | null;
};

export type DevStorageStateRowSnapshot = {
  readonly id: string;
  readonly kind: "scalar" | "array" | "struct" | "mapping" | "error";
  readonly name: string;
  readonly typeLabel: string;
  readonly summary: string;
  readonly detailAvailable: boolean;
  readonly checked?: number;
  readonly nonDefault?: number;
  readonly defaultValuesHidden?: boolean;
  readonly error?: string | null;
};
```

- [ ] **Step 4: Implement StateRows renderer**

Create `packages/tui/src/StateRows.tsx`:

```tsx
import { theme } from "./theme";
import type { DevStorageStateRowSnapshot, DevStateValueSnapshot } from "./runtime-types";

export function StateAbiValueLine(props: {
  readonly value: DevStateValueSnapshot;
  readonly showRawValue: boolean;
  readonly rawLabel: string;
}) {
  const main = props.value.error === undefined || props.value.error === null
    ? `${props.value.name} ${props.value.readable ?? props.value.raw}`
    : `${props.value.name} ! ${props.value.error}`;
  const raw = props.showRawValue && props.value.raw.length > 0 ? ` raw: ${props.value.raw}` : "";
  return <text selectable fg={theme.color.text} content={`${main}${raw}`} wrapMode="word" />;
}

export function StateStorageRowLine(props: {
  readonly row: DevStorageStateRowSnapshot;
  readonly selected: boolean;
}) {
  const marker = props.selected ? "> " : "  ";
  const color = props.row.kind === "error" ? theme.color.danger : props.selected ? theme.color.accent : theme.color.text;
  return <text selectable fg={color} content={`${marker}${props.row.name} ${props.row.typeLabel} ${props.row.summary}`} wrapMode="word" />;
}
```

- [ ] **Step 5: Render storage rows in DevPanels**

Modify `packages/tui/src/DevPanels.tsx`:

- Keep existing ABI value rendering.
- Add storage rows after ABI values.
- Add storage hints below rows.
- Do not add selection logic yet; pass `selected={false}` in this task.

- [ ] **Step 6: Run focused TUI tests**

Run:

```bash
bun test packages/tui/src/DevPanels.test.tsx --timeout 30000 --test-name-pattern "complex storage rows"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/tui/src/StateRows.tsx packages/tui/src/runtime-types.ts packages/tui/src/DevPanels.tsx packages/tui/src/DevPanels.test.tsx
git commit -m "feat: render complex state rows"
```

### Task 8: Dev Snapshot Mapping For Storage Rows

**Files:**

- Modify: `packages/cli/src/commands/dev.ts`
- Modify: `packages/tui/src/DevShellController.test.tsx`

- [ ] **Step 1: Add failing dev snapshot transform test**

Add to `packages/tui/src/DevShellController.test.tsx` or `packages/cli/src/main.test.ts` depending on existing helpers:

```ts
test("dev state snapshot includes complex storage rows", async () => {
  const snapshots: unknown[] = [];
  await runCli(["dev", "Counter"], {
    cwd: projectRoot,
    env: {},
    launchTui: async ({ onStateSnapshotRequest, session, deployedContracts }) => {
      const snapshot = await onStateSnapshotRequest?.({
        session,
        deployedContract: deployedContracts[0] ?? null,
      });
      snapshots.push(snapshot);
    },
  });

  expect(JSON.stringify(snapshots[0])).toContain("storageValues");
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
bun test packages/cli/src/main.test.ts --timeout 30000 --test-name-pattern "complex storage rows"
```

Expected: FAIL until `devStateSnapshotFromUnknown` maps the new fields.

- [ ] **Step 3: Map storage fields**

Modify `packages/cli/src/commands/dev.ts`:

```ts
function devStateSnapshotFromUnknown(input: {
  readonly state: unknown;
  readonly deployment: unknown;
  readonly network: unknown;
  readonly account: unknown;
  readonly session: DevSession;
}): DevStateSnapshot {
  const record = recordFromUnknown(input.state);
  return {
    status: { ... },
    address: nullableStringFromUnknown(record?.["address"]) ?? deploymentAddress,
    details: stateDetailSnapshots(...),
    values: arrayFromUnknown(record?.["values"]).map(stateValueSnapshotFromUnknown),
    storageValues: arrayFromUnknown(record?.["storage_values"]).map(storageStateRowSnapshotFromUnknown),
    storageHints: arrayFromUnknown(record?.["storage_hints"]).flatMap(stringArrayItem),
    storageLayoutId: nullableStringFromUnknown(record?.["storage_layout_id"]),
  };
}
```

Add `storageStateRowSnapshotFromUnknown` and keep field names camelCase for TUI.

- [ ] **Step 4: Run tests**

Run:

```bash
bun test packages/cli/src/main.test.ts --timeout 30000 --test-name-pattern "complex storage rows"
bun test packages/tui/src/DevPanels.test.tsx --timeout 30000 --test-name-pattern "complex storage rows"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/dev.ts packages/cli/src/main.test.ts packages/tui/src/DevShellController.test.tsx
git commit -m "feat: pass complex state rows to dev tui"
```

### Task 9: State Panel Selection And Details

**Files:**

- Modify: `packages/tui/src/DevShellController.tsx`
- Modify: `packages/tui/src/DevShell.tsx`
- Modify: `packages/tui/src/DevPanels.tsx`
- Modify: `packages/tui/src/StateRows.tsx`
- Modify: `packages/tui/src/runtime-types.ts`
- Modify: `packages/tui/src/DevShellController.test.tsx`
- Modify: `packages/i18n/src/locales/en-US.ts`
- Modify: `packages/i18n/src/locales/zh-CN.ts`

- [ ] **Step 1: Add failing keyboard/detail tests**

Add to `packages/tui/src/DevShellController.test.tsx`:

```ts
test("state rows can be selected and opened", async () => {
  const harness = await renderDevShellController({
    stateSnapshot: {
      status: { status: "ready", message: "state loaded", hint: null },
      address: "0x0000000000000000000000000000000000000001",
      values: [],
      storageValues: [
        { id: "storage:numbers", kind: "array", name: "numbers", typeLabel: "uint256[]", summary: "len=4 [1, 2, 3, ...]", detailAvailable: true },
        { id: "storage:balances", kind: "mapping", name: "balances", typeLabel: "mapping(address => uint256)", summary: "3 checked", detailAvailable: true },
      ],
    },
  });

  await harness.press("Down");
  await harness.press("Return");
  expect(harness.frame()).toContain("numbers");
  expect(harness.frame()).toContain("details");
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
bun test packages/tui/src/DevShellController.test.tsx --timeout 30000 --test-name-pattern "state rows can be selected"
```

Expected: FAIL because State selection/detail modal does not exist.

- [ ] **Step 3: Add runtime detail request types**

Modify `packages/tui/src/runtime-types.ts`:

```ts
export type DevStateDetailRequest = {
  readonly session: DevSession;
  readonly deployedContract: DevDeployedContract;
  readonly rowId: string;
  readonly showDefaults: boolean;
};

export type DevStateDetailSnapshot = {
  readonly rowId: string;
  readonly title: string;
  readonly lines: readonly string[];
  readonly copyValue: string | null;
};

export type DevStateDetailHandler = (
  request: DevStateDetailRequest,
) => DevStateDetailSnapshot | Promise<DevStateDetailSnapshot | void> | void;
```

- [ ] **Step 4: Add selection state in controller**

In `packages/tui/src/DevShellController.tsx`:

- Add `selectedStateRowId` signal.
- Derive a flat list from `snapshot.values` plus `snapshot.storageValues`.
- `Up`/`Down` moves selection only when State panel has focus.
- `Enter` opens detail for selected row.
- Keep selected id stable across refresh if the same row id still exists.

- [ ] **Step 5: Render detail modal**

In `packages/tui/src/StateRows.tsx`, add:

```tsx
export function StateDetailModal(props: {
  readonly title: string;
  readonly lines: readonly string[];
  readonly onClose: () => void;
}) {
  return (
    <box width="100%" height="100%" flexDirection="column">
      <text fg={theme.color.accent} content={props.title} />
      <scrollbox width="100%" height="100%" scrollY contentOptions={{ flexDirection: "column" }}>
        {props.lines.map((line) => <text selectable fg={theme.color.text} content={line} wrapMode="word" />)}
      </scrollbox>
    </box>
  );
}
```

Use the existing project modal style if there is already a shared modal wrapper.

- [ ] **Step 6: Add i18n copy**

Add keys:

```ts
"tui.state.detail.title": "State details",
"tui.state.shortcut.select": "select",
"tui.state.shortcut.details": "details",
"tui.state.mapping.defaultsHidden": "mapping default values hidden; Enter shows checked keys",
```

Chinese:

```ts
"tui.state.detail.title": "状态详情",
"tui.state.shortcut.select": "选择",
"tui.state.shortcut.details": "详情",
"tui.state.mapping.defaultsHidden": "mapping 默认值已隐藏；Enter 查看已检查的 key",
```

- [ ] **Step 7: Run TUI tests**

Run:

```bash
bun test packages/tui/src/DevShellController.test.tsx --timeout 30000 --test-name-pattern "state rows can be selected"
bun run check:i18n
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/tui/src/DevShellController.tsx packages/tui/src/DevShell.tsx packages/tui/src/DevPanels.tsx packages/tui/src/StateRows.tsx packages/tui/src/runtime-types.ts packages/tui/src/DevShellController.test.tsx packages/i18n/src/locales/en-US.ts packages/i18n/src/locales/zh-CN.ts
git commit -m "feat: add selectable state details"
```

### Task 10: Key Book TUI Actions

**Files:**

- Create: `packages/tui/src/StateKeyBookModal.tsx`
- Modify: `packages/tui/src/runtime-types.ts`
- Modify: `packages/tui/src/DevShellController.tsx`
- Modify: `packages/tui/src/DevShell.tsx`
- Modify: `packages/cli/src/commands/dev.ts`
- Modify: `packages/tui/src/DevShellController.test.tsx`
- Modify: `packages/i18n/src/locales/en-US.ts`
- Modify: `packages/i18n/src/locales/zh-CN.ts`

- [ ] **Step 1: Add failing Key Book action test**

Add to `packages/tui/src/DevShellController.test.tsx`:

```ts
test("state mapping detail can open add key modal", async () => {
  const keyChanges: unknown[] = [];
  const harness = await renderDevShellController({
    stateSnapshot: {
      status: { status: "ready", message: "state loaded", hint: null },
      address: "0x0000000000000000000000000000000000000001",
      values: [],
      storageValues: [
        { id: "storage:balances", kind: "mapping", name: "balances", typeLabel: "mapping(address => uint256)", summary: "3 checked", detailAvailable: true },
      ],
      storageLayoutId: "layout:abc123",
    },
    onStateKeyBookChange: (change) => keyChanges.push(change),
  });

  await harness.press("Return");
  await harness.press("a");
  expect(harness.frame()).toContain("Add key");
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
bun test packages/tui/src/DevShellController.test.tsx --timeout 30000 --test-name-pattern "add key modal"
```

Expected: FAIL because Key Book actions do not exist.

- [ ] **Step 3: Add runtime action types**

Modify `packages/tui/src/runtime-types.ts`:

```ts
export type DevStateKeyBookChange =
  | {
      readonly action: "add_key";
      readonly layoutId: string;
      readonly target: string;
      readonly contract: string;
      readonly key: { readonly type: string; readonly value: string; readonly label: string | null; readonly enabled: boolean };
    }
  | {
      readonly action: "delete_key";
      readonly layoutId: string;
      readonly type: string;
      readonly value: string;
    }
  | {
      readonly action: "set_key_enabled";
      readonly layoutId: string;
      readonly type: string;
      readonly value: string;
      readonly enabled: boolean;
    };

export type DevStateKeyBookChangeHandler = (
  change: DevStateKeyBookChange,
) => void | Promise<void>;
```

- [ ] **Step 4: Implement modal**

Create `packages/tui/src/StateKeyBookModal.tsx` with:

- type display;
- key input;
- optional label input;
- save/cancel actions;
- validation for empty key;
- copy consistent with existing input modal styling.

- [ ] **Step 5: Wire CLI persistence**

Modify `packages/cli/src/commands/dev.ts`:

- Add `onStateKeyBookChange` handler to `runDevShell` input.
- Use `readStateKeyBook`, `addStateKey`, `deleteStateKey`, and `writeStateKeyBook`.
- Refresh state snapshot after a successful change.
- Surface persistence errors in Feed instead of crashing the TUI.

- [ ] **Step 6: Add i18n copy**

Add keys:

```ts
"tui.state.keyBook.add": "Add key",
"tui.state.keyBook.key": "key",
"tui.state.keyBook.label": "label",
"tui.state.keyBook.save": "save",
"tui.state.keyBook.delete": "delete key",
```

Chinese:

```ts
"tui.state.keyBook.add": "添加 key",
"tui.state.keyBook.key": "key",
"tui.state.keyBook.label": "标签",
"tui.state.keyBook.save": "保存",
"tui.state.keyBook.delete": "删除 key",
```

- [ ] **Step 7: Run tests**

Run:

```bash
bun test packages/tui/src/DevShellController.test.tsx --timeout 30000 --test-name-pattern "add key modal"
bun run check:i18n
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/tui/src/StateKeyBookModal.tsx packages/tui/src/runtime-types.ts packages/tui/src/DevShellController.tsx packages/tui/src/DevShell.tsx packages/cli/src/commands/dev.ts packages/tui/src/DevShellController.test.tsx packages/i18n/src/locales/en-US.ts packages/i18n/src/locales/zh-CN.ts
git commit -m "feat: manage state key book in tui"
```

### Task 11: Detail Reads For Full Arrays And Mapping Keys

**Files:**

- Modify: `packages/cli/src/commands/storage-state.ts`
- Modify: `packages/cli/src/commands/dev.ts`
- Modify: `packages/tui/src/runtime-types.ts`
- Modify: `packages/tui/src/DevShellController.tsx`
- Modify: `packages/tui/src/DevShellController.test.tsx`
- Modify: `packages/cli/src/commands/storage-state.test.ts`

- [ ] **Step 1: Add failing detail read tests**

Add to `packages/cli/src/commands/storage-state.test.ts`:

```ts
test("detail mode reads all compatible mapping keys", async () => {
  const snapshot = await createComplexStorageSnapshot({
    layoutJson: JSON.stringify(mappingLayoutFixture()),
    projectRoot: "/tmp/project",
    target: "src/Token.sol:Token",
    contract: "Token",
    address: "0x0000000000000000000000000000000000000001",
    rpc: fakeRpc({}),
    keyBook: keyBookWithAddressCount(5),
    previewLimit: 3,
    mode: "detail",
    rowId: "storage:balances",
    showDefaults: true,
  });

  const row = snapshot.rows.find((item) => item.name === "balances");
  expect(row?.kind).toBe("mapping");
  expect(row && "checked" in row ? row.checked : 0).toBe(5);
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
bun test packages/cli/src/commands/storage-state.test.ts --timeout 30000 --test-name-pattern "detail mode"
```

Expected: FAIL because detail mode is not complete.

- [ ] **Step 3: Implement detail handler in CLI**

Modify `packages/cli/src/commands/dev.ts`:

- Add `onStateDetailRequest`.
- Resolve storage layout and Key Book for the selected deployed contract.
- Call `createComplexStorageSnapshot` with `mode: "detail"`, `rowId`, and `showDefaults`.
- Return `DevStateDetailSnapshot` with `title`, `lines`, and `copyValue`.

- [ ] **Step 4: Implement detail rendering behavior**

Modify `packages/tui/src/DevShellController.tsx`:

- When `Enter` opens a storage row, request details from `onStateDetailRequest`.
- Show existing row summary immediately while loading details.
- Replace modal content when details arrive.
- Ignore detail responses if selected row or deployed contract changed.

- [ ] **Step 5: Run focused tests**

Run:

```bash
bun test packages/cli/src/commands/storage-state.test.ts --timeout 30000 --test-name-pattern "detail mode"
bun test packages/tui/src/DevShellController.test.tsx --timeout 30000 --test-name-pattern "state rows can be selected"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/storage-state.ts packages/cli/src/commands/dev.ts packages/tui/src/runtime-types.ts packages/tui/src/DevShellController.tsx packages/tui/src/DevShellController.test.tsx packages/cli/src/commands/storage-state.test.ts
git commit -m "feat: load full state details on demand"
```

### Task 12: Final Verification And Package Smoke

**Files:**

- Modify if needed: `docs/product/DEV_TUI_COMPLEX_STATE_PANEL.md`

- [ ] **Step 1: Run full verification**

Run:

```bash
bun run check
bun test --timeout 30000
```

Expected: PASS.

- [ ] **Step 2: Build package**

Run:

```bash
bun run package:build
bun run package:smoke
```

Expected:

- `dist/consol` exists.
- Smoke reports version, doctor, and dev checks passing.

- [ ] **Step 3: Manual local fixture check**

Create or use a temporary Foundry project with:

```solidity
pragma solidity ^0.8.20;

contract ComplexStateDemo {
    uint256[] public numbers = [1, 2, 3, 4];
    mapping(address => uint256) public balances;

    struct User {
        uint256 id;
        address owner;
        bool active;
    }

    User public user = User(1, address(0x1234), true);
}
```

Run:

```bash
dist/consol dev ComplexStateDemo
```

Expected:

- State panel shows `numbers` as an array row.
- State panel shows `user` as a struct row.
- Adding an address key lets the mapping row check that key.
- `Enter` opens details for array/struct/mapping rows.

- [ ] **Step 4: Commit verification doc changes if any**

If Task 12 changes docs, commit:

```bash
git add docs/product/DEV_TUI_COMPLEX_STATE_PANEL.md
git commit -m "docs: clarify complex state panel behavior"
```

## Self-Review

Spec coverage:

- Arrays: Task 2 slot/decode, Task 5 snapshot rows, Task 11 details.
- Structs: Task 2 slot/decode, Task 5 snapshot rows, Task 9 details.
- Mappings: Task 4 Key Book, Task 5 bounded summaries, Task 10 Key Book UI, Task 11 full detail reads.
- Performance limits: Task 5 snapshot builder and Task 11 on-demand details.
- TUI selection/details: Tasks 7, 9, 10, 11.
- Package boundaries: Tasks keep storage planning in core, RPC in rpc, assembly in cli, rendering in tui.

Incomplete-marker scan:

- The plan contains no incomplete-work markers.
- Every implementation task has concrete files, tests, commands, and expected results.

Type consistency:

- CLI JSON uses snake_case additive fields: `storage_values`, `storage_hints`, `storage_layout_id`.
- TUI runtime uses camelCase fields: `storageValues`, `storageHints`, `storageLayoutId`.
- Key Book file uses JSON fields `keys` and `tupleKeys` in core types; persisted JSON may keep `tuple_keys` only if the implementation explicitly normalizes both names. Prefer `tupleKeys` for new local state.

## Execution Choice

Recommended execution: subagent-driven task execution with review after each task. The tasks are separable and touch different layers, so fresh context per task reduces cross-layer mistakes.
