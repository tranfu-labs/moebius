import type {
  AiTeamBuilderDraft,
  AiTeamBuilderFailureKind,
  AiTeamBuilderMessage,
  AiTeamBuilderPhase,
} from "./state-machine.js";
import type { AiTeamBuilderProposal } from "./validator.js";
import type { ExecutionCli } from "../team-execution-profile.js";

export type AiTeamBuilderAction = "retry" | "cancel" | "commit" | "adjust";

export interface AiTeamBuilderErrorSummary {
  code: "temporarily-unavailable" | "invalid-response" | "context-lost" | "create-failed";
  canRetry: boolean;
}

export interface AiTeamBuilderState {
  builderCli: ExecutionCli | null;
  phase: AiTeamBuilderPhase;
  messages: AiTeamBuilderMessage[];
  proposal: AiTeamBuilderProposal | null;
  proposalRevision: number | null;
  error: AiTeamBuilderErrorSummary | null;
  actions: AiTeamBuilderAction[];
  selectedTeamId: string | null;
}

export function toAiTeamBuilderState(draft: AiTeamBuilderDraft): AiTeamBuilderState {
  return {
    builderCli: draft.executionProfile?.cli ?? null,
    phase: draft.phase,
    messages: draft.messages.map((message) => ({ role: message.role, text: message.text })),
    proposal: draft.proposal === null ? null : cloneProposal(draft.proposal),
    proposalRevision: draft.proposalRevision,
    error: draft.error === null ? null : summarizeError(draft.error.kind),
    actions: actionsForDraft(draft),
    selectedTeamId: draft.selectedTeamId,
  };
}

function actionsForDraft(draft: AiTeamBuilderDraft): AiTeamBuilderAction[] {
  switch (draft.phase) {
    case "running":
    case "committing":
      return ["cancel"];
    case "proposal":
      return ["adjust", "commit", "cancel"];
    case "failed":
      return ["retry", "cancel"];
    case "selected":
      return [];
    case "idle":
    case "clarifying":
      return ["cancel"];
  }
}

function summarizeError(kind: AiTeamBuilderFailureKind): AiTeamBuilderErrorSummary {
  switch (kind) {
    case "invalid-output":
      return {
        code: "invalid-response",
        canRetry: true,
      };
    case "resume-failed":
      return {
        code: "context-lost",
        canRetry: true,
      };
    case "commit-failed":
      return {
        code: "create-failed",
        canRetry: true,
      };
    case "engine-failed":
    case "interrupted":
      return {
        code: "temporarily-unavailable",
        canRetry: true,
      };
  }
}

function cloneProposal(proposal: AiTeamBuilderProposal): AiTeamBuilderProposal {
  return {
    team: { ...proposal.team },
    members: proposal.members.map((member) => ({
      ...member,
      responsibilities: [...member.responsibilities],
      constraints: [...member.constraints],
      handoffs: [...member.handoffs],
    })),
    primaryAgentSlug: proposal.primaryAgentSlug,
    relayBeats: proposal.relayBeats.map((beat) => ({ ...beat })),
  };
}
