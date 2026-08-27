import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { waitForCondition, waitForValue } from "../src/testing/wait.js";
import type { CodexRunOptions, CodexRunResult } from "../src/codex.js";
import { LocalAttachmentManager } from "../src/local-console/attachments.js";
import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";
import {
  startLocalConsoleServer,
  type LocalConsoleServerOptions,
  type StartedLocalConsoleServer,
} from "../src/local-console/start.js";
import type { LocalConsoleSessionSummary } from "../src/local-console/types.js";

const TITLE_PROMPT_MARKER = "为这段对话生成标题";
const STANDARD_STORE_TIMEOUT_MS = 10_000;

/**
 * 新会话自动标题生成的端到端验证（fake 执行驱动按提示词分流：标题 one-shot 与主流程回复互不干扰）。
 * 真实 provider 效果由真机验收覆盖（步骤 4/5）。
 */
async function startTitleConsole(
  options: Omit<LocalConsoleServerOptions, "runCodex"> & {
    runCodex: (options: CodexRunOptions) => Promise<CodexRunResult>;
  },
): Promise<StartedLocalConsoleServer> {
  const projectRoot = options.projectRoot ?? process.cwd();
  return startLocalConsoleServer({
    ...options,
    enableSessionTitleGeneration: true,
    listAgentFiles: options.listAgentFiles ?? (async () => {
      const agentsDirectory = path.join(projectRoot, "agents");
      const entries = await fs.readdir(agentsDirectory, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => ({
          name: entry.name.slice(0, -3),
          path: path.join(agentsDirectory, entry.name),
        }));
    }),
  });
}

function codexOk(options: CodexRunOptions, finalText: string): CodexRunResult {
  return {
    ok: true,
    finalText,
    threadId: "thread-title-test",
    cachedInputTokens: null,
    runDir: options.runDir,
    stdoutPath: path.join(options.runDir, "stdout.jsonl"),
    stderrPath: path.join(options.runDir, "stderr.log"),
  };
}

async function makeFixtureRoot(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "moebius-session-title-"));
}

async function writeAgent(root: string, name: string, body: string): Promise<void> {
  const agentsDir = path.join(root, "agents");
  await fs.mkdir(agentsDir, { recursive: true });
  await fs.writeFile(path.join(agentsDir, `${name}.md`), body, "utf8");
}

