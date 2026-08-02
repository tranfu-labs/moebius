import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import type { DesktopLocale } from "../language-preference-contract.js";
import {
  createLanguageState,
  planActiveLanguageCommit,
  planInitialDesktopLocale,
  planLanguagePersistence,
  planLanguageRetry,
  reduceLanguageState,
  type LanguageState,
} from "./language-state.js";

export interface DesktopLanguagePort {
  readLanguagePreference?: () => Promise<DesktopLocale>;
  saveLanguagePreference?: (locale: DesktopLocale) => Promise<DesktopLocale>;
  onLanguagePreferenceChanged?: (
    listener: (locale: DesktopLocale) => void,
  ) => () => void;
}

export interface DesktopLanguageBundle extends LanguageState {
  selectLocale(locale: DesktopLocale): void;
  retry(): void;
}

export function useDesktopLanguageController(input: {
  api: DesktopLanguagePort | undefined;
  search: string;
}): DesktopLanguageBundle {
  const [state, dispatch] = useReducer(
    reduceLanguageState,
    planInitialDesktopLocale(input.search),
    createLanguageState,
  );
  const requestIdRef = useRef(0);
  const save = useCallback((locale: DesktopLocale) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    dispatch({ type: "select", locale, requestId });
    const savePreference = input.api?.saveLanguagePreference;
    if (planLanguagePersistence(savePreference !== undefined) === "commit-local") {
      dispatch({ type: "saved", locale, requestId });
      return;
    }
    void savePreference!.call(input.api, locale).then((savedLocale) => {
      dispatch({ type: "saved", locale: savedLocale, requestId });
    }).catch(() => dispatch({ type: "failed", requestId }));
  }, [input.api]);
  useEffect(() => {
    let active = true;
    void input.api?.readLanguagePreference?.().then((locale) => {
      if (planActiveLanguageCommit(active)) dispatch({ type: "external", locale });
    }).catch(() => undefined);
    const unsubscribe = input.api?.onLanguagePreferenceChanged?.((locale) => {
      dispatch({ type: "external", locale });
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [input.api]);
  useEffect(() => {
    document.documentElement.lang = state.activeLocale;
  }, [state.activeLocale]);
  return useMemo(() => ({
    ...state,
    selectLocale: save,
    retry: () => {
      const retryLocale = planLanguageRetry(state);
      if (retryLocale !== null) save(retryLocale);
    },
  }), [save, state]);
}
