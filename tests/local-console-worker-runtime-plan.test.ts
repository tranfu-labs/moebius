import { describe, expect, it } from "vitest";
import {
  decideWorkerClaimRelease,
  decideWorkerAgentFileSource,
  decideWorkerAgentMarkdownSource,
  decideWorkerAttachmentPreparation,
  decideWorkerOutstandingWork,
  decideWorkerLifecycleCreation,
  decideWorkerOriginEffect,
  decideWorkerPreparation,
  decideWorkerRecoveryPersistence,
  decideWorkerSuccessPersistence,
  decideWorkerRedirectAbort,
  decideWorkerRunId,
  decideWorkerStopHandling,
  decideWorkerTerminalContinuation,
  decideWorkerTaskRelease,
  decideWorkerWakeCheckpoint,
  planWorkerSourceDisposition,
  planWorkerGracefulResume,
  planWorkerLastSeenIndex,
  planWorkerFinalization,
  planWorkerAgentContents,
  planWorkerSnapshotAgents,
  planWorkerTimelineMessages,
} from "../src/local-console/worker-runtime-plan.js";
import type { LocalConsoleMessage } from "../src/local-console/types.js";

describe("worker runtime plan", () => {
  it("aborts only an active worker redirected by the primary lane", () => {
    expect(decideWorkerRedirectAbort({ origin: "primary-redirect", activeLane: "worker" }))
      .toEqual({ kind: "abort" });
    expect(decideWorkerRedirectAbort({ origin: "user-direct", activeLane: "worker" }))
      .toEqual({ kind: "keep" });
    expect(decideWorkerRedirectAbort({ origin: "primary-redirect", activeLane: "primary" }))
      .toEqual({ kind: "keep" });
  });

  it("preserves retry run identity and releases only the current lane owner", () => {
    expect(decideWorkerRunId("run-resume")).toEqual({ kind: "resume", runId: "run-resume" });
    expect(decideWorkerRunId(null)).toEqual({ kind: "fresh" });
    const current = Promise.resolve();
    expect(decideWorkerTaskRelease(current, current)).toEqual({ kind: "release" });
    expect(decideWorkerTaskRelease(Promise.resolve(), current)).toEqual({ kind: "keep" });
  });

  it("stops wake and releases claims only while shutdown or session deactivation is active", () => {
    expect(decideWorkerWakeCheckpoint({ stopping: true })).toEqual({ kind: "stop" });
    expect(decideWorkerWakeCheckpoint({ stopping: false, workspaceAvailable: false })).toEqual({ kind: "stop" });
    expect(decideWorkerWakeCheckpoint({ stopping: false, workspaceAvailable: true })).toEqual({ kind: "continue" });
    expect(decideWorkerClaimRelease(true)).toEqual({ kind: "release" });
    expect(decideWorkerOutstandingWork(0, 0)).toEqual({ kind: "idle" });
    expect(decideWorkerOutstandingWork(0, 1)).toEqual({ kind: "pending" });
  });

  it("keeps direct and detached persistence effects distinct across preparation", () => {
    expect(decideWorkerOriginEffect("user-direct")).toEqual({ kind: "direct" });
    expect(decideWorkerOriginEffect("primary-redirect")).toEqual({ kind: "detached" });
    expect(planWorkerSourceDisposition("user-direct")).toBe("user-direct");
    expect(planWorkerSourceDisposition("primary-redirect")).toBe("agent-handoff");
    expect(decideWorkerLifecycleCreation(false)).toEqual({ kind: "record" });
    expect(decideWorkerLifecycleCreation(true)).toEqual({ kind: "skip" });
    expect(decideWorkerPreparation({ kind: "settled-unavailable" })).toEqual({ kind: "settled" });
    expect(decideWorkerPreparation({ kind: "ready", value: 1 })).toEqual({
      kind: "continue",
      preparation: { kind: "ready", value: 1 },
    });
    expect(decideWorkerSuccessPersistence("processed")).toEqual({ kind: "processed" });
    expect(decideWorkerSuccessPersistence("direct-response")).toEqual({ kind: "direct" });
    expect(decideWorkerSuccessPersistence("detached-response")).toEqual({ kind: "detached" });
    expect(decideWorkerRecoveryPersistence(false)).toEqual({ kind: "skip" });
    expect(decideWorkerRecoveryPersistence(true)).toEqual({ kind: "record" });
    expect(planWorkerGracefulResume(undefined)).toBe(false);
    expect(planWorkerGracefulResume({ gracefulResumePrepared: true })).toBe(true);
    expect(planWorkerLastSeenIndex([])).toBe(-1);
    expect(planWorkerLastSeenIndex([{ index: 2 }, { index: 5 }])).toBe(5);
    expect(decideWorkerStopHandling({ stopping: true, origin: "user-direct" }))
      .toEqual({ kind: "release-and-stop" });
    expect(decideWorkerStopHandling({ stopping: true, origin: "primary-redirect" }))
      .toEqual({ kind: "stop" });
    expect(decideWorkerStopHandling({ stopping: false, origin: "user-direct" }))
      .toEqual({ kind: "continue" });
    expect(decideWorkerTerminalContinuation("failed")).toEqual({ kind: "stop" });
    expect(decideWorkerTerminalContinuation("succeeded")).toEqual({ kind: "clear-error" });
    expect(planWorkerFinalization(undefined)).toEqual({ cwd: null, lifecycle: "none" });
    expect(planWorkerFinalization({ cwd: "/tmp/work", terminalRecorded: false, gracefulResumePrepared: true }))
      .toEqual({ cwd: "/tmp/work", lifecycle: "pause" });
    expect(planWorkerFinalization({ cwd: "/tmp/work", terminalRecorded: false, gracefulResumePrepared: false }))
      .toEqual({ cwd: "/tmp/work", lifecycle: "fail" });
  });

  it("prefers persisted team members and removes non-timeline worker placeholders", () => {
    expect(decideWorkerAgentFileSource(undefined)).toEqual({ kind: "fallback" });
    expect(planWorkerSnapshotAgents([{
      name: "dev",
      agentMarkdown: "# dev",
      executionProfile: null,
    }])).toEqual([{ name: "dev", agentMarkdown: "# dev", executionProfile: null }]);
    const messages = [
      { id: 1, status: "pending", sourceKind: null },
      { id: 2, status: "completed", sourceKind: "local-worker-run" },
      { id: 3, status: "completed", sourceKind: null },
    ] as LocalConsoleMessage[];
    expect(planWorkerTimelineMessages(messages).map((message) => message.id)).toEqual([3]);
    expect(decideWorkerAgentMarkdownSource(undefined)).toEqual({ kind: "file" });
    expect(decideWorkerAttachmentPreparation(false)).toEqual({ kind: "empty" });
    expect(planWorkerAgentContents(
      [{ name: "dev", agentMarkdown: undefined, executionProfile: null }],
      "qa",
      "# qa",
      new Map([["dev", "# dev"]]),
    )).toEqual([{ name: "dev", agentMarkdown: "# dev", executionProfile: null }]);
  });
});
