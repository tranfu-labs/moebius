import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startLocalConsoleServer } from "../src/local-console/server.js";
import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("local console sidebar metadata", () => {
  it("persists manual unread through the required leave-and-reenter lifecycle", async () => {
    const { store, sqlitePath } = await fixtureStore();
    await store.createSession({
      sessionId: "manual-unread",
      title: "手动提醒",
      now: "2026-07-30T00:00:00.000Z",
    });

    const marked = await store.updateSessionReadState({
      sessionId: "manual-unread",
      action: "mark-unread",
      expectedAttentionRevision: 0,
      expectedReadStateRevision: 0,
      expectedTitleRevision: 0,
      isCurrent: true,
      now: "2026-07-30T00:00:01.000Z",
    });
    expect(marked).toMatchObject({
      manualUnreadAt: "2026-07-30T00:00:01.000Z",
      manualUnreadRequiresLeave: true,
    });
    expect(await store.markSessionViewed({
      sessionId: "manual-unread",
      now: "2026-07-30T00:00:02.000Z",
    })).toMatchObject({ manualUnreadAt: "2026-07-30T00:00:01.000Z" });

    await store.armSessionManualUnread({
      sessionId: "manual-unread",
      now: "2026-07-30T00:00:03.000Z",
    });
    expect(await store.markSessionViewed({
      sessionId: "manual-unread",
      now: "2026-07-30T00:00:04.000Z",
    })).toMatchObject({
      manualUnreadAt: null,
      manualUnreadRequiresLeave: false,
    });
    await store.close();

    const reopened = await createSqliteLocalConsoleStore({ sqlitePath });
    await reopened.init();
    expect((await reopened.listSessions()).find((session) => session.sessionId === "manual-unread"))
      .toMatchObject({ manualUnreadAt: null, manualUnreadRequiresLeave: false });
    await reopened.close();
  });

  it("acknowledges one attention revision and alerts again only for a later fact", async () => {
    const { store, sqlitePath } = await fixtureStore();
    await store.createSession({
      sessionId: "attention",
      title: "异常提醒",
      now: "2026-07-30T00:00:00.000Z",
    });
    await store.recordSystemMessage({
      sessionId: "attention",
      body: "第一次失败",
      runId: null,
      runDir: null,
      error: "failed",
      status: "failed",
      systemEventKind: "run-not-started",
      now: "2026-07-30T00:00:01.000Z",
    });
    const alerted = (await store.listSessions()).find((session) => session.sessionId === "attention");
    expect(alerted).toMatchObject({
      attentionRevision: 1,
      attentionAcknowledgedRevision: 0,
      hasUnacknowledgedAttention: true,
    });

    const acknowledged = await store.updateSessionReadState({
      sessionId: "attention",
      action: "mark-read-attention",
      expectedAttentionRevision: 1,
      expectedReadStateRevision: 0,
      expectedTitleRevision: 0,
      isCurrent: false,
      now: "2026-07-30T00:00:02.000Z",
    });
    expect(acknowledged).toMatchObject({
      attentionRevision: 1,
      attentionAcknowledgedRevision: 1,
      hasUnacknowledgedAttention: false,
    });
    await store.close();

    const reopened = await createSqliteLocalConsoleStore({ sqlitePath });
    await reopened.init();
    expect((await reopened.listSessions()).find((session) => session.sessionId === "attention"))
      .toMatchObject({ attentionRevision: 1, attentionAcknowledgedRevision: 1 });
    await reopened.recordSystemMessage({
      sessionId: "attention",
      body: "后来新增失败",
      runId: null,
      runDir: null,
      error: "failed again",
      status: "failed",
      systemEventKind: "retry-exhausted",
      now: "2026-07-30T00:00:03.000Z",
    });
    expect((await reopened.listSessions()).find((session) => session.sessionId === "attention"))
      .toMatchObject({
        attentionRevision: 2,
        attentionAcknowledgedRevision: 1,
        hasUnacknowledgedAttention: true,
      });
    await reopened.close();
  });

  it("persists pin and title revisions while rejecting stale mutations", async () => {
    const { store, sqlitePath } = await fixtureStore();
    await store.createSession({
      sessionId: "metadata",
      title: "原标题",
      now: "2026-07-30T00:00:00.000Z",
    });
    const pinned = await store.setSessionPinned({
      sessionId: "metadata",
      pinned: true,
      expectedPinnedAt: null,
      now: "2026-07-30T00:00:01.000Z",
    });
    expect(pinned.pinnedAt).toBe("2026-07-30T00:00:01.000Z");
    await expect(store.setSessionPinned({
      sessionId: "metadata",
      pinned: true,
      expectedPinnedAt: null,
      now: "2026-07-30T00:00:02.000Z",
    })).rejects.toThrow("SESSION_SIDEBAR_STATE_STALE");

    expect(await store.renameSession({
      sessionId: "metadata",
      title: "  新标题  ",
      expectedTitleRevision: 0,
      now: "2026-07-30T00:00:03.000Z",
    })).toMatchObject({ title: "新标题", titleRevision: 1 });
    await expect(store.renameSession({
      sessionId: "metadata",
      title: "陈旧写入",
      expectedTitleRevision: 0,
      now: "2026-07-30T00:00:04.000Z",
    })).rejects.toThrow("SESSION_SIDEBAR_STATE_STALE");
    await store.close();

    const reopened = await createSqliteLocalConsoleStore({ sqlitePath });
    await reopened.init();
    expect((await reopened.listSessions()).find((session) => session.sessionId === "metadata"))
      .toMatchObject({
        title: "新标题",
        titleRevision: 1,
        pinnedAt: "2026-07-30T00:00:01.000Z",
      });
    await reopened.close();
  });

  it("exposes confirmed mutations and stale-state conflicts through the loopback API", async () => {
    const { store } = await fixtureStore();
    await store.createSession({
      sessionId: "api-metadata",
      title: "API 原标题",
      now: "2026-07-30T00:00:00.000Z",
    });
    const started = await startLocalConsoleServer({
      projectRoot: process.cwd(),
      port: 0,
      store,
      listAgentFiles: async () => [],
      isCodexThreadAvailable: async () => true,
    });
    try {
      const rename = await fetch(new URL(
        "/api/local-console/sessions/api-metadata/title",
        started.url,
      ), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "API 新标题", expectedTitleRevision: 0 }),
      });
      expect(rename.status).toBe(200);
      expect(await rename.json()).toMatchObject({
        session: { title: "API 新标题", titleRevision: 1 },
      });

      const staleRename = await fetch(new URL(
        "/api/local-console/sessions/api-metadata/title",
        started.url,
      ), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "陈旧标题", expectedTitleRevision: 0 }),
      });
      expect(staleRename.status).toBe(409);
      expect(await staleRename.json()).toMatchObject({ code: "SESSION_SIDEBAR_STATE_STALE" });

      const pin = await fetch(new URL(
        "/api/local-console/sessions/api-metadata/pin",
        started.url,
      ), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinned: true, expectedPinnedAt: null }),
      });
      expect(pin.status).toBe(200);
      expect(await pin.json()).toMatchObject({ session: { pinnedAt: expect.any(String) } });

      const unread = await fetch(new URL(
        "/api/local-console/sessions/api-metadata/attention",
        started.url,
      ), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "mark-unread",
          expectedAttentionRevision: 0,
          expectedReadStateRevision: 0,
          expectedTitleRevision: 1,
          isCurrent: false,
        }),
      });
      expect(unread.status).toBe(200);
      expect(await unread.json()).toMatchObject({
        session: { manualUnreadAt: expect.any(String), manualUnreadRequiresLeave: false },
      });
    } finally {
      await started.close();
    }
  });

  it("rejects an old blue menu after a newer agent result advances the read generation", async () => {
    const { store } = await fixtureStore();
    await store.createSession({
      sessionId: "stale-blue",
      title: "蓝点竞态",
      now: "2026-07-30T00:00:00.000Z",
    });
    await store.recordDetachedAgentResponse({
      sessionId: "stale-blue",
      role: "assistant",
      body: "第一条结果",
      runId: "run-1",
      runDir: "/tmp/run-1",
      now: "2026-07-30T00:00:03.000Z",
    });
    const menuState = (await store.listSessions()).find((session) =>
      session.sessionId === "stale-blue");
    expect(menuState).toMatchObject({
      unreadSince: "2026-07-30T00:00:03.000Z",
      readStateRevision: 1,
    });

    await store.recordDetachedAgentResponse({
      sessionId: "stale-blue",
      role: "assistant",
      body: "后来到达的新结果",
      runId: "run-2",
      runDir: "/tmp/run-2",
      now: "2026-07-30T00:00:06.000Z",
    });

    const started = await startLocalConsoleServer({
      projectRoot: process.cwd(),
      port: 0,
      store,
      listAgentFiles: async () => [],
      isCodexThreadAvailable: async () => true,
    });
    try {
      const staleRead = await fetch(new URL(
        "/api/local-console/sessions/stale-blue/attention",
        started.url,
      ), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "mark-read-unread",
          expectedAttentionRevision: menuState?.attentionRevision ?? 0,
          expectedReadStateRevision: menuState?.readStateRevision ?? 0,
          expectedTitleRevision: menuState?.titleRevision ?? 0,
          isCurrent: false,
        }),
      });
      expect(staleRead.status).toBe(409);
      expect(await staleRead.json()).toMatchObject({ code: "SESSION_SIDEBAR_STATE_STALE" });
      expect((await store.listSessions()).find((session) => session.sessionId === "stale-blue"))
        .toMatchObject({
          unreadSince: "2026-07-30T00:00:06.000Z",
          readStateRevision: 2,
        });
    } finally {
      await started.close();
    }
  });
});

async function fixtureStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-sidebar-metadata-"));
  roots.push(root);
  const sqlitePath = path.join(root, ".state", "local-console.sqlite");
  const store = await createSqliteLocalConsoleStore({ sqlitePath });
  await store.init();
  return { store, sqlitePath };
}
