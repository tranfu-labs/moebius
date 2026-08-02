import { describe, expect, it } from "vitest";

import {
  planAiTeamBuilderStoredDraft,
  requireAiTeamBuilderExecutionProfile,
} from "../src/ai-team-builder/draft-persistence-plan.js";

const legacyExecutionProfile = {
  cli: "codex" as const,
  model: "legacy-codex",
  effort: "high",
};

describe("AI team builder draft persistence plans", () => {
  it("creates and persists a missing draft", () => {
    expect(planAiTeamBuilderStoredDraft({
      source: null,
      expectedDraftId: "draft-1",
      legacyExecutionProfile,
      recoverInterrupted: true,
    })).toMatchObject({
      persist: true,
      draft: { version: 3, draftId: "draft-1", phase: "idle" },
    });
  });

  it("migrates v1 identity and failure fields without probing another provider", () => {
    const result = planAiTeamBuilderStoredDraft({
      source: JSON.stringify({
        version: 1,
        draftId: "draft-1",
        phase: "failed",
        messages: [],
        proposal: null,
        proposalRevision: null,
        threadId: "legacy-thread",
        turnRevision: 1,
        pendingPrompt: "retry",
        error: { kind: "codex-failed", internalReason: "failed" },
        failedFrom: "turn",
        selectedTeamId: null,
      }),
      expectedDraftId: "draft-1",
      legacyExecutionProfile,
      recoverInterrupted: true,
    });

    expect(result).toMatchObject({
      persist: true,
      draft: {
        version: 3,
        externalSessionId: "legacy-thread",
        executionProfile: legacyExecutionProfile,
        error: { kind: "engine-failed" },
      },
    });
  });

  it("recovers interrupted v3 work only when the caller requests recovery", () => {
    const source = JSON.stringify({
      version: 3,
      draftId: "draft-1",
      phase: "running",
      messages: [],
      proposal: null,
      proposalRevision: null,
      executionProfile: legacyExecutionProfile,
      externalSessionId: "session-1",
      turnRevision: 1,
      pendingPrompt: "work",
      error: null,
      failedFrom: null,
      selectedTeamId: null,
    });

    expect(planAiTeamBuilderStoredDraft({
      source,
      expectedDraftId: "draft-1",
      legacyExecutionProfile,
      recoverInterrupted: false,
    })).toMatchObject({ persist: false, draft: { phase: "running" } });
    expect(planAiTeamBuilderStoredDraft({
      source,
      expectedDraftId: "draft-1",
      legacyExecutionProfile,
      recoverInterrupted: true,
    })).toMatchObject({ persist: true, draft: { phase: "failed", error: { kind: "interrupted" } } });
  });

  it("fails closed on identity, version, and missing execution-profile contracts", () => {
    expect(() => planAiTeamBuilderStoredDraft({
      source: JSON.stringify({ version: 99, draftId: "draft-1", phase: "idle", messages: [] }),
      expectedDraftId: "draft-1",
      legacyExecutionProfile,
      recoverInterrupted: true,
    })).toThrow("version is unsupported");
    expect(() => planAiTeamBuilderStoredDraft({
      source: null,
      expectedDraftId: "../draft",
      legacyExecutionProfile,
      recoverInterrupted: true,
    })).toThrow("Invalid AI team builder draft id");
    const missingProfile = planAiTeamBuilderStoredDraft({
      source: null,
      expectedDraftId: "draft-1",
      legacyExecutionProfile,
      recoverInterrupted: true,
    }).draft;
    expect(() => requireAiTeamBuilderExecutionProfile(missingProfile)).toThrow(
      "execution profile is not assigned",
    );
  });
});
