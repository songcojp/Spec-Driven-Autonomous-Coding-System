import { en } from "./en";
import { zhCN } from "./zh-CN";
import type { Locale } from "./types";

export type { Locale, TranslationCatalog, ViewKey } from "./types";

export const localeStorageKey = "specdrive-console-locale";

export const i18n = {
  "zh-CN": zhCN,
  en,
} satisfies Record<Locale, typeof zhCN>;

export type UiStrings = (typeof i18n)[Locale];
