import { expect, test } from "bun:test";
import { terminalCellWidth, wrapTerminalText } from "./terminal-width";

test("terminalCellWidth treats CJK as two cells and Nerd Font glyphs as one", () => {
  expect(terminalCellWidth("A")).toBe(1);
  expect(terminalCellWidth("中")).toBe(2);
  expect(terminalCellWidth("")).toBe(1);
  expect(terminalCellWidth(" 开发")).toBe(6);
});

test("wrapTerminalText preserves every character and applies a continuation indent", () => {
  expect(wrapTerminalText("[WRITE] transferFrom(address,address,uint256)", 20, "  ")).toEqual([
    "[WRITE] transferFrom",
    "  (address,address,u",
    "  int256)",
  ]);
  expect(wrapTerminalText("参数：from:address,to:address", 18, "    ")).toEqual([
    "参数：from:address",
    "    ,to:address",
  ]);
});
