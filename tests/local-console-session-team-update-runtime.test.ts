import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { finalizeAgentTeamSnapshot } from "../src/local-console/session-team-snapshot.js";
import { decideSubmittedMessageDispatch } from "../src/local-console/message-command-plan.js";
import { LocalPendingSessionContextRuntime } from "../src/local-console/pending-session-context-runtime.js";
import { LocalSessionTeamUpdateRuntime } from "../src/local-console/session-team-update-runtime.js";
import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";
import type { LocalConsoleAgentTeamSnapshot, LocalConsoleStore } from "../src/local-console/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("session team update runtime failure and recovery", () => {
  it("persists a failed first promotion, survives restart, rejects a late token and retries the frozen target", async () => {
    const fixture = await createFixture("failure-recovery");
    roots.push(fixture.root);
    const { store, oldSnapshot, frozenSnapshot } = fixture;
    await store.writeSessionAgentTeamCandidate!({ sessionId: fixture.sessionId, snapshot: frozenSnapshot });
    const processPending = vi.fn();
    const failingRuntime = runtime(overrideStore(store, {
      applyPendingSessionContext: async () => { throw new Error("injected first promotion failure"); },
    }), frozenSnapshot, processPending);

    await expect(failingRuntime.apply(fixture.sessionId, frozenSnapshot.snapshotKey)).resolves.toMatchObject({
      status: "failed",
      updateToken: frozenSnapshot.snapshotKey,
      failure: { code: "TEAM_UPDATE_APPLY_FAILED" },
    });
    expect((await store.listSessionAgentTeamSnapshot!(fixture.sessionId))?.snapshotKey).toBe(oldSnapshot.snapshotKey);
    expect(processPending).not.toHaveBeenCalled();
    await store.close();

    const reopened = await createSqliteLocalConsoleStore({
      sqlitePath: fixture.sqlitePath,
      sessionLogRoot: path.join(fixture.root, "sessions"),
    });
    await reopened.init();
    const newerSnapshot = snapshot("newer", "kimi", "2026-08-04T00:03:00.000Z");
    await reopened.writeSessionAgentTeamCandidate!({ sessionId: fixture.sessionId, snapshot: newerSnapshot });
    expect(await reopened.readSessionTeamUpdateRecord!(fixture.sessionId)).toMatchObject({
      candidate: { snapshotKey: newerSnapshot.snapshotKey },
      pending: { snapshotKey: frozenSnapshot.snapshotKey },
      intent: { status: "failed", targetSnapshotKey: frozenSnapshot.snapshotKey },
    });

    const resumedPending = vi.fn();
    const recoveredRuntime = runtime(reopened, newerSnapshot, resumedPending);
    await expect(recoveredRuntime.retry(fixture.sessionId, newerSnapshot.snapshotKey))
      .rejects.toThrow("SESSION_TEAM_UPDATE_STALE");
    expect((await reopened.readSessionTeamUpdateRecord!(fixture.sessionId)).intent?.status).toBe("failed");

    await expect(recoveredRuntime.retry(fixture.sessionId, frozenSnapshot.snapshotKey)).resolves.toMatchObject({
      status: "idle",
    });
    expect((await reopened.listSessionAgentTeamSnapshot!(fixture.sessionId))?.snapshotKey)
      .toBe(frozenSnapshot.snapshotKey);
    expect(resumedPending).toHaveBeenCalledOnce();
    await reopened.close();
  });

  it("cancels a failed frozen target, releases waiting work, and re-exposes a later saved version", async () => {
    const fixture = await createFixture("cancel-later-version");
    roots.push(fixture.root);
    const { store, frozenSnapshot } = fixture;
    await store.writeSessionAgentTeamCandidate!({ sessionId: fixture.sessionId, snapshot: frozenSnapshot });
    await store.beginSessionTeamUpdate!({
      sessionId: fixture.sessionId,
      expectedUpdateToken: frozenSnapshot.snapshotKey,
      now: "2026-08-04T00:02:00.000Z",
    });
    await store.markSessionTeamUpdateFailed!({
      sessionId: fixture.sessionId,
      code: "INJECTED",
      summary: "failed",
    });
    const newerSnapshot = snapshot("newer", "kimi", "2026-08-04T00:03:00.000Z");
    await store.writeSessionAgentTeamCandidate!({ sessionId: fixture.sessionId, snapshot: newerSnapshot });
    const processPending = vi.fn();

    await expect(runtime(store, newerSnapshot, processPending)
      .cancel(fixture.sessionId, frozenSnapshot.snapshotKey)).resolves.toMatchObject({
      status: "available",
      updateToken: newerSnapshot.snapshotKey,
    });
    expect(processPending).toHaveBeenCalledOnce();
    expect(await store.readSessionTeamUpdateRecord!(fixture.sessionId)).toMatchObject({
      pending: null,
      intent: null,
      candidate: { snapshotKey: newerSnapshot.snapshotKey },
    });
    await store.close();
  });

  it("cancels an unpersisted failure idempotently and re-exposes its saved candidate", async () => {
    const fixture = await createFixture("cancel-missing-intent");
    roots.push(fixture.root);
    await fixture.store.writeSessionAgentTeamCandidate!({
      sessionId: fixture.sessionId,
      snapshot: fixture.frozenSnapshot,
    });
    const processPending = vi.fn();

    await expect(runtime(fixture.store, fixture.frozenSnapshot, processPending)
      .cancel(fixture.sessionId, fixture.frozenSnapshot.snapshotKey)).resolves.toMatchObject({
      status: "available",
      updateToken: fixture.frozenSnapshot.snapshotKey,
    });
    expect(processPending).toHaveBeenCalledOnce();
    expect(await fixture.store.readSessionTeamUpdateRecord!(fixture.sessionId)).toMatchObject({
      candidate: { snapshotKey: fixture.frozenSnapshot.snapshotKey },
      pending: null,
      intent: null,
    });
    await fixture.store.close();
  });

  it("preserves the frozen target and awaiting messages when a pre-apply run becomes stuck across restart", async () => {
    const fixture = await createFixture("restart-stuck-old-work");
    roots.push(fixture.root);
    const oldMessage = await fixture.store.appendUserMessage({
      sessionId: fixture.sessionId,
      body: "old work",
      dispatch: { lane: "primary", role: "lead", reason: "single-valid-mention" },
      now: "2026-08-04T00:00:20.000Z",
    });
    await fixture.store.claimNextPendingMessage({
      sessionId: fixture.sessionId,
      runId: "run-before-update",
      now: "2026-08-04T00:00:30.000Z",
    });
    await fixture.store.writeSessionAgentTeamCandidate!({
      sessionId: fixture.sessionId,
      snapshot: fixture.frozenSnapshot,
    });
    await fixture.store.beginSessionTeamUpdate!({
      sessionId: fixture.sessionId,
      expectedUpdateToken: fixture.frozenSnapshot.snapshotKey,
      now: "2026-08-04T00:02:00.000Z",
    });
    const awaiting = await fixture.store.appendUserMessage({
      sessionId: fixture.sessionId,
      body: "wait for frozen team",
      dispatch: { lane: "awaiting-team", role: null, reason: "no-valid-mention" },
      now: "2026-08-04T00:02:30.000Z",
    });
    await fixture.store.recordStuck({
      userMessageId: oldMessage.id,
      sessionId: fixture.sessionId,
      reason: "orphaned after crash",
      runId: "run-before-update",
      runDir: null,
      now: "2026-08-04T00:04:00.000Z",
    });
    await fixture.store.close();

    const reopened = await createSqliteLocalConsoleStore({
      sqlitePath: fixture.sqlitePath,
      sessionLogRoot: path.join(fixture.root, "sessions"),
    });
    await reopened.init();
    const pendingRuntime = new LocalPendingSessionContextRuntime({
      store: reopened,
      storeCall: async (_label, operation) => await operation(),
      nowIso: () => "2026-08-04T00:05:00.000Z",
      hasActiveRun: () => false,
      hasScheduledWorker: () => false,
      listAgentNames: async () => ["lead"],
    });
    await pendingRuntime.applyWhenIdle(fixture.sessionId);

    expect(await reopened.listSessionAgentTeamSnapshot!(fixture.sessionId)).toMatchObject({
      snapshotKey: fixture.oldSnapshot.snapshotKey,
    });
    expect(await reopened.readSessionTeamUpdateRecord!(fixture.sessionId)).toMatchObject({
      pending: { snapshotKey: fixture.frozenSnapshot.snapshotKey },
      intent: {
        status: "failed",
        targetSnapshotKey: fixture.frozenSnapshot.snapshotKey,
        failureCode: "TEAM_UPDATE_OLD_WORK_UNRECOVERABLE",
      },
    });
    expect((await reopened.listMessages(fixture.sessionId)).find((message) => message.id === awaiting.id))
      .toMatchObject({ status: "pending", dispatchLane: "awaiting-team" });

    const processPending = vi.fn();
    await expect(runtime(reopened, fixture.frozenSnapshot, processPending)
      .retry(fixture.sessionId, fixture.frozenSnapshot.snapshotKey)).resolves.toMatchObject({ status: "idle" });
    expect(await reopened.listSessionAgentTeamSnapshot!(fixture.sessionId)).toMatchObject({
      snapshotKey: fixture.frozenSnapshot.snapshotKey,
    });
    expect(processPending).toHaveBeenCalledOnce();
    await reopened.close();
  });

  it("recreates a missing first intent from the frozen candidate before an immediate message is routed", async () => {
    const fixture = await createFixture("retry-missing-intent");
    roots.push(fixture.root);
    await fixture.store.writeSessionAgentTeamCandidate!({
      sessionId: fixture.sessionId,
      snapshot: fixture.frozenSnapshot,
    });
    const promotionStarted = deferred<void>();
    const releasePromotion = deferred<void>();
    const delayedStore = overrideStore(fixture.store, {
      applyPendingSessionContext: async (input) => {
        promotionStarted.resolve(undefined);
        await releasePromotion.promise;
        return await fixture.store.applyPendingSessionContext(input);
      },
    });
    const retry = runtime(delayedStore, snapshot("later", "kimi", "2026-08-04T00:03:00.000Z"), vi.fn())
      .retry(fixture.sessionId, fixture.frozenSnapshot.snapshotKey);

    await promotionStarted.promise;
    const summary = (await fixture.store.listProjects())
      .flatMap((project) => project.sessions)
      .find((session) => session.sessionId === fixture.sessionId)!;
    expect(decideSubmittedMessageDispatch(summary)).toEqual({
      kind: "awaiting-team",
      dispatch: { lane: "awaiting-team", role: null, reason: "no-valid-mention" },
    });
    expect(await fixture.store.readSessionTeamUpdateRecord!(fixture.sessionId)).toMatchObject({
      candidate: { snapshotKey: fixture.frozenSnapshot.snapshotKey },
      pending: { snapshotKey: fixture.frozenSnapshot.snapshotKey },
      intent: { status: "waiting", targetSnapshotKey: fixture.frozenSnapshot.snapshotKey },
    });

    releasePromotion.resolve(undefined);
    await expect(retry).resolves.toMatchObject({ status: "idle" });
    expect(await fixture.store.listSessionAgentTeamSnapshot!(fixture.sessionId)).toMatchObject({
      snapshotKey: fixture.frozenSnapshot.snapshotKey,
      members: [{ agentMarkdown: "frozen" }],
    });
    await fixture.store.close();
  });

  it("does not retain a partial candidate when its first persistence fails", async () => {
    const fixture = await createFixture("candidate-write-failure");
    roots.push(fixture.root);
    const writeCandidate = vi.fn(async () => { throw new Error("injected candidate persistence failure"); });
    const failingStore = overrideStore(fixture.store, { writeSessionAgentTeamCandidate: writeCandidate });

    await expect(runtime(failingStore, fixture.frozenSnapshot, vi.fn()).inspect(fixture.sessionId))
      .rejects.toThrow("injected candidate persistence failure");
    expect(writeCandidate).toHaveBeenCalledOnce();
    expect(await fixture.store.readSessionTeamUpdateRecord!(fixture.sessionId)).toEqual({
      candidate: null,
      pending: null,
      intent: null,
    });

    await expect(runtime(fixture.store, fixture.frozenSnapshot, vi.fn()).inspect(fixture.sessionId))
      .resolves.toMatchObject({ status: "available", updateToken: fixture.frozenSnapshot.snapshotKey });
    await fixture.store.close();
  });
});

