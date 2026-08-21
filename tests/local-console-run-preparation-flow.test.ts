import { describe, expect, it } from "vitest";

import type { TimelineMessage } from "../src/conversation.js";
import type { LocalCodexResumeIntentFact } from "../src/local-console/codex-resume.js";
import { createRunExecutionContext } from "../src/local-console/execution-context.js";
import {
  executeLocalRunPreparationFlow,
  type LocalRunPreparationInput,
  type LocalRunPreparationPorts,
  type LocalRunRecoverySnapshot,
} from "../src/local-console/run-preparation-flow.js";
import type { LocalConsoleMessage } from "../src/local-console/types.js";

const recordedAt = "2026-08-02T01:00:00.000Z";
const timeline: TimelineMessage[] = [
  { index: 0, speaker: "user", body: "old", source: "message" },
  { index: 1, speaker: "dev", body: "self", source: "message" },
  { index: 2, speaker: "user", body: "new", source: "message" },
];

describe("local run preparation application flow", () => {
  it("prepares a first worker invocation through memory ports", async () => {
    const events: string[] = [];
    const preparedMessageIds: number[] = [];
    const ports = basePorts(emptySnapshot(), {
      recordRunExecutionContext: async () => { events.push("context"); },
      prepareAttachments: async ({ messages }) => {
        preparedMessageIds.push(...messages.map((message) => message.id));
        return { promptSuffix: "\nATTACHMENTS", imagePaths: ["/tmp/image.png"] };
      },
    });

    const result = await executeLocalRunPreparationFlow(baseInput(), ports);

    expect(result).toMatchObject({
      kind: "ready",
      continuingSameRun: false,
      invocationPlan: {
        providerMode: { kind: "full" },
        workspaceAccess: "read-only",
      },
      preparedAttachments: { imagePaths: ["/tmp/image.png"] },
    });
    expect(result.kind === "ready" ? result.prompt : "").toContain("READ-ONLY CONTRACT");
    expect(result.kind === "ready" ? result.prompt : "").toContain("ATTACHMENTS");
    expect(preparedMessageIds).toEqual([1, 2, 3]);
    expect(events).toEqual(["context"]);
  });

  it("prepares only unseen attachments for a graceful resume on the same run", async () => {
    const prior = executionContext();
    const intent = gracefulIntent();
    const snapshot = emptySnapshot();
    snapshot.recoveryFacts.intents.push(intent);
    snapshot.runContexts.push(prior);
    snapshot.canonicalLinks.push({
      sessionId: prior.sessionId,
      agentIdentityFingerprint: prior.agentIdentityFingerprint,
      role: prior.role,
      engine: prior.engine,
      externalSessionId: "thread-a",
      profileFingerprint: prior.profileFingerprint,
      contextFingerprint: prior.contextFingerprint,
      linkedAt: recordedAt,
    });
    snapshot.timelineCursors.push({
      sessionId: prior.sessionId,
      runId: prior.runId,
      role: prior.role,
      agentIdentityFingerprint: prior.agentIdentityFingerprint,
      lastSeenIndex: 1,
      recordedAt,
    });
    const preparedMessageIds: number[] = [];
    const result = await executeLocalRunPreparationFlow(baseInput(), basePorts(snapshot, {
      prepareAttachments: async ({ messages }) => {
        preparedMessageIds.push(...messages.map((message) => message.id));
        return { promptSuffix: "", imagePaths: [] };
      },
    }));

    expect(result).toMatchObject({
      kind: "ready",
      continuingSameRun: true,
      invocationPlan: {
        providerMode: { kind: "resume", externalSessionId: "thread-a" },
        deltaTimeline: [{ index: 2, speaker: "user" }],
      },
    });
    expect(preparedMessageIds).toEqual([3]);
    expect(result.kind === "ready" ? result.prompt : "").toContain("#2 <user>:\nnew");
  });

  it("settles an unavailable graceful resume before attachments or provider setup", async () => {
    const prior = executionContext();
    const intent = gracefulIntent();
    const snapshot: LocalRunRecoverySnapshot = {
      ...emptySnapshot(),
      recoveryFacts: {
        intents: [intent],
        consumedIntentIds: new Set(),
        repairedIntentIds: new Set(),
      },
      runContexts: [prior],
      canonicalLinks: [{
        sessionId: prior.sessionId,
        agentIdentityFingerprint: prior.agentIdentityFingerprint,
        role: prior.role,
        engine: prior.engine,
        externalSessionId: "thread-a",
        profileFingerprint: prior.profileFingerprint,
        contextFingerprint: prior.contextFingerprint,
        linkedAt: recordedAt,
      }],
    };
    const events: string[] = [];
    const ports = basePorts(snapshot, {
      isCodexThreadAvailable: async () => false,
      settleUnavailable: async (plan) => { events.push(`settled:${plan.reason}`); },
      prepareAttachments: async () => {
        events.push("attachments");
        return { promptSuffix: "", imagePaths: [] };
      },
    });

    const result = await executeLocalRunPreparationFlow(baseInput(), ports);

    expect(result).toEqual({ kind: "settled-unavailable" });
    expect(events).toEqual(["settled:rollout-unavailable"]);
  });

  it("applies a primary retry execution override once and consumes it as full fallback", async () => {
    const overrideIntent: LocalCodexResumeIntentFact = {
      sessionId: "session-a",
      intentId: "intent-override",
      targetRunId: "run-old",
      sourceMessageId: 3,
      role: "dev",
      reason: "retry",
      executionOverride: {
        overrideId: "override-a",
        profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
        scope: "single-run",
      },
      createdAt: recordedAt,
    };
    const snapshot = emptySnapshot();
    snapshot.recoveryFacts.intents.push(overrideIntent);
    const consumed: Array<{ intentId: string; mode: string }> = [];
    const ports = basePorts(snapshot, {
      consumeRecoveryIntent: async ({ intentId, mode }) => { consumed.push({ intentId, mode }); },
    });

    const result = await executeLocalRunPreparationFlow({
      ...baseInput(),
      lane: "primary",
      readOnly: false,
    }, ports);

    expect(result).toMatchObject({
      kind: "ready",
      executionContext: {
        engine: "kimi",
        profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      },
      invocationPlan: { workspaceAccess: "read-write" },
    });
    expect(consumed).toEqual([{ intentId: "intent-override", mode: "full-fallback" }]);
  });

  it("fails closed before attachments when the member continuation was explicitly ended", async () => {
    const events: string[] = [];
    const result = await executeLocalRunPreparationFlow({
      ...baseInput(),
      continuationEnded: true,
    }, basePorts(emptySnapshot(), {
      settleUnavailable: async (plan) => { events.push(plan.reason); },
      prepareAttachments: async () => {
        events.push("attachments");
        return { promptSuffix: "", imagePaths: [] };
      },
    }));

    expect(result).toEqual({ kind: "settled-unavailable" });
    expect(events).toEqual(["continuation-ended"]);
  });
});

