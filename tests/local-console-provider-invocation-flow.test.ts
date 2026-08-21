import { describe, expect, it } from "vitest";

import type { CodexRunResult } from "../src/codex.js";
import { createRunExecutionContext } from "../src/local-console/execution-context.js";
import {
  executeLocalProviderInvocationFlow,
  type LocalProviderInvocationFlowPorts,
} from "../src/local-console/provider-invocation-flow.js";
import { planLocalRunContext, planLocalRunInvocation } from "../src/local-console/run-invocation-plan.js";

describe("local provider invocation application flow", () => {
  it("records provider identity facts and serializes visible progress through memory ports", async () => {
    const executionContext = context("codex");
    const facts: string[] = [];
    const progress: string[] = [];
    const ports = basePorts({
      runProvider: async (callbacks) => {
        callbacks.onVisibleAgentMarkdown("one");
        callbacks.onVisibleAgentMarkdown("two");
        await callbacks.onSessionStarted({ engine: "codex", externalSessionId: "thread-a" });
        await callbacks.onExecutionTraceReady({ engine: "codex", externalSessionId: "thread-a" });
        return success("thread-a");
      },
      onVisibleAgentMarkdown: (text) => async () => { progress.push(text); },
      recordProviderInvocation: async () => { facts.push("invocation"); },
      recordProviderSessionObserved: async () => { facts.push("observed"); },
      recordAgentSessionLink: async () => { facts.push("agent-link"); },
      recordExecutionSessionLink: async () => { facts.push("execution-link"); },
      recordCodexThreadLink: async () => { facts.push("codex-link"); },
    });

    const result = await executeLocalProviderInvocationFlow(flowInput(executionContext), ports);

    expect(result).toMatchObject({
      kind: "completed",
      observedExternalSessionId: "thread-a",
      executionTraceExternalSessionId: "thread-a",
      result: { ok: true },
    });
    expect(facts).toEqual(["invocation", "observed", "agent-link", "execution-link", "codex-link"]);
    expect(progress).toEqual(["one", "two"]);
  });

  it("backfills Kimi identity facts from a successful terminal thread id", async () => {
    const executionContext = context("kimi");
    const facts: string[] = [];
    const result = await executeLocalProviderInvocationFlow(flowInput(executionContext), basePorts({
      runProvider: async () => success("kimi-session"),
      recordProviderSessionObserved: async () => { facts.push("observed"); },
      recordAgentSessionLink: async () => { facts.push("agent-link"); },
      recordExecutionSessionLink: async () => { facts.push("execution-link"); },
      recordCodexThreadLink: async () => { facts.push("codex-link"); },
    }));

    expect(result).toMatchObject({
      kind: "completed",
      observedExternalSessionId: "kimi-session",
      executionTraceExternalSessionId: "kimi-session",
    });
    expect(facts).toEqual(["observed", "agent-link", "execution-link"]);
  });

  it("stops before provider persistence when the runtime is closing", async () => {
    const events: string[] = [];
    const result = await executeLocalProviderInvocationFlow(flowInput(context("codex")), basePorts({
      releaseIfStopping: async () => true,
      recordProviderInvocation: async () => { events.push("invocation"); },
      runProvider: async () => {
        events.push("provider");
        return success(null);
      },
    }));

    expect(result).toEqual({ kind: "stopped" });
    expect(events).toEqual([]);
  });
});

function basePorts(
  overrides: Partial<LocalProviderInvocationFlowPorts>,
): LocalProviderInvocationFlowPorts {
  return {
    nowIso: () => "2026-08-02T02:00:00.000Z",
    releaseIfStopping: async () => false,
    recordProviderInvocation: async () => undefined,
    runProvider: async () => success(null),
    onVisibleAgentMarkdown: () => async () => undefined,
    onProcessStarted: () => undefined,
    onStructuredActivity: () => undefined,
    onExecutionProgress: () => undefined,
    setActiveExternalSessionId: () => undefined,
    recordProviderSessionObserved: async () => undefined,
    recordAgentSessionLink: async () => undefined,
    recordExecutionSessionLink: async () => undefined,
    recordCodexThreadLink: async () => undefined,
    ...overrides,
  };
}

function flowInput(executionContext: ReturnType<typeof context>) {
  const contextPlan = planLocalRunContext({
    recoveryPlan: { kind: "first", intent: null, context: executionContext, reason: "no-provider-session" },
    sessionId: "session-a",
    runId: "run-a",
    sourceMessageId: 7,
    recordedAt: "2026-08-02T02:00:00.000Z",
  });
  const invocationPlan = planLocalRunInvocation({
    lane: "worker",
    role: "dev",
    sourceBody: "work",
    promptContext: {
      role: "dev",
      agentMarkdown: "# Developer",
      primaryAgent: "dev",
      availableAgentNames: ["dev"],
    },
    timeline: [],
    cursorLastSeenIndex: -1,
    contextPlan,
    readOnly: false,
  });
  if (invocationPlan.kind === "unavailable") throw new Error("fixture must be ready");
  return {
    sessionId: "session-a",
    runId: "run-a",
    sourceMessageId: 7,
    role: "dev",
    runDir: "/tmp/run-a",
    continuingSameRun: false,
    executionContext,
    invocationPlan,
  };
}

function context(engine: "codex" | "kimi") {
  const profile = engine === "codex"
    ? null
    : { cli: "kimi" as const, model: "kimi-for-coding", effort: "high" };
  return createRunExecutionContext({
    sessionId: "session-a",
    runId: "run-a",
    sourceMessageId: 7,
    role: "dev",
    profile,
    workspace: {
      cwd: "/tmp/project",
      mode: "direct",
      worktreePath: null,
      worktreeUnavailableReason: null,
      branchName: null,
      baseRef: null,
      originalRepoRoot: null,
    },
    team: [{ name: "dev", agentMarkdown: "# Developer", executionProfile: profile }],
    recordedAt: "2026-08-02T02:00:00.000Z",
  });
}

function success(threadId: string | null): CodexRunResult {
  return {
    ok: true,
    finalText: "done",
    threadId,
    cachedInputTokens: null,
    runDir: "/tmp/run-a",
    stdoutPath: "/tmp/run-a/stdout.log",
    stderrPath: "/tmp/run-a/stderr.log",
  };
}
