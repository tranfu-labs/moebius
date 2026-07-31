import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { compactSessionFactLog, replayMessages } from "../src/local-console/session-fact-compaction.js";
import {
  appendSessionFactLogLine,
  canonicalJson,
  invalidateSessionFactLog,
  readSessionFactLog,
} from "../src/local-console/session-fact-log.js";
import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";

const roots: string[] = [];

afterEach(async () => {
  invalidateSessionFactLog();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("会话事实日志的增量写入", () => {
  it("每条事件只携带真正变更的消息，日志不随事件数 × 消息数膨胀", async () => {
    const root = await fixtureRoot("moebius-fact-growth-");
    const store = await createSqliteLocalConsoleStore({
      sqlitePath: path.join(root, ".state", "local-console.sqlite"),
    });
    await store.init();
    const sessionId = "local:growth";
    await store.createSession({ sessionId, title: "growth", now: stamp(0) });

    for (let round = 1; round <= 4; round += 1) {
      const message = await store.appendUserMessage({
        sessionId,
        body: `第 ${String(round)} 轮指令`,
        now: stamp(round * 10),
      });
      await store.claimNextPendingMessage({
        sessionId,
        runId: `run-${String(round)}`,
        now: stamp(round * 10 + 1),
      });
      await store.setRunDir({
        id: message.id,
        sessionId,
        runDir: `/tmp/run-${String(round)}`,
        now: stamp(round * 10 + 2),
      });
      await store.recordAgentResponse({
        userMessageId: message.id,
        sessionId,
        role: "dev",
        body: `第 ${String(round)} 轮回复`,
        runId: `run-${String(round)}`,
        runDir: `/tmp/run-${String(round)}`,
        now: stamp(round * 10 + 3),
      });
      await store.recordMessageProcessed({
        userMessageId: message.id,
        sessionId,
        runId: `run-${String(round)}`,
        runDir: `/tmp/run-${String(round)}`,
        now: stamp(round * 10 + 4),
      });
    }
    const logPath = store.getSessionFactLogPath(sessionId);
    await store.close();

    const events = await readEvents(logPath);
    const messageCount = new Set(events.flatMap((event) =>
      event.messageUpserts.map((message) => message.id))).size;
    expect(messageCount).toBeGreaterThanOrEqual(8);

    // 不变式：每条 upsert 都必须相对上一状态真的变了。键序缺陷下每条事件都会重发全部消息，
    // 这里会立刻抓到「携带的消息与既有状态逐字段相同」。
    const projection = new Map<number, string>();
    const redundant: string[] = [];
    let totalUpserts = 0;
    for (const event of events) {
      for (const message of event.messageUpserts) {
        totalUpserts += 1;
        const serialized = canonicalJson(message);
        if (projection.get(message.id) === serialized) {
          redundant.push(`${event.type}#${String(message.id)}`);
        }
        projection.set(message.id, serialized);
      }
    }
    expect(redundant).toEqual([]);
    // 每条事件顶多改动「用户消息 + 一条新产生的消息」，与会话已有消息总数无关。
    expect(Math.max(...events.map((event) => event.messageUpserts.length))).toBeLessThanOrEqual(2);
    expect(totalUpserts).toBeLessThanOrEqual(events.length * 2);
  }, 60_000);

  it("追加一行的读取量与文件大小无关", async () => {
    const root = await fixtureRoot("moebius-fact-append-");
    const logPath = path.join(root, "sessions", "big.jsonl");
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.writeFile(logPath, `${paddedLine(1, 4 * 1024 * 1024)}\n`, "utf8");

    const measured = await measureBytesRead(async () => {
      await appendSessionFactLogLine(logPath, paddedLine(2, 64));
    });
    expect(measured).toBeLessThan(1024);
    expect((await fs.readFile(logPath, "utf8")).trimEnd().split("\n")).toHaveLength(2);
  });

  it("修复上次写了一半的尾行而不整文件重读", async () => {
    const root = await fixtureRoot("moebius-fact-torn-");
    const logPath = path.join(root, "sessions", "torn.jsonl");
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.writeFile(logPath, `${paddedLine(1, 1024 * 1024)}\n{"version":1,"half`, "utf8");

    const measured = await measureBytesRead(async () => {
      await appendSessionFactLogLine(logPath, paddedLine(2, 64));
    });
    expect(measured).toBeLessThan(70 * 1024);
    const text = await fs.readFile(logPath, "utf8");
    expect(text).not.toContain("half");
    expect(text.trimEnd().split("\n").map((line) => JSON.parse(line))).toHaveLength(2);
  });
});

describe("会话事实日志的读取缓存", () => {
  it("文件变长时只解析新增字节", async () => {
    const root = await fixtureRoot("moebius-fact-cache-");
    const logPath = path.join(root, "sessions", "cache.jsonl");
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.writeFile(
      logPath,
      `${Array.from({ length: 200 }, (_, index) => paddedLine(index + 1, 4096)).join("\n")}\n`,
      "utf8",
    );

    const first = await measureBytesRead(async () => {
      expect((await readSessionFactLog(logPath, "local:cache"))?.values).toHaveLength(200);
    });
    expect(first).toBeGreaterThan(200 * 4096);

    const cached = await measureBytesRead(async () => {
      expect((await readSessionFactLog(logPath, "local:cache"))?.values).toHaveLength(200);
    });
    expect(cached).toBe(0);

    await appendSessionFactLogLine(logPath, paddedLine(201, 64));
    const incremental = await measureBytesRead(async () => {
      expect((await readSessionFactLog(logPath, "local:cache"))?.values).toHaveLength(201);
    });
    expect(incremental).toBeLessThan(4096);
  });

  it("文件被整体改写后丢弃缓存重新解析", async () => {
    const root = await fixtureRoot("moebius-fact-rewrite-");
    const logPath = path.join(root, "sessions", "rewrite.jsonl");
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.writeFile(logPath, `${paddedLine(1, 512)}\n${paddedLine(2, 512)}\n`, "utf8");
    expect((await readSessionFactLog(logPath, "local:rewrite"))?.values).toHaveLength(2);

    await fs.writeFile(logPath, `${paddedLine(9, 512)}\n${paddedLine(2, 512)}\n${paddedLine(3, 512)}\n`, "utf8");
    const snapshot = await readSessionFactLog(logPath, "local:rewrite");
    expect(snapshot?.values).toHaveLength(3);
    expect((snapshot?.values[0] as { id: number }).id).toBe(9);
  });

  it("尾部半行不参与解析，也不影响后续增量", async () => {
    const root = await fixtureRoot("moebius-fact-partial-");
    const logPath = path.join(root, "sessions", "partial.jsonl");
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.writeFile(logPath, `${paddedLine(1, 512)}\n{"id":2,"pad`, "utf8");
    const first = await readSessionFactLog(logPath, "local:partial");
    expect(first?.values).toHaveLength(1);
    expect(first?.parsedLength).toBeLessThan(first?.size ?? 0);

    await appendSessionFactLogLine(logPath, paddedLine(3, 64));
    const second = await readSessionFactLog(logPath, "local:partial");
    expect(second?.values).toHaveLength(2);
    expect((second?.values[1] as { id: number }).id).toBe(3);
  });
});

describe("键序无关比较", () => {
  it("键序不同但语义相同的结构视为相等", () => {
    expect(canonicalJson({ a: 1, b: [1, { x: 1, y: 2 }] }))
      .toBe(canonicalJson({ b: [1, { y: 2, x: 1 }], a: 1 }));
    expect(canonicalJson({ a: 1, b: 2 })).not.toBe(canonicalJson({ a: 1, b: 3 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson({ a: undefined, b: 1 })).toBe(canonicalJson({ b: 1 }));
  });
});

describe("存量日志压缩", () => {
  it("把重复携带全量消息的旧日志缩回增量，回放结果不变", () => {
    const messages = [1, 2, 3].map((id) => ({ id, sessionId: "local:legacy", body: `消息 ${String(id)}` }));
    const bloated = [
      { type: "append_user", messageUpserts: [messages[0]] },
      { type: "claim_next", messageUpserts: messages.slice(0, 2) },
      { type: "record_agent_response", messageUpserts: messages },
      { type: "mark_stale_running", messageUpserts: messages },
      { type: "run_activity", messageUpserts: [] },
    ].map((event) => JSON.stringify({ version: 1, sessionId: "local:legacy", ...event })).join("\n");

    const { content, stats } = compactSessionFactLog(`${bloated}\n`);
    expect(stats.upsertsBefore).toBe(9);
    expect(stats.upsertsAfter).toBe(3);
    expect(stats.bytesAfter).toBeLessThan(stats.bytesBefore);
    expect(replayMessages(content)).toEqual(replayMessages(`${bloated}\n`));
    expect(content.trimEnd().split("\n")).toHaveLength(5);
  });

  it("丢弃尾部半行并保留非消息事件的载荷", () => {
    const complete = JSON.stringify({
      version: 1,
      sessionId: "local:tail",
      type: "run_activity",
      payload: { runId: "run-1" },
      messageUpserts: [],
    });
    const { content, stats } = compactSessionFactLog(`${complete}\n{"version":1,"half`);
    expect(stats.droppedTailBytes).toBe(18);
    expect(content).toBe(`${complete}\n`);
  });
});

interface LoggedEvent {
  type: string;
  messageUpserts: Array<{ id: number }>;
}

async function readEvents(logPath: string): Promise<LoggedEvent[]> {
  const text = await fs.readFile(logPath, "utf8");
  return text.trimEnd().split("\n").map((line) => JSON.parse(line) as LoggedEvent);
}

/** 统计一段操作里通过 fs/promises 句柄读取的字节数。 */
async function measureBytesRead(operation: () => Promise<void>): Promise<number> {
  const originalOpen = fs.open;
  let bytesRead = 0;
  (fs as { open: typeof fs.open }).open = (async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args);
    const read = handle.read.bind(handle);
    (handle as { read: typeof handle.read }).read = (async (...readArgs: unknown[]) => {
      const result = await (read as (...inner: unknown[]) => Promise<{ bytesRead: number }>)(...readArgs);
      bytesRead += result.bytesRead;
      return result;
    }) as typeof handle.read;
    return handle;
  }) as typeof fs.open;
  try {
    await operation();
  } finally {
    (fs as { open: typeof fs.open }).open = originalOpen;
  }
  return bytesRead;
}

function paddedLine(id: number, bytes: number): string {
  const skeleton = JSON.stringify({ version: 1, sessionId: "local:pad", id, pad: "" });
  return JSON.stringify({
    version: 1,
    sessionId: "local:pad",
    id,
    pad: "x".repeat(Math.max(0, bytes - skeleton.length)),
  });
}

function stamp(seconds: number): string {
  return new Date(Date.UTC(2026, 6, 31, 0, 0, seconds)).toISOString();
}

async function fixtureRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}
