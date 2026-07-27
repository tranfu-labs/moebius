export const DESKTOP_LOCALES = ["zh-CN", "en"] as const;

export type DesktopLocale = (typeof DESKTOP_LOCALES)[number];

export const LANGUAGE_PREFERENCE_IPC_CHANNELS = {
  read: "language-preference:read",
  save: "language-preference:save",
  changed: "language-preference:changed",
} as const;

export function isDesktopLocale(value: unknown): value is DesktopLocale {
  return typeof value === "string" && DESKTOP_LOCALES.some((locale) => locale === value);
}
