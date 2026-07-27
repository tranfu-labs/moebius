import { DEFAULT_LOCALE, type Locale } from "./i18n/index.js";

export type SaveState = "idle" | "saving" | "failed";

export interface SettingsState {
  activeLocale: Locale;
  pendingLocale: Locale | null;
  saveState: SaveState;
}

export type SettingsEvent =
  | { type: "select"; locale: Locale }
  | { type: "saveSucceeded"; locale: Locale }
  | { type: "saveFailed"; locale: Locale }
  | { type: "retry" };

export function createSettingsState(savedLocale?: Locale): SettingsState {
  return {
    activeLocale: savedLocale ?? DEFAULT_LOCALE,
    pendingLocale: null,
    saveState: "idle"
  };
}

export function reduceSettingsState(
  state: SettingsState,
  event: SettingsEvent
): SettingsState {
  switch (event.type) {
    case "select":
      if (state.saveState === "saving" || event.locale === state.activeLocale) {
        return state;
      }
      return {
        ...state,
        pendingLocale: event.locale,
        saveState: "saving"
      };
    case "saveSucceeded":
      if (state.pendingLocale !== event.locale) return state;
      return {
        activeLocale: event.locale,
        pendingLocale: null,
        saveState: "idle"
      };
    case "saveFailed":
      if (state.pendingLocale !== event.locale) return state;
      return {
        ...state,
        saveState: "failed"
      };
    case "retry":
      if (state.saveState !== "failed" || state.pendingLocale === null) {
        return state;
      }
      return {
        ...state,
        saveState: "saving"
      };
  }
}
