import { catalogs, type Locale, type LocalePreference, type MessageKey } from "./catalog";

export type { Locale, LocalePreference, MessageKey } from "./catalog";
export { catalogs } from "./catalog";

const ENV_LOCALE_KEYS = ["CONSOL_LANG", "LANGUAGE", "LC_ALL", "LC_MESSAGES", "LANG"] as const;

export type LocaleResolutionInput = {
  readonly configuredLanguage?: string | null;
  readonly env?: Readonly<Record<string, string | undefined>>;
};

export function normalizeLocale(value: string | null | undefined): LocalePreference | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalized = trimmed.split(/[.@]/)[0]?.replace("_", "-").toLowerCase();

  if (normalized === "system") {
    return "system";
  }

  if (normalized === "zh" || normalized?.startsWith("zh-")) {
    return "zh-CN";
  }

  if (normalized === "en" || normalized?.startsWith("en-")) {
    return "en-US";
  }

  return undefined;
}

export function resolveLocale(input: LocaleResolutionInput = {}): Locale {
  const configured = normalizeLocale(input.configuredLanguage);
  if (configured && configured !== "system") {
    return configured;
  }

  for (const key of ENV_LOCALE_KEYS) {
    const candidate = normalizeLocale(input.env?.[key]);
    if (candidate && candidate !== "system") {
      return candidate;
    }
  }

  return "en-US";
}

export function createTranslator(locale: Locale): (key: MessageKey, values?: Record<string, string | number>) => string {
  const catalog = catalogs[locale];

  return (key, values = {}) => {
    const message = catalog[key];
    return message.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (placeholder, name: string) => {
      const value = values[name];
      return value === undefined ? placeholder : String(value);
    });
  };
}
