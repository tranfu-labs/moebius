import { describe, expect, it } from "vitest";

import type { LocalConsoleMessage } from "../src/local-console/types.js";
import {
  executePendingWorkerDispatchFlow,
  type LocalWorkerDispatchFlowPorts,
} from "../src/local-console/worker-dispatch-flow.js";

interface Agent { name: string }
type Timeline = readonly number[];

describe("pending worker dispatch application flow", () => {
  it("preserves per-role FIFO while allowing independent role lanes", async () => {
    const messages = [message(1, "qa"), message(2, "qa"), message(3, "dev")];
    const claimed: number[] = [];
    const scheduled: Array<{ id: number; role: string }> = [];
    const ports = basePorts(messages, {
      activeRoles: () => new Set(["dev"]),
      claim: async (role) => {
        const next = messages.find((candidate) => candidate.dispatchRole === role && !claimed.includes(candidate.id));
        if (next !== undefined) claimed.push(next.id);
        return next ?? null;
      },
      schedule: ({ sourceMessage, role }) => scheduled.push({ id: sourceMessage.id, role }),
    });

    await executePendingWorkerDispatchFlow(ports);

    expect(claimed).toEqual([1]);
    expect(scheduled).toEqual([{ id: 1, role: "qa" }]);
  });

  it("releases a claimed message and stops before preparation when shutdown begins", async () => {
    const source = message(1, "qa");
    const events: string[] = [];
    const ports = basePorts([source], {
      claim: async () => {
        events.push("claim");
        return source;
      },
      releaseIfStopping: async () => {
        events.push("release");
        return true;
      },
      prepareRun: async () => {
        events.push("prepare");
        return { selectedAgent: { name: "qa" }, timeline: [], timelineMessages: [] };
      },
      schedule: () => events.push("schedule"),
    });

    await executePendingWorkerDispatchFlow(ports);

    expect(events).toEqual(["claim", "release"]);
  });
});

function basePorts(
  messages: LocalConsoleMessage[],
  overrides: Partial<LocalWorkerDispatchFlowPorts<Agent, Timeline>>,
): LocalWorkerDispatchFlowPorts<Agent, Timeline> {
  return {
    listPending: async () => messages,
    activeRoles: () => new Set(),
    queuedRoles: () => new Set(),
    loadAgents: async () => [{ name: "qa" }, { name: "dev" }],
    isStopping: () => false,
    nextRunId: async (messageId) => `run-${String(messageId)}`,
    claim: async (role) => messages.find((message) => message.dispatchRole === role) ?? null,
    releaseIfStopping: async () => false,
    recordMissingAgent: async () => undefined,
    prepareRun: async (sourceMessage, selectedAgent) => ({
      selectedAgent,
      timeline: [sourceMessage.id],
      timelineMessages: [sourceMessage],
    }),
    schedule: () => undefined,
    ...overrides,
  };
}

function message(id: number, role: string): LocalConsoleMessage {
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
    dispatchRole: role,
    dispatchReason: "single-valid-mention",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  };
}
