import { describe, expect, test } from "bun:test";
import { deployedContractAgeLabel, deployedDetailParts } from "./dev-selector-options";
import type { DevDeployedContract } from "./runtime-types";

const contract = {
  id: "local:Counter:0x000000000000000000000000000000000000c0fe",
  contract: "Counter",
  address: "0x000000000000000000000000000000000000c0fe",
  target: "src/Counter.sol:Counter",
  sourceFile: "src/Counter.sol",
  network: "local",
  chainId: "31337",
  networkFingerprint: "local:31337:localhost",
  account: "anvil0",
  deployTxHash: `0x${"2".repeat(64)}`,
  status: "ready",
  constructorArgs: [],
  value: null,
  abiSummary: {
    functions: 2,
    events: 0,
    errors: 0,
    constructor: false,
  },
  constructor: null,
  functions: [],
  createdAtUnix: 1_000,
} as const satisfies DevDeployedContract;

describe("dev selector options", () => {
  test("formats deployed contract ages as compact relative labels", () => {
    expect(deployedContractAgeLabel(1_000, 1_001, "zh-CN")).toBe("1秒前");
    expect(deployedContractAgeLabel(1_000, 1_125, "zh-CN")).toBe("2分钟前");
    expect(deployedContractAgeLabel(1_000, 8_300, "zh-CN")).toBe("2小时前");
    expect(deployedContractAgeLabel(1_000, 1_001, "en-US")).toBe("1s ago");
  });

  test("updates deployed contract detail text when now changes", () => {
    const first = deployedDetailParts(contract, 1_001, "zh-CN").map((part) => part.text).join("");
    const next = deployedDetailParts(contract, 1_003, "zh-CN").map((part) => part.text).join("");

    expect(first).toContain("1秒前");
    expect(next).toContain("3秒前");
  });
});
