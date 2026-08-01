import { describe, expect, it } from "vitest";

import type { TimelineMessage } from "../src/conversation.js";
import type { LocalCodexResumeIntentFact } from "../src/local-console/codex-resume.js";
import {
  createRunExecutionContext,
  type LocalExecutionRecoveryPlan,
} from "../src/local-console/execution-context.js";
import {
  planLocalRunInvocation,
  planLocalRunContext,
  selectExecutingAgent,
} from "../src/local-console/run-invocation-plan.js";

const timeline: TimelineMessage[] = [
  { index: 0, speaker: "user", body: "old", source: "comment" },
  { index: 1, speaker: "dev", body: "self", source: "comment" },
  { index: 2, speaker: "user", body: "new", source: "comment" },
];

describe("local run invocation planning", () => {
  it("plans a first invocation with the full prompt and all attachment indexes", () => {
    const plan = planLocalRunInvocation({
      lane: "primary",
      role: "dev",
      sourceBody: "new",
      fullPrompt: "FULL",
      timeline,
      cursorLastSeenIndex: 1,
      contextPlan: contextPlan(recovery("first", null), "run-new"),
      readOnly: false,
    });
    expect(plan).toMatchObject({
      kind: "ready",
      continuingSameRun: false,
      providerMode: { kind: "full" },
      prompt: "FULL",
      consumeIntentMode: null,
      workspaceAccess: "read-write",
    });
    expect(plan.kind === "ready" ? [...plan.attachmentTimelineIndexes] : []).toEqual([0, 1, 2]);
  });

  it("plans an ordinary resume with only unseen external timeline entries", () => {
    const plan = planLocalRunInvocation({
      lane: "worker",
      role: "dev",
      sourceBody: "new",
      fullPrompt: "FULL",
      timeline,
      cursorLastSeenIndex: 0,
      contextPlan: contextPlan(recovery("resume", null), "run-new"),
      readOnly: true,
    });
    expect(plan).toMatchObject({
      kind: "ready",
      providerMode: { kind: "resume", externalSessionId: "external-a" },
      consumeIntentMode: null,
      workspaceAccess: "read-only",
      deltaTimeline: [{ index: 2, speaker: "user" }],
    });
    expect(plan.kind === "ready" ? [...plan.attachmentTimelineIndexes] : []).toEqual([2]);
  });

  it("keeps graceful shutdown on the same run and uses the continuation prompt", () => {
    const intent = resumeIntent("graceful-shutdown", "run-same");
    const plan = planLocalRunInvocation({
      lane: "primary",
      role: "dev",
      sourceBody: "ignored",
      fullPrompt: "FULL",
      timeline,
      cursorLastSeenIndex: 1,
      contextPlan: contextPlan(recovery("resume", intent), "run-same"),
      readOnly: false,
    });
    expect(plan).toMatchObject({
      kind: "ready",
      continuingSameRun: true,
      consumeIntentMode: "resume",
      deltaTimeline: timeline,
    });
    expect(plan.kind === "ready" ? plan.prompt : "").toContain("从中断处继续");
  });

  it("includes an edited resend and unseen delta in a resumed invocation", () => {
    const plan = planLocalRunInvocation({
      lane: "worker",
      role: "dev",
      sourceBody: "corrected instruction",
      fullPrompt: "FULL",
      timeline,
      cursorLastSeenIndex: 0,
      contextPlan: contextPlan(recovery("resume", resumeIntent("edit-resend", "run-old")), "run-new"),
      readOnly: false,
    });
    expect(plan).toMatchObject({ kind: "ready", consumeIntentMode: "resume" });
    const prompt = plan.kind === "ready" ? plan.prompt : "";
    expect(prompt).toContain("corrected instruction");
    expect(prompt).toContain("#2 <user>:");
    expect(prompt).not.toContain("#1 <dev>:");
  });

  it("preserves the existing primary and worker consumption difference for first retries", () => {
    const intent = resumeIntent("retry", "run-old");
    const base = {
      role: "dev",
      sourceBody: "retry",
      fullPrompt: "FULL",
      timeline,
      cursorLastSeenIndex: -1,
      contextPlan: contextPlan(recovery("first", intent), "run-new"),
      readOnly: false,
    } as const;
    expect(planLocalRunInvocation({ ...base, lane: "primary" })).toMatchObject({
      kind: "ready",
      consumeIntentMode: "unavailable",
    });
    expect(planLocalRunInvocation({ ...base, lane: "worker" })).toMatchObject({
      kind: "ready",
      consumeIntentMode: "full-fallback",
    });
  });

  it("returns unavailable without constructing a provider invocation", () => {
    expect(planLocalRunInvocation({
      lane: "primary",
      role: "dev",
      sourceBody: "new",
      fullPrompt: "FULL",
      timeline,
      cursorLastSeenIndex: -1,
      contextPlan: contextPlan(recovery("unavailable", null), "run-new"),
      readOnly: false,
    })).toMatchObject({
      kind: "unavailable",
      recoveryPlan: { reason: "rollout-unavailable" },
    });
  });
});

describe("executing Agent selection", () => {
  it("fails deterministically when the frozen context lacks the selected role", () => {
    const context = executionContext();
    expect(selectExecutingAgent(context, "qa")).toEqual({ kind: "missing", role: "qa" });
    expect(selectExecutingAgent(context, "dev")).toMatchObject({
      kind: "found",
      agent: { name: "dev" },
    });
  });
});

function recovery(
  kind: "first" | "resume" | "unavailable",
  intent: LocalCodexResumeIntentFact | null,
): LocalExecutionRecoveryPlan {
  const context = executionContext();
  if (kind === "first") {
    return { kind, intent, context, reason: "no-provider-session" };
  }
  if (kind === "resume") {
    return {
      kind,
      intent,
      context,
      externalSessionId: "external-a",
      canonicalLinkMissing: false,
      reason: "compatible",
    };
  }
  return { kind, intent, context, reason: "rollout-unavailable" };
}

function contextPlan(recoveryPlan: LocalExecutionRecoveryPlan, runId: string) {
  return planLocalRunContext({
    recoveryPlan,
    sessionId: "session-a",
    runId,
    sourceMessageId: 7,
    recordedAt: "2026-08-01T00:00:01.000Z",
  });
}

function resumeIntent(
  reason: LocalCodexResumeIntentFact["reason"],
  targetRunId: string,
): LocalCodexResumeIntentFact {
  return {
    sessionId: "session-a",
    intentId: `intent:${reason}`,
    targetRunId,
    sourceMessageId: 7,
    role: "dev",
    reason,
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

function executionContext() {
  return createRunExecutionContext({
    sessionId: "session-a",
    runId: "run-context",
    sourceMessageId: 7,
    role: "dev",
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
    team: [{ name: "dev", agentMarkdown: "# dev", executionProfile: null }],
    recordedAt: "2026-08-01T00:00:00.000Z",
  });
}
