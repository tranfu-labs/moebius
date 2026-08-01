import type { CodexRunResult } from "../codex.js";
import type { LocalExecutionEngine } from "./execution-driver.js";
import type { LocalRunSourceDisposition } from "./codex-resume.js";

export type LocalRunTerminalOutcomePlan =
  | { kind: "failed"; result: Extract<CodexRunResult, { ok: false }> }
  | {
      kind: "succeeded";
      result: Extract<CodexRunResult, { ok: true }>;
      terminalToolOnly: boolean;
    };

export function planLocalRunTerminalOutcome(result: CodexRunResult): LocalRunTerminalOutcomePlan {
  return result.ok
    ? {
        kind: "succeeded",
        result,
        terminalToolOnly: result.completionKind === "terminal-tool-result",
      }
    : { kind: "failed", result };
}

export type LocalFailedRunLifecycleDecision =
  | { kind: "pause" }
  | { kind: "finish"; status: "failed" | "interrupted" | "stuck" | "paused" };

export function decideLocalFailedRunLifecycle(input: {
  runtimeClosing: boolean;
  gracefulResumePrepared: boolean;
  failureStatus: "failed" | "interrupted" | "stuck" | "paused";
}): LocalFailedRunLifecycleDecision {
  return input.runtimeClosing && input.gracefulResumePrepared
    ? { kind: "pause" }
    : { kind: "finish", status: input.failureStatus };
}

export type LocalRunUsagePlan = { kind: "record" } | { kind: "skip" };

export function planLocalRunUsage(engine: LocalExecutionEngine): LocalRunUsagePlan {
  return engine === "codex" ? { kind: "record" } : { kind: "skip" };
}

export type LocalRunSuccessResponseKind = "processed" | "direct-response" | "detached-response";

export interface LocalRunSuccessEffectsPlan {
  responseKind: LocalRunSuccessResponseKind;
  recordChildSession: boolean;
  recordWorkspaceDiff: boolean;
  recordDirectoryWarning: boolean;
}

export function planLocalRunSuccessEffects(input: {
  sourceDisposition: LocalRunSourceDisposition;
  role: string;
  terminalToolOnly: boolean;
  sourceDirectoryAvailable: boolean;
}): LocalRunSuccessEffectsPlan {
  return {
    responseKind: input.terminalToolOnly
      ? "processed"
      : input.sourceDisposition === "agent-handoff"
        ? "detached-response"
        : "direct-response",
    recordChildSession: input.sourceDirectoryAvailable
      && !input.terminalToolOnly
      && input.role === "ceo",
    recordWorkspaceDiff: input.sourceDirectoryAvailable,
    recordDirectoryWarning: !input.sourceDirectoryAvailable,
  };
}

export type LocalChildSessionCardPersistencePlan<T> =
  | { kind: "skip" }
  | { kind: "record"; card: T };

export function planLocalChildSessionCardPersistence<T>(
  card: T | null,
): LocalChildSessionCardPersistencePlan<T> {
  return card === null ? { kind: "skip" } : { kind: "record", card };
}