async function createSession(url: string, title: string): Promise<LocalConsoleSessionSummary> {
  const response = await fetch(new URL("/api/local-console/sessions", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { session: LocalConsoleSessionSummary };
  return body.session;
}

async function postSessionMessage(url: string, sessionId: string, body: string): Promise<Response> {
  return await fetch(new URL(`/api/local-console/sessions/${encodeURIComponent(sessionId)}/messages`, url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

async function renameSession(url: string, sessionId: string, title: string, expectedTitleRevision: number): Promise<Response> {
  return await fetch(new URL(`/api/local-console/sessions/${encodeURIComponent(sessionId)}/title`, url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, expectedTitleRevision }),
  });
}

async function sessionTitle(url: string, sessionId: string): Promise<string | null> {
  const stateUrl = new URL("/api/local-console/state", url);
  stateUrl.searchParams.set("sessionId", sessionId);
  const response = await fetch(stateUrl);
  if (response.status !== 200) return null;
  const state = (await response.json()) as { selectedSession: LocalConsoleSessionSummary | null };
  return state.selectedSession?.title ?? null;
}

function countTitleCalls(runCodex: ReturnType<typeof vi.fn>): number {
  return runCodex.mock.calls.filter(([options]) =>
    (options as CodexRunOptions).prompt.includes(TITLE_PROMPT_MARKER)).length;
}

describe("session title generation through the HTTP assembly", () => {
  it("renames a new conversation from its first message", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev\n\nROLE:dev");
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> =>
      codexOk(options, options.prompt.includes(TITLE_PROMPT_MARKER) ? "改进推特推广" : "主流程回复"));
    const started = await startTitleConsole({
      projectRoot: root,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createSession(started.url, "新对话");
      expect((await postSessionMessage(started.url, session.sessionId, "@dev 推特效果平平，想改进推广")).status).toBe(202);

      await waitForValue(
        async () => (await sessionTitle(started.url, session.sessionId)) === "改进推特推广"
          ? "改进推特推广"
          : undefined,
        { describe: "first-message generated title", kind: "io", timeoutMs: 5_000 },
      );
      expect(countTitleCalls(runCodex)).toBe(1);
      const titleCall = runCodex.mock.calls.find(([options]) => options.prompt.includes(TITLE_PROMPT_MARKER));
      expect(titleCall?.[0].execOptions).toEqual(expect.arrayContaining([
        "--ignore-user-config",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
      ]));
    } finally {
      await started.close();
    }
  });

  it("does not regenerate for later messages in the same session", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev\n\nROLE:dev");
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> =>
      codexOk(options, options.prompt.includes(TITLE_PROMPT_MARKER) ? "标题一" : "主流程回复"));
    const started = await startTitleConsole({
      projectRoot: root,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createSession(started.url, "续聊");
      expect((await postSessionMessage(started.url, session.sessionId, "@dev 第一条")).status).toBe(202);
      await waitForValue(
        async () => (await sessionTitle(started.url, session.sessionId)) === "标题一" ? true : undefined,
        { describe: "first generated title", kind: "io", timeoutMs: 5_000 },
      );
      expect((await postSessionMessage(started.url, session.sessionId, "@dev 第二条")).status).toBe(202);
      await waitForCondition(
        () => runCodex.mock.calls.length >= 2,
        { describe: "second message reaches the provider", kind: "io", timeoutMs: 5_000 },
      );
      expect(countTitleCalls(runCodex)).toBe(1);
    } finally {
      await started.close();
    }
  });

  it("keeps a manual rename when the generated title arrives late", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev\n\nROLE:dev");
    let releaseTitle!: () => void;
    const titleGate = new Promise<void>((resolve) => { releaseTitle = resolve; });
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      if (options.prompt.includes(TITLE_PROMPT_MARKER)) {
        await titleGate;
        return codexOk(options, "迟到的自动标题");
      }
      return codexOk(options, "主流程回复");
    });
    const started = await startTitleConsole({
      projectRoot: root,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createSession(started.url, "手动优先");
      expect((await postSessionMessage(started.url, session.sessionId, "@dev 消息")).status).toBe(202);
      await waitForCondition(
        () => countTitleCalls(runCodex) === 1,
        { describe: "title generation enters the provider", kind: "logic", timeoutMs: 3_000 },
      );
      const manual = await renameSession(started.url, session.sessionId, "我的手动名称", 0);
      expect(manual.status).toBe(200);

      releaseTitle();
      await waitForCondition(
        () => runCodex.mock.calls.length >= 2,
        { describe: "title generation settles", kind: "logic", timeoutMs: 3_000 },
      );
      expect(await sessionTitle(started.url, session.sessionId)).toBe("我的手动名称");
    } finally {
      releaseTitle();
      await started.close();
    }
  });

  it("keeps the default title when the provider output is unusable", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev\n\nROLE:dev");
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> =>
      codexOk(options, options.prompt.includes(TITLE_PROMPT_MARKER) ? "。。。" : "主流程回复"));
    const started = await startTitleConsole({
      projectRoot: root,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createSession(started.url, "降级");
      expect((await postSessionMessage(started.url, session.sessionId, "@dev hi")).status).toBe(202);
      await waitForCondition(
        () => runCodex.mock.calls.length >= 2,
        { describe: "title and primary calls settle", kind: "io", timeoutMs: 5_000 },
      );
      expect(await sessionTitle(started.url, session.sessionId)).not.toBe("。。。");
    } finally {
      await started.close();
    }
  });

  it("does not call the provider for titles when the feature is disabled", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev\n\nROLE:dev");
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> =>
      codexOk(options, options.prompt.includes(TITLE_PROMPT_MARKER) ? "不应出现" : "主流程回复"));
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
      enableSessionTitleGeneration: false,
      listAgentFiles: async () => [{ name: "dev", path: path.join(root, "agents", "dev.md") }],
    });
    try {
      const session = await createSession(started.url, "关闭");
      expect((await postSessionMessage(started.url, session.sessionId, "@dev 消息")).status).toBe(202);
      await waitForCondition(
        () => runCodex.mock.calls.length >= 1,
        { describe: "primary reply settles", kind: "io", timeoutMs: 5_000 },
      );
      expect(countTitleCalls(runCodex)).toBe(0);
    } finally {
      await started.close();
    }
  });

  it("keeps the rename SQLite store path unchanged (no new schema surface)", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev\n\nROLE:dev");
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> =>
      codexOk(options, options.prompt.includes(TITLE_PROMPT_MARKER) ? "落库标题" : "主流程回复"));
    const started = await startTitleConsole({
      projectRoot: root,
      port: 0,
      store,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createSession(started.url, "持久化");
      expect((await postSessionMessage(started.url, session.sessionId, "@dev 消息")).status).toBe(202);
      await waitForValue(
        async () => (await sessionTitle(started.url, session.sessionId)) === "落库标题" ? true : undefined,
        { describe: "generated title persists in the store", kind: "io", timeoutMs: 5_000 },
      );
      await started.close();
      const reopened = await createSqliteLocalConsoleStore({ sqlitePath });
      await reopened.init();
      try {
        const sessionRow = (await reopened.listSessions()).find((entry) => entry.sessionId === session.sessionId);
        expect(sessionRow?.title).toBe("落库标题");
        expect(sessionRow?.titleRevision).toBe(1);
      } finally {
        await reopened.close();
      }
    } finally {
      await started.close();
    }
  });
});

