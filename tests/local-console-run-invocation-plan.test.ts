import { describe, expect, it } from "vitest";

import type { TimelineMessage } from "../src/conversation.js";
import type { LocalCodexResumeIntentFact } from "../src/local-console/codex-resume.js";
import {
  createRunExecutionContext,
  type LocalExecutionRecoveryPlan,
} from "../src/local-console/execution-context.js";
import type { LocalConsoleExecutionProfile } from "../src/local-console/types.js";
import {
  planLocalRunInvocation,
  planLocalRunAttachmentMessages,
  planLocalRunContext,
  selectExecutingAgent,
} from "../src/local-console/run-invocation-plan.js";

const timeline: TimelineMessage[] = [
  { index: 0, speaker: "user", body: "old", source: "message" },
  { index: 1, speaker: "dev", body: "self", source: "message" },
  { index: 2, speaker: "user", body: "new", source: "message" },
];
const promptContext = {
  role: "dev",
  agentMarkdown: "# Developer",
  primaryAgent: "dev",
  availableAgentNames: ["dev"],
} as const;

describe("local run invocation planning", () => {
  it("plans a first invocation with the full prompt and all attachment indexes", () => {
    const plan = planLocalRunInvocation({
      lane: "primary",
      role: "dev",
      sourceBody: "new",
      promptContext,
      timeline,
      cursorLastSeenIndex: 1,
      contextPlan: contextPlan(recovery("first", null), "run-new"),
      readOnly: false,
    });
    expect(plan).toMatchObject({
      kind: "ready",
      continuingSameRun: false,
      providerMode: { kind: "full" },
      consumeIntentMode: null,
      workspaceAccess: "read-write",
    });
    expect(plan.kind === "ready" ? plan.prompt : "").toContain("#0 <user>:\nold");
    expect(plan.kind === "ready" ? [...plan.attachmentTimelineIndexes] : []).toEqual([0, 1, 2]);
  });

  it("plans an ordinary resume with only unseen external timeline entries", () => {
    const plan = planLocalRunInvocation({
      lane: "worker",
      role: "dev",
      sourceBody: "new",
      promptContext,
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
    expect(plan.kind === "ready" ? plan.prompt : "").toContain("#2 <user>:\nnew");
    expect(plan.kind === "ready" ? plan.prompt : "").not.toContain("#0 <user>:");
    expect(plan.kind === "ready" ? [...plan.attachmentTimelineIndexes] : []).toEqual([2]);
  });

  it("keeps graceful shutdown on the same run and uses the continuation prompt", () => {
    const intent = resumeIntent("graceful-shutdown", "run-same");
    const plan = planLocalRunInvocation({
      lane: "primary",
      role: "dev",
      sourceBody: "ignored",
      promptContext,
      timeline,
      cursorLastSeenIndex: 1,
      contextPlan: contextPlan(recovery("resume", intent), "run-same"),
      readOnly: false,
    });
    expect(plan).toMatchObject({
      kind: "ready",
      continuingSameRun: true,
      consumeIntentMode: "resume",
      deltaTimeline: [{ index: 2, speaker: "user" }],
    });
    expect(plan.kind === "ready" ? plan.prompt : "").toContain("从中断处继续");
    expect(plan.kind === "ready" ? plan.prompt : "").toContain("#2 <user>:\nnew");
    expect(plan.kind === "ready" ? plan.prompt : "").not.toContain("#0 <user>:");
  });

  it("includes an edited resend and unseen delta in a resumed invocation", () => {
    const plan = planLocalRunInvocation({
      lane: "worker",
      role: "dev",
      sourceBody: "corrected instruction",
      promptContext,
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

  it("keeps a retry resume instruction beside the unseen external timeline", () => {
    const plan = planLocalRunInvocation({
      lane: "worker",
      role: "dev",
      sourceBody: "retry",
      promptContext,
      timeline,
      cursorLastSeenIndex: 0,
      contextPlan: contextPlan(recovery("resume", resumeIntent("retry", "run-old")), "run-new"),
      readOnly: false,
    });

    expect(plan).toMatchObject({
      kind: "ready",
      providerMode: { kind: "resume", externalSessionId: "external-a" },
      deltaTimeline: [{ index: 2, speaker: "user" }],
    });
    const prompt = plan.kind === "ready" ? plan.prompt : "";
    expect(prompt).toContain("从中断处继续");
    expect(prompt).toContain("#2 <user>:\nnew");
    expect(prompt).not.toContain("#0 <user>:");
  });

  it("preserves the existing primary and worker consumption difference for first retries", () => {
    const intent = resumeIntent("retry", "run-old");
    const base = {
      role: "dev",
      sourceBody: "retry",
      promptContext,
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

  it("uses native Skill loading for Claude and Codex, with prompt fallback for TODO providers", () => {
    const planFor = (profile: LocalConsoleExecutionProfile) => planLocalRunInvocation({
      lane: "primary",
      role: "dev",
      sourceBody: "new",
      promptContext,
      timeline,
      cursorLastSeenIndex: -1,
      contextPlan: contextPlan(recovery("first", null, profile), "run-new"),
      readOnly: false,
    });

    const claudePlan = planFor({ cli: "claude", model: "sonnet", effort: "high" });
    expect(claudePlan).toMatchObject({
      kind: "ready",
      prompt: expect.stringContaining("已通过标准 Skill 目录发现此能力"),
    });
    expect(claudePlan.kind === "ready" ? claudePlan.prompt : "")
      .not.toContain("只有已有实际命令、工具、运行或链接证据时才准备完成交接");
    expect(planFor({ cli: "codex", model: "o3", effort: "high" })).toMatchObject({
      kind: "ready",
      prompt: expect.stringContaining("已通过标准 Skill 目录发现此能力"),
    });
    expect(planFor({ cli: "kimi", model: "kimi-k2", effort: "high" })).toMatchObject({
      kind: "ready",
      prompt: expect.stringContaining("只有已有实际命令、工具、运行或链接证据时才准备完成交接"),
    });
    expect(planFor({
      cli: "pi",
      providerId: "deepseek",
      providerProfileId: "deepseek",
      model: "deepseek-chat",
      effort: "high",
    })).toMatchObject({
      kind: "ready",
      prompt: expect.stringContaining("只有已有实际命令、工具、运行或链接证据时才准备完成交接"),
    });
  });

  it("returns unavailable without constructing a provider invocation", () => {
    expect(planLocalRunInvocation({
      lane: "primary",
      role: "dev",
      sourceBody: "new",
      promptContext,
      timeline,
      cursorLastSeenIndex: -1,
      contextPlan: contextPlan(recovery("unavailable", null), "run-new"),
      readOnly: false,
    })).toMatchObject({
      kind: "unavailable",
      recoveryPlan: { reason: "rollout-unavailable" },
    });
  });

  it("selects only the same incremental attachment set during graceful resume", () => {
    expect(planLocalRunAttachmentMessages({
      recoveryPlan: recovery("resume", null) as Extract<LocalExecutionRecoveryPlan, { kind: "resume" }>,
      timelineMessages: ["old", "self", "new"],
      attachmentTimelineIndexes: new Set([2]),
    })).toEqual(["new"]);
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
  profile: LocalConsoleExecutionProfile | null = null,
): LocalExecutionRecoveryPlan {
  const context = executionContext(profile);
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

function executionContext(profile: LocalConsoleExecutionProfile | null = null) {
  return createRunExecutionContext({
    sessionId: "session-a",
    runId: "run-context",
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
    team: [{ name: "dev", agentMarkdown: "# dev", executionProfile: null }],
    recordedAt: "2026-08-01T00:00:00.000Z",
  });
}
