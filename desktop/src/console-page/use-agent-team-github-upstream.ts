import { useCallback, useMemo, useRef } from "react";

import type {
  GithubTeamCheckUpstreamIpcRequest,
  GithubTeamCheckUpstreamIpcResponse,
  GithubTeamDetachIpcRequest,
  GithubTeamDetachIpcResponse,
  GithubTeamRevertSyncIpcRequest,
  GithubTeamRevertSyncIpcResponse,
  GithubTeamSyncIpcRequest,
  GithubTeamSyncIpcResponse,
} from "../github-team-ipc-contract.js";
import { planAgentTeamGithubUpstreamOperation, planFindOperatorAgentTeam } from "./agent-team-console-model.js";
import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";

interface AgentTeamGithubUpstreamPort {
  detachGithubTeamUpstream?: (request: GithubTeamDetachIpcRequest) => Promise<GithubTeamDetachIpcResponse>;
  checkGithubTeamUpstream?: (request: GithubTeamCheckUpstreamIpcRequest) => Promise<GithubTeamCheckUpstreamIpcResponse>;
  syncGithubTeamUpstream?: (request: GithubTeamSyncIpcRequest) => Promise<GithubTeamSyncIpcResponse>;
  revertGithubTeamSync?: (request: GithubTeamRevertSyncIpcRequest) => Promise<GithubTeamRevertSyncIpcResponse>;
}

export interface GithubTeamUpstreamCheckView {
  status: "up-to-date" | "update-available" | "unreachable";
  recentSync: { officialVersion: string; occurredAt: string } | null;
  pendingMergeMemberCount: number;
}

export interface GithubTeamUpstreamSyncOutcome {
  status: "applied" | "up-to-date" | "unreachable" | "failed";
  message: string | null;
}

const UNAVAILABLE_VIEW: GithubTeamUpstreamCheckView = {
  status: "unreachable",
  recentSync: null,
  pendingMergeMemberCount: 0,
};

export function useAgentTeamGithubUpstream(input: {
  api: AgentTeamGithubUpstreamPort | undefined;
  catalog: AgentTeamCatalogBundle;
}) {
  const inputRef = useRef(input);
  inputRef.current = input;

  const detachUpstream = useCallback(async (teamKey: string) => {
    const runtime = inputRef.current;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const operation = runtime.api?.detachGithubTeamUpstream;
    if (planAgentTeamGithubUpstreamOperation(team, operation !== undefined) === "unavailable") {
      return;
    }
    await operation!.call(runtime.api, { teamId: team!.id });
    inputRef.current.catalog.refresh();
  }, []);

  const retryUpstream = useCallback(async (teamKey: string): Promise<GithubTeamUpstreamCheckView> => {
    const runtime = inputRef.current;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const operation = runtime.api?.checkGithubTeamUpstream;
    if (planAgentTeamGithubUpstreamOperation(team, operation !== undefined) === "unavailable") {
      return UNAVAILABLE_VIEW;
    }
    const response = await operation!.call(runtime.api, { teamId: team!.id });
    return response.status === "not-following" ? UNAVAILABLE_VIEW : response;
  }, []);

  const syncUpstream = useCallback(async (teamKey: string): Promise<GithubTeamUpstreamSyncOutcome> => {
    const runtime = inputRef.current;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const operation = runtime.api?.syncGithubTeamUpstream;
    if (planAgentTeamGithubUpstreamOperation(team, operation !== undefined) === "unavailable") {
      return { status: "unreachable", message: null };
    }
    const response = await operation!.call(runtime.api, { teamId: team!.id });
    inputRef.current.catalog.refresh();
    if (response.status === "applied") {
      return { status: "applied", message: null };
    }
    if (response.status === "up-to-date") {
      return { status: "up-to-date", message: null };
    }
    if (response.status === "failed") {
      return { status: "failed", message: response.message };
    }
    return { status: "unreachable", message: null };
  }, []);

  const revertUpstream = useCallback(async (teamKey: string): Promise<"reverted" | "none"> => {
    const runtime = inputRef.current;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const operation = runtime.api?.revertGithubTeamSync;
    if (planAgentTeamGithubUpstreamOperation(team, operation !== undefined) === "unavailable") {
      return "none";
    }
    const response = await operation!.call(runtime.api, { teamId: team!.id });
    inputRef.current.catalog.refresh();
    return response.status === "reverted" ? "reverted" : "none";
  }, []);

  return useMemo(
    () => ({ detachUpstream, retryUpstream, syncUpstream, revertUpstream }),
    [detachUpstream, retryUpstream, syncUpstream, revertUpstream],
  );
}
