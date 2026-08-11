import { describe, expect, it } from "vitest";
import type { CodexRunResult } from "../src/codex.js";
import type { LocalConsoleTerminal } from "../src/local-console/types.js";
import {
  decideDetachedTerminalCapability,
  decideStartFailureRecovery,
  planDetachedRunFailure,
  planDirectRunFailure,
  planFailureRecordFields,
  planTerminalRecordField,
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

  it("plans optional terminal persistence without inventing absent fields", () => {
    const terminal = {
      kind: "crashed",
      subkind: null,
      safeCode: null,
      retryable: null,
      partialMarkdown: "",
      contentIncomplete: true,
      actualProfile: null,
    } satisfies LocalConsoleTerminal;

    expect(planFailureRecordFields(undefined, undefined)).toEqual({});
    expect(planFailureRecordFields("visible failure", terminal)).toEqual({
      body: "visible failure",
      terminal,
    });
    expect(planTerminalRecordField(null)).toEqual({});
    expect(planTerminalRecordField(terminal)).toEqual({ terminal });
  });

  it("chooses the detached terminal persistence capability when available", () => {
    const capability = async () => undefined;

    expect(decideDetachedTerminalCapability(undefined)).toEqual({ kind: "fallback" });
    expect(decideDetachedTerminalCapability(capability)).toEqual({ kind: "record", capability });
  });

  it("auto-retries only silent user-run failures and dead-letters at the limit", () => {
    const base = {
      speaker: "user" as const,
      failureCount: 0,
      partialMarkdown: null,
      liveMarkdown: null,
      diagnosticBody: undefined,
      observedExternalSessionId: null,
      failureRetryLimit: undefined,
    };

    expect(decideStartFailureRecovery(base)).toEqual({ kind: "retry" });
    // 第 3 次尝试（默认上限）转死信，终局一次呈现。
    expect(decideStartFailureRecovery({ ...base, failureCount: 2 })).toEqual({ kind: "dead-letter", attempt: 3 });
    expect(decideStartFailureRecovery({ ...base, failureCount: 1, failureRetryLimit: 2 })).toEqual({ kind: "dead-letter", attempt: 2 });

    // 四种情况必须终局：非用户来源、已有可见产出、引擎给了可行动诊断、外部会话已被观察（重跑会双发提示词）。
    expect(decideStartFailureRecovery({ ...base, speaker: "agent" })).toEqual({ kind: "terminal" });
    expect(decideStartFailureRecovery({ ...base, liveMarkdown: "## 已经写了一半" })).toEqual({ kind: "terminal" });
    expect(decideStartFailureRecovery({ ...base, partialMarkdown: "partial" })).toEqual({ kind: "terminal" });
    expect(decideStartFailureRecovery({ ...base, diagnosticBody: "没有找到 Kimi CLI。请先安装 Kimi，然后重试。" })).toEqual({ kind: "terminal" });
    expect(decideStartFailureRecovery({ ...base, observedExternalSessionId: "codex-thread-observed" })).toEqual({ kind: "terminal" });
  });
});
