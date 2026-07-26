export type OnboardingStep = 1 | 2 | 3 | 4;
export type CliId = "codex" | "kimi";
export type CliStatus =
  | "ready"
  | "missing"
  | "unavailable"
  | "needs-login"
  | "checking"
  | "installing"
  | "failed"
  | "cancelled";
export type InstallStage = "starting" | "downloading" | "installing";
export type EnvironmentScenario =
  | "codex-ready"
  | "kimi-ready"
  | "both-ready"
  | "both-missing"
  | "both-unavailable"
  | "install-recovery";
export type OnboardingMode = "first-run" | "replay";
export type PrototypeView = OnboardingStep | "conversation" | "main";

export interface CliState {
  status: CliStatus;
  lastKnownReady: boolean;
  installStage?: InstallStage;
  attempt: number;
}

export interface EnvironmentState {
  codex: CliState;
  kimi: CliState;
}

export interface TeamChoice {
  id: string;
  name: string;
  primaryAgent: string;
  members: string[];
  builderCli?: CliId;
}

export const DEVELOPMENT_TEAM: TeamChoice = {
  id: "development",
  name: "开发团队",
  primaryAgent: "开发经理",
  members: ["开发", "软件测试"]
};

export interface OnboardingState {
  view: PrototypeView;
  mode: OnboardingMode;
  environment: EnvironmentState;
  selectedTeam: TeamChoice;
  replayEntryTeam: TeamChoice | null;
  relayRun: number;
}

export type OnboardingAction =
  | { type: "continue" }
  | { type: "back" }
  | { type: "set-cli"; cli: CliId; value: Partial<CliState> & Pick<CliState, "status"> }
  | { type: "start-install"; cli: CliId }
  | { type: "cancel-install"; cli: CliId }
  | { type: "start-recheck" }
  | { type: "select-team"; team: TeamChoice }
  | { type: "replay-relay" }
  | { type: "enter-replay" }
  | { type: "exit-replay" }
  | {
      type: "reset";
      scenario?: EnvironmentScenario;
      mode?: OnboardingMode;
    };

function cli(status: CliStatus): CliState {
  return {
    status,
    lastKnownReady: status === "ready",
    attempt: 0
  };
}

export function environmentForScenario(
  scenario: EnvironmentScenario = "codex-ready"
): EnvironmentState {
  switch (scenario) {
    case "kimi-ready":
      return { codex: cli("missing"), kimi: cli("ready") };
    case "both-ready":
      return { codex: cli("ready"), kimi: cli("ready") };
    case "both-missing":
      return { codex: cli("missing"), kimi: cli("missing") };
    case "both-unavailable":
      return { codex: cli("unavailable"), kimi: cli("needs-login") };
    case "install-recovery":
      return { codex: cli("ready"), kimi: cli("failed") };
    case "codex-ready":
      return { codex: cli("ready"), kimi: cli("missing") };
  }
}

export function initialOnboardingState(
  scenario: EnvironmentScenario = "codex-ready",
  mode: OnboardingMode = "first-run"
): OnboardingState {
  return {
    view: mode === "replay" ? "main" : 1,
    mode,
    environment: environmentForScenario(scenario),
    selectedTeam: DEVELOPMENT_TEAM,
    replayEntryTeam: mode === "replay" ? DEVELOPMENT_TEAM : null,
    relayRun: 0
  };
}

export function isCliReady(cliState: CliState): boolean {
  return cliState.status === "ready"
    || (cliState.status === "checking" && cliState.lastKnownReady);
}

export function canContinue(state: OnboardingState): boolean {
  return state.view !== 1
    || isCliReady(state.environment.codex)
    || isCliReady(state.environment.kimi);
}

export function chooseBuilderCli(environment: EnvironmentState): CliId {
  return isCliReady(environment.codex) ? "codex" : "kimi";
}

export function runningInstallations(environment: EnvironmentState): CliId[] {
  return (["codex", "kimi"] as const).filter(
    (cliId) => environment[cliId].status === "installing"
  );
}

function updateCli(
  environment: EnvironmentState,
  cliId: CliId,
  next: Partial<CliState> & Pick<CliState, "status">
): EnvironmentState {
  const current = environment[cliId];
  const nextReady = next.status === "ready";
  return {
    ...environment,
    [cliId]: {
      ...current,
      ...next,
      lastKnownReady: nextReady
        ? true
        : next.status === "checking"
          ? current.lastKnownReady
          : false,
      installStage: next.status === "installing" ? next.installStage : undefined
    }
  };
}

export function onboardingReducer(
  state: OnboardingState,
  action: OnboardingAction
): OnboardingState {
  switch (action.type) {
    case "continue": {
      if (!canContinue(state)) {
        return state;
      }

      if (state.view === "conversation" || state.view === "main") {
        return state;
      }

      if (state.view === 4) {
        if (state.mode === "replay") {
          return {
            ...state,
            view: "main",
            selectedTeam: state.replayEntryTeam ?? state.selectedTeam
          };
        }
        return { ...state, view: "conversation" };
      }

      return {
        ...state,
        view: (state.view + 1) as OnboardingStep,
        relayRun: state.view === 2 ? state.relayRun + 1 : state.relayRun
      };
    }
    case "back": {
      if (state.view === "conversation" || state.view === "main" || state.view === 1) {
        return state;
      }

      return {
        ...state,
        view: (state.view - 1) as OnboardingStep,
        relayRun: state.view === 4 ? state.relayRun + 1 : state.relayRun
      };
    }
    case "set-cli":
      return {
        ...state,
        environment: updateCli(state.environment, action.cli, action.value)
      };
    case "start-install": {
      const current = state.environment[action.cli];
      if (!["missing", "failed", "cancelled"].includes(current.status)) {
        return state;
      }
      return {
        ...state,
        environment: updateCli(state.environment, action.cli, {
          status: "installing",
          installStage: "starting",
          attempt: current.attempt + 1
        })
      };
    }
    case "cancel-install":
      if (state.environment[action.cli].status !== "installing") {
        return state;
      }
      return {
        ...state,
        environment: updateCli(state.environment, action.cli, {
          status: "cancelled"
        })
      };
    case "start-recheck":
      return {
        ...state,
        environment: {
          codex: state.environment.codex.status === "installing"
            ? state.environment.codex
            : {
                ...state.environment.codex,
                status: "checking",
                lastKnownReady: isCliReady(state.environment.codex)
              },
          kimi: state.environment.kimi.status === "installing"
            ? state.environment.kimi
            : {
                ...state.environment.kimi,
                status: "checking",
                lastKnownReady: isCliReady(state.environment.kimi)
              }
        }
      };
    case "select-team":
      return {
        ...state,
        selectedTeam: action.team
      };
    case "replay-relay":
      return {
        ...state,
        relayRun: state.relayRun + 1
      };
    case "enter-replay":
      return {
        ...state,
        view: 1,
        mode: "replay",
        replayEntryTeam: state.selectedTeam,
        relayRun: 0
      };
    case "exit-replay":
      if (state.mode !== "replay") {
        return state;
      }
      return {
        ...state,
        view: "main",
        selectedTeam: state.replayEntryTeam ?? state.selectedTeam
      };
    case "reset":
      return initialOnboardingState(
        action.scenario ?? "codex-ready",
        action.mode ?? "first-run"
      );
  }
}
