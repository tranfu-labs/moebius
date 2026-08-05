import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  restorePublicInput,
} from "../src/local-console/codex-thread-link.js";
import { readCodexThreadLinks } from "../src/local-console/codex-thread-link-reader.js";
import {
  CodexRolloutCursorInvalidError,
  readCodexRolloutAppend,
  readCodexRolloutInvocation,
  readCodexRolloutPage,
  resolveCodexRollout,
  resolveCodexSessionsRoot,
} from "../src/local-console/codex-rollout.js";
import {
  malformedCodexRolloutEvent,
  projectCodexRolloutRecord,
} from "../src/local-console/process-event-projector.js";
import { loadLocalProcessAppendPage } from "../src/local-console/process-append-page-runtime.js";
import { loadLocalProcessHistoryPage } from "../src/local-console/process-history-page-runtime.js";
import { localProcessFactReader } from "../src/local-console/process-fact-reader.js";
import { localProcessTraceReader } from "../src/local-console/process-trace-reader.js";
import type { LocalConsoleMessage } from "../src/local-console/types.js";
import { LOCAL_CONSOLE_DEFAULT_SESSION_ID } from "../src/local-console/types.js";
import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";

describe("Codex rollout resolution", () => {
  it("locates exactly one rollout beneath the configured sessions root", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-rollout-"));
    const sessionsRoot = path.join(tempDir, "sessions");
    const threadId = "019f8cd7-cbc4-7a72-b0f7-71fecb7bd2e3";
    const filePath = path.join(sessionsRoot, "2026", "07", "23", `rollout-example-${threadId}.jsonl`);
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, '{"type":"session_meta"}\n', "utf8");

      const result = await resolveCodexRollout(threadId, { sessionsRoot });

      expect(result).toMatchObject({
        status: "available",
        filePath: await fs.realpath(filePath),
        sessionsRoot: await fs.realpath(sessionsRoot),
      });
      if (result.status === "available") {
        expect(result.identity.size).toBeGreaterThan(0);
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails closed for invalid, missing, duplicate, and symlink-only candidates", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-rollout-"));
    const sessionsRoot = path.join(tempDir, "sessions");
    const outside = path.join(tempDir, "outside.jsonl");
    const threadId = "019f8cd7-cbc4-7a72-b0f7-71fecb7bd2e3";
    try {
      await fs.mkdir(sessionsRoot, { recursive: true });
      expect(await resolveCodexRollout("../escape", { sessionsRoot })).toEqual({
        status: "unavailable",
        reason: "invalid-thread-id",
      });
      expect(await resolveCodexRollout(threadId, { sessionsRoot })).toEqual({
        status: "unavailable",
        reason: "not-found",
      });

      await fs.writeFile(outside, "{}\n", "utf8");
      await fs.symlink(outside, path.join(sessionsRoot, `rollout-link-${threadId}.jsonl`));
      expect(await resolveCodexRollout(threadId, { sessionsRoot })).toEqual({
        status: "unavailable",
        reason: "not-found",
      });
      await fs.unlink(path.join(sessionsRoot, `rollout-link-${threadId}.jsonl`));

      await fs.mkdir(path.join(sessionsRoot, "a"));
      await fs.mkdir(path.join(sessionsRoot, "b"));
      await fs.writeFile(path.join(sessionsRoot, "a", `rollout-a-${threadId}.jsonl`), "{}\n");
      await fs.writeFile(path.join(sessionsRoot, "b", `rollout-b-${threadId}.jsonl`), "{}\n");
      expect(await resolveCodexRollout(threadId, { sessionsRoot })).toEqual({
        status: "unavailable",
        reason: "duplicate",
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("derives sessions from CODEX_HOME without exposing that path to renderer DTOs", () => {
    expect(resolveCodexSessionsRoot({ codexHome: "/tmp/codex-home" })).toBe(
      path.resolve("/tmp/codex-home/sessions"),
    );
  });
});

describe("Codex rollout paging", () => {
  it("reads backward from the latest complete line and reaches the first visible event", async () => {
    const fixture = await createRolloutFixture([
      hiddenRecord(),
      assistantRecord("第一段", "2026-07-23T01:00:01.000Z"),
      toolRecord("read file", "2026-07-23T01:00:02.000Z"),
      assistantRecord("最后一段", "2026-07-23T01:00:03.000Z"),
    ], '{"type":"partial"');
    try {
      const resolution = await resolveCodexRollout(fixture.threadId, {
        sessionsRoot: fixture.sessionsRoot,
      });
      expect(resolution.status).toBe("available");
      if (resolution.status !== "available") {
        return;
      }

      const latest = await readCodexRolloutPage({
        resolution,
        runId: "run-a",
        maxBytes: 160,
        maxEvents: 1,
      });
      expect(latest.events).toEqual([
        expect.objectContaining({ kind: "agent-output", output: "最后一段" }),
      ]);
      expect(latest.completeEndOffset).toBeLessThan(resolution.identity.size);
      expect(latest.previousOffset).not.toBeNull();

      const collected = [...latest.events];
      let previousOffset = latest.previousOffset;
      while (previousOffset !== null) {
        const page = await readCodexRolloutPage({
          resolution,
          runId: "run-a",
          endOffset: previousOffset,
          expectedIdentity: latest.identity,
          minimumSize: latest.identity.size,
          maxBytes: 160,
          maxEvents: 1,
        });
        collected.unshift(...page.events);
        previousOffset = page.previousOffset;
      }
      expect(collected).toEqual([
        expect.objectContaining({ kind: "agent-output", output: "第一段" }),
        expect.objectContaining({ kind: "tool" }),
        expect.objectContaining({ kind: "agent-output", output: "最后一段" }),
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("allows a single oversized event to exceed the byte budget without truncating it", async () => {
    const markdown = "完整输出".repeat(1_000);
    const fixture = await createRolloutFixture([
      assistantRecord(markdown, "2026-07-23T01:00:01.000Z"),
    ]);
    try {
      const resolution = await resolveCodexRollout(fixture.threadId, {
        sessionsRoot: fixture.sessionsRoot,
      });
      if (resolution.status !== "available") {
        throw new Error("fixture rollout unavailable");
      }
      const page = await readCodexRolloutPage({
        resolution,
        runId: "run-a",
        maxBytes: 64,
        maxEvents: 10,
      });
      expect(page.rawBytes).toBeGreaterThan(64);
      expect(page.events).toEqual([
        expect.objectContaining({ kind: "agent-output", output: markdown }),
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("reads the exact prompt layers and actual rollout metadata without truncating a large prompt", async () => {
    const systemPrompt = `SYSTEM-${"x".repeat(300_000)}-END`;
    const fixture = await createRolloutFixture([
      {
        timestamp: "2026-07-23T01:00:00.000Z",
        type: "session_meta",
        payload: {
          base_instructions: { text: systemPrompt },
          model_provider: "openai",
          cli_version: "1.2.3",
        },
      },
      {
        timestamp: "2026-07-23T01:00:00.100Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "DEVELOPER-EXACT" }],
        },
      },
      {
        timestamp: "2026-07-23T01:00:00.200Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "USER-UNIQUE-MARKER" }],
        },
      },
      {
        timestamp: "2026-07-23T01:00:00.300Z",
        type: "turn_context",
        payload: {
          model: "gpt-5-debug",
          reasoning_effort: "high",
          cwd: "/Users/person/project",
        },
      },
    ]);
    try {
      const resolution = await resolveCodexRollout(fixture.threadId, {
        sessionsRoot: fixture.sessionsRoot,
      });
      if (resolution.status !== "available") {
        throw new Error("fixture rollout unavailable");
      }
      const invocation = await readCodexRolloutInvocation({ resolution });
      expect(invocation).toMatchObject({
        status: "available",
        prompts: {
          system: { status: "recorded", contents: [systemPrompt] },
          developer: { status: "recorded", contents: ["DEVELOPER-EXACT"] },
          user: { status: "recorded", contents: ["USER-UNIQUE-MARKER"] },
        },
        metadata: {
          model: "gpt-5-debug",
          effort: "high",
          provider: "openai",
          cliVersion: "1.2.3",
          cwd: "/Users/person/project",
        },
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("reads only appended complete lines and invalidates a cursor after replacement or shrink", async () => {
    const fixture = await createRolloutFixture([
      assistantRecord("已有", "2026-07-23T01:00:01.000Z"),
    ]);
    try {
      const resolution = await resolveCodexRollout(fixture.threadId, {
        sessionsRoot: fixture.sessionsRoot,
      });
      if (resolution.status !== "available") {
        throw new Error("fixture rollout unavailable");
      }
      const initial = await readCodexRolloutPage({ resolution, runId: "run-a" });
      await fs.appendFile(
        fixture.filePath,
        `${JSON.stringify(assistantRecord("新增", "2026-07-23T01:00:02.000Z"))}\n{"partial":`,
      );
      const appended = await readCodexRolloutAppend({
        resolution,
        runId: "run-a",
        startOffset: initial.completeEndOffset,
        expectedIdentity: initial.identity,
        minimumSize: initial.identity.size,
      });
      expect(appended.events).toEqual([
        expect.objectContaining({ kind: "agent-output", output: "新增" }),
      ]);
      expect(appended.completeEndOffset).toBeLessThan(appended.identity.size);

      await fs.truncate(fixture.filePath, 0);
      await expect(readCodexRolloutAppend({
        resolution,
        runId: "run-a",
        startOffset: appended.nextOffset,
        expectedIdentity: appended.identity,
        minimumSize: appended.identity.size,
      })).rejects.toBeInstanceOf(CodexRolloutCursorInvalidError);
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects a rollout swapped to an outside symlink after resolution", async () => {
    const fixture = await createRolloutFixture([
      assistantRecord("已有", "2026-07-23T01:00:01.000Z"),
    ]);
    const outside = path.join(path.dirname(fixture.sessionsRoot), "outside.jsonl");
    try {
      const resolution = await resolveCodexRollout(fixture.threadId, {
        sessionsRoot: fixture.sessionsRoot,
      });
      if (resolution.status !== "available") {
        throw new Error("fixture rollout unavailable");
      }
      await fs.writeFile(outside, `${JSON.stringify(assistantRecord("外部", "2026-07-23T01:00:02.000Z"))}\n`);
      await fs.unlink(fixture.filePath);
      await fs.symlink(outside, fixture.filePath);

      await expect(readCodexRolloutPage({
        resolution,
        runId: "run-a",
      })).rejects.toBeInstanceOf(CodexRolloutCursorInvalidError);
    } finally {
      await fixture.cleanup();
      await fs.rm(outside, { force: true });
    }
  });
});

describe("Codex thread links and public input", () => {
  it("persists a run-thread link idempotently in the session fact log", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-link-store-"));
    const store = await createSqliteLocalConsoleStore({
      sqlitePath: path.join(tempDir, ".state", "local-console.sqlite"),
    });
    await store.init();
    const link = {
      sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
      runId: "run-a",
      sourceMessageId: 2,
      role: "dev",
      threadId: "thread-a",
      startedAt: "2026-07-23T01:00:00.000Z",
    };
    try {
      await store.recordCodexThreadLink(link);
      await store.recordCodexThreadLink(link);
      await Promise.all([
        store.recordCodexThreadLink({
          ...link,
          runId: "run-b",
          sourceMessageId: 3,
          role: "qa",
          threadId: "thread-b",
          startedAt: "2026-07-23T01:00:01.000Z",
        }),
        store.recordCodexThreadLink({
          ...link,
          runId: "run-c",
          sourceMessageId: 4,
          role: "dev-manager",
          threadId: "thread-c",
          startedAt: "2026-07-23T01:00:02.000Z",
        }),
      ]);
      expect(await readCodexThreadLinks(
        store.getSessionFactLogPath(LOCAL_CONSOLE_DEFAULT_SESSION_ID),
        LOCAL_CONSOLE_DEFAULT_SESSION_ID,
      )).toEqual([
        link,
        expect.objectContaining({ runId: "run-b", threadId: "thread-b" }),
        expect.objectContaining({ runId: "run-c", threadId: "thread-c" }),
      ]);
      await expect(store.recordCodexThreadLink({
        ...link,
        threadId: "thread-b",
      })).rejects.toThrow("conflicting Codex thread link");
      await expect(store.recordCodexThreadLink({
        ...link,
        startedAt: "2026-07-23T01:00:01.000Z",
      })).rejects.toThrow("conflicting Codex thread link");
    } finally {
      await store.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("reads idempotent links, rejects conflicts, and ignores a trailing partial fact", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-links-"));
    const logPath = path.join(tempDir, "session.jsonl");
    const fact = {
      version: 1,
      eventId: "event-a",
      sessionId: "session-a",
      type: "codex_thread_link",
      recordedAt: "2026-07-23T01:00:00.000Z",
      payload: {
        sessionId: "session-a",
        runId: "run-a",
        sourceMessageId: 2,
        role: "dev",
        threadId: "thread-a",
        startedAt: "2026-07-23T01:00:00.000Z",
      },
      messageUpserts: [],
    };
    try {
      await fs.writeFile(logPath, `${JSON.stringify(fact)}\n${JSON.stringify(fact)}\n{"partial":`, "utf8");
      expect(await readCodexThreadLinks(logPath, "session-a")).toEqual([fact.payload]);

      const conflict = {
        ...fact,
        eventId: "event-b",
        payload: { ...fact.payload, threadId: "thread-b" },
      };
      await fs.writeFile(logPath, `${JSON.stringify(fact)}\n${JSON.stringify(conflict)}\n`, "utf8");
      await expect(readCodexThreadLinks(logPath, "session-a")).rejects.toThrow(
        "conflicting Codex thread links",
      );

      const metadataConflict = {
        ...fact,
        eventId: "event-c",
        payload: { ...fact.payload, role: "qa" },
      };
      await fs.writeFile(logPath, `${JSON.stringify(fact)}\n${JSON.stringify(metadataConflict)}\n`, "utf8");
      await expect(readCodexThreadLinks(logPath, "session-a")).rejects.toThrow(
        "conflicting Codex thread links",
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("restores public user and Agent turns through the source message in timeline order", () => {
    const messages = [
      message({ id: 1, speaker: "user", body: "先检查页面" }),
      message({ id: 2, speaker: "agent", role: "dev-manager", body: "交给 @dev" }),
      message({
        id: 99,
        speaker: "agent",
        role: "dev",
        body: "内部 worker 占位",
        sourceKind: "local-worker-run",
      }),
      message({ id: 3, speaker: "user", body: "后来的消息" }),
    ];

    expect(restorePublicInput(messages, 2, "run-a")).toEqual([
      expect.objectContaining({ messageId: 1, speaker: "user", markdown: "先检查页面" }),
      expect.objectContaining({ messageId: 2, speaker: "agent", role: "dev-manager", markdown: "交给 @dev" }),
    ]);
    expect(() => restorePublicInput(messages, 404, "run-a")).toThrow("source message not found");
  });
});

describe("local process history aggregation", () => {
  it("paginates backward across attempts while preserving each attempt input", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-history-"));
    const sessionsRoot = path.join(tempDir, "codex-sessions");
    const sessionFactLogPath = path.join(tempDir, "session.jsonl");
    const threadIds = [
      "019f8cd7-cbc4-7a72-b0f7-71fecb7bd2e3",
      "019f8cd7-cbc4-7a72-b0f7-71fecb7bd2e4",
    ];
    try {
      await writeRollout(sessionsRoot, threadIds[0]!, [
        assistantRecord("第一次开始", "2026-07-23T01:00:01.000Z"),
        toolRecord("pnpm test", "2026-07-23T01:00:02.000Z"),
      ]);
      await writeRollout(sessionsRoot, threadIds[1]!, [
        assistantRecord("第二次开始", "2026-07-23T01:01:01.000Z"),
        assistantRecord("第二次完成", "2026-07-23T01:01:02.000Z"),
      ]);
      await writeThreadLinkFacts(sessionFactLogPath, [
        {
          sessionId: "session-a",
          runId: "run-1",
          sourceMessageId: 2,
          role: "dev",
          threadId: threadIds[0]!,
          startedAt: "2026-07-23T01:00:00.000Z",
        },
        {
          sessionId: "session-a",
          runId: "run-2",
          sourceMessageId: 2,
          role: "dev",
          threadId: threadIds[1]!,
          startedAt: "2026-07-23T01:01:00.000Z",
        },
      ]);
      const messages = [
        message({ id: 1, speaker: "user", body: "检查测试" }),
        message({ id: 2, speaker: "agent", role: "dev-manager", body: "交给 @dev" }),
        message({ id: 3, speaker: "user", body: "运行后才出现", createdAt: "2026-07-23T01:02:00.000Z" }),
      ];

      let page = await loadLocalProcessHistoryPage({
        sessionId: "session-a",
        requestedRunId: "run-2",
        sessionFactLogPath,
        factReader: localProcessFactReader,
        traceReader: localProcessTraceReader,
        messages,
        activeRunIds: new Set(),
        rollout: { sessionsRoot },
        maxBytes: 256,
        maxEvents: 2,
      });
      expect(page.status).toBe("settled");
      expect(page.attempts).toHaveLength(2);
      expect(page.atLatest).toBe(true);
      expect(page.events).toEqual([
        expect.objectContaining({ kind: "agent-output", output: "第二次开始" }),
        expect.objectContaining({ kind: "agent-output", output: "第二次完成" }),
      ]);

      const allEvents = [...page.events];
      while (page.previousCursor !== null) {
        page = await loadLocalProcessHistoryPage({
          sessionId: "session-a",
          requestedRunId: "run-2",
          sessionFactLogPath,
          factReader: localProcessFactReader,
          traceReader: localProcessTraceReader,
          messages,
          activeRunIds: new Set(),
          cursor: page.previousCursor,
          rollout: { sessionsRoot },
          maxBytes: 256,
          maxEvents: 2,
        });
        allEvents.unshift(...page.events);
      }

      expect(allEvents.filter((event) => event.kind === "attempt-header")).toEqual([
        expect.objectContaining({ attempt: 1, runId: "run-1" }),
        expect.objectContaining({ attempt: 2, runId: "run-2" }),
      ]);
      expect(JSON.stringify(allEvents)).not.toContain("检查测试");
      expect(JSON.stringify(allEvents)).not.toContain("交给 @dev");
      expect(JSON.stringify(allEvents)).not.toContain("运行后才出现");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns unavailable without reading runDir when the stable thread link is absent", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-history-"));
    const sessionFactLogPath = path.join(tempDir, "session.jsonl");
    try {
      await fs.writeFile(sessionFactLogPath, "", "utf8");
      const page = await loadLocalProcessHistoryPage({
        sessionId: "session-a",
        requestedRunId: "legacy-run",
        sessionFactLogPath,
        factReader: localProcessFactReader,
        traceReader: localProcessTraceReader,
        messages: [message({ id: 1, speaker: "user", body: "legacy" })],
        activeRunIds: new Set(),
      });
      expect(page).toMatchObject({
        status: "unavailable",
        unavailableReason: "link-missing",
        events: [],
      });
      expect(JSON.stringify(page)).not.toContain("runDir");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uses an append cursor to return only newly completed rollout lines", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-history-"));
    const sessionsRoot = path.join(tempDir, "codex-sessions");
    const sessionFactLogPath = path.join(tempDir, "session.jsonl");
    const threadId = "019f8cd7-cbc4-7a72-b0f7-71fecb7bd2e3";
    try {
      const filePath = await writeRollout(sessionsRoot, threadId, [
        assistantRecord("开始", "2026-07-23T01:00:01.000Z"),
      ]);
      await writeThreadLinkFacts(sessionFactLogPath, [{
        sessionId: "session-a",
        runId: "run-1",
        sourceMessageId: 1,
        role: "dev",
        threadId,
        startedAt: "2026-07-23T01:00:00.000Z",
      }]);
      const initial = await loadLocalProcessHistoryPage({
        sessionId: "session-a",
        requestedRunId: "run-1",
        sessionFactLogPath,
        factReader: localProcessFactReader,
        traceReader: localProcessTraceReader,
        messages: [message({ id: 1, speaker: "user", body: "开始" })],
        activeRunIds: new Set(["run-1"]),
        rollout: { sessionsRoot },
      });
      expect(initial.appendCursor).not.toBeNull();

      await fs.appendFile(
        filePath,
        `${JSON.stringify(assistantRecord("新增", "2026-07-23T01:00:02.000Z"))}\n`,
      );
      const appended = await loadLocalProcessAppendPage({
        sessionId: "session-a",
        requestedRunId: "run-1",
        sessionFactLogPath,
        factReader: localProcessFactReader,
        traceReader: localProcessTraceReader,
        activeRunIds: new Set(["run-1"]),
        appendCursor: initial.appendCursor!,
        rollout: { sessionsRoot },
      });
      expect(appended.events).toEqual([
        expect.objectContaining({ kind: "agent-output", output: "新增" }),
      ]);
      expect(appended.atLatest).toBe(true);
      expect(appended.status).toBe("running");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("Codex rollout projection", () => {
  it("projects assistant Markdown and user-meaningful tool events", () => {
    expect(projectCodexRolloutRecord({
      timestamp: "2026-07-23T01:00:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "我先检查实现。" }],
      },
    }, { runId: "run-a", lineOffset: 12 })).toEqual([
      expect.objectContaining({ kind: "agent-output", output: "我先检查实现。" }),
    ]);

    expect(projectCodexRolloutRecord({
      timestamp: "2026-07-23T01:00:01.000Z",
      type: "response_item",
      payload: {
        type: "command_execution",
        command: "acceptance-overlong-tool",
        status: "completed",
        output: "completed output",
        exit_code: 0,
      },
    }, { runId: "run-a", lineOffset: 60 })).toEqual([
      expect.objectContaining({
        kind: "command",
        phase: "completed",
        status: "completed",
        input: "acceptance-overlong-tool",
      }),
    ]);

    expect(projectCodexRolloutRecord({
      timestamp: "2026-07-23T01:00:01.250Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        name: "exec",
        input: "pnpm test",
        status: "completed",
      },
    }, { runId: "run-a", lineOffset: 80 })).toEqual([
      expect.objectContaining({ kind: "tool", name: "exec", input: "pnpm test" }),
    ]);

    const debugTool = projectCodexRolloutRecord({
      timestamp: "2026-07-23T01:00:01.500Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "inspect",
        arguments: JSON.stringify({
          query: "检查实现",
          path: "/Users/person/private/source.ts",
          sessionId: "internal-session",
          runId: "internal-run",
        }),
      },
    }, { runId: "run-a", lineOffset: 81 });
    expect(debugTool).toEqual([
      expect.objectContaining({
        kind: "tool",
        callId: null,
        input: expect.stringContaining("/Users/person/private/source.ts"),
      }),
    ]);
    expect(JSON.stringify(debugTool)).toContain("internal-session");
    expect(JSON.stringify(debugTool)).toContain("internal-run");

    expect(projectCodexRolloutRecord({
      timestamp: "2026-07-23T01:00:02.000Z",
      type: "event_msg",
      payload: {
        type: "patch_apply_end",
        stdout: "Success. Updated file.ts",
      },
    }, { runId: "run-a", lineOffset: 120 })).toEqual([
      expect.objectContaining({ kind: "file", action: "应用文件修改" }),
    ]);
  });

  it("separates prompts, filters reasoning, exposes token usage, and preserves unknown payload", () => {
    const hidden = [
      { type: "session_meta", payload: { base_instructions: { text: "secret" } } },
      { type: "response_item", payload: { type: "reasoning", encrypted_content: "secret" } },
      { type: "event_msg", payload: { type: "agent_reasoning", text: "secret" } },
      { type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "secret" }] } },
    ];
    for (const record of hidden) {
      expect(projectCodexRolloutRecord(record, { runId: "run-a", lineOffset: 0 })).toEqual([]);
    }

    const usage = projectCodexRolloutRecord({
      timestamp: "2026-07-23T01:00:02.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { input_tokens: 40, cached_input_tokens: 12, output_tokens: 7, total_tokens: 47 },
      },
    }, { runId: "run-a", lineOffset: 1 });
    expect(usage).toEqual([
      expect.objectContaining({
        kind: "usage",
        protocolType: "event_msg · token_count",
        usage: expect.stringContaining('"cached_input_tokens": 12'),
      }),
    ]);

    const projected = projectCodexRolloutRecord({
      type: "event_msg",
      payload: { type: "future_event", secret: "must-not-leak" },
    }, { runId: "run-a", lineOffset: 1 });
    expect(projected).toEqual([
      expect.objectContaining({
        kind: "unsupported-debug",
        protocolType: "event_msg · future_event",
        rawPayload: expect.stringContaining("must-not-leak"),
      }),
    ]);
    expect(malformedCodexRolloutEvent("run-a", 42)).toMatchObject({
      kind: "error",
      message: "过程记录读取异常",
    });
  });

  it("projects current Codex Agent, file, search, and abort event shapes without redaction", () => {
    expect(projectCodexRolloutRecord({
      timestamp: "2026-07-23T01:00:00.000Z",
      type: "response_item",
      payload: {
        type: "agent_message",
        author: "worker",
        recipient: "parent",
        content: [{ type: "output_text", text: "子 Agent 已完成检查。" }],
      },
    }, { runId: "run-a", lineOffset: 1 })).toEqual([
      expect.objectContaining({ kind: "agent-output", output: "子 Agent 已完成检查。" }),
    ]);

    const files = projectCodexRolloutRecord({
      timestamp: "2026-07-23T01:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "patch_apply_end",
        success: true,
        changes: {
          "/Users/person/private/project/src/app.ts": { type: "update" },
          "docs/readme.md": { type: "add" },
        },
      },
    }, { runId: "run-a", lineOffset: 2 });
    expect(files).toEqual([
      expect.objectContaining({ kind: "file", action: "update", path: "/Users/person/private/project/src/app.ts" }),
      expect.objectContaining({ kind: "file", action: "新增文件", path: "docs/readme.md" }),
    ]);
    expect(JSON.stringify(files)).toContain("/Users/person");

    expect(projectCodexRolloutRecord({
      type: "event_msg",
      payload: {
        type: "web_search_end",
        query: "Codex docs",
        results: [{ title: "Docs", url: "https://example.com/docs", internal_id: "hidden" }],
      },
    }, { runId: "run-a", lineOffset: 3 })).toEqual([
      expect.objectContaining({
        kind: "tool",
        name: "web_search",
        input: "Codex docs",
        output: expect.stringContaining('"internal_id": "hidden"'),
      }),
    ]);

    expect(projectCodexRolloutRecord({
      type: "event_msg",
      payload: { type: "turn_aborted", reason: "user interrupted", turn_id: "hidden" },
    }, { runId: "run-a", lineOffset: 4 })).toEqual([
      expect.objectContaining({ kind: "error", message: "turn_aborted", detail: "user interrupted" }),
    ]);
  });

  it("deduplicates paired Agent messages even when their timestamps differ", async () => {
    const fixture = await createRolloutFixture([
      assistantRecord("同一条回复", "2026-07-23T01:00:01.000Z"),
      {
        timestamp: "2026-07-23T01:00:01.100Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "同一条回复" },
      },
    ]);
    try {
      const resolution = await resolveCodexRollout(fixture.threadId, {
        sessionsRoot: fixture.sessionsRoot,
      });
      if (resolution.status !== "available") {
        throw new Error("fixture rollout unavailable");
      }
      const page = await readCodexRolloutPage({ resolution, runId: "run-a" });
      expect(page.events).toEqual([
        expect.objectContaining({ kind: "agent-output", output: "同一条回复" }),
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps an intentional repeated Agent message from a later moment", async () => {
    const fixture = await createRolloutFixture([
      assistantRecord("再次检查", "2026-07-23T01:00:01.000Z"),
      assistantRecord("再次检查", "2026-07-23T01:00:03.000Z"),
    ]);
    try {
      const resolution = await resolveCodexRollout(fixture.threadId, {
        sessionsRoot: fixture.sessionsRoot,
      });
      if (resolution.status !== "available") {
        throw new Error("fixture rollout unavailable");
      }
      const page = await readCodexRolloutPage({ resolution, runId: "run-a" });
      expect(page.events.filter((event) => event.kind === "agent-output")).toHaveLength(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps repeated same-origin Agent messages even within the same second", async () => {
    const fixture = await createRolloutFixture([
      assistantRecord("仍在检查", "2026-07-23T01:00:01.000Z"),
      assistantRecord("仍在检查", "2026-07-23T01:00:01.200Z"),
    ]);
    try {
      const resolution = await resolveCodexRollout(fixture.threadId, {
        sessionsRoot: fixture.sessionsRoot,
      });
      if (resolution.status !== "available") {
        throw new Error("fixture rollout unavailable");
      }
      const page = await readCodexRolloutPage({ resolution, runId: "run-a" });
      expect(page.events.filter((event) => event.kind === "agent-output")).toHaveLength(2);
    } finally {
      await fixture.cleanup();
    }
  });
});

function message(
  overrides: Partial<LocalConsoleMessage> & Pick<LocalConsoleMessage, "id" | "speaker" | "body">,
): LocalConsoleMessage {
  return {
    id: overrides.id,
    sessionId: "session-a",
    speaker: overrides.speaker,
    role: overrides.role ?? null,
    body: overrides.body,
    status: overrides.status ?? "completed",
    runId: overrides.runId ?? null,
    runDir: overrides.runDir ?? null,
    error: overrides.error ?? null,
    systemEventKind: overrides.systemEventKind ?? "other",
    failureCount: overrides.failureCount ?? 0,
    lastFailureReason: overrides.lastFailureReason ?? null,
    sourceKind: overrides.sourceKind ?? null,
    sourceId: overrides.sourceId ?? null,
    attachments: overrides.attachments ?? [],
    createdAt: overrides.createdAt ?? `2026-07-23T01:00:0${String(overrides.id)}.000Z`,
    updatedAt: overrides.updatedAt ?? `2026-07-23T01:00:0${String(overrides.id)}.000Z`,
  };
}

function hiddenRecord(): unknown {
  return {
    timestamp: "2026-07-23T01:00:00.000Z",
    type: "session_meta",
    payload: { base_instructions: { text: "hidden" } },
  };
}

function assistantRecord(markdown: string, timestamp: string): unknown {
  return {
    timestamp,
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: markdown }],
    },
  };
}

function toolRecord(input: string, timestamp: string): unknown {
  return {
    timestamp,
    type: "response_item",
    payload: {
      type: "custom_tool_call",
      name: "exec",
      input,
      status: "completed",
    },
  };
}

async function createRolloutFixture(
  records: unknown[],
  partial = "",
): Promise<{
  threadId: string;
  sessionsRoot: string;
  filePath: string;
  cleanup(): Promise<void>;
}> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-rollout-page-"));
  const sessionsRoot = path.join(tempDir, "sessions");
  const threadId = "019f8cd7-cbc4-7a72-b0f7-71fecb7bd2e3";
  const filePath = path.join(sessionsRoot, "2026", "07", "23", `rollout-fixture-${threadId}.jsonl`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const complete = records.map((record) => JSON.stringify(record)).join("\n");
  await fs.writeFile(filePath, `${complete}${complete === "" ? "" : "\n"}${partial}`, "utf8");
  return {
    threadId,
    sessionsRoot,
    filePath,
    cleanup: () => fs.rm(tempDir, { recursive: true, force: true }),
  };
}

async function writeRollout(
  sessionsRoot: string,
  threadId: string,
  records: unknown[],
): Promise<string> {
  const filePath = path.join(sessionsRoot, "2026", "07", "23", `rollout-fixture-${threadId}.jsonl`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  return filePath;
}

async function writeThreadLinkFacts(
  logPath: string,
  links: Array<{
    sessionId: string;
    runId: string;
    sourceMessageId: number;
    role: string;
    threadId: string;
    startedAt: string;
  }>,
): Promise<void> {
  await fs.writeFile(
    logPath,
    links.map((link, index) => JSON.stringify({
      version: 1,
      eventId: `event-${String(index)}`,
      sessionId: link.sessionId,
      type: "codex_thread_link",
      recordedAt: link.startedAt,
      payload: link,
      messageUpserts: [],
    })).join("\n") + "\n",
    "utf8",
  );
}
