import { describe, expect, test } from "bun:test";
import {
  parseStorageLayoutJson,
  storageLayoutId,
  storageType,
  storageVariables,
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
