import {
  OnboardingShell,
  type OnboardingEnvironmentState,
  type OperatorAgentTeam,
  type OperatorAgentTeamsState,
  type TeamBuilderViewState,
} from "@moebius/console-ui";
import { useCallback, useEffect, useState } from "react";

import type { AiTeamBuilderIpcResponse } from "../ai-team-builder/contract.js";
import type { AiTeamBuilderState } from "../ai-team-builder/dto.js";
import type { AgentTeamListItem } from "../team-ipc-contract.js";
import type { DesktopApi } from "../console-page/app.js";

const ONBOARDING_TEAM_BUILDER_DRAFT_ID = "onboarding-team-builder";

const INITIAL_TEAM_BUILDER_STATE: TeamBuilderViewState = {
  phase: "idle",
  messages: [{
    role: "assistant",
    text: "你希望这支团队长期替你完成什么工作？\n\n先说目标就好，不需要想好角色和分工。",
  }],
  proposal: null,
  proposalRevision: null,
  error: null,
};

export function OnboardingRoute({
  onComplete,
}: {
  onComplete: (teamKey: string) => void | Promise<void>;
}): JSX.Element {
  const api = window.moebius;
  const [environment, setEnvironment] = useState<OnboardingEnvironmentState>({ status: "checking" });
  const [teamsState, setTeamsState] = useState<OperatorAgentTeamsState>({ status: "loading" });
  const [teamBuilderState, setTeamBuilderState] = useState<TeamBuilderViewState>(
    INITIAL_TEAM_BUILDER_STATE,
  );
  const [createdTeamKey, setCreatedTeamKey] = useState<string | null>(null);

  const checkCodex = useCallback(async () => {
    setEnvironment({ status: "checking" });
    try {
      const result = await api?.checkOnboardingCodex?.();
      if (result?.status === "ok") {
        setEnvironment({ status: "ready", detail: result.detail });
        return;
      }
      setEnvironment({
        status: "error",
        kind: result?.message.includes("未找到") ? "missing" : "unavailable",
      });
    } catch {
      setEnvironment({ status: "error", kind: "unavailable" });
    }
  }, [api]);

  const loadTeams = useCallback(async (): Promise<OperatorAgentTeam[]> => {
    setTeamsState({ status: "loading" });
    try {
      const response = await api?.listAgentTeams?.();
      if (response?.status !== "ready") {
        setTeamsState(response?.status === "configuration-error"
          ? { status: "configuration-error" }
          : { status: "error" });
        return [];
      }
      const teams = response.teams.map(toOperatorAgentTeam);
      setTeamsState({ status: "ready", teams });
      return teams;
    } catch {
      setTeamsState({ status: "error" });
      return [];
    }
  }, [api]);

  useEffect(() => {
    void Promise.all([checkCodex(), loadTeams()]);
    if (api?.onStatus === undefined) {
      return;
    }
    let checkedAfterShellReady = false;
    let loadedAfterSeedReady = false;
    const unsubscribe = api.onStatus((snapshot) => {
      if (!checkedAfterShellReady && snapshot.shellPath !== null) {
        checkedAfterShellReady = true;
        void checkCodex();
      }
      if (!loadedAfterSeedReady && snapshot.seed?.status !== "pending") {
        loadedAfterSeedReady = true;
        void loadTeams();
      }
    });
    return unsubscribe;
  }, [api, checkCodex, loadTeams]);

  const applyBuilderResponse = useCallback((response: AiTeamBuilderIpcResponse): AiTeamBuilderState | null => {
    if (!response.ok) {
      setTeamBuilderState((current) => ({
        ...current,
        phase: "failed",
        error: response.error,
      }));
      return null;
    }
    setTeamBuilderState(response.state);
    return response.state;
  }, []);

  const invokeBuilder = useCallback(async (
    operation: (desktopApi: DesktopApi) => Promise<AiTeamBuilderIpcResponse>,
  ): Promise<AiTeamBuilderState | null> => {
    if (api === undefined) {
      setTeamBuilderState((current) => ({
        ...current,
        phase: "failed",
        error: {
          code: "temporarily-unavailable",
          humanMessage: "AI 团队设计器暂时不可用，请稍后重试。",
          canRetry: true,
        },
      }));
      return null;
    }
    try {
      return applyBuilderResponse(await operation(api));
    } catch {
      setTeamBuilderState((current) => ({
        ...current,
        phase: "failed",
        error: {
          code: "temporarily-unavailable",
          humanMessage: "AI 团队设计器暂时不可用，请稍后重试。",
          canRetry: true,
        },
      }));
      return null;
    }
  }, [api, applyBuilderResponse]);

  const invokeDraftOperation = useCallback((
    operation: NonNullable<DesktopApi["startOnboardingTeamBuilder"]>,
  ) => invokeBuilder((desktopApi) => operation.call(desktopApi, {
    draftId: ONBOARDING_TEAM_BUILDER_DRAFT_ID,
  })), [invokeBuilder]);

  const submitBuilderTurn = useCallback((
    method: "submitOnboardingTeamBuilder" | "adjustOnboardingTeamBuilder",
    text: string,
  ) => invokeBuilder((desktopApi) => {
    const operation = desktopApi[method];
    if (operation === undefined) {
      throw new Error("AI team builder is unavailable");
    }
    return operation({
      draftId: ONBOARDING_TEAM_BUILDER_DRAFT_ID,
      text,
    });
  }), [invokeBuilder]);

  const adoptSelectedBuilderTeam = useCallback(async (result: AiTeamBuilderState | null) => {
    if (result?.phase !== "selected" || result.selectedTeamId === null) {
      return;
    }
    await loadTeams();
    setCreatedTeamKey(`user:${result.selectedTeamId}`);
  }, [loadTeams]);

  const commitBuilder = useCallback(async (proposalRevision: number) => {
    const result = await invokeBuilder((desktopApi) => {
      if (desktopApi.commitOnboardingTeamBuilder === undefined) {
        throw new Error("AI team builder is unavailable");
      }
      return desktopApi.commitOnboardingTeamBuilder({
        draftId: ONBOARDING_TEAM_BUILDER_DRAFT_ID,
        proposalRevision,
      });
    });
    await adoptSelectedBuilderTeam(result);
  }, [adoptSelectedBuilderTeam, invokeBuilder]);

  return (
    <OnboardingShell
      environment={environment}
      teamsState={teamsState}
      teamBuilderState={teamBuilderState}
      createdTeamKey={createdTeamKey}
      onRecheckCodex={checkCodex}
      onCopyInstallCommand={() => api?.copyOnboardingInstallCommand?.()
        ?? navigator.clipboard.writeText("brew install codex")}
      onRetryTeams={async () => {
        await loadTeams();
      }}
      onOpenTeamBuilder={async () => {
        if (api?.startOnboardingTeamBuilder === undefined) {
          await invokeBuilder(() => Promise.reject(new Error("AI team builder is unavailable")));
          return;
        }
        await adoptSelectedBuilderTeam(await invokeDraftOperation(api.startOnboardingTeamBuilder));
      }}
      onTeamBuilderSubmit={async (text) => {
        await submitBuilderTurn("submitOnboardingTeamBuilder", text);
      }}
      onTeamBuilderAdjust={async (text) => {
        await submitBuilderTurn("adjustOnboardingTeamBuilder", text);
      }}
      onTeamBuilderRetry={async () => {
        if (api?.retryOnboardingTeamBuilder === undefined) {
          await invokeBuilder(() => Promise.reject(new Error("AI team builder is unavailable")));
          return;
        }
        await invokeDraftOperation(api.retryOnboardingTeamBuilder);
      }}
      onTeamBuilderCommit={commitBuilder}
      onCreatedTeamConsumed={() => setCreatedTeamKey(null)}
      onComplete={onComplete}
    />
  );
}

function toOperatorAgentTeam(team: AgentTeamListItem): OperatorAgentTeam {
  return {
    teamKey: `${team.ownership}:${team.id}`,
    id: team.id,
    ownership: team.ownership,
    name: team.definition?.name ?? null,
    description: team.definition?.description ?? null,
    primaryAgentSlug: team.definition?.primaryAgentSlug ?? null,
    memberOrder: team.definition?.memberOrder ?? [],
    onboardingOrchestration: team.onboardingOrchestration?.status === "ready"
      ? {
          status: "ready",
          relayBeats: team.onboardingOrchestration.relayBeats.map((beat) => ({ ...beat })),
        }
      : { status: "unavailable" },
    members: team.members.map((member) => ({ ...member, available: member.available !== false })),
    status: team.status,
    canCreateConversation: team.canCreateConversation,
    issues: team.issues,
  };
}
