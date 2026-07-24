export type OnboardingStep = 1 | 2 | 3 | 4;
export type EnvironmentState = "ready" | "missing" | "checking";
export type PrototypeView = OnboardingStep | "conversation";

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
  environment: EnvironmentState;
  selectedTeam: TeamChoice;
  relayRun: number;
}

export type OnboardingAction =
  | { type: "continue" }
  | { type: "back" }
  | { type: "set-environment"; value: EnvironmentState }
  | { type: "select-team"; team: TeamChoice }
  | { type: "replay-relay" }
  | { type: "reset"; environment?: EnvironmentState };

export function initialOnboardingState(
  environment: EnvironmentState = "ready"
): OnboardingState {
  return {
    view: 1,
    environment,
    selectedTeam: DEVELOPMENT_TEAM,
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

      if (state.view === "conversation") {
        return state;
      }

      if (state.view === 4) {
        return { ...state, view: "conversation" };
      }

      return {
        ...state,
        view: (state.view + 1) as OnboardingStep,
        relayRun: state.view === 2 ? state.relayRun + 1 : state.relayRun
      };
    }
    case "back": {
      if (state.view === "conversation" || state.view === 1) {
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
    case "reset":
      return initialOnboardingState(action.environment ?? "ready");
  }
}
