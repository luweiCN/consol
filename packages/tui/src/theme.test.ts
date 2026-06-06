import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { theme } from "./theme";

const themeSource = readFileSync(new URL("./theme.ts", import.meta.url), "utf8");
const selectionBackgroundConsumers = [
  "./DevPanels.tsx",
  "./DevShell.tsx",
  "./PickerActionMenu.tsx",
  "./SelectorModal.tsx",
  "./StateRows.tsx",
] as const;

describe("theme", () => {
  test("uses ANSI palette slots instead of fixed truecolor hex values", () => {
    expect(themeSource).not.toMatch(/#[0-9A-Fa-f]{6}/);
    expect(themeSource).toContain("RGBA.fromIndex");
    expect(themeSource).toContain("ANSI_SLOT");

    for (const [name, color] of Object.entries(theme.color)) {
      if (!(color instanceof RGBA)) {
        throw new TypeError(`${name} must be an OpenTUI RGBA color`);
      }
      expect(color.intent).toBe("indexed");
      expect(color.slot).toBeGreaterThanOrEqual(0);
      expect(color.slot).toBeLessThanOrEqual(15);
    }
  });

  test("does not define default background palette slots", () => {
    expect(theme.color).not.toHaveProperty("bg");
    expect(theme.color).not.toHaveProperty("surface");
    expect(theme.color).not.toHaveProperty("surfaceRaised");
    expect(theme.color).not.toHaveProperty("selectionBg");
    expect(theme.color).not.toHaveProperty("buttonBg");
    expect(theme.color).not.toHaveProperty("scrollbarTrack");
  });

  test("uses the terminal default background only for overlays", () => {
    expect(theme.background.overlay).toBeInstanceOf(RGBA);
    expect(theme.background.overlay.intent).toBe("default");
  });

  test("uses an ANSI palette slot for selected row backgrounds", () => {
    expect(theme.background.selection).toBeInstanceOf(RGBA);
    expect(theme.background.selection.intent).toBe("indexed");
    expect(theme.background.selection.slot).toBe(8);
  });

  test("keeps selected row backgrounds on text spans instead of layout containers", () => {
    for (const file of selectionBackgroundConsumers) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toContain("backgroundColor: theme.background.selection");
      expect(source).not.toContain("backgroundColor={theme.background.selection");
    }
  });
});
