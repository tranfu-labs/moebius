import { describe, expect, it } from "vitest";

import type { LocalRunLifecycleActiveRun } from "../src/local-console/run-lifecycle-contracts.js";
import { LocalRunLifecycleActivityRuntime } from "../src/local-console/run-lifecycle-activity-runtime.js";

describe("run lifecycle activity snapshot", () => {
  it("keeps the exact active profile beside the engine for first-render Provider marks", async () => {
    const profile = {
      cli: "pi" as const,
      providerId: "deepseek" as const,
      providerProfileId: "profile-a",
      model: "deepseek-chat",
      effort: "medium",
    };
    const active = {
      sessionId: "session-a",
      runId: "run-a",
      role: "dev",
      lane: "primary",
      runDir: null,
      cwd: "/tmp/work",
      workspaceMode: "direct",
      worktreeUnavailableReason: null,
      branchName: null,
      baseRef: null,
      liveMarkdown: null,
      activity: null,
      activitySteps: [],
      activitySequence: 0,
      activityFactTail: Promise.resolve(),
      longRunReported: false,
      createdAt: "2026-08-21T00:00:00.000Z",
      startedAt: "2026-08-21T00:00:01.000Z",
      segmentStartedAt: "2026-08-21T00:00:01.000Z",
      accumulatedMs: 0,
      resuming: false,
      stepId: "message:1",
      attempt: 1,
      engine: "pi",
      profile,
      nativePromptDecision: null,
      processOutputAvailable: true,
      terminalRecorded: false,
    } satisfies LocalRunLifecycleActiveRun;
    const runtime = new LocalRunLifecycleActivityRuntime({
      activeRun: (runId) => runId === active.runId ? active : undefined,
      touchActiveRun: () => undefined,
      activeRuns: () => [active],
      lifecycleStore: () => null,
      storeCall: async <T>(_label: string, operation: () => Promise<T>) => await operation(),
      now: () => new Date("2026-08-21T00:00:02.000Z"),
      nowIso: () => "2026-08-21T00:00:02.000Z",
      recordError: () => undefined,
      readOutputTail: async () => ({
        stdoutTail: null,
        stderrTail: null,
        lastOutputSummary: "",
        tailDiagnostic: null,
      }),
      longRunReportMs: 60_000,
    });

    await expect(runtime.snapshot(active)).resolves.toMatchObject({
      engine: "pi",
      profile,
    });
  });
});
