import { describe, expect, it } from "vitest";

import type { CodexRunResult } from "../src/codex.js";
import { createRunExecutionContext } from "../src/local-console/execution-context.js";
import {
  executeLocalRunTerminalFlow,
  type LocalRunTerminalFlowPorts,
} from "../src/local-console/run-terminal-flow.js";
import { planLocalRunFailureStatus } from "../src/local-console/run-terminal-plan.js";

describe("local run terminal application flow", () => {
  it("classifies failed run timing by shutdown, timeout, and interruption precedence", () => {
    expect([
      planLocalRunFailureStatus({ runtimeClosing: true, timedOut: true, interrupted: true }),
      planLocalRunFailureStatus({ runtimeClosing: false, timedOut: true, interrupted: true }),
      planLocalRunFailureStatus({ runtimeClosing: false, timedOut: false, interrupted: true }),
      planLocalRunFailureStatus({ runtimeClosing: false, timedOut: false, interrupted: false }),
    ]).toEqual(["paused", "stuck", "interrupted", "failed"]);
  });

  it("pauses a graceful runtime-closing failure before recording its terminal result", async () => {
    const events: string[] = [];
    await executeLocalRunTerminalFlow(input(failure(), "user-direct", true), ports(events, {
      classifyFailure: () => ({ runtimeClosing: true, failureStatus: "interrupted" }),
    }));

    expect(events).toEqual(["provider-terminal", "pause", "failed"]);
  });

  it("records detached CEO success effects in their external order", async () => {
    const events: string[] = [];
    await executeLocalRunTerminalFlow(input(success(), "agent-handoff", false, "ceo"), ports(events, {
      sourceDirectoryAvailable: async () => true,
      executeChildSession: async () => {
        events.push("child-run");
        return { sourceId: "source-a", childSessionIds: ["child-a"] };
      },
    }));

    expect(events).toEqual([
      "provider-terminal",
      "finish:completed",
      "usage",
      "child-run",
      "diff",
      "success:detached-response",
      "cursor:2",
      "child-card",
    ]);
  });

  it("marks tool-only completion and records a directory warning without child or diff work", async () => {
    const events: string[] = [];
    await executeLocalRunTerminalFlow(
      input({ ...success(), completionKind: "terminal-tool-result" }, "primary", false),
      ports(events, { sourceDirectoryAvailable: async () => false }),
    );

    expect(events).toEqual([
      "provider-terminal",
      "finish:completed",
      "usage",
      "success:processed",
      "cursor:2",
      "directory-warning",
    ]);
  });
});

function ports(
  events: string[],
  overrides: Partial<LocalRunTerminalFlowPorts>,
): LocalRunTerminalFlowPorts {
  return {
    nowIso: () => "2026-08-02T03:00:00.000Z",
    recordProviderInvocation: async () => { events.push("provider-terminal"); },
    classifyFailure: () => ({ runtimeClosing: false, failureStatus: "failed" }),
    pauseLifecycle: async () => { events.push("pause"); },
    finishLifecycle: async (status) => { events.push(`finish:${status}`); },
    recordFailed: async () => { events.push("failed"); },
    recordUsage: async () => { events.push("usage"); },
    sourceDirectoryAvailable: async () => true,
    executeChildSession: async () => null,
    recordWorkspaceDiff: async () => { events.push("diff"); },
    recordSuccess: async (kind) => { events.push(`success:${kind}`); },
    onSuccessPersistenceError: async () => undefined,
    recordTimelineCursor: async (index) => { events.push(`cursor:${String(index)}`); },
    recordChildSessionCard: async () => { events.push("child-card"); },
    onChildSessionCardError: async () => undefined,
    recordDirectoryWarning: async () => { events.push("directory-warning"); },
    ...overrides,
  };
}

function input(
  result: CodexRunResult,
  sourceDisposition: "primary" | "user-direct" | "agent-handoff",
  gracefulResumePrepared: boolean,
  role = "dev",
) {
  const executionContext = createRunExecutionContext({
    sessionId: "session-a",
    runId: "run-a",
    sourceMessageId: 7,
    role,
    profile: null,
    workspace: {
      cwd: "/tmp/project",
      mode: "direct",
      worktreePath: null,
      worktreeUnavailableReason: null,
      branchName: null,
      baseRef: null,
      originalRepoRoot: null,
    },
    team: [{ name: role, agentMarkdown: `# ${role}`, executionProfile: null }],
    recordedAt: "2026-08-02T03:00:00.000Z",
  });
  return {
    sessionId: "session-a",
    runId: "run-a",
    runDir: "/tmp/run-a",
    sourceMessageId: 7,
    role,
    sourceDisposition,
    executionContext,
    recoveryPlan: { kind: "first" as const, intent: null, context: executionContext, reason: "no-provider-session" as const },
    observedExternalSessionId: null,
    result,
    gracefulResumePrepared,
    lastSeenIndex: 2,
  };
}

function success(): Extract<CodexRunResult, { ok: true }> {
  return {
    ok: true,
    finalText: "done",
    threadId: "thread-a",
    cachedInputTokens: 3,
    runDir: "/tmp/run-a",
    stdoutPath: "/tmp/run-a/stdout.log",
    stderrPath: "/tmp/run-a/stderr.log",
  };
}

function failure(): Extract<CodexRunResult, { ok: false }> {
  return {
    ok: false,
    reason: "interrupted",
    runDir: "/tmp/run-a",
    stdoutPath: "/tmp/run-a/stdout.log",
    stderrPath: "/tmp/run-a/stderr.log",
  };
}
