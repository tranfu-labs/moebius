import type { ExecutionProfile } from "../team-execution-profile.js";
import type { AiTeamBuilderProposal } from "./validator.js";

export const AI_TEAM_BUILDER_FIRST_QUESTION = "你希望这支团队长期替你完成什么工作？";

export type AiTeamBuilderPhase =
  | "idle"
  | "running"
  | "clarifying"
  | "proposal"
  | "failed"
  | "committing"
  | "selected";

export interface AiTeamBuilderMessage {
  role: "user" | "assistant";
  text: string;
}

export type AiTeamBuilderFailureKind =
  | "engine-failed"
  | "resume-failed"
  | "invalid-output"
  | "commit-failed"
  | "interrupted";

export interface AiTeamBuilderInternalError {
  kind: AiTeamBuilderFailureKind;
  internalReason: string;
}

export interface AiTeamBuilderDraft {
  version: 3;
  draftId: string;
  phase: AiTeamBuilderPhase;
  messages: AiTeamBuilderMessage[];
  proposal: AiTeamBuilderProposal | null;
  proposalRevision: number | null;
  executionProfile: ExecutionProfile | null;
  externalSessionId: string | null;
  turnRevision: number;
  pendingPrompt: string | null;
  error: AiTeamBuilderInternalError | null;
  failedFrom: "turn" | "commit" | null;
  selectedTeamId: string | null;
  continuationEnded?: boolean;
}

export function createAiTeamBuilderDraft(draftId: string): AiTeamBuilderDraft {
  return {
    version: 3,
    draftId,
    phase: "idle",
    messages: [
      {
        role: "assistant",
        text: `${AI_TEAM_BUILDER_FIRST_QUESTION}\n\n先说目标就好，不需要想好角色和分工。`,
      },
    ],
    proposal: null,
    proposalRevision: null,
    executionProfile: null,
    externalSessionId: null,
    turnRevision: 0,
    pendingPrompt: null,
    error: null,
    failedFrom: null,
    selectedTeamId: null,
    continuationEnded: false,
  };
}

export function beginAiTeamBuilderTurn(
  draft: AiTeamBuilderDraft,
  prompt: string,
  options: { appendUserMessage: boolean },
): AiTeamBuilderDraft {
  if (draft.continuationEnded === true) {
    throw new AiTeamBuilderTransitionError("This AI team builder draft is read-only.");
  }
  const normalizedPrompt = prompt.trim();
  if (normalizedPrompt.length === 0) {
    throw new AiTeamBuilderTransitionError("AI team builder input cannot be empty.");
  }
  if (!["idle", "clarifying", "proposal", "failed"].includes(draft.phase)) {
    throw new AiTeamBuilderTransitionError(`Cannot start a turn from ${draft.phase}.`);
  }
  return {
    ...draft,
    phase: "running",
    messages: options.appendUserMessage
      ? [...draft.messages, { role: "user", text: normalizedPrompt }]
      : draft.messages,
    turnRevision: draft.turnRevision + 1,
    pendingPrompt: normalizedPrompt,
    error: null,
    failedFrom: null,
    selectedTeamId: null,
  };
}

export function assignAiTeamBuilderExecutionProfile(
  draft: AiTeamBuilderDraft,
  executionProfile: ExecutionProfile,
): AiTeamBuilderDraft {
  if (draft.executionProfile !== null) {
    return draft;
  }
  if (draft.phase !== "idle") {
    throw new AiTeamBuilderTransitionError(
      `Cannot assign an execution profile while ${draft.phase}.`,
    );
  }
  return {
    ...draft,
    executionProfile: { ...executionProfile },
  };
}

export function acceptAiTeamBuilderClarifying(
  draft: AiTeamBuilderDraft,
  question: string,
  externalSessionId: string,
): AiTeamBuilderDraft {
  assertRunning(draft);
  return {
    ...draft,
    phase: "clarifying",
    messages: [...draft.messages, { role: "assistant", text: question }],
    externalSessionId,
    pendingPrompt: null,
    error: null,
    failedFrom: null,
  };
}

export function acceptAiTeamBuilderProposal(
  draft: AiTeamBuilderDraft,
  proposal: AiTeamBuilderProposal,
  externalSessionId: string,
): AiTeamBuilderDraft {
  assertRunning(draft);
  const proposalRevision = (draft.proposalRevision ?? 0) + 1;
  return {
    ...draft,
    phase: "proposal",
    messages: [
      ...draft.messages,
      {
        role: "assistant",
        text: `我整理了一版「${proposal.team.name}」团队方案，你可以继续调整或创建并选中。`,
      },
    ],
    proposal,
    proposalRevision,
    externalSessionId,
    pendingPrompt: null,
    error: null,
    failedFrom: null,
  };
}

export function failAiTeamBuilderDraft(
  draft: AiTeamBuilderDraft,
  error: AiTeamBuilderInternalError,
  failedFrom: "turn" | "commit",
): AiTeamBuilderDraft {
  return {
    ...draft,
    phase: "failed",
    error,
    failedFrom,
    selectedTeamId: null,
  };
}

export function beginAiTeamBuilderCommit(
  draft: AiTeamBuilderDraft,
  proposalRevision: number,
): AiTeamBuilderDraft {
  if (draft.continuationEnded === true) {
    throw new AiTeamBuilderTransitionError("This AI team builder draft is read-only.");
  }
  const canCommit = draft.phase === "proposal"
    || (draft.phase === "failed" && draft.failedFrom === "commit");
  if (!canCommit || draft.proposal === null || draft.proposalRevision === null) {
    throw new AiTeamBuilderTransitionError("There is no current AI team proposal to commit.");
  }
  if (proposalRevision !== draft.proposalRevision) {
    throw new AiTeamBuilderStaleRevisionError();
  }
  return {
    ...draft,
    phase: "committing",
    error: null,
    failedFrom: null,
  };
}

export function selectAiTeamBuilderTeam(
  draft: AiTeamBuilderDraft,
  teamId: string,
): AiTeamBuilderDraft {
  if (draft.phase !== "committing") {
    throw new AiTeamBuilderTransitionError(`Cannot select a team from ${draft.phase}.`);
  }
  return {
    ...draft,
    phase: "selected",
    pendingPrompt: null,
    error: null,
    failedFrom: null,
    selectedTeamId: teamId,
  };
}

export function recoverInterruptedAiTeamBuilderDraft(draft: AiTeamBuilderDraft): AiTeamBuilderDraft {
  if (draft.phase !== "running" && draft.phase !== "committing") {
    return draft;
  }
  return failAiTeamBuilderDraft(
    draft,
    {
      kind: "interrupted",
      internalReason: `application-restarted-during-${draft.phase}`,
    },
    draft.phase === "committing" ? "commit" : "turn",
  );
}

function assertRunning(draft: AiTeamBuilderDraft): void {
  if (draft.phase !== "running") {
    throw new AiTeamBuilderTransitionError(`Expected running draft, got ${draft.phase}.`);
  }
}

export class AiTeamBuilderTransitionError extends Error {
  readonly code = "AI_TEAM_BUILDER_TRANSITION_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "AiTeamBuilderTransitionError";
  }
}

export class AiTeamBuilderStaleRevisionError extends AiTeamBuilderTransitionError {
  readonly staleCode = "AI_TEAM_BUILDER_STALE_REVISION";

  constructor() {
    super("The requested proposal revision is no longer current.");
    this.name = "AiTeamBuilderStaleRevisionError";
  }
}
