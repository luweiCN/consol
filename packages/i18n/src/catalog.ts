import { enUSCatalog } from "./locales/en-US";
import { zhCNCatalog } from "./locales/zh-CN";

export const catalogs = {
  "en-US": enUSCatalog,
  "zh-CN": zhCNCatalog,
} as const;

export type Locale = keyof typeof catalogs;
export type MessageKey = keyof typeof enUSCatalog;
export type LocalePreference = Locale | "system";
