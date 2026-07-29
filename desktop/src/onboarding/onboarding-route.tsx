import {
  OnboardingShell,
  type OnboardingCli,
  type OnboardingEnvironmentState,
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
  OnboardingCliReadinessSnapshot,
  OnboardingCliReadinessState,
} from "./cli-readiness-contract.js";
import type {
  OnboardingCliInstallSnapshot,
  OnboardingCliInstallState,
} from "./cli-installer-contract.js";

const ONBOARDING_TEAM_BUILDER_DRAFT_ID = "onboarding-team-builder";
const INITIAL_ENVIRONMENT: OnboardingEnvironmentState = {
  codex: { status: "checking", revision: 0 },
  claude: { status: "checking", revision: 0 },
  kimi: { status: "checking", revision: 0 },
};
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
  const [environment, setEnvironment] = useState<OnboardingEnvironmentState>(INITIAL_ENVIRONMENT);
  const [installations, setInstallations] = useState<OnboardingInstallationState>(
    INITIAL_INSTALLATIONS,
  );
  const [teamsState, setTeamsState] = useState<OperatorAgentTeamsState>({ status: "loading" });
  const [teamBuilderState, setTeamBuilderState] = useState<TeamBuilderViewState>(
    () => createInitialTeamBuilderState(t("teamBuilder.initialPrompt")),
  );
  const [createdTeamKey, setCreatedTeamKey] = useState<string | null>(null);
  const checkSequenceRef = useRef<Record<OnboardingCli, number>>({
    codex: 0,
    claude: 0,
    kimi: 0,
  });
  const previousInstallationsRef = useRef<OnboardingInstallationState>(INITIAL_INSTALLATIONS);
  const readinessMergeRef = useRef<Record<
    OnboardingCli,
    { revision: number; status: OnboardingCliReadinessSnapshot["status"] }
  >>({
    codex: { revision: -1, status: "checking" },
    claude: { revision: -1, status: "checking" },
    kimi: { revision: -1, status: "checking" },
  });
  const installationRevisionRef = useRef<Record<OnboardingCli, number>>({
    codex: -1,
    claude: -1,
    kimi: -1,
  });
  const installMutationPendingRef = useRef(new Set<OnboardingCli>());

  const mergeReadinessSnapshot = useCallback((
    snapshot: OnboardingCliReadinessSnapshot,
  ): boolean => {
    const previous = readinessMergeRef.current[snapshot.cli];
    const sameRevisionCanAdvance = snapshot.revision === previous.revision
      && previous.status === "checking"
      && snapshot.status !== "checking";
    const sameTerminalIsIdempotent = snapshot.revision === previous.revision
      && previous.status === snapshot.status
      && snapshot.status !== "checking";
    if (
      snapshot.revision < previous.revision
      || (
        snapshot.revision === previous.revision
        && !sameRevisionCanAdvance
        && !sameTerminalIsIdempotent
      )
    ) {
      return false;
    }
    readinessMergeRef.current[snapshot.cli] = {
      revision: snapshot.revision,
      status: snapshot.status,
    };
    setEnvironment((current) => ({
      ...current,
      [snapshot.cli]: toViewReadiness(snapshot),
    }));
    return true;
  }, []);

  const mergeInstallationSnapshot = useCallback((
    snapshot: OnboardingCliInstallSnapshot,
    options: { allowEqual?: boolean } = {},
  ): { accepted: boolean; becameSucceeded: boolean } => {
    const previousRevision = installationRevisionRef.current[snapshot.cli];
    if (
      snapshot.revision < previousRevision
      || (snapshot.revision === previousRevision && options.allowEqual !== true)
    ) {
      return { accepted: false, becameSucceeded: false };
    }
    installationRevisionRef.current[snapshot.cli] = snapshot.revision;
    const previous = previousInstallationsRef.current[snapshot.cli];
    const next = toViewInstallation(snapshot);
    previousInstallationsRef.current = {
      ...previousInstallationsRef.current,
      [snapshot.cli]: next,
    };
    setInstallations((current) => ({ ...current, [snapshot.cli]: next }));
    return {
      accepted: true,
      becameSucceeded: previous.status === "running" && next.status === "succeeded",
    };
  }, []);

  const checkCli = useCallback(async (cli: OnboardingCli) => {
    const sequence = ++checkSequenceRef.current[cli];
    setEnvironment((current) => ({
      ...current,
      [cli]: {
        status: "checking",
        revision: current[cli].revision + 1,
        lastKnownReady: current[cli].status === "ready"
          || current[cli].lastKnownReady === true,
      },
    }));
    try {
      if (api?.checkOnboardingCliReadiness !== undefined) {
        const result = await api.checkOnboardingCliReadiness(cli);
        if (sequence !== checkSequenceRef.current[cli]) {
          return;
        }
        mergeReadinessSnapshot(result);
        return;
      }
      if (cli !== "codex") {
        setEnvironment((current) => ({
          ...current,
          [cli]: { status: "missing", revision: current[cli].revision },
        }));
        return;
      }
      const legacy = await api?.checkOnboardingCodex?.();
      if (sequence !== checkSequenceRef.current[cli]) {
        return;
      }
      setEnvironment((current) => ({
        ...current,
        codex: legacy?.status === "ok"
          ? {
              status: "ready",
              revision: current.codex.revision,
              ...(legacy.detail === undefined ? {} : { version: legacy.detail }),
            }
          : {
              status: legacy?.message === "Codex 未找到" ? "missing" : "unavailable", // i18n-exempt: legacy-protocol-value
              revision: current.codex.revision,
            },
      }));
    } catch {
      if (sequence !== checkSequenceRef.current[cli]) {
        return;
      }
      setEnvironment((current) => ({
        ...current,
        [cli]: { status: "unavailable", revision: current[cli].revision },
      }));
    }
  }, [api, mergeReadinessSnapshot]);

  const checkEnvironment = useCallback(async () => {
    await Promise.all([checkCli("codex"), checkCli("claude"), checkCli("kimi")]);
  }, [checkCli]);

  const loadReadinessState = useCallback(async () => {
    if (api?.getOnboardingCliReadinessState === undefined) {
      return;
    }
    try {
      const next = await api.getOnboardingCliReadinessState();
      mergeReadinessSnapshot(next.codex);
      mergeReadinessSnapshot(next.claude);
      mergeReadinessSnapshot(next.kimi);
    } catch {
      // Keep the last safe renderer state; manual recheck remains available.
    }
  }, [api, mergeReadinessSnapshot]);

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

function toViewEnvironment(
  state: OnboardingCliReadinessState,
): OnboardingEnvironmentState {
  return {
    codex: toViewReadiness(state.codex),
    claude: toViewReadiness(state.claude),
    kimi: toViewReadiness(state.kimi),
  };
}

function toViewReadiness(
  snapshot: OnboardingCliReadinessSnapshot,
): OnboardingEnvironmentState[OnboardingCli] {
  return {
    status: snapshot.status,
    revision: snapshot.revision,
    code: snapshot.code,
    ...(snapshot.version === null ? {} : { version: snapshot.version }),
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
