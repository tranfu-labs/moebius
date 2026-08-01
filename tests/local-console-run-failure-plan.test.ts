import { describe, expect, it } from "vitest";
import type { CodexRunResult } from "../src/codex.js";
import {
  planDetachedRunFailure,
  planDirectRunFailure,
} from "../src/local-console/run-failure-plan.js";

const failed = (input: Partial<Extract<CodexRunResult, { ok: false }>> = {}) => ({
  ok: false,
  reason: "provider-failed",
  runDir: "/tmp/run",
  ...input,
} as Extract<CodexRunResult, { ok: false }>);

describe("run failure plan", () => {
  it("prioritizes timeout and graceful shutdown before ordinary direct failure", () => {
    const result = failed();
    expect(planDirectRunFailure({
      result,
      runId: "run-1",
      activeRunId: "run-1",
      gracefulResumePrepared: false,
      timeoutKind: "idle",
      interrupted: false,
      cause: null,
    })).toEqual({ kind: "stuck", logEvent: "local-console-codex-idle-timeout" });
    expect(planDirectRunFailure({
      result,
      runId: "run-1",
      activeRunId: "run-1",
      gracefulResumePrepared: true,
      timeoutKind: null,
      interrupted: true,
      cause: "runtime-closing",
    })).toEqual({ kind: "skip-graceful" });
  });

  it("maps detached interruption causes to stable visible outcomes", () => {
    const result = failed();
    expect(planDetachedRunFailure({
      result,
      gracefulResumePrepared: false,
      timeoutKind: null,
      interrupted: true,
      cause: "redirect",
    })).toMatchObject({
      kind: "interrupted",
      systemEventKind: "other",
      status: "interrupted",
    });
    expect(planDetachedRunFailure({
      result,
      gracefulResumePrepared: false,
      timeoutKind: null,
      interrupted: true,
      cause: "user",
    })).toMatchObject({ kind: "interrupted", systemEventKind: "user-stopped" });
  });
});
