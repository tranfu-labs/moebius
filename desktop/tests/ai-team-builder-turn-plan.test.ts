import { describe, expect, it } from "vitest";

import { createAiTeamBuilderDraft } from "../src/ai-team-builder/state-machine.js";
import {
  planAiTeamBuilderDriverResult,
  planAiTeamBuilderExternalSessionLink,
  planAiTeamBuilderOutput,
  planAiTeamBuilderOutputValidation,
  planAiTeamBuilderTurnCommit,
} from "../src/ai-team-builder/turn-plan.js";
import { parseAndValidateAiTeamBuilderOutput } from "../src/ai-team-builder/validator.js";

describe("AI team builder turn plans", () => {
  it("maps provider failures without exposing adapter-specific branching", () => {
    expect(planAiTeamBuilderDriverResult({
      ok: false,
      reason: "lost",
      resumeFailed: true,
      externalSessionId: "session-1",
    })).toEqual({
      kind: "failure",
      error: { kind: "resume-failed", internalReason: "lost" },
      externalSessionId: "session-1",
    });
  });

  it("allows one repair and then fails invalid output closed", () => {
    const invalid = parseAndValidateAiTeamBuilderOutput("not-json");

    expect(planAiTeamBuilderOutput(invalid, false)).toMatchObject({ kind: "repair" });
    expect(planAiTeamBuilderOutput(invalid, true)).toMatchObject({
      kind: "failure",
      error: { kind: "invalid-output" },
    });
  });

  it("validates schema-native provider output before falling back to final text", () => {
    const decision = planAiTeamBuilderDriverResult({
      ok: true,
      finalText: "not-json-diagnostic-fallback",
      structuredOutput: { phase: "clarifying", question: "面向谁？" },
      externalSessionId: "session-1",
    });

    expect(decision.kind).toBe("success");
    if (decision.kind !== "success") return;
    expect(planAiTeamBuilderOutputValidation(decision)).toEqual({
      ok: true,
      value: { phase: "clarifying", question: "面向谁？" },
    });
  });

  it("persists one observed session and rejects a conflicting replacement", () => {
    const draft = createAiTeamBuilderDraft("draft-1");
    const linked = planAiTeamBuilderExternalSessionLink(draft, "session-1");

    expect(linked).toMatchObject({
      persist: true,
      draft: { externalSessionId: "session-1" },
    });
    expect(planAiTeamBuilderExternalSessionLink(linked.draft, "session-1")).toMatchObject({
      persist: false,
    });
    expect(() => planAiTeamBuilderExternalSessionLink(linked.draft, "session-2")).toThrow(
      "conflicting session id",
    );
  });

  it("commits only the still-current running turn", () => {
    const draft = { ...createAiTeamBuilderDraft("draft-1"), phase: "running" as const, turnRevision: 2 };

    expect(planAiTeamBuilderTurnCommit(draft, 2)).toBe("commit");
    expect(planAiTeamBuilderTurnCommit({ ...draft, turnRevision: 3 }, 2)).toBe("skip");
  });
});