function baseInput(): LocalRunPreparationInput {
  return {
    lane: "worker",
    sessionId: "session-a",
    runId: "run-a",
    sourceMessage: message(3),
    role: "dev",
    defaultProfile: null,
    defaultWorkspace: workspace(),
    concurrentWorkspace: null,
    team: [{ name: "dev", agentMarkdown: "# Developer", executionProfile: null }],
    timeline,
    timelineMessages: [message(1), message(2), message(3)],
    readOnly: true,
    promptContract: "\nREAD-ONLY CONTRACT",
    runDir: "/tmp/run-a",
  };
}

function basePorts(
  snapshot: LocalRunRecoverySnapshot,
  overrides: Partial<LocalRunPreparationPorts>,
): LocalRunPreparationPorts {
  return {
    nowIso: () => recordedAt,
    loadRecoverySnapshot: async () => snapshot,
    isCodexThreadAvailable: async () => true,
    settleUnavailable: async () => undefined,
    recordRunExecutionContext: async () => undefined,
    recordAgentSessionLink: async () => undefined,
    prepareAttachments: async () => ({ promptSuffix: "", imagePaths: [] }),
    consumeRecoveryIntent: async () => undefined,
    ...overrides,
  };
}

function emptySnapshot(): LocalRunRecoverySnapshot {
  return {
    recoveryFacts: { intents: [], consumedIntentIds: new Set(), repairedIntentIds: new Set() },
    threadLinks: [],
    executionLinks: [],
    runContexts: [],
    canonicalLinks: [],
    observations: [],
    timelineCursors: [],
  };
}

function executionContext() {
  return createRunExecutionContext({
    sessionId: "session-a",
    runId: "run-a",
    sourceMessageId: 3,
    role: "dev",
    profile: null,
    workspace: workspace(),
    team: [{ name: "dev", agentMarkdown: "# Developer", executionProfile: null }],
    recordedAt,
  });
}

function gracefulIntent(): LocalCodexResumeIntentFact {
  return {
    sessionId: "session-a",
    intentId: "intent-a",
    targetRunId: "run-a",
    sourceMessageId: 3,
    role: "dev",
    reason: "graceful-shutdown",
    createdAt: recordedAt,
  };
}

function workspace() {
  return {
    cwd: "/tmp/project",
    mode: "direct" as const,
    worktreePath: null,
    worktreeUnavailableReason: null,
    branchName: null,
    baseRef: null,
    originalRepoRoot: null,
  };
}

function message(id: number): LocalConsoleMessage {
  return {
    id,
    sessionId: "session-a",
    speaker: "user",
    role: null,
    body: `message-${String(id)}`,
    status: "pending",
    runId: null,
    runDir: null,
    error: null,
    systemEventKind: "other",
    failureCount: 0,
    lastFailureReason: null,
    dispatchLane: "worker",
    dispatchRole: "dev",
    dispatchReason: "single-valid-mention",
    createdAt: recordedAt,
    updatedAt: recordedAt,
  };
}
