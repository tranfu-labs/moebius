import type { AiTeamBuilderDriverResult } from "./driver.js";
import { formatAiTeamBuilderError } from "./draft-persistence-plan.js";
import { AiTeamBuilderRequestError } from "./request-error.js";
import {
  acceptAiTeamBuilderClarifying,
  acceptAiTeamBuilderProposal,
  type AiTeamBuilderDraft,
  type AiTeamBuilderInternalError,
} from "./state-machine.js";
import {
  formatAiTeamBuilderValidationIssues,
  type AiTeamBuilderOutput,
  type AiTeamBuilderValidationResult,
} from "./validator.js";

export type AiTeamBuilderDriverDecision =
  | { kind: "success"; finalText: string; externalSessionId: string }
  | { kind: "failure"; error: AiTeamBuilderInternalError; externalSessionId: string | null };

export function planAiTeamBuilderDriverResult(
  result: AiTeamBuilderDriverResult,
): AiTeamBuilderDriverDecision {
  return result.ok
    ? {
        kind: "success",
        finalText: result.finalText,
        externalSessionId: result.externalSessionId,
      }
    : {
        kind: "failure",
        error: {
          kind: result.resumeFailed ? "resume-failed" : "engine-failed",
          internalReason: result.reason,
        },
        externalSessionId: result.externalSessionId,
      };
}

export function planAiTeamBuilderThrownDriverError(
  wasResume: boolean,
  error: unknown,
): AiTeamBuilderInternalError {
  return {
    kind: wasResume ? "resume-failed" : "engine-failed",
    internalReason: formatAiTeamBuilderError(error),
  };
}

export function planAiTeamBuilderOutput(
  validation: AiTeamBuilderValidationResult,
  repairAttempted: boolean,
):
  | { kind: "accept"; value: AiTeamBuilderOutput }
  | { kind: "repair"; issues: readonly { path: string; message: string }[] }
  | { kind: "failure"; error: AiTeamBuilderInternalError } {
  if (validation.ok) {
    return { kind: "accept", value: validation.value };
  }
  return repairAttempted
    ? {
        kind: "failure",
        error: {
          kind: "invalid-output",
          internalReason: formatAiTeamBuilderValidationIssues(validation.issues),
        },
      }
    : { kind: "repair", issues: validation.issues };
}

export function planAiTeamBuilderAcceptedDraft(input: {
  draft: AiTeamBuilderDraft;
  output: AiTeamBuilderOutput;
  externalSessionId: string;
}): AiTeamBuilderDraft {
  return input.output.phase === "clarifying"
    ? acceptAiTeamBuilderClarifying(
        input.draft,
        input.output.question,
        input.externalSessionId,
      )
    : acceptAiTeamBuilderProposal(
        input.draft,
        input.output,
        input.externalSessionId,
      );
}

export function planAiTeamBuilderTurnCommit(
  latest: AiTeamBuilderDraft,
  expectedTurnRevision: number,
): "commit" | "skip" {
  return latest.phase === "running" && latest.turnRevision === expectedTurnRevision
    ? "commit"
    : "skip";
}

export function planAiTeamBuilderExternalSessionLink(
  draft: AiTeamBuilderDraft,
  observedExternalSessionId: string | null,
): { draft: AiTeamBuilderDraft; persist: boolean } {
  if (observedExternalSessionId === null) {
    return { draft, persist: false };
  }
  if (
    draft.externalSessionId !== null
    && draft.externalSessionId !== observedExternalSessionId
  ) {
    throw new AiTeamBuilderRequestError(
      "AI team builder provider returned a conflicting session id.",
    );
  }
  return draft.externalSessionId === observedExternalSessionId
    ? { draft, persist: false }
    : {
        draft: { ...draft, externalSessionId: observedExternalSessionId },
        persist: true,
      };
}

export function planAiTeamBuilderRepairPrompt(
  issues: readonly { path: string; message: string }[],
): string {
  return `上一条输出未通过校验。只修复以下问题并重新返回完整 schema JSON，不要解释：\n${issues
    .map((issue) => `- ${issue.path}: ${issue.message}`)
    .join("\n")}`;
}
