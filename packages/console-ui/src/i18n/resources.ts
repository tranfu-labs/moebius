import { zhCN } from "./locales/zh-CN";

export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type TranslationKey = keyof typeof zhCN;
export type TranslationResource = Readonly<Record<TranslationKey, string>>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && SUPPORTED_LOCALES.some((locale) => locale === value);
}
