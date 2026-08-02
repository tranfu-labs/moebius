import type { DesktopLocale } from "../language-preference-contract.js";

export interface LanguageState {
  activeLocale: DesktopLocale;
  pendingLocale: DesktopLocale | null;
  status: "idle" | "saving" | "failed";
  requestId: number;
}

export type LanguageAction =
  | { type: "select"; locale: DesktopLocale; requestId: number }
  | { type: "saved"; locale: DesktopLocale; requestId: number }
  | { type: "failed"; requestId: number }
  | { type: "external"; locale: DesktopLocale };

export function createLanguageState(locale: DesktopLocale): LanguageState {
  return {
    activeLocale: locale,
    pendingLocale: null,
    status: "idle",
    requestId: 0,
  };
}

export function reduceLanguageState(
  state: LanguageState,
  action: LanguageAction,
): LanguageState {
  if (action.type === "external") {
    return {
      ...state,
      activeLocale: action.locale,
      pendingLocale: null,
      status: "idle",
    };
  }
  if (action.requestId < state.requestId) {
    return state;
  }
  if (action.type === "select") {
    if (action.locale === state.activeLocale) {
      return {
        ...state,
        pendingLocale: null,
        status: "idle",
        requestId: action.requestId,
      };
    }
    return {
      ...state,
      pendingLocale: action.locale,
      status: "saving",
      requestId: action.requestId,
    };
  }
  if (action.type === "saved") {
    return {
      activeLocale: action.locale,
      pendingLocale: null,
      status: "idle",
      requestId: action.requestId,
    };
  }
  return {
    ...state,
    status: "failed",
    requestId: action.requestId,
  };
}

export function planInitialDesktopLocale(search: string): DesktopLocale {
  return new URLSearchParams(search).get("locale") === "en" ? "en" : "zh-CN";
}

export function planLanguagePersistence(hasPersistencePort: boolean): "persist" | "commit-local" {
  return hasPersistencePort ? "persist" : "commit-local";
}

export function planLanguageRetry(state: LanguageState): DesktopLocale | null {
  return state.pendingLocale;
}

export function planActiveLanguageCommit(active: boolean): boolean {
  return active;
}
