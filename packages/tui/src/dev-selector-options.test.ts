import { describe, expect, test } from "bun:test";
import { createTranslator } from "@consol/i18n";
import { declarationKindLabel, declarationKindPart, deployedContractAgeLabel, deployedDetailParts, deployedTitleParts, selectorOpeners } from "./dev-selector-options";
import type { DevDeployedContract } from "./runtime-types";

const contract = {
  id: "local:Counter:0x000000000000000000000000000000000000c0fe",
  contract: "Counter",
  kind: "contract",
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

  test("uses f for source selection and c for deployed contract selection", () => {
    expect(selectorOpeners("source")).toEqual(["f"]);
    expect(selectorOpeners("deployed")).toEqual(["c"]);
  });

  test("formats deployed contract ages as compact relative labels", () => {
    expect(deployedContractAgeLabel(1_000, 1_001, "zh-CN")).toBe("1秒前");
    expect(deployedContractAgeLabel(1_000, 1_125, "zh-CN")).toBe("2分钟前");
    expect(deployedContractAgeLabel(1_000, 8_300, "zh-CN")).toBe("2小时前");
    expect(deployedContractAgeLabel(1_000, 1_001, "en-US")).toBe("1s ago");
  });

  test("puts deployed contract age beside the contract title instead of the address", () => {
    const title = deployedTitleParts(contract, 1_001, "zh-CN").map((part) => part.text).join("");
    const detail = deployedDetailParts(contract).map((part) => part.text).join("");

    expect(title).toContain("Counter");
    expect(title).toContain("1秒前");
    expect(detail).toContain("0x000000...00c0fe");
    expect(detail).not.toContain("秒前");
  });

  test("updates deployed contract title age text when now changes", () => {
    const first = deployedTitleParts(contract, 1_001, "zh-CN").map((part) => part.text).join("");
    const next = deployedTitleParts(contract, 1_003, "zh-CN").map((part) => part.text).join("");

    expect(first).toContain("1秒前");
    expect(next).toContain("3秒前");
  });

  test("deployedTitleParts shows the deployment kind", () => {
    const libContract = { ...contract, kind: "library" } as const satisfies DevDeployedContract;
    const title = deployedTitleParts(libContract, 1_001, "en-US", createTranslator("en-US")).map((part) => part.text).join("");
    expect(title).toContain("library");
  });
});
