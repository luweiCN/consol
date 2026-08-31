import { describe, expect, test } from "bun:test";
import {
  functionAbiJson,
  functionHumanReadableAbi,
  functionSelector,
  itemSignature,
  parseFunctionItem,
} from "./abi";

describe("ABI parsing", () => {
  test("tuple params are rendered as canonical ABI types", () => {
    expect(
      itemSignature({
        type: "function",
        name: "add",
        inputs: [
          {
            name: "profile",
            type: "tuple",
            components: [
              { name: "name", type: "string" },
              { name: "score", type: "uint256" },
            ],
          },
        ],
      }),
    ).toBe("add((string,uint256))");
  });

  test("tuple array params keep array suffixes", () => {
    expect(
      itemSignature({
        type: "function",
        name: "addMany",
        inputs: [
          {
            name: "profiles",
            type: "tuple[]",
            components: [
              { name: "owner", type: "address" },
              { name: "scores", type: "uint256[]" },
            ],
          },
        ],
      }),
    ).toBe("addMany((address,uint256[])[])");
  });

  test("classifies ABI functions for the dev cockpit", () => {
    expect(parseFunctionItem({ type: "function", name: "number", stateMutability: "view", inputs: [], outputs: [] })).toMatchObject({
      name: "number",
      kind: "read",
    });
    expect(parseFunctionItem({ type: "function", name: "setNumber", stateMutability: "nonpayable", inputs: [], outputs: [] })).toMatchObject({
      name: "setNumber",
      kind: "write",
    });
    expect(parseFunctionItem({ type: "function", name: "buy", stateMutability: "payable", inputs: [], outputs: [] })).toMatchObject({
      name: "buy",
      kind: "payable",
    });
  });

  test("derives frontend-ready function metadata from the canonical function model", () => {
    const functionItem = parseFunctionItem({
      type: "function",
      name: "transfer",
      stateMutability: "nonpayable",
      inputs: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
      ],
      outputs: [{ name: "success", type: "bool" }],
    });

    expect(functionSelector(functionItem)).toBe("0xa9059cbb");
    expect(functionHumanReadableAbi(functionItem)).toBe("function transfer(address to, uint256 value) returns (bool success)");
    expect(JSON.parse(functionAbiJson(functionItem))).toEqual([{
      type: "function",
      inputs: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
      ],
      name: "transfer",
      outputs: [{ name: "success", type: "bool" }],
      stateMutability: "nonpayable",
    }]);
  });

  test("function ABI JSON preserves tuple component structure", () => {
    const functionItem = parseFunctionItem({
      type: "function",
      name: "save",
      stateMutability: "payable",
      inputs: [{
        name: "profile",
        type: "tuple",
        components: [
          { name: "owner", type: "address" },
          { name: "score", type: "uint256" },
        ],
      }],
      outputs: [],
    });
    const abi = JSON.parse(functionAbiJson(functionItem)) as readonly [{ readonly inputs: readonly [{ readonly type: string; readonly components: readonly unknown[] }] }];

    expect(abi[0].inputs[0].type).toBe("tuple");
    expect(abi[0].inputs[0].components).toHaveLength(2);
    expect(functionHumanReadableAbi(functionItem)).toBe("function save((address,uint256) profile) payable");
  });
});
