import { describe, expect, test } from "bun:test";
import { itemSignature, parseFunctionItem } from "./abi";

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
});
