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
