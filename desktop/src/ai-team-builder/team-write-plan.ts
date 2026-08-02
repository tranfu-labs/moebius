import {
  createUniqueAgentSlug,
  evaluateTeamStatus,
  validateTeamStructure,
  type AgentMarkdownIdentity,
  type TeamDefinition,
} from "../team-model.js";
import {
  renderAiTeamMemberMarkdown,
  validateAiTeamBuilderOutput,
  type AiTeamBuilderProposal,
} from "./validator.js";
import { AiTeamWriterError } from "./team-write-error.js";

export type AiTeamWritePlanResult =
  | {
      ok: true;
      teamId: string;
      definition: TeamDefinition;
      orchestration: { version: 1; relayBeats: AiTeamBuilderProposal["relayBeats"] };
      members: Array<{ slug: string; agentMarkdown: string }>;
    }
  | { ok: false; reason: "invalid-proposal" };

export type AiTeamStagedValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "definition-structure"
        | "definition-identity"
        | "member-order"
        | "relay-beats"
        | "unexpected-member"
        | "member-identity"
        | "proposal"
        | "not-usable";
      message: string;
      slug?: string;
    };

export type AiTeamWriteDeviceDecision =
  | { ok: true }
  | { ok: false; message: string };

export function planAiTeamWrite(
  proposal: AiTeamBuilderProposal,
  randomPart: string,
): AiTeamWritePlanResult {
  const validation = validateAiTeamBuilderOutput({ phase: "proposal", ...proposal });
  if (!validation.ok || validation.value.phase !== "proposal") {
    return { ok: false, reason: "invalid-proposal" };
  }
  const normalized = validation.value;
  const safeRandomPart = randomPart
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "")
    .slice(0, 12) || "generated";
  return {
    ok: true,
    teamId: `${createUniqueAgentSlug(normalized.team.name, [])}-${safeRandomPart}`,
    definition: {
      name: normalized.team.name,
      description: normalized.team.purpose,
      primaryAgentSlug: normalized.primaryAgentSlug,
      memberOrder: normalized.members.map((member) => member.slug),
    },
    orchestration: {
      version: 1,
      relayBeats: normalized.relayBeats.map((beat) => ({ ...beat })),
    },
    members: normalized.members.map((member) => ({
      slug: member.slug,
      agentMarkdown: renderAiTeamMemberMarkdown(member),
    })),
  };
}

export function planAiTeamStagedValidation(input: {
  proposal: AiTeamBuilderProposal;
  definition: TeamDefinition;
  orchestration: { relayBeats: readonly { speakerSlug: string; message: string }[] };
  members: readonly {
    slug: string;
    identity: AgentMarkdownIdentity;
    agentMarkdown: string;
  }[];
}): AiTeamStagedValidationResult {
  if (validateTeamStructure(input.definition).length > 0) {
    return {
      ok: false,
      reason: "definition-structure",
      message: "Staged team manifest failed structural validation.",
    };
  }
  if (
    input.definition.name !== input.proposal.team.name
    || input.definition.description !== input.proposal.team.purpose
    || input.definition.primaryAgentSlug !== input.proposal.primaryAgentSlug
  ) {
    return {
      ok: false,
      reason: "definition-identity",
      message: "Staged team manifest does not match the validated proposal.",
    };
  }
  if (!sameStrings(
    input.definition.memberOrder,
    input.proposal.members.map((member) => member.slug),
  )) {
    return {
      ok: false,
      reason: "member-order",
      message: "Staged team member order does not match the proposal.",
    };
  }
  if (!sameRelayBeats(input.orchestration.relayBeats, input.proposal.relayBeats)) {
    return {
      ok: false,
      reason: "relay-beats",
      message: "Staged team relay beats do not match the proposal.",
    };
  }
  for (const member of input.members) {
    const expected = input.proposal.members.find((candidate) => candidate.slug === member.slug);
    if (expected === undefined) {
      return {
        ok: false,
        reason: "unexpected-member",
        message: `Staged team contains an unexpected member: ${member.slug}`,
        slug: member.slug,
      };
    }
    if (
      member.identity.displayName !== expected.name
      || member.identity.description !== expected.role
      || member.agentMarkdown !== renderAiTeamMemberMarkdown(expected)
    ) {
      return {
        ok: false,
        reason: "member-identity",
        message: `Staged member does not match the validated proposal: ${member.slug}`,
        slug: member.slug,
      };
    }
  }
  const proposalValidation = validateAiTeamBuilderOutput({
    phase: "proposal",
    ...input.proposal,
  });
  if (!proposalValidation.ok || proposalValidation.value.phase !== "proposal") {
    return {
      ok: false,
      reason: "proposal",
      message: "Staged team proposal failed final business validation.",
    };
  }
  const readiness = evaluateTeamStatus({ definition: input.definition });
  if (readiness.status !== "usable" || input.members.length !== input.proposal.members.length) {
    return {
      ok: false,
      reason: "not-usable",
      message: "Staged team is not complete and usable.",
    };
  }
  return { ok: true };
}

export function decideAiTeamWriteDevice(
  teamsDevice: number,
  stagingDevice: number,
): AiTeamWriteDeviceDecision {
  return teamsDevice === stagingDevice
    ? { ok: true }
    : {
        ok: false,
        message: "AI team staging and teams directories must be on the same filesystem.",
      };
}

export function planAiTeamWriteCleanup(input: {
  renamed: boolean;
  staging: string | null;
  destination: string;
}): { kind: "skip" } | { kind: "remove"; target: string } {
  if (input.staging === null) {
    return { kind: "skip" };
  }
  return {
    kind: "remove",
    target: input.renamed ? input.destination : input.staging,
  };
}

export function planAiTeamWriteError(error: unknown): AiTeamWriterError {
  return error instanceof AiTeamWriterError
    ? error
    : new AiTeamWriterError("Could not create the AI team atomically.", { cause: error });
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameRelayBeats(
  left: readonly { speakerSlug: string; message: string }[],
  right: readonly { speakerSlug: string; message: string }[],
): boolean {
  return left.length === right.length && left.every((value, index) =>
    value.speakerSlug === right[index]?.speakerSlug
    && value.message === right[index]?.message);
}
