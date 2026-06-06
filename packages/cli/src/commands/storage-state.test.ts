import { parseStorageLayoutJson, storageLayoutId, type StateKeyBook } from "@consol/core";
import type { RpcAdapter } from "@consol/rpc";
import { describe, expect, test } from "bun:test";
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
      keyBook: keyBookWithAddressCount(layoutId, 4),
      previewLimit: 3,
      mode: "summary",
    });

    const balances = snapshot.rows.find((row) => row.name === "balances");
    expect(balances?.kind).toBe("mapping");
    expect(balances?.checked).toBe(3);
  });

  test("detail mode reads all compatible mapping keys", async () => {
    const layoutJson = JSON.stringify(mappingLayoutFixture());
    const layoutId = storageLayoutId(parseStorageLayoutJson(layoutJson));
    const snapshot = await createComplexStorageSnapshot({
      layoutJson,
      projectRoot: "/tmp/project",
      target: "src/Counter.sol:Counter",
      contract: "Counter",
      address: "0x0000000000000000000000000000000000000001",
      rpc: fakeRpc({}),
      keyBook: keyBookWithAddressCount(layoutId, 5),
      previewLimit: 3,
      mode: "detail",
      rowId: "storage:balances",
      showDefaults: true,
    });

    const balances = snapshot.rows.find((row) => row.name === "balances");
    expect(snapshot.rows).toHaveLength(1);
    expect(balances?.kind).toBe("mapping");
    expect(balances?.checked).toBe(5);
    expect(balances?.entries).toHaveLength(5);
  });

  test("detail mode keeps key book entries when mapping defaults are hidden", async () => {
    const layoutJson = JSON.stringify(mappingLayoutFixture());
    const layoutId = storageLayoutId(parseStorageLayoutJson(layoutJson));
    const snapshot = await createComplexStorageSnapshot({
      layoutJson,
      projectRoot: "/tmp/project",
      target: "src/Counter.sol:Counter",
      contract: "Counter",
      address: "0x0000000000000000000000000000000000000001",
      rpc: fakeRpc({}),
      keyBook: keyBookWithAddressCount(layoutId, 2),
      previewLimit: 3,
      mode: "detail",
      rowId: "storage:balances",
    });

    const balances = snapshot.rows.find((row) => row.name === "balances");
    expect(balances?.kind).toBe("mapping");
    expect(balances?.entries).toHaveLength(0);
    expect(balances?.key_book_entries).toHaveLength(2);
  });

  test("ignores incompatible persisted mapping keys before planning storage reads", async () => {
    const layoutJson = JSON.stringify(mappingLayoutFixture());
    const layoutId = storageLayoutId(parseStorageLayoutJson(layoutJson));
    const keyBook = keyBookWithAddressCount(layoutId, 1);
    const snapshot = await createComplexStorageSnapshot({
      layoutJson,
      projectRoot: "/tmp/project",
      target: "src/Counter.sol:Counter",
      contract: "Counter",
      address: "0x0000000000000000000000000000000000000001",
      rpc: fakeRpc({}),
      keyBook: {
        ...keyBook,
        contracts: {
          [layoutId]: {
            ...keyBook.contracts[layoutId]!,
            keys: [
              ...keyBook.contracts[layoutId]!.keys,
              { type: "address", value: "eeeee", label: "bad", enabled: true },
            ],
          },
        },
      },
      previewLimit: 3,
      mode: "detail",
      rowId: "storage:balances",
      showDefaults: true,
    });

    const balances = snapshot.rows.find((row) => row.name === "balances");
    expect(balances?.kind).toBe("mapping");
    expect(balances?.checked).toBe(1);
    expect(balances?.error).toBeUndefined();
    expect(balances?.entries).toHaveLength(1);
    expect(balances?.key_book_entries).toEqual([
      expect.objectContaining({ key_type: "address", key: ["0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"], label: "anvil0" }),
      expect.objectContaining({ key_type: "address", key: ["eeeee"], label: "bad" }),
    ]);
  });
});

function keyBookWithAddressCount(layoutId: string, count: number): StateKeyBook {
  const addresses = [
    "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
    "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
    "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
    "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
  ].slice(0, count);

  return {
    version: 1,
    contracts: {
      [layoutId]: {
        target: "src/Counter.sol:Counter",
        contract: "Counter",
        keys: addresses.map((value, index) => ({
          type: "address",
          value,
          label: `anvil${index}`,
          enabled: true,
        })),
        tupleKeys: [],
      },
    },
  };
}

function mappingLayoutFixture() {
  return {
    storage: [
      { astId: 1, contract: "src/Counter.sol:Counter", label: "balances", offset: 0, slot: "0", type: "t_mapping(t_address,t_uint256)" },
    ],
    types: {
      "t_mapping(t_address,t_uint256)": {
        encoding: "mapping",
        key: "t_address",
        label: "mapping(address => uint256)",
        numberOfBytes: "32",
        value: "t_uint256",
      },
      t_address: { encoding: "inplace", label: "address", numberOfBytes: "20" },
      t_uint256: { encoding: "inplace", label: "uint256", numberOfBytes: "32" },
    },
  };
}
