import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixtureStore(): Promise<{ store: ReturnType<typeof createSqliteLocalConsoleStore> extends Promise<infer T> ? T : never; sqlitePath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-handoff-dispatch-"));
  roots.push(root);
  const sqlitePath = path.join(root, ".state", "local-console.sqlite");
  const store = await createSqliteLocalConsoleStore({ sqlitePath });
  await store.init();
  await store.createSession({
    sessionId: "session-a",
    title: "handoff dispatch store test",
    now: "2026-08-01T00:00:00.000Z",
  });
  return { store, sqlitePath };
}

describe("local console handoff dispatch store", () => {
  it("assigns strictly increasing generations per role and keeps roles independent", async () => {
    const { store } = await fixtureStore();
    const qaFirst = await store.recordHandoffDispatch!({
      sessionId: "session-a",
      role: "qa",
      runId: "run-1",
      sourceMessageId: 1,
      now: "2026-08-01T00:00:00.000Z",
    });
    const qaSecond = await store.recordHandoffDispatch!({
      sessionId: "session-a",
      role: "qa",
      runId: "run-2",
      sourceMessageId: 2,
      now: "2026-08-01T00:00:00.100Z",
    });
    const devFirst = await store.recordHandoffDispatch!({
      sessionId: "session-a",
      role: "dev",
      runId: "run-3",
      sourceMessageId: 3,
      now: "2026-08-01T00:00:00.200Z",
    });
    expect([qaFirst, qaSecond, devFirst]).toEqual([1, 2, 1]);
    await store.close();
  });

  it("projects run generation and role latest, and survives restart with continued counting", async () => {
    const { store, sqlitePath } = await fixtureStore();
    await store.recordHandoffDispatch!({
      sessionId: "session-a",
      role: "qa",
      runId: "run-1",
      sourceMessageId: 1,
      now: "2026-08-01T00:00:00.000Z",
    });
    await store.recordHandoffDispatch!({
      sessionId: "session-a",
      role: "qa",
      runId: "run-2",
      sourceMessageId: 2,
      now: "2026-08-01T00:00:00.100Z",
    });
    await store.close();

    const reopened = await createSqliteLocalConsoleStore({ sqlitePath });
    await reopened.init();
    expect(await reopened.readHandoffDispatchState!({
      sessionId: "session-a",
      role: "qa",
      runId: "run-1",
    })).toEqual({ runGeneration: 1, latestGeneration: 2 });
    expect(await reopened.readHandoffDispatchState!({
      sessionId: "session-a",
      role: "qa",
      runId: "run-2",
    })).toEqual({ runGeneration: 2, latestGeneration: 2 });
    expect(await reopened.readHandoffDispatchState!({
      sessionId: "session-a",
      role: "qa",
      runId: "unknown-run",
    })).toEqual({ runGeneration: null, latestGeneration: 2 });
    expect(await reopened.recordHandoffDispatch!({
      sessionId: "session-a",
      role: "qa",
      runId: "run-3",
      sourceMessageId: 3,
      now: "2026-08-01T00:00:00.200Z",
    })).toBe(3);
    await reopened.close();
  });
});
