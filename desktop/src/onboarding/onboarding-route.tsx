import {
  OnboardingShell,
  type OnboardingCli,
  type OnboardingInstallationState,
  type OnboardingMode,
  type OperatorAgentTeam,
  type OperatorAgentTeamsState,
  type TeamBuilderViewState,
  useI18n,
} from "@moebius/console-ui";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AiTeamBuilderIpcResponse } from "../ai-team-builder/contract.js";
import type { AiTeamBuilderState } from "../ai-team-builder/dto.js";
import type { AgentTeamListItem } from "../team-ipc-contract.js";
import type { DesktopApi } from "../console-page/app.js";
import {
  toTeamBuilderIpcViewError,
  toTeamBuilderViewState,
} from "../team-builder-view-state.js";
import type {
  OnboardingCliInstallSnapshot,
  OnboardingCliInstallState,
} from "./cli-installer-contract.js";
import {
  createOnboardingInstallationModel,
  decideOnboardingInstallationSnapshot,
} from "./onboarding-installation-model.js";
import { useOnboardingReadiness } from "./use-onboarding-readiness.js";

const ONBOARDING_TEAM_BUILDER_DRAFT_ID = "onboarding-team-builder";
const INITIAL_INSTALLATIONS: OnboardingInstallationState = {
  codex: { cli: "codex", status: "idle", revision: 0 },
  claude: { cli: "claude", status: "idle", revision: 0 },
  kimi: { cli: "kimi", status: "idle", revision: 0 },
};

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
  const [installations, setInstallations] = useState<OnboardingInstallationState>(
    INITIAL_INSTALLATIONS,
  );
  const [teamsState, setTeamsState] = useState<OperatorAgentTeamsState>({ status: "loading" });
  const [teamBuilderState, setTeamBuilderState] = useState<TeamBuilderViewState>(
    () => createInitialTeamBuilderState(t("teamBuilder.initialPrompt")),
  );
  const [createdTeamKey, setCreatedTeamKey] = useState<string | null>(null);
  const { environment, checkEnvironment, loadReadinessState } = useOnboardingReadiness(api);
  const installationModelRef = useRef(createOnboardingInstallationModel());
  const previousInstallationsRef = useRef<OnboardingInstallationState>(INITIAL_INSTALLATIONS);
  const installMutationPendingRef = useRef(new Set<OnboardingCli>());

  const mergeInstallationSnapshot = useCallback((
    snapshot: OnboardingCliInstallSnapshot,
    options: { allowEqual?: boolean } = {},
  ): { accepted: boolean; becameSucceeded: boolean } => {
    const decision = decideOnboardingInstallationSnapshot(
      installationModelRef.current,
      snapshot,
      options,
    );
    if (!decision.accepted) return decision;
    installationModelRef.current = decision.model;
    const next = toViewInstallation(snapshot);
    previousInstallationsRef.current = {
      ...previousInstallationsRef.current,
      [snapshot.cli]: next,
    };
    setInstallations((current) => ({ ...current, [snapshot.cli]: next }));
    return decision;
  }, []);

  const loadInstallState = useCallback(async () => {
    if (api?.getOnboardingCliInstallState === undefined) {
      return;
    }
    try {
      const next = await api.getOnboardingCliInstallState();
      const codex = mergeInstallationSnapshot(next.codex);
      const claude = mergeInstallationSnapshot(next.claude);
      const kimi = mergeInstallationSnapshot(next.kimi);
      if (codex.becameSucceeded || claude.becameSucceeded || kimi.becameSucceeded) {
        await loadReadinessState();
      }
    } catch {
      // Polling failure does not erase the last known task state.
    }
  }, [api, loadReadinessState, mergeInstallationSnapshot]);

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

  useEffect(() => {
    if (api?.onOnboardingCliInstallSnapshot === undefined) {
      return;
    }
    return api.onOnboardingCliInstallSnapshot((snapshot) => {
      const merged = mergeInstallationSnapshot(snapshot);
      if (merged.becameSucceeded) {
        void loadReadinessState();
      }
    });
  }, [api, loadReadinessState, mergeInstallationSnapshot]);

  useEffect(() => {
    if (
      api?.getOnboardingCliInstallState === undefined
      || (
        installations.codex.status !== "running"
        && installations.claude.status !== "running"
        && installations.kimi.status !== "running"
      )
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadInstallState();
    }, 750);
    return () => window.clearInterval(timer);
  }, [
    api,
    installations.codex.status,
    installations.claude.status,
    installations.kimi.status,
    loadInstallState,
  ]);

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
      onRecheckEnvironment={checkEnvironment}
      onInstallCli={async (cli) => {
        if (
          api?.startOnboardingCliInstall === undefined
          || installMutationPendingRef.current.has(cli)
          || previousInstallationsRef.current[cli].status === "running"
        ) {
          return;
        }
        installMutationPendingRef.current.add(cli);
        const optimistic: OnboardingInstallationState[OnboardingCli] = {
          cli,
          status: "running",
          revision: previousInstallationsRef.current[cli].revision,
          stage: "starting",
        };
        previousInstallationsRef.current = {
          ...previousInstallationsRef.current,
          [cli]: optimistic,
        };
        setInstallations((current) => ({
          ...current,
          [cli]: optimistic,
        }));
        try {
          mergeInstallationSnapshot(await api.startOnboardingCliInstall(cli));
        } catch {
          const failed: OnboardingInstallationState[OnboardingCli] = {
            cli,
            status: "failed",
            revision: previousInstallationsRef.current[cli].revision,
          };
          previousInstallationsRef.current = {
            ...previousInstallationsRef.current,
            [cli]: failed,
          };
          setInstallations((current) => ({ ...current, [cli]: failed }));
          await loadInstallState();
        } finally {
          installMutationPendingRef.current.delete(cli);
        }
      }}
      onUpdateClaude={async () => {
        const cli = "claude";
        if (
          api?.startOnboardingClaudeUpdate === undefined
          || installMutationPendingRef.current.has(cli)
          || previousInstallationsRef.current.claude.status === "running"
        ) {
          return;
        }
        installMutationPendingRef.current.add(cli);
        const optimistic: OnboardingInstallationState["claude"] = {
          cli,
          status: "running",
          revision: previousInstallationsRef.current.claude.revision,
          stage: "starting",
        };
        previousInstallationsRef.current = {
          ...previousInstallationsRef.current,
          claude: optimistic,
        };
        setInstallations((current) => ({ ...current, claude: optimistic }));
        try {
          mergeInstallationSnapshot(await api.startOnboardingClaudeUpdate());
        } catch {
          const failed: OnboardingInstallationState["claude"] = {
            cli,
            status: "failed",
            revision: previousInstallationsRef.current.claude.revision,
          };
          previousInstallationsRef.current = {
            ...previousInstallationsRef.current,
            claude: failed,
          };
          setInstallations((current) => ({ ...current, claude: failed }));
          await loadInstallState();
        } finally {
          installMutationPendingRef.current.delete(cli);
        }
      }}
      onCancelCliInstallation={async (cli) => {
        if (
          api?.cancelOnboardingCliInstall === undefined
          || installMutationPendingRef.current.has(cli)
          || !window.confirm(
            t("onboarding.cancelInstallConfirm", {
              cli: cli === "codex" ? "Codex" : cli === "claude" ? "Claude Code" : "Kimi",
            }),
          )
        ) {
          return;
        }
        installMutationPendingRef.current.add(cli);
        try {
          mergeInstallationSnapshot(await api.cancelOnboardingCliInstall(cli));
        } catch {
          await loadInstallState();
        } finally {
          installMutationPendingRef.current.delete(cli);
        }
      }}
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

function toViewInstallations(
  state: OnboardingCliInstallState,
): OnboardingInstallationState {
  return {
    codex: toViewInstallation(state.codex),
    claude: toViewInstallation(state.claude),
    kimi: toViewInstallation(state.kimi),
  };
}

function toViewInstallation(
  snapshot: OnboardingCliInstallSnapshot,
): OnboardingInstallationState[OnboardingCli] {
  return {
    cli: snapshot.cli,
    status: snapshot.status,
    revision: snapshot.revision,
    ...(snapshot.stage === null ? {} : { stage: snapshot.stage }),
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
