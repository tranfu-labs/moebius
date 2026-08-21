import { describe, expect, it, vi } from "vitest";

import { planLatestRoundFactFromLog, LOCAL_ROUND_FACT_TYPE, type LocalRoundFact } from "../src/local-console/round-closeout-plan.js";
import { LocalRoundTerminalRuntime, type LocalRoundRuntimePorts } from "../src/local-console/round-terminal-runtime.js";
import type { LocalConsoleSessionSummary, LocalConsoleStore } from "../src/local-console/types.js";

const T0 = "2026-08-10T09:00:00.000Z";

function terminalFact(roundId: number, outcome: LocalRoundFact["outcome"], occurredAt: string): LocalRoundFact {
  return { roundId, outcome, terminalMessageId: null, occurredAt };
}

function factLine(fact: LocalRoundFact): { type: string; sessionId: string; payload: LocalRoundFact } {
  return { type: LOCAL_ROUND_FACT_TYPE, sessionId: "s", payload: fact };
}

function summary(overrides: Partial<LocalConsoleSessionSummary> = {}): LocalConsoleSessionSummary {
  return {
    sessionId: "s",
    projectId: "p",
    title: "T",
    status: "idle",
    awaitsHumanReason: null,
    unreadSince: null,
    workspaceMode: "direct",
    workspacePendingMode: null,
    runningCount: 0,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
    interruptedCount: 0,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function makeRuntime(input: {
  messages?: Array<{ speaker: string; id: number; createdAt: string; updatedAt: string }>;
  summary?: Partial<LocalConsoleSessionSummary>;
  logValues?: readonly unknown[];
  nowIso?: string;
  persistFact?: LocalRoundRuntimePorts["persistFact"];
  recordRoundTerminal?: LocalConsoleStore["recordRoundTerminal"];
  readRoundFacts?: LocalRoundRuntimePorts["readRoundFacts"];
}): {
  runtime: LocalRoundTerminalRuntime;
  persistSpy: ReturnType<typeof vi.fn>;
  readLog: () => Promise<unknown[] | null>;
} {
  const logValues = [...(input.logValues ?? [])];
  const readLog = async () => logValues;
  const persistSpy = vi.fn(async () => true);
  const store = {
    listMessages: vi.fn(async () => input.messages ?? []),
  } as unknown as LocalConsoleStore;
  const readRoundFacts = input.readRoundFacts ?? (async () => {
    const snapshot = { values: logValues };
    return {
      lastRoundFact: planLatestRoundFactFromLog(snapshot, "s", LOCAL_ROUND_FACT_TYPE),
      lastPrimaryCloseout: null,
    };
  });
  const runtime = new LocalRoundTerminalRuntime({
    store,
    bus: { emit: vi.fn() } as never,
    nowIso: () => input.nowIso ?? "2026-08-10T09:05:00.000Z",
    readRoundFacts,
    persistFact: input.persistFact ?? persistSpy,
  });
  return { runtime, persistSpy, readLog };
}

describe("LocalRoundTerminalRuntime evaluation consistency", () => {
  it("re-evaluating a closed round returns the persisted fact, never a re-derived silent-closeout", async () => {
    // primary_closeout 与 round_terminal 同毫秒成对落盘；重评时同毫秒信号属于当前轮。
    const { runtime, persistSpy } = makeRuntime({
      messages: [{ speaker: "agent", id: 2, createdAt: T0, updatedAt: T0 }],
      summary: { updatedAt: T0 },
      readRoundFacts: async () => ({
        lastRoundFact: { ...terminalFact(1, "completed", T0), sessionId: "s", conversationTitle: "T" },
        lastPrimaryCloseout: { messageId: 2, role: "lead", occurredAt: T0 },
      }),
      nowIso: "2026-08-10T09:05:31.000Z", // 远超 30s 静默窗口
    });
    const state = await runtime.evaluate("s", summary({ updatedAt: T0 }));
    expect(state).toMatchObject({ kind: "terminal", roundId: 1, fact: { outcome: "completed" } });
    expect(persistSpy).not.toHaveBeenCalled();
  });

  it("keeps a genuine silent closeout when the session really went idle past the window", async () => {
    const { runtime, persistSpy } = makeRuntime({
      messages: [
        { speaker: "user", id: 1, createdAt: T0, updatedAt: T0 },
        { speaker: "agent", id: 2, createdAt: "2026-08-10T09:01:00.000Z", updatedAt: "2026-08-10T09:01:00.000Z" },
      ],
      summary: { updatedAt: "2026-08-10T09:01:00.000Z" },
      nowIso: "2026-08-10T09:01:31.000Z",
    });
    const state = await runtime.evaluate("s", summary({ updatedAt: "2026-08-10T09:01:00.000Z" }));
    expect(state).toMatchObject({ kind: "terminal", roundId: 1, fact: { outcome: "silent-closeout" } });
    expect(persistSpy).toHaveBeenCalledTimes(1);
  });

  it("recovers the persisted fact when it appears during a round re-evaluation", async () => {
    let readCount = 0;
    const persistFact = vi.fn(async () => {
      throw new Error("conflicting round_terminal fact for round:1");
    });
    const { runtime } = makeRuntime({
      messages: [
        { speaker: "user", id: 1, createdAt: T0, updatedAt: T0 },
        { speaker: "agent", id: 2, createdAt: "2026-08-10T09:01:00.000Z", updatedAt: "2026-08-10T09:01:00.000Z" },
      ],
      summary: { updatedAt: "2026-08-10T09:01:00.000Z" },
      nowIso: "2026-08-10T09:01:31.000Z",
      persistFact,
      readRoundFacts: async () => {
        readCount += 1;
        return readCount < 3
          ? { lastRoundFact: null, lastPrimaryCloseout: null }
          : {
              lastRoundFact: {
                ...terminalFact(1, "completed", T0),
                sessionId: "s",
                conversationTitle: "T",
              },
              lastPrimaryCloseout: null,
            };
      },
    });

    const state = await runtime.evaluate("s", summary({ updatedAt: "2026-08-10T09:01:00.000Z" }));
    expect(state).toMatchObject({ kind: "terminal", roundId: 1, fact: { outcome: "completed" } });
    expect(persistFact).toHaveBeenCalledTimes(1);
  });

  it("rethrows unrelated persistence failures instead of treating them as fact conflicts", async () => {
    const persistFact = vi.fn(async () => {
      throw new Error("permission denied");
    });
    const { runtime } = makeRuntime({
      messages: [
        { speaker: "user", id: 1, createdAt: T0, updatedAt: T0 },
        { speaker: "agent", id: 2, createdAt: "2026-08-10T09:01:00.000Z", updatedAt: "2026-08-10T09:01:00.000Z" },
      ],
      summary: { updatedAt: "2026-08-10T09:01:00.000Z" },
      nowIso: "2026-08-10T09:01:31.000Z",
      persistFact,
    });

    await expect(runtime.evaluate("s", summary({ updatedAt: "2026-08-10T09:01:00.000Z" })))
      .rejects.toThrow("permission denied");
    expect(persistFact).toHaveBeenCalledTimes(1);
  });

  it("still closes a later round silently when the previous round has a persisted fact", async () => {
    const { runtime, persistSpy } = makeRuntime({
      messages: [
        { speaker: "user", id: 3, createdAt: "2026-08-10T09:10:00.000Z", updatedAt: "2026-08-10T09:10:00.000Z" },
      ],
      summary: { updatedAt: "2026-08-10T09:10:00.000Z" },
      readRoundFacts: async () => ({
        lastRoundFact: { ...terminalFact(1, "completed", T0), sessionId: "s", conversationTitle: "T" },
        lastPrimaryCloseout: null,
      }),
      nowIso: "2026-08-10T09:11:00.000Z",
    });
    const state = await runtime.evaluate("s", summary({ updatedAt: "2026-08-10T09:10:00.000Z" }));
    expect(state).toMatchObject({ kind: "terminal", roundId: 2, fact: { outcome: "silent-closeout" } });
    expect(persistSpy).toHaveBeenCalledTimes(1);
    // 落盘后可再次投影出同一结论。
    const { runtime: again } = makeRuntime({
      messages: [
        { speaker: "user", id: 3, createdAt: "2026-08-10T09:10:00.000Z", updatedAt: "2026-08-10T09:10:00.000Z" },
      ],
      summary: { updatedAt: "2026-08-10T09:10:00.000Z" },
      readRoundFacts: async () => ({
        lastRoundFact: { ...terminalFact(2, "silent-closeout", "2026-08-10T09:11:00.000Z"), sessionId: "s", conversationTitle: "T" },
        lastPrimaryCloseout: null,
      }),
      nowIso: "2026-08-10T09:12:00.000Z",
    });
    const state2 = await again.evaluate("s", summary({ updatedAt: "2026-08-10T09:10:00.000Z" }));
    expect(state2).toMatchObject({ kind: "terminal", roundId: 2, fact: { outcome: "silent-closeout" } });
  });

  it("projects the latest persisted fact from the log", async () => {
    const { runtime } = makeRuntime({
      logValues: [
        factLine(terminalFact(1, "completed", T0)),
        "junk",
        factLine(terminalFact(2, "awaiting-user", "2026-08-10T09:02:00.000Z")),
      ],
    });
    const fact = await runtime.readLastRoundFact("s");
    expect(fact).toMatchObject({ roundId: 2, outcome: "awaiting-user" });
    expect(planLatestRoundFactFromLog({ values: [] }, "s", LOCAL_ROUND_FACT_TYPE)).toBeNull();
  });
});
