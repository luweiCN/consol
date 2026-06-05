import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseStorageLayoutJson,
  storageLayoutId,
  storageType,
  storageVariables,
} from "./storage-layout";
import { decodeStorageWord, isDefaultDecodedStorageValue } from "./storage-decode";
import { arrayElementSlot, mappingValueSlot, planStorageSummaryReads } from "./storage-slots";
import {
  addStateKey,
  deleteStateKey,
  readStateKeyBook,
  stateKeyBookPath,
  writeStateKeyBook,
} from "./state-key-book";

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

  test("decodes elementary storage words", () => {
    expect(decodeStorageWord({ typeLabel: "uint256", numberOfBytes: 32, word: `0x${"0".repeat(63)}7` }).readable).toBe("7");
    expect(decodeStorageWord({ typeLabel: "bool", numberOfBytes: 1, word: `0x${"0".repeat(63)}1` }).readable).toBe("true");
    expect(
      decodeStorageWord({
        typeLabel: "address",
        numberOfBytes: 20,
        word: `0x${"0".repeat(24)}f39fd6e51aad88f6f4ce6ab8827279cfffb92266`,
      }).readable,
    ).toBe("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
  });

  test("detects default decoded values", () => {
    expect(isDefaultDecodedStorageValue(decodeStorageWord({ typeLabel: "uint256", numberOfBytes: 32, word: `0x${"0".repeat(64)}` }))).toBe(true);
    expect(isDefaultDecodedStorageValue(decodeStorageWord({ typeLabel: "bool", numberOfBytes: 1, word: `0x${"0".repeat(63)}1` }))).toBe(false);
  });

  test("plans bounded summary reads for mappings", () => {
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
    expect(mappingValueSlot({
      baseSlot: "2",
      keyType: "address",
      keyValue: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    })).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("persists Key Book entries under .consol/state-keys.json", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "consol-state-keys-"));
    try {
      const layoutId = "layout:abc123";
      const book = addStateKey(readStateKeyBook(projectRoot), {
        layoutId,
        target: "src/Counter.sol:Counter",
        contract: "Counter",
        key: {
          type: "address",
          value: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          label: "anvil0",
          enabled: true,
        },
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
});
