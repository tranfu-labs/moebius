import type { OperatorAgentTeam } from "@/console/agent-teams-page";
import type { Translate } from "@/i18n";

export type OnboardingStep = 1 | 2 | 3 | 4;
export type OnboardingCli = "codex" | "kimi";

export type OnboardingCliReadinessStatus =
  | "checking"
  | "ready"
  | "missing"
  | "needs-login"
  | "unavailable";

export interface OnboardingCliReadiness {
  status: OnboardingCliReadinessStatus;
  revision: number;
  version?: string;
  code?: string;
  lastKnownReady?: boolean;
}

export type OnboardingCliInstallStatus =
  | "idle"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed-out";

export interface OnboardingCliInstallation {
  cli: OnboardingCli;
  status: OnboardingCliInstallStatus;
  revision: number;
  stage?: "starting" | "downloading" | "installing" | "verifying";
}

export type OnboardingEnvironmentState = Record<OnboardingCli, OnboardingCliReadiness>;
export type OnboardingInstallationState = Record<OnboardingCli, OnboardingCliInstallation>;

export interface OnboardingShellState {
  step: OnboardingStep;
  environmentPassed: boolean;
  selectedTeamKey: string | null;
  teamBuilderOpen: boolean;
  relayRun: number;
}

export type OnboardingShellAction =
  | { type: "environment-passed" }
  | { type: "next" }
  | { type: "back" }
  | { type: "select-team"; teamKey: string }
  | { type: "open-team-builder" }
  | { type: "close-team-builder" }
  | { type: "replay-relay" };

export function createOnboardingShellState(
  environmentPassed = false,
): OnboardingShellState {
  return {
    step: 1,
    environmentPassed,
    selectedTeamKey: null,
    teamBuilderOpen: false,
    relayRun: 0,
  };
}

export function isOnboardingCliReady(state: OnboardingCliReadiness): boolean {
  return state.status === "ready"
    || (state.status === "checking" && state.lastKnownReady === true);
}

export function canContinueOnboardingEnvironment(
  environment: OnboardingEnvironmentState,
): boolean {
  return isOnboardingCliReady(environment.codex)
    || isOnboardingCliReady(environment.kimi);
}

export function chooseOnboardingBuilderCli(
  environment: OnboardingEnvironmentState,
): OnboardingCli | null {
  if (isOnboardingCliReady(environment.codex)) {
    return "codex";
  }
  return isOnboardingCliReady(environment.kimi) ? "kimi" : null;
}

export interface OnboardingTeamCompatibility {
  affectedCount: number;
  clis: OnboardingCli[];
  copy: string;
}

export function getOnboardingTeamCompatibility(
  team: OperatorAgentTeam | null,
  environment: OnboardingEnvironmentState,
  t: Translate,
): OnboardingTeamCompatibility {
  if (team === null) {
    return { affectedCount: 0, clis: [], copy: "" };
  }
  const missing = team.members.flatMap((member): OnboardingCli[] => {
    const cli = member.executionProfile?.effectiveProfile.cli;
    return (cli === "codex" || cli === "kimi") && !isOnboardingCliReady(environment[cli])
      ? [cli]
      : [];
  });
  const clis = [...new Set(missing)];
  return {
    affectedCount: missing.length,
    clis,
    copy: missing.length === 0
      ? ""
      : t("onboarding.teamCompatibility", {
          count: missing.length,
          clis: clis
            .map((cli) => cli === "codex" ? "Codex" : "Kimi")
            .join(" / "),
        }),
  };
}

export function runningOnboardingInstallations(
  installations: OnboardingInstallationState,
): OnboardingCliInstallation[] {
  return (["codex", "kimi"] as const)
    .map((cli) => installations[cli])
    .filter((installation) => installation.status === "running");
}

export function reduceOnboardingShell(
  state: OnboardingShellState,
  action: OnboardingShellAction,
): OnboardingShellState {
  switch (action.type) {
    case "environment-passed":
      return state.environmentPassed ? state : { ...state, environmentPassed: true };
    case "next":
      if (state.teamBuilderOpen || state.step === 4) {
        return state;
      }
      return {
        ...state,
        step: (state.step + 1) as OnboardingStep,
        relayRun: state.step === 2 ? state.relayRun + 1 : state.relayRun,
      };
    case "back":
      if (state.teamBuilderOpen || state.step === 1) {
        return state;
      }
      return {
        ...state,
        step: (state.step - 1) as OnboardingStep,
        relayRun: state.step === 4 ? state.relayRun + 1 : state.relayRun,
      };
    case "select-team":
      return { ...state, selectedTeamKey: action.teamKey };
    case "open-team-builder":
      return { ...state, teamBuilderOpen: true };
    case "close-team-builder":
      return { ...state, teamBuilderOpen: false };
    case "replay-relay":
      return { ...state, relayRun: state.relayRun + 1 };
  }
}

export function resolveDefaultOnboardingTeamKey(
  teams: readonly OperatorAgentTeam[],
): string | null {
  const builtIn = teams.filter((team) =>
    team.ownership === "system" && team.canCreateConversation);
  return builtIn.find((team) => team.id === "development")?.teamKey
    ?? builtIn[0]?.teamKey
    ?? null;
}
