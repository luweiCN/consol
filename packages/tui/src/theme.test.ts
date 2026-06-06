import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { theme } from "./theme";

const themeSource = readFileSync(new URL("./theme.ts", import.meta.url), "utf8");

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

  test("keeps large UI backgrounds on neutral ANSI slots", () => {
    const largeBackgroundColors = {
      bg: theme.color.bg,
      surface: theme.color.surface,
      surfaceRaised: theme.color.surfaceRaised,
      selectionBg: theme.color.selectionBg,
      buttonBg: theme.color.buttonBg,
      scrollbarTrack: theme.color.scrollbarTrack,
    } as const;

    for (const [name, color] of Object.entries(largeBackgroundColors)) {
      expect(color.intent, name).toBe("indexed");
      expect([0, 8], name).toContain(color.slot);
    }
  });
});
