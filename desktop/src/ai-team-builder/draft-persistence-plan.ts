import { isValidPathSegment } from "../team-model.js";
import {
  normalizeExecutionProfile,
  type ExecutionProfile,
} from "../team-execution-profile.js";
import { AiTeamBuilderRequestError } from "./request-error.js";
import {
  createAiTeamBuilderDraft,
  recoverInterruptedAiTeamBuilderDraft,
  type AiTeamBuilderDraft,
} from "./state-machine.js";

export function planAiTeamBuilderStoredDraft(input: {
  source: string | null;
  expectedDraftId: string;
  legacyExecutionProfile: ExecutionProfile;
  recoverInterrupted: boolean;
}): { draft: AiTeamBuilderDraft; persist: boolean } {
  assertAiTeamBuilderDraftId(input.expectedDraftId);
  if (input.source === null) {
    return { draft: createAiTeamBuilderDraft(input.expectedDraftId), persist: true };
  }
  const parsed = parseStoredDraft(
    input.source,
    input.expectedDraftId,
    input.legacyExecutionProfile,
  );
  const recovered = input.recoverInterrupted
    ? recoverInterruptedAiTeamBuilderDraft(parsed.draft)
    : parsed.draft;
  return {
    draft: recovered,
    persist: parsed.migrated || recovered !== parsed.draft,
  };
}

export function assertAiTeamBuilderDraftId(draftId: string): void {
  if (!isValidPathSegment(draftId) || draftId.trim() !== draftId) {
    throw new AiTeamBuilderRequestError("Invalid AI team builder draft id.");
  }
}

export function requireAiTeamBuilderExecutionProfile(
  draft: AiTeamBuilderDraft,
): ExecutionProfile {
  if (draft.executionProfile === null) {
    throw new AiTeamBuilderRequestError("AI team builder execution profile is not assigned.");
  }
  return draft.executionProfile;
}

export function formatAiTeamBuilderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseStoredDraft(
  source: string,
  expectedDraftId: string,
  legacyExecutionProfile: ExecutionProfile,
): { draft: AiTeamBuilderDraft; migrated: boolean } {
  const value: unknown = JSON.parse(source);
  if (!isPlainObject(value)
    || value.draftId !== expectedDraftId
    || typeof value.phase !== "string"
    || !Array.isArray(value.messages)) {
    throw new AiTeamBuilderRequestError("Stored AI team builder draft is invalid.");
  }
  if (value.version === 1) {
    const { threadId: legacyThreadId, ...legacyDraft } = value;
    const legacyError = isPlainObject(value.error) && value.error.kind === "codex-failed"
      ? { ...value.error, kind: "engine-failed" }
      : value.error;
    return {
      migrated: true,
      draft: {
        ...legacyDraft,
        version: 3,
        executionProfile: { ...legacyExecutionProfile },
        externalSessionId: typeof legacyThreadId === "string" ? legacyThreadId : null,
        error: legacyError,
        continuationEnded: false,
      } as unknown as AiTeamBuilderDraft,
    };
  }
  if (value.version === 2) {
    const { threadRebuildUsed: _legacyThreadRebuildUsed, ...legacyDraft } = value;
    const executionProfile = value.executionProfile === null
      ? null
      : normalizeExecutionProfile(value.executionProfile);
    return {
      migrated: true,
      draft: {
        ...legacyDraft,
        version: 3,
        executionProfile,
        externalSessionId: typeof value.externalSessionId === "string"
          ? value.externalSessionId
          : null,
        continuationEnded: false,
      } as unknown as AiTeamBuilderDraft,
    };
  }
  if (value.version !== 3) {
    throw new AiTeamBuilderRequestError("Stored AI team builder draft version is unsupported.");
  }
  const executionProfile = value.executionProfile === null
    ? null
    : normalizeExecutionProfile(value.executionProfile);
  return {
    migrated: false,
    draft: {
      ...value,
      executionProfile,
      externalSessionId: typeof value.externalSessionId === "string"
        ? value.externalSessionId
        : null,
      continuationEnded: value.continuationEnded === true,
    } as unknown as AiTeamBuilderDraft,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
