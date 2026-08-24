import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendLocalClaudeTerminalTrace,
  createLocalClaudeTerminalTrace,
  pageLocalClaudeTerminalTrace,
} from "../src/local-console/claude-terminal-trace.js";
import { LocalClaudeTerminalTraceStore } from "../src/local-console/claude-terminal-trace-store.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Claude terminal trace", () => {
  it("retains ordered bytes and marks overflow instead of hiding it", () => {
    const trace = createLocalClaudeTerminalTrace(5);
    const first = appendLocalClaudeTerminalTrace(trace, "ab");
    const second = appendLocalClaudeTerminalTrace(trace, Uint8Array.from([0, 255, 3]));
    const overflow = appendLocalClaudeTerminalTrace(trace, "z");

    expect(first.kind).toBe("accepted");
    expect(second.kind).toBe("accepted");
    expect(overflow).toEqual({ kind: "incomplete" });
    expect(trace.bytesObserved).toBe(6);
    expect(trace.bytesRetained).toBe(5);
    expect(trace.incomplete).toBe(true);
    expect(trace.nextCursor).toBe(2);

    const page = pageLocalClaudeTerminalTrace({
      sessionId: "session-a",
      runId: "run-a",
      trace,
      cursor: 0,
    });
    const bytes = Buffer.concat(page.chunks.map((chunk) => Buffer.from(chunk.dataBase64, "base64")));
    expect([...bytes]).toEqual([97, 98, 0, 255, 3]);
    expect(page.incomplete).toBe(true);
  });

  it("persists chunks and can read them from a fresh store instance", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-terminal-trace-test-"));
    temporaryRoots.push(root);
    const runDir = path.join(root, "attempt-1");
    const trace = createLocalClaudeTerminalTrace();
    const store = new LocalClaudeTerminalTraceStore();
    const first = appendLocalClaudeTerminalTrace(trace, "first");
    const second = appendLocalClaudeTerminalTrace(trace, "second");
    store.append({ runId: "run-a", runDir, trace, result: first });
    store.append({ runId: "run-a", runDir, trace, result: second });
    await store.flush("run-a");

    const reopened = await new LocalClaudeTerminalTraceStore().read({
      sessionId: "session-a",
      runId: "run-a",
      runDir,
      cursor: 1,
    });
    expect(reopened.chunks).toHaveLength(1);
    expect(Buffer.from(reopened.chunks[0]!.dataBase64, "base64").toString("utf8")).toBe("second");
    expect(reopened.nextCursor).toBe(2);
    expect(reopened.bytesObserved).toBe(11);
    expect(reopened.bytesRetained).toBe(11);
    expect(reopened.incomplete).toBe(false);
  });

  it("persists an incomplete marker even when the overflowing chunk is not retained", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-terminal-trace-overflow-"));
    temporaryRoots.push(root);
    const runDir = path.join(root, "attempt-2");
    const trace = createLocalClaudeTerminalTrace(3);
    const store = new LocalClaudeTerminalTraceStore();
    const retained = appendLocalClaudeTerminalTrace(trace, "abc");
    const overflow = appendLocalClaudeTerminalTrace(trace, "d");
    store.append({ runId: "run-b", runDir, trace, result: retained });
    store.append({ runId: "run-b", runDir, trace, result: overflow });
    await store.flush("run-b");

    const page = await new LocalClaudeTerminalTraceStore().read({
      sessionId: "session-b",
      runId: "run-b",
      runDir,
      cursor: 0,
    });
    expect(page.chunks).toHaveLength(1);
    expect(page.incomplete).toBe(true);
    expect(page.bytesObserved).toBe(4);
    expect(page.bytesRetained).toBe(3);
  });
});
