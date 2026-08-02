import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { OperatorAgentTeam, OperatorAgentTeamsState } from "@moebius/console-ui";

import type { LastUsedAgentTeam } from "../team-conversation-preference-contract.js";
import type { AgentTeamListResponse } from "../team-ipc-contract.js";
import {
  planActiveAgentTeamCatalogCommit,
  planAgentTeamCatalogLoad,
  planAgentTeamCatalogPort,
} from "./agent-team-console-model.js";
import type { AgentTeamSelection } from "./team-state.js";
import { reconcileAgentTeamSelection } from "./team-state.js";

interface AgentTeamCatalogPort {
  listAgentTeams?: () => Promise<AgentTeamListResponse>;
  readLastUsedAgentTeam?: () => Promise<LastUsedAgentTeam | null>;
}

export interface AgentTeamCatalogBundle {
  state: OperatorAgentTeamsState;
  setState: Dispatch<SetStateAction<OperatorAgentTeamsState>>;
  lastUsedTeamKey: string | null;
  setLastUsedTeamKey: Dispatch<SetStateAction<string | null>>;
  selection: AgentTeamSelection | null;
  setSelection: Dispatch<SetStateAction<AgentTeamSelection | null>>;
  replaceTeams(teams: OperatorAgentTeam[]): void;
  refresh(): void;
}

export function useAgentTeamCatalog(api: AgentTeamCatalogPort | undefined): AgentTeamCatalogBundle {
  const [state, setState] = useState<OperatorAgentTeamsState>({ status: "loading" });
  const [lastUsedTeamKey, setLastUsedTeamKey] = useState<string | null>(null);
  const [selection, setSelection] = useState<AgentTeamSelection | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let loadingTimer: number | undefined;
    async function load(): Promise<void> {
      const listTeams = api?.listAgentTeams;
      if (planAgentTeamCatalogPort(listTeams !== undefined) === "unavailable") {
        if (planActiveAgentTeamCatalogCommit(cancelled)) setState({ status: "error" });
        return;
      }
      const readLastUsed = api?.readLastUsedAgentTeam;
      const lastUsedPromise = planAgentTeamCatalogPort(readLastUsed !== undefined) === "unavailable"
        ? Promise.resolve(null)
        : readLastUsed!.call(api).catch(() => null);
      try {
        const [response, lastUsed] = await Promise.all([listTeams!.call(api), lastUsedPromise]);
        if (!planActiveAgentTeamCatalogCommit(cancelled)) return;
        const plan = planAgentTeamCatalogLoad(response, lastUsed);
        if (plan.kind === "retry") {
          setState({ status: "loading" });
          loadingTimer = window.setTimeout(() => void load(), 250);
          return;
        }
        if (plan.kind === "configuration-error") {
          setState({ status: "configuration-error" });
          setSelection(null);
          return;
        }
        setState(plan.state);
        setLastUsedTeamKey(plan.lastUsedTeamKey);
        setSelection((current) => reconcileAgentTeamSelection(plan.teams, current));
      } catch {
        if (planActiveAgentTeamCatalogCommit(cancelled)) setState({ status: "error" });
      }
    }
    setState({ status: "loading" });
    void load();
    return () => {
      cancelled = true;
      if (planAgentTeamCatalogPort(loadingTimer !== undefined) === "load") {
        window.clearTimeout(loadingTimer);
      }
    };
  }, [api, refreshNonce]);
  const refresh = useCallback(() => setRefreshNonce((current) => current + 1), []);
  const replaceTeams = useCallback((teams: OperatorAgentTeam[]) => {
    setState({ status: "ready", teams });
  }, []);
  return useMemo(() => ({
    state,
    setState,
    lastUsedTeamKey,
    setLastUsedTeamKey,
    selection,
    setSelection,
    replaceTeams,
    refresh,
  }), [lastUsedTeamKey, refresh, replaceTeams, selection, state]);
}
