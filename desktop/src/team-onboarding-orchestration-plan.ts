import { TEAM_MANIFEST_FILE, type TeamDefinition } from "./team-model.js";

export const TEAM_ONBOARDING_ORCHESTRATION_FILE = "onboarding-orchestration.json";

export interface TeamRelayBeat {
  speakerSlug: string;
  message: string;
}

export interface TeamOnboardingOrchestration {
  version: 1;
  relayBeats: TeamRelayBeat[];
}

export type TeamOnboardingOrchestrationReadResult =
  | {
      status: "ready";
      source: "independent" | "embedded";
      orchestration: TeamOnboardingOrchestration;
    }
  | { status: "missing" }
  | { status: "invalid" };

export type LegacyOnboardingPreservationPlan =
  | { status: "skip" }
  | {
      status: "write";
      memberOrder: string[];
      orchestration: TeamOnboardingOrchestration;
    };

export function parseTeamOnboardingOrchestrationJson(
  source: string,
  memberOrder: readonly string[],
): TeamOnboardingOrchestration {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new TeamOnboardingOrchestrationError(
      `${TEAM_ONBOARDING_ORCHESTRATION_FILE} must contain valid JSON`,
    );
  }
  return parseTeamOnboardingOrchestrationValue(value, memberOrder);
}

export function serializeTeamOnboardingOrchestration(
  orchestration: TeamOnboardingOrchestration,
): string {
  return `${JSON.stringify(orchestration, null, 2)}\n`;
}

export function readLegacyEmbeddedOnboardingOrchestration(
  value: unknown,
  memberOrder: readonly string[],
): TeamOnboardingOrchestrationReadResult {
  if (!isPlainObject(value) || !Object.hasOwn(value, "relayBeats")) {
    return { status: "missing" };
  }
  try {
    return {
      status: "ready",
      source: "embedded",
      orchestration: parseTeamOnboardingOrchestrationValue({
        version: 1,
        relayBeats: value.relayBeats,
      }, memberOrder),
    };
  } catch {
    return { status: "invalid" };
  }
}

export function planLegacyOnboardingPreservation(source: string): LegacyOnboardingPreservationPlan {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return { status: "skip" };
  }
  if (!isPlainObject(value) || !Array.isArray(value.memberOrder)) {
    return { status: "skip" };
  }
  const memberOrder = value.memberOrder.filter((candidate): candidate is string =>
    typeof candidate === "string");
  const embedded = readLegacyEmbeddedOnboardingOrchestration(value, memberOrder);
  if (embedded.status !== "ready") {
    return { status: "skip" };
  }
  return {
    status: "write",
    memberOrder,
    orchestration: embedded.orchestration,
  };
}

export function serializeLegacyRelayInclusiveTeamDefinition(
  definition: TeamDefinition,
  relayBeats: readonly TeamRelayBeat[],
): string {
  return `${JSON.stringify({
    name: definition.name,
    description: definition.description,
    primaryAgentSlug: definition.primaryAgentSlug,
    memberOrder: definition.memberOrder,
    relayBeats,
  }, null, 2)}\n`;
}

export class TeamOnboardingOrchestrationError extends Error {
  readonly code = "TEAM_ONBOARDING_ORCHESTRATION_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "TeamOnboardingOrchestrationError";
  }
}

function parseTeamOnboardingOrchestrationValue(
  value: unknown,
  memberOrder: readonly string[],
): TeamOnboardingOrchestration {
  if (!isPlainObject(value)) {
    throw new TeamOnboardingOrchestrationError(
      `${TEAM_ONBOARDING_ORCHESTRATION_FILE} must contain a JSON object`,
    );
  }
  const unexpectedTopLevelKey = Object.keys(value)
    .find((key) => key !== "version" && key !== "relayBeats");
  if (unexpectedTopLevelKey !== undefined || value.version !== 1 || !Array.isArray(value.relayBeats)) {
    throw new TeamOnboardingOrchestrationError(
      `${TEAM_ONBOARDING_ORCHESTRATION_FILE} has an unsupported shape`,
    );
  }
  if (value.relayBeats.length === 0) {
    throw new TeamOnboardingOrchestrationError(
      `${TEAM_ONBOARDING_ORCHESTRATION_FILE} relayBeats must be a non-empty array`,
    );
  }
  const relayBeats = value.relayBeats.map((candidate, index) => {
    if (!isPlainObject(candidate)) {
      throw new TeamOnboardingOrchestrationError(
        `${TEAM_ONBOARDING_ORCHESTRATION_FILE} relayBeats[${String(index)}] must be an object`,
      );
    }
    const unexpectedBeatKey = Object.keys(candidate)
      .find((key) => key !== "speakerSlug" && key !== "message");
    if (
      unexpectedBeatKey !== undefined
      || typeof candidate.speakerSlug !== "string"
      || candidate.speakerSlug.trim().length === 0
      || candidate.speakerSlug.trim() !== candidate.speakerSlug
      || typeof candidate.message !== "string"
      || candidate.message.trim().length === 0
      || !memberOrder.includes(candidate.speakerSlug)
    ) {
      throw new TeamOnboardingOrchestrationError(
        `${TEAM_ONBOARDING_ORCHESTRATION_FILE} relayBeats[${String(index)}] is invalid`,
      );
    }
    return {
      speakerSlug: candidate.speakerSlug,
      message: candidate.message,
    };
  });
  return { version: 1, relayBeats };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