function runtime(
  store: LocalConsoleStore,
  loaded: LocalConsoleAgentTeamSnapshot,
  processPending: (sessionId: string) => void,
): LocalSessionTeamUpdateRuntime {
  let tick = 0;
  return new LocalSessionTeamUpdateRuntime({
    store,
    storeCall: async (_label, operation) => await operation(),
    nowIso: () => `2026-08-04T00:10:${String(tick++).padStart(2, "0")}.000Z`,
    loadAgentTeamSnapshot: async () => loaded,
    processPending,
  });
}

function overrideStore(
  store: LocalConsoleStore,
  overrides: Partial<LocalConsoleStore>,
): LocalConsoleStore {
  return new Proxy(store, {
    get(target, property) {
      const replacement = Reflect.get(overrides, property);
      if (replacement !== undefined) return replacement;
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function createFixture(name: string): Promise<{
  root: string;
  sqlitePath: string;
  sessionId: string;
  store: LocalConsoleStore;
  oldSnapshot: LocalConsoleAgentTeamSnapshot;
  frozenSnapshot: LocalConsoleAgentTeamSnapshot;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-team-update-runtime-"));
  const sqlitePath = path.join(root, "state.sqlite");
  const sessionId = `team-update-${name}`;
  const store = await createSqliteLocalConsoleStore({ sqlitePath, sessionLogRoot: path.join(root, "sessions") });
  await store.init();
  const oldSnapshot = snapshot("old", "codex", "2026-08-04T00:00:00.000Z");
  const frozenSnapshot = snapshot("frozen", "claude", "2026-08-04T00:01:00.000Z");
  await store.createSession({
    sessionId,
    title: name,
    agentTeamOwnership: "user",
    agentTeamId: "team-a",
    agentTeamSnapshot: oldSnapshot,
    now: "2026-08-04T00:00:00.000Z",
  });
  return { root, sqlitePath, sessionId, store, oldSnapshot, frozenSnapshot };
}

function snapshot(
  markdown: string,
  cli: "codex" | "claude" | "kimi",
  capturedAt: string,
): LocalConsoleAgentTeamSnapshot {
  return finalizeAgentTeamSnapshot({
    team: { ownership: "user", id: "team-a", name: "Team A", description: "Purpose", primaryAgentSlug: "lead" },
    members: [{
      name: "lead", displayName: "Lead", description: "Leads", agentMarkdown: markdown,
      executionProfile: { cli, model: `${cli}-model`, effort: "high" },
    }],
  }, { capturedAt });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
