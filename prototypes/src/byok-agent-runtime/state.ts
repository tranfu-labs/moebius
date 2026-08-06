export type PrototypeScene =
  | "onboarding"
  | "settings"
  | "teams"
  | "conversation"
  | "agent";

export type ProviderStatus = "ready" | "attention" | "disabled" | "removed";

export type ValidationStage =
  | "idle"
  | "reply"
  | "tools"
  | "saving"
  | "failed";

export type ConversationFixture =
  | "running"
  | "key-invalid"
  | "model-removed"
  | "migrated"
  | "compressed";

export interface ProviderProfile {
  exists: boolean;
  name: string;
  service: "DeepSeek";
  defaultModel: string;
  models: string[];
  status: ProviderStatus;
  lastVerified: string;
}

export interface ByokPrototypeState {
  scene: PrototypeScene;
  onboardingStep: 1 | 2 | 3 | 4;
  provider: ProviderProfile;
  validation: ValidationStage;
  failNextValidation: boolean;
  teamBound: boolean;
  teamUpdateState: "idle" | "saving" | "failed";
  conversationFixture: ConversationFixture;
}

export type ByokPrototypeEvent =
  | { type: "scene"; scene: PrototypeScene }
  | { type: "onboarding-step"; step: 1 | 2 | 3 | 4 }
  | { type: "start-validation"; name: string; model: string }
  | { type: "advance-validation" }
  | { type: "validation-failed" }
  | { type: "retry-validation" }
  | { type: "fail-next-validation" }
  | { type: "start-team-update" }
  | { type: "team-update-succeeded" }
  | { type: "team-update-failed" }
  | { type: "provider-status"; status: ProviderStatus }
  | { type: "conversation-fixture"; fixture: ConversationFixture }
  | { type: "migration-succeeded"; model: string };

export function createByokPrototypeState(): ByokPrototypeState {
  return {
    scene: "onboarding",
    onboardingStep: 1,
    provider: {
      exists: false,
      name: "工作档案",
      service: "DeepSeek",
      defaultModel: "deepseek-chat",
      models: ["deepseek-chat"],
      status: "ready",
      lastVerified: "尚未验证"
    },
    validation: "idle",
    failNextValidation: false,
    teamBound: false,
    teamUpdateState: "idle",
    conversationFixture: "running"
  };
}

export function reduceByokPrototypeState(
  state: ByokPrototypeState,
  event: ByokPrototypeEvent
): ByokPrototypeState {
  switch (event.type) {
    case "scene":
      return { ...state, scene: event.scene };
    case "onboarding-step":
      return { ...state, onboardingStep: event.step };
    case "start-validation":
      return {
        ...state,
        validation: "reply",
        provider: {
          ...state.provider,
          name: event.name,
          defaultModel: event.model,
          models: [event.model]
        }
      };
    case "advance-validation":
      if (state.validation === "reply") {
        return { ...state, validation: "tools" };
      }
      if (state.validation === "tools") {
        if (state.failNextValidation) {
          return {
            ...state,
            validation: "failed",
            failNextValidation: false
          };
        }
        return { ...state, validation: "saving" };
      }
      if (state.validation === "saving") {
        return {
          ...state,
          validation: "idle",
          provider: {
            ...state.provider,
            exists: true,
            status: "ready",
            lastVerified: "刚刚 · 两项能力通过"
          }
        };
      }
      return state;
    case "validation-failed":
      return { ...state, validation: "failed" };
    case "retry-validation":
      return { ...state, validation: "reply" };
    case "fail-next-validation":
      return { ...state, failNextValidation: true };
    case "start-team-update":
      return { ...state, teamUpdateState: "saving" };
    case "team-update-succeeded":
      return { ...state, teamUpdateState: "idle", teamBound: true };
    case "team-update-failed":
      return { ...state, teamUpdateState: "failed", teamBound: false };
    case "provider-status":
      return {
        ...state,
        provider: { ...state.provider, exists: true, status: event.status }
      };
    case "conversation-fixture":
      return { ...state, conversationFixture: event.fixture };
    case "migration-succeeded":
      return {
        ...state,
        provider: {
          ...state.provider,
          status: "ready",
          defaultModel: event.model,
          models: state.provider.models.includes(event.model)
            ? state.provider.models
            : [...state.provider.models, event.model]
        },
        conversationFixture: "migrated"
      };
  }
}
