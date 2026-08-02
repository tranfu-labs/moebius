import type { AiTeamBuilderDraft } from "./state-machine.js";

export type AiTeamBuilderActionDecision =
  | { kind: "allow" }
  | { kind: "reject"; message: string };

export type AiTeamBuilderRetryDecision =
  | { kind: "commit"; proposalRevision: number }
  | { kind: "turn"; prompt: string }
  | { kind: "reject"; message: string };

export function planAiTeamBuilderSubmit(draft: AiTeamBuilderDraft): AiTeamBuilderActionDecision {
  return draft.phase === "idle" || draft.phase === "clarifying"
    ? { kind: "allow" }
    : { kind: "reject", message: `Cannot submit input while ${draft.phase}.` };
}

export function planAiTeamBuilderAdjustment(
  draft: AiTeamBuilderDraft,
): AiTeamBuilderActionDecision {
  return draft.phase === "proposal"
    ? { kind: "allow" }
    : { kind: "reject", message: "A proposal can only be adjusted while it is current." };
}

export function planAiTeamBuilderRetry(draft: AiTeamBuilderDraft): AiTeamBuilderRetryDecision {
  if (draft.phase !== "failed") {
    return {
      kind: "reject",
      message: "Only a failed AI team builder draft can be retried.",
    };
  }
  if (draft.failedFrom === "commit") {
    return draft.proposal !== null && draft.proposalRevision !== null
      ? { kind: "commit", proposalRevision: draft.proposalRevision }
      : { kind: "reject", message: "The failed draft has no proposal to create." };
  }
  return draft.pendingPrompt === null
    ? { kind: "reject", message: "The failed draft has no turn to retry." }
    : { kind: "turn", prompt: draft.pendingPrompt };
}

export function planAiTeamBuilderMutationAvailability(isRunning: boolean): AiTeamBuilderActionDecision {
  return isRunning
    ? { kind: "reject", message: "An AI team builder operation is already running." }
    : { kind: "allow" };
}

export function planAiTeamBuilderExecutionProfile(draft: AiTeamBuilderDraft): "keep" | "resolve" {
  return draft.executionProfile === null ? "resolve" : "keep";
}
