import type { LocalExecutionEngine } from "./execution-driver.js";
import { legacyCodexContextFingerprint, type LocalExecutionRecoveryPlan, type LocalProviderInvocationFact, type LocalRunExecutionContextFact } from "./execution-context.js";
import type { LocalRunInvocationPlan } from "./run-invocation-plan.js";

export type LocalProviderCheckpointDecision = { kind: "continue" } | { kind: "stop" };

export function planLocalProviderExecutionOptions(input: {
  idleTimeoutMs: number | undefined;
  toolTimeoutMs: number | undefined;
  imagePaths: string[];
}): {
  idleTimeoutMs?: number;
  toolTimeoutMs?: number;
  imagePaths?: string[];
} {
  return {
    ...(input.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: input.idleTimeoutMs }),
    ...(input.toolTimeoutMs === undefined ? {} : { toolTimeoutMs: input.toolTimeoutMs }),
    ...(input.imagePaths.length === 0 ? {} : { imagePaths: input.imagePaths }),
  };
}

export function decideLocalActiveRunTarget<T extends { sessionId: string }>(
  active: T | undefined,
  sessionId: string,
): { kind: "skip" } | { kind: "update"; active: T } {
  return active?.sessionId === sessionId
    ? { kind: "update", active }
    : { kind: "skip" };
}

export function decideLocalProviderCheckpoint(stopping: boolean): LocalProviderCheckpointDecision {
  return stopping ? { kind: "stop" } : { kind: "continue" };
}

export function planLocalProviderInvocationStart(input: {
  sessionId: string;
  runId: string;
  runDir: string;
  role: string;
  executionContext: LocalRunExecutionContextFact;
  invocationPlan: Extract<LocalRunInvocationPlan, { kind: "ready" }>;
  recordedAt: string;
}): LocalProviderInvocationFact {
  return {
    sessionId: input.sessionId,
    runId: input.runId,
    invocationId: `${input.runId}:${input.runDir}`,
    role: input.role,
    agentIdentityFingerprint: input.executionContext.agentIdentityFingerprint,
    phase: "started",
    mode: input.invocationPlan.providerMode.kind,
    requestedExternalSessionId: input.invocationPlan.providerMode.kind === "resume"
      ? input.invocationPlan.providerMode.externalSessionId
      : null,
    observedExternalSessionId: null,
    outcome: "started",
    recordedAt: input.recordedAt,
  };
}

export function planLocalProviderInvocationTerminal(input: {
  sessionId: string;
  runId: string;
  runDir: string;
  role: string;
  executionContext: LocalRunExecutionContextFact;
  recoveryPlan: Exclude<LocalExecutionRecoveryPlan, { kind: "unavailable" }>;
  observedExternalSessionId: string | null;
  resultOk: boolean;
  recordedAt: string;
}): LocalProviderInvocationFact {
  return {
    sessionId: input.sessionId,
    runId: input.runId,
    invocationId: `${input.runId}:${input.runDir}`,
    role: input.role,
    agentIdentityFingerprint: input.executionContext.agentIdentityFingerprint,
    phase: "terminal",
    mode: input.recoveryPlan.kind === "resume" ? "resume" : "full",
    requestedExternalSessionId: input.recoveryPlan.kind === "resume"
      ? input.recoveryPlan.externalSessionId
      : null,
    observedExternalSessionId: input.observedExternalSessionId,
    outcome: input.resultOk ? "succeeded" : "failed",
    recordedAt: input.recordedAt,
  };
}

export type LocalProviderSessionFactPlan = { kind: "record" } | { kind: "skip" };

export function planLocalProviderSessionFacts(continuingSameRun: boolean): LocalProviderSessionFactPlan {
  return continuingSameRun ? { kind: "skip" } : { kind: "record" };
}

export type LocalProviderTraceDecision =
  | { kind: "error"; reason: "execution-trace-ready-session-mismatch" | "execution-trace-ready-session-conflict" }
  | {
      kind: "accept";
      externalSessionId: string;
      recordExecutionLink: boolean;
      recordCodexLink: boolean;
    };

export function decideLocalProviderTrace(input: {
  engine: LocalExecutionEngine;
  externalSessionId: string;
  observedExternalSessionId: string | null;
  executionTraceExternalSessionId: string | null;
  continuingSameRun: boolean;
}): LocalProviderTraceDecision {
  if (input.observedExternalSessionId !== input.externalSessionId) {
    return { kind: "error", reason: "execution-trace-ready-session-mismatch" };
  }
  if (
    input.executionTraceExternalSessionId !== null
    && input.executionTraceExternalSessionId !== input.externalSessionId
  ) {
    return { kind: "error", reason: "execution-trace-ready-session-conflict" };
  }
  return {
    kind: "accept",
    externalSessionId: input.externalSessionId,
    recordExecutionLink: !input.continuingSameRun,
    recordCodexLink: !input.continuingSameRun && input.engine === "codex",
  };
}

export type LocalKimiProviderFallbackPlan =
  | { kind: "skip" }
  | {
      kind: "record";
      externalSessionId: string;
      recordObserved: boolean;
      recordExecutionLink: boolean;
    };

export function planLocalKimiProviderFallback(input: {
  result: { ok: true; threadId: string | null } | { ok: false; threadId?: string | null };
  engine: LocalExecutionEngine;
  continuingSameRun: boolean;
  observedExternalSessionId: string | null;
  executionTraceExternalSessionId: string | null;
}): LocalKimiProviderFallbackPlan {
  if (
    !input.result.ok
    || input.engine !== "kimi"
    || input.result.threadId === null
    || input.continuingSameRun
  ) {
    return { kind: "skip" };
  }
  return {
    kind: "record",
    externalSessionId: input.result.threadId,
    recordObserved: input.observedExternalSessionId === null,
    recordExecutionLink: input.executionTraceExternalSessionId === null,
  };
}

export function planLocalCodexLinkContextFingerprint(
  context: LocalRunExecutionContextFact,
): string {
  return context.profile === null
    ? legacyCodexContextFingerprint(context)
    : context.contextFingerprint;
}
