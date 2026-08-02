import { describe, expect, it } from "vitest";

import {
  decideMessageAgentSource,
  decideMessageRecoveryStore,
  decidePrimaryMessageAdmission,
  decideSubmittedMessageDispatch,
  decideSubmittedMessageWake,
  planMessagePrimaryAgent,
  planMessageResumeLink,
  planPersistedPrimaryRun,
  planSubmittedMessageContent,
} from "../src/local-console/message-command-plan.js";
import type { LocalConsoleMessage, LocalConsoleSessionSummary } from "../src/local-console/types.js";

describe("local console message command plan", () => {
  it("validates and serializes the submitted body before persistence", () => {
    expect(() => planSubmittedMessageContent({ body: "  ", attachmentIds: [], textFragments: [] }))
      .toThrow("Message body must not be empty");
    expect(() => planSubmittedMessageContent({ body: "ok", attachmentIds: ["a", "a"], textFragments: [] }))
      .toThrow("Attachment ids must be unique");
    expect(planSubmittedMessageContent({
      body: "  inspect  ",
      attachmentIds: ["a"],
      textFragments: [{ id: "source", label: "Source", text: "record" }],
    })).toEqual({
      trimmed: "inspect",
      persistedBody: "> 来源：\n> - record\n\ninspect",
      attachmentIds: ["a"],
    });
  });

  it("rejects only an orphaned persisted primary claim", () => {
    expect(decidePrimaryMessageAdmission({ activePrimary: false, persistedPrimary: true }))
      .toEqual({ kind: "busy" });
    expect(decidePrimaryMessageAdmission({ activePrimary: true, persistedPrimary: true }))
      .toEqual({ kind: "accept" });
  });

  it("holds messages for a pending team and wakes only worker dispatches", () => {
    const session = { agentTeamPendingId: "team-next" } as LocalConsoleSessionSummary;
    const decision = decideSubmittedMessageDispatch(session);
    expect(decision).toMatchObject({ kind: "awaiting-team", dispatch: { lane: "awaiting-team", role: null } });
    expect(decision.kind === "awaiting-team" && decideSubmittedMessageWake(decision.dispatch))
      .toEqual({ kind: "primary" });
    expect(decideSubmittedMessageWake({ lane: "worker", role: "qa", reason: "single-valid-mention" }))
      .toEqual({ kind: "worker" });
  });

  it("plans persisted-primary and recovery lookup inputs", () => {
    const persisted = [{ speaker: "user", status: "running", dispatchLane: "primary" }] as LocalConsoleMessage[];
    const execution = { runId: "run-1", role: "dev", engine: "codex" };
    const codex = { runId: "run-2", role: "qa", threadId: "thread-1" };

    expect(planPersistedPrimaryRun(persisted)).toBe(true);
    expect(decideMessageAgentSource(null)).toEqual({ kind: "files" });
    expect(planMessagePrimaryAgent([])).toEqual({ kind: "missing" });
    expect(planMessagePrimaryAgent(["ceo", "dev"])).toEqual({ kind: "found", primaryAgent: "ceo" });
    expect(decideMessageRecoveryStore(null)).toEqual({ kind: "unavailable" });
    expect(planMessageResumeLink([execution], [codex], "run-2")).toBe(codex);
  });
});
