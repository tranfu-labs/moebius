import { describe, expect, it } from "vitest";

import { planExecutionFailureTerminal } from "../src/execution-failure-plan.js";

describe("execution failure plan", () => {
  it.each([
    ["claude-auth-required", "auth", false],
    ["kimi-quota-exhausted", "quota-exhausted", false],
    ["claude-rate-limited", "rate-limited", true],
  ] as const)("maps %s to its stable public terminal", (code, kind, retryable) => {
    expect(planExecutionFailureTerminal({ code, message: "provider detail" }, "partial"))
      .toMatchObject({ kind, retryable, partialText: "partial", safeCode: code });
  });

  it("preserves interruption, timeout, and crash semantics", () => {
    expect(planExecutionFailureTerminal({ code: "kimi-acp-interrupted", message: "stopped" }, "partial"))
      .toEqual({ kind: "interrupted", actor: "user", cause: "user", partialText: "partial" });
    expect(planExecutionFailureTerminal({ code: "claude-timeout", message: "late" }, "partial"))
      .toEqual({ kind: "timeout", basis: "idle", partialText: "partial" });
    expect(planExecutionFailureTerminal({ code: "kimi-empty-response", message: "empty" }, "partial"))
      .toEqual({ kind: "crashed", partialText: "partial", safeCode: "kimi-empty-response" });
  });
});
