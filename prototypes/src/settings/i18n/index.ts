import en from "./en.js";
import zhCN from "./zh-CN.js";

export const DEFAULT_LOCALE = "zh-CN" as const;
export const resources = {
  "zh-CN": zhCN,
  en
} as const;

export type Locale = keyof typeof resources;
export type TranslationKey = keyof typeof zhCN;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && Object.hasOwn(resources, value);
}

export function translate(locale: Locale, key: TranslationKey): string {
  return resources[locale][key];
}
