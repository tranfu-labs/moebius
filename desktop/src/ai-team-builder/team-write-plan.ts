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
        | "not-usable"
        | "cross-device";
      slug?: string;
    };

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
  teamsDevice: number;
  stagingDevice: number;
}): AiTeamStagedValidationResult {
  if (input.teamsDevice !== input.stagingDevice) {
    return { ok: false, reason: "cross-device" };
  }
  if (validateTeamStructure(input.definition).length > 0) {
    return { ok: false, reason: "definition-structure" };
  }
  if (
    input.definition.name !== input.proposal.team.name
    || input.definition.description !== input.proposal.team.purpose
    || input.definition.primaryAgentSlug !== input.proposal.primaryAgentSlug
  ) {
    return { ok: false, reason: "definition-identity" };
  }
  if (!sameStrings(
    input.definition.memberOrder,
    input.proposal.members.map((member) => member.slug),
  )) {
    return { ok: false, reason: "member-order" };
  }
  if (!sameRelayBeats(input.orchestration.relayBeats, input.proposal.relayBeats)) {
    return { ok: false, reason: "relay-beats" };
  }
  for (const member of input.members) {
    const expected = input.proposal.members.find((candidate) => candidate.slug === member.slug);
    if (expected === undefined) {
      return { ok: false, reason: "unexpected-member", slug: member.slug };
    }
    if (
      member.identity.displayName !== expected.name
      || member.identity.description !== expected.role
      || member.agentMarkdown !== renderAiTeamMemberMarkdown(expected)
    ) {
      return { ok: false, reason: "member-identity", slug: member.slug };
    }
  }
  const proposalValidation = validateAiTeamBuilderOutput({
    phase: "proposal",
    ...input.proposal,
  });
  if (!proposalValidation.ok || proposalValidation.value.phase !== "proposal") {
    return { ok: false, reason: "proposal" };
  }
  const readiness = evaluateTeamStatus({ definition: input.definition });
  if (readiness.status !== "usable" || input.members.length !== input.proposal.members.length) {
    return { ok: false, reason: "not-usable" };
  }
  return { ok: true };
}

export function planAiTeamWriteCleanupTarget(input: {
  renamed: boolean;
  staging: string;
  destination: string;
}): string {
  return input.renamed ? input.destination : input.staging;
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
