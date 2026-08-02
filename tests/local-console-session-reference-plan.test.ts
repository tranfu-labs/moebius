import { describe, expect, it } from "vitest";
import {
  planSessionReferenceTarget,
  planSessionReferenceText,
} from "../src/local-console/session-reference-plan.js";
import type { LocalConsoleMessage, LocalConsoleSessionSummary } from "../src/local-console/types.js";

const session = { sessionId: "local:test", title: "Architecture" } as LocalConsoleSessionSummary;
const message = {
  id: 7,
  sessionId: "local:test",
  runId: "run-1",
  speaker: "agent",
  role: "qa",
  body: "Verified the boundary behavior",
} as LocalConsoleMessage;

describe("session reference plan", () => {
  it("selects a message by explicit id or latest matching run", () => {
    expect(planSessionReferenceTarget({ scope: "message", messages: [message], messageId: 7 }))
      .toEqual({ kind: "message", message });
    expect(planSessionReferenceTarget({ scope: "message", messages: [message], runId: "run-1" }))
      .toEqual({ kind: "message", message });
    expect(planSessionReferenceTarget({ scope: "message", messages: [message], messageId: 8 }))
      .toEqual({ kind: "missing-message" });
  });

  it("projects conversation and collaborator references from values", () => {
    expect(planSessionReferenceText({ session, target: { kind: "conversation" } })).toContain("Architecture");
    expect(planSessionReferenceText({ session, target: { kind: "message", message } })).toContain("qa");
  });
});
