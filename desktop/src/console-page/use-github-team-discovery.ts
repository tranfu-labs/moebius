import { useCallback, useEffect, useRef, useState } from "react";
import type { GithubTeamDiscoveryState, GithubTeamLanguage } from "@moebius/console-ui";

import type { DesktopLocale } from "../language-preference-contract.js";
import type { GithubTeamSearchIpcResponse } from "../github-team-ipc-contract.js";
import {
  decideGithubTeamDebounceMs,
  decideGithubTeamDiscoveryState,
  decideGithubTeamInitialLanguage,
  decideGithubTeamSearchIntent,
  planGithubTeamSearchLoadingState,
} from "./github-team-console-model.js";
import type { DesktopApi } from "./desktop-api-contract.js";

export interface GithubTeamDiscoveryController {
  query: string;
  language: GithubTeamLanguage;
  ghAuthenticated: boolean;
  state: GithubTeamDiscoveryState;
  setQuery: (query: string) => void;
  setLanguage: (language: GithubTeamLanguage) => void;
  onRetry: () => void;
  reset: () => void;
}

export function useGithubTeamDiscoveryConsole(
  api: DesktopApi | undefined,
  locale: DesktopLocale,
  active: boolean,
  debounceMsOverride: number | undefined,
): GithubTeamDiscoveryController {
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState<GithubTeamLanguage>(() => decideGithubTeamInitialLanguage(locale));
  const [ghAuthenticated, setGhAuthenticated] = useState(false);
  const [state, setState] = useState<GithubTeamDiscoveryState>({ status: "initial" });

  const requestRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const search = useCallback((nextQuery: string, nextLanguage: GithubTeamLanguage): void => {
    const intent = decideGithubTeamSearchIntent(nextQuery);
    const requestId = ++requestRef.current;
    if (intent.kind === "empty") {
      setState({ status: "initial" });
      return;
    }
    setState(planGithubTeamSearchLoadingState(stateRef.current));
    const port = api?.searchGithubTeams;
    if (port === undefined) {
      setState({ status: "offline" });
      return;
    }
    void port.call(api, { query: intent.query, language: nextLanguage })
      .then((response: GithubTeamSearchIpcResponse) => {
        if (requestId !== requestRef.current) return;
        setGhAuthenticated(response.authenticated);
        setState(decideGithubTeamDiscoveryState(response, locale));
      })
      .catch(() => {
        if (requestId === requestRef.current) setState({ status: "offline" });
      });
  }, [api, locale]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const port = api?.readGithubTeamAuthStatus;
    if (port === undefined) {
      setGhAuthenticated(false);
      return;
    }
    void port.call(api)
      .then((response) => {
        if (!cancelled) setGhAuthenticated(response.authenticated);
      })
      .catch(() => {
        if (!cancelled) setGhAuthenticated(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, active]);

  useEffect(() => {
    if (!active) return;
    const intent = decideGithubTeamSearchIntent(query);
    if (intent.kind === "empty") {
      search("", language);
      return;
    }
    const timer = window.setTimeout(
      () => search(query, language),
      decideGithubTeamDebounceMs(debounceMsOverride),
    );
    return () => window.clearTimeout(timer);
  }, [active, language, debounceMsOverride, query, search]);

  const reset = useCallback(() => {
    requestRef.current += 1;
    setQuery("");
    setState({ status: "initial" });
  }, []);

  return { query, language, ghAuthenticated, state, setQuery, setLanguage, onRetry: () => search(query, language), reset };
}
