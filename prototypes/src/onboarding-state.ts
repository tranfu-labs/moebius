export type OnboardingStep = 1 | 2 | 3 | 4;
export type EnvironmentState = "ready" | "missing" | "unavailable" | "checking";
export type OnboardingMode = "first-run" | "replay";
export type PrototypeView = OnboardingStep | "conversation" | "main";

export interface TeamChoice {
  id: string;
  name: string;
  primaryAgent: string;
  members: string[];
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
  | { type: "set-environment"; value: EnvironmentState }
  | { type: "select-team"; team: TeamChoice }
  | { type: "replay-relay" }
  | { type: "enter-replay" }
  | { type: "exit-replay" }
  | {
      type: "reset";
      environment?: EnvironmentState;
      mode?: OnboardingMode;
    };

export function initialOnboardingState(
  environment: EnvironmentState = "ready",
  mode: OnboardingMode = "first-run"
): OnboardingState {
  return {
    view: mode === "replay" ? "main" : 1,
    mode,
    environment,
    selectedTeam: DEVELOPMENT_TEAM,
    replayEntryTeam: mode === "replay" ? DEVELOPMENT_TEAM : null,
    relayRun: 0
  };
}

export function canContinue(state: OnboardingState): boolean {
  return state.view !== 1 || state.environment === "ready";
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
    case "set-environment":
      return {
        ...state,
        environment: action.value
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
        action.environment ?? "ready",
        action.mode ?? "first-run"
      );
  }
}
