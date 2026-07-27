import type { DesktopLocale } from "../language-preference-contract.js";
import { en } from "./locales/en.js";
import { zhCN } from "./locales/zh-CN.js";

export type DesktopTranslationKey = keyof typeof zhCN;

const resources: Readonly<Record<DesktopLocale, Readonly<Record<DesktopTranslationKey, string>>>> = {
  "zh-CN": zhCN,
  en,
};

export function translateDesktop(
  locale: DesktopLocale,
  key: DesktopTranslationKey,
  values?: Readonly<Record<string, string | number>>,
): string {
  const template = resources[locale][key];
  if (values === undefined) {
    return template;
  }
  return template.replace(/\{([A-Za-z0-9_]+)\}/gu, (placeholder, name: string) => {
    const value = values[name];
    return value === undefined ? placeholder : String(value);
  });
}