describe("session title generation through the desktop creation flow (create + initialMessage)", () => {
  async function createWithInitialMessage(
    url: string,
    body: Record<string, unknown>,
  ): Promise<LocalConsoleSessionSummary> {
    const response = await fetch(new URL("/api/local-console/sessions", url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { session: LocalConsoleSessionSummary };
    return payload.session;
  }

  it("renames a conversation created with an initialMessage (desktop new-conversation flow)", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev\n\nROLE:dev");
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> =>
      codexOk(options, options.prompt.includes(TITLE_PROMPT_MARKER) ? "改进推特推广" : "主流程回复"));
    const started = await startTitleConsole({
      projectRoot: root,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createWithInitialMessage(started.url, {
        title: "新对话",
        initialMessage: "@dev 推特效果平平，想改进推广",
      });
      await waitForValue(
        async () => (await sessionTitle(started.url, session.sessionId)) === "改进推特推广"
          ? "改进推特推广"
          : undefined,
        { describe: "creation-flow generated title", kind: "io", timeoutMs: 5_000 },
      );
      expect(countTitleCalls(runCodex)).toBe(1);
      await waitForCondition(
        () => runCodex.mock.calls.length >= 2,
        { describe: "primary reply settles alongside title generation", kind: "io", timeoutMs: 5_000 },
      );
    } finally {
      await started.close();
    }
  });

  it("does not regenerate for later messages after creation-flow generation", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev\n\nROLE:dev");
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> =>
      codexOk(options, options.prompt.includes(TITLE_PROMPT_MARKER) ? "标题一" : "主流程回复"));
    const started = await startTitleConsole({
      projectRoot: root,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createWithInitialMessage(started.url, {
        title: "续聊",
        initialMessage: "@dev 第一条",
      });
      await waitForValue(
        async () => (await sessionTitle(started.url, session.sessionId)) === "标题一" ? true : undefined,
        { describe: "creation-flow first generated title", kind: "io", timeoutMs: 5_000 },
      );
      expect((await postSessionMessage(started.url, session.sessionId, "@dev 第二条")).status).toBe(202);
      await waitForCondition(
        () => runCodex.mock.calls.length >= 3,
        { describe: "second message reaches the provider", kind: "io", timeoutMs: 5_000 },
      );
      expect(countTitleCalls(runCodex)).toBe(1);
    } finally {
      await started.close();
    }
  });

  it("skips title generation when the created session carries no text", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev\n\nROLE:dev");
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    const manager = new LocalAttachmentManager(path.join(root, ".state", "local-console-attachments"), store);
    await manager.init();
    const uploaded = await manager.upload({
      draftKey: "draft:new",
      displayName: "readme.txt",
      mediaTypeHint: "text/plain",
      stream: Readable.from([Buffer.from("ordinary attachment")]),
    });
    expect(uploaded.status).toBe("ready");
    if (uploaded.status !== "ready") throw new Error("expected ready attachment");
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> =>
      codexOk(options, options.prompt.includes(TITLE_PROMPT_MARKER) ? "不应出现" : "主流程回复"));
    const started = await startTitleConsole({
      projectRoot: root,
      port: 0,
      store,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createWithInitialMessage(started.url, {
        title: "附件会话",
        attachmentIds: [uploaded.attachment.attachmentId],
        attachmentDraftKey: "draft:new",
      });
      await waitForCondition(
        () => runCodex.mock.calls.length >= 1,
        { describe: "attachment-only primary run settles", kind: "io", timeoutMs: 5_000 },
      );
      expect(countTitleCalls(runCodex)).toBe(0);
      // 纯附件首条消息：默认标题取第一个附件显示名（PRD 规则），不做模型生成。
      expect(await sessionTitle(started.url, session.sessionId)).toBe("readme.txt");
    } finally {
      await started.close();
    }
  });

  it("does not trigger before any message exists, then generates on the first submitted message", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev\n\nROLE:dev");
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> =>
      codexOk(options, options.prompt.includes(TITLE_PROMPT_MARKER) ? "标题一" : "主流程回复"));
    const started = await startTitleConsole({
      projectRoot: root,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createWithInitialMessage(started.url, { title: "空会话" });
      expect(countTitleCalls(runCodex)).toBe(0);
      expect(await sessionTitle(started.url, session.sessionId)).toBe("空会话");
      expect((await postSessionMessage(started.url, session.sessionId, "@dev 第一条")).status).toBe(202);
      await waitForValue(
        async () => (await sessionTitle(started.url, session.sessionId)) === "标题一" ? true : undefined,
        { describe: "submit-path title after empty creation", kind: "io", timeoutMs: 5_000 },
      );
      expect(countTitleCalls(runCodex)).toBe(1);
    } finally {
      await started.close();
    }
  });
});
