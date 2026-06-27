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
