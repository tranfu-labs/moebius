import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

import { en } from "./locales/en";
import { zhCN } from "./locales/zh-CN";
import {
  type Locale,
  type TranslationKey,
  type TranslationResource,
} from "./resources";

const resources: Readonly<Record<Locale, TranslationResource>> = {
  "zh-CN": zhCN,
  en,
};

export type TranslationValues = Readonly<Record<string, string | number>>;
export type Translate = (key: TranslationKey, values?: TranslationValues) => string;

export function translate(
  locale: Locale,
  key: TranslationKey,
  values?: TranslationValues,
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

interface I18nContextValue {
  locale: Locale;
  t: Translate;
}

const defaultValue: I18nContextValue = {
  locale: "zh-CN",
  t: (key, values) => translate("zh-CN", key, values),
};

const I18nContext = createContext<I18nContextValue>(defaultValue);

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}): JSX.Element {
  const value = useMemo<I18nContextValue>(() => ({
    locale,
    t: (key, values) => translate(locale, key, values),
  }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export { isLocale, SUPPORTED_LOCALES } from "./resources";
export type { Locale, TranslationKey, TranslationResource } from "./resources";
