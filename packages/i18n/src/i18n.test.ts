import { describe, expect, test } from "bun:test";
import {
  createTranslator,
  normalizeLocale,
  resolveLocale,
} from "./index";

describe("ConSol i18n", () => {
  test("configured UI language wins over environment variables", () => {
    expect(
      resolveLocale({
        configuredLanguage: "zh-CN",
        env: { CONSOL_LANG: "en-US" },
      }),
    ).toBe("zh-CN");
  });

  test("system falls back to locale environment variables", () => {
    expect(
      resolveLocale({
        configuredLanguage: "system",
        env: { CONSOL_LANG: "zh_CN.UTF-8" },
      }),
    ).toBe("zh-CN");
  });

  test("normalizes common locale spellings", () => {
    expect(normalizeLocale("zh_CN.UTF-8")).toBe("zh-CN");
    expect(normalizeLocale("en_US.UTF-8")).toBe("en-US");
  });

  test("formats placeholders", () => {
    const t = createTranslator("en-US");
    expect(t("dev.status.ready", { target: "Counter" })).toBe("Counter ready");
  });
});
