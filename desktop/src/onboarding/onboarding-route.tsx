import {
  OnboardingShell,
  type OnboardingInstallationState,
  type OnboardingMode,
  type OperatorAgentTeam,
  type OperatorAgentTeamsState,
  type TeamBuilderViewState,
  useI18n,
} from "@moebius/console-ui";
import { useCallback, useEffect, useState } from "react";

import type { AiTeamBuilderIpcResponse } from "../ai-team-builder/contract.js";
import type { AiTeamBuilderState } from "../ai-team-builder/dto.js";
import type { AgentTeamListItem } from "../team-ipc-contract.js";
import type { DesktopApi } from "../console-page/desktop-api-contract.js";
import {
  toTeamBuilderIpcViewError,
  toTeamBuilderViewState,
} from "../team-builder-view-state.js";
import { useOnboardingInstallations } from "./use-onboarding-installations.js";
import { useOnboardingReadiness } from "./use-onboarding-readiness.js";
import { hasProviderSettingsPort } from "../console-page/provider-settings-port.js";
import { useProviderSettings } from "../console-page/use-provider-settings.js";
import { useTaskReminderController } from "../console-page/use-task-reminder.js";

const ONBOARDING_TEAM_BUILDER_DRAFT_ID = "onboarding-team-builder";

export function OnboardingRoute({
  mode = "first-run",
  onExit,
  onComplete,
}: {
  mode?: OnboardingMode;
  onExit?: () => void;
  onComplete: (teamKey: string) => void | Promise<void>;
}): JSX.Element {
  const { t } = useI18n();
  const api = window.moebius;
  const providerSettings = useProviderSettings(hasProviderSettingsPort(api) ? api : undefined, {
    bridgeUnavailable: t("settings.providers.bridgeUnavailable"),
    listFailed: t("settings.providers.listFailed"),
    operationFailed: t("settings.providers.operationFailed"),
  });
  const taskReminder = useTaskReminderController(api);
  const [teamsState, setTeamsState] = useState<OperatorAgentTeamsState>({ status: "loading" });
  const [teamBuilderState, setTeamBuilderState] = useState<TeamBuilderViewState>(
    () => createInitialTeamBuilderState(t("teamBuilder.initialPrompt")),
  );
  const [createdTeamKey, setCreatedTeamKey] = useState<string | null>(null);
  const { environment, checkEnvironment, loadReadinessState } = useOnboardingReadiness(api);
  const {
    installations,
    loadInstallState,
    install,
    updateClaude,
    cancel,
  } = useOnboardingInstallations({ api, loadReadinessState, t });

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
    void Promise.all([checkEnvironment(), loadTeams(), loadInstallState()]);
    if (api?.onStatus === undefined) {
      return;
    }
    let checkedAfterShellReady = false;
    let loadedAfterSeedReady = false;
    const unsubscribe = api.onStatus((snapshot) => {
      if (!checkedAfterShellReady && snapshot.shellPath !== null) {
        checkedAfterShellReady = true;
        void checkEnvironment();
      }
      if (!loadedAfterSeedReady && snapshot.seed?.status !== "pending") {
        loadedAfterSeedReady = true;
        void loadTeams();
      }
    });
    return unsubscribe;
  }, [api, checkEnvironment, loadInstallState, loadTeams]);

  const applyBuilderResponse = useCallback((response: AiTeamBuilderIpcResponse): AiTeamBuilderState | null => {
    if (!response.ok) {
      setTeamBuilderState((current) => ({
        ...current,
        phase: "failed",
        error: toTeamBuilderIpcViewError(response.error, t),
      }));
      return null;
    }
    setTeamBuilderState(toTeamBuilderViewState(response.state, t));
    return response.state;
  }, [t]);

  const invokeBuilder = useCallback(async (
    operation: (desktopApi: DesktopApi) => Promise<AiTeamBuilderIpcResponse>,
  ): Promise<AiTeamBuilderState | null> => {
    if (api === undefined) {
      setTeamBuilderState((current) => ({
        ...current,
        phase: "failed",
        error: {
          code: "temporarily-unavailable",
          humanMessage: t("teamBuilder.unavailable"),
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
          humanMessage: t("teamBuilder.unavailable"),
          canRetry: true,
        },
      }));
      return null;
    }
  }, [api, applyBuilderResponse, t]);

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
      mode={mode}
      environment={environment}
      installations={installations}
      teamsState={teamsState}
      teamBuilderState={teamBuilderState}
      createdTeamKey={createdTeamKey}
      providerSettings={providerSettings}
      taskReminder={taskReminder}
      onRecheckEnvironment={checkEnvironment}
      onInstallCli={install}
      onUpdateClaude={updateClaude}
      onCancelCliInstallation={cancel}
      onRetryTeams={async () => {
        await loadTeams();
      }}
      onReplaceTeamWithProvider={async (request) => {
        if (api?.replaceUnavailableAgentTeamExecutionProfiles === undefined) {
          throw new Error("Agent team replacement is unavailable");
        }
        await api.replaceUnavailableAgentTeamExecutionProfiles({
          teamId: request.teamId,
          ownership: request.ownership,
          memberSlugs: request.memberSlugs,
          profile: {
            cli: "pi",
            providerId: "deepseek",
            providerProfileId: request.providerProfileId,
            model: request.model,
            effort: request.effort,
          },
        });
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
      onExit={onExit}
      onComplete={onComplete}
    />
  );
}

function createInitialTeamBuilderState(initialPrompt: string): TeamBuilderViewState {
  return {
    phase: "idle",
    builderCli: null,
    messages: [{ role: "assistant", text: initialPrompt }],
    proposal: null,
    proposalRevision: null,
    error: null,
  };
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
