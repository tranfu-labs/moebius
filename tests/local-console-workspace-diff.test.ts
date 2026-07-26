import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import type { CodexRunOptions, CodexRunResult } from "../src/codex.js";
import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../src/local-console/server.js";
import type { LocalConsoleStateSnapshot } from "../src/local-console/types.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const servers: StartedLocalConsoleServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 50,
  })));
});

describe("local console conversation workspace diff through HTTP", () => {
  it.each(["direct", "worktree"] as const)(
    "counts committed and uncommitted files in %s workspace without attributing them",
    async (workspaceMode) => {
      const root = await temporaryRoot();
      const repository = path.join(root, "repository");
      await initializeRepository(repository);
      const started = await startHarness(root, async (options) => {
        const cwd = requireCwd(options);
        await fs.writeFile(path.join(cwd, "committed.txt"), "committed during conversation\n", "utf8");
        await git(cwd, "add", "committed.txt");
        await git(cwd, "commit", "-m", "conversation commit");
        await fs.writeFile(path.join(cwd, "draft.txt"), "uncommitted during conversation\n", "utf8");
        return successfulRun(options, "workspace diff complete");
      });
      const project = await createProject(started.url, repository);
      const session = await createSession(started.url, project.projectId, workspaceMode, "count changes");

      const state = await waitForState(started.url, session.sessionId, (snapshot) =>
        snapshot.activeRun === null && snapshot.messages.some((message) => message.speaker === "agent"),
      );

      expect(state.workspaceDiff).toEqual({ available: true, fileCount: 2, reason: null });
      const diff = await getJson<{
        available: true;
        fileCount: number;
        workspaceMode: "direct" | "worktree";
        files: Array<{ path: string; additions: number | null; deletions: number | null }>;
      }>(
        started.url,
        `/api/local-console/sessions/${encodeURIComponent(session.sessionId)}/workspace-diff`,
      );
      expect(diff).toEqual({
        available: true,
        fileCount: 2,
        workspaceMode,
        reason: null,
        files: [
          { path: "committed.txt", additions: 1, deletions: 1 },
          { path: "draft.txt", additions: 1, deletions: 0 },
        ],
      });

      const changedFile = await getJson<{
        available: true;
        lines: Array<{ kind: string; oldLineNumber: number | null; newLineNumber: number | null; text: string }>;
      }>(
        started.url,
        `/api/local-console/sessions/${encodeURIComponent(session.sessionId)}/files/content?path=committed.txt`,
      );
      expect(changedFile.lines).toEqual([
        { kind: "deletion", oldLineNumber: 1, newLineNumber: null, text: "baseline" },
        { kind: "addition", oldLineNumber: null, newLineNumber: 1, text: "committed during conversation" },
      ]);

      const projectFiles = await getJson<{
        available: true;
        files: Array<{ path: string; changed: boolean }>;
      }>(
        started.url,
        `/api/local-console/sessions/${encodeURIComponent(session.sessionId)}/files`,
      );
      expect(projectFiles.files).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "committed.txt", changed: true }),
        expect.objectContaining({ path: "draft.txt", changed: true }),
        expect.objectContaining({ path: "unchanged.txt", changed: false }),
      ]));
      const unchangedFile = await getJson<{
        available: true;
        lines: Array<{ kind: string; text: string }>;
      }>(
        started.url,
        `/api/local-console/sessions/${encodeURIComponent(session.sessionId)}/files/content?path=unchanged.txt`,
      );
      expect(unchangedFile.lines).toEqual([
        expect.objectContaining({ kind: "unchanged", text: "keep me" }),
      ]);
      const factLog = await readSessionFactLog(root, session.sessionId);
      expect(factLog[0]).toMatchObject({
        type: "create_session",
        payload: {
          kind: "local-create-session",
          baselineCommit: expect.stringMatching(/^[0-9a-f]{40}$/u),
        },
      });

      if (workspaceMode === "worktree") {
        await expect(fs.readFile(path.join(repository, "draft.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      }
    },
    20_000,
  );

  it("reports an available zero instead of omitting the fact", async () => {
    const root = await temporaryRoot();
    const repository = path.join(root, "repository");
    await initializeRepository(repository);
    const started = await startHarness(root, async (options) => successfulRun(options, "no changes"));
    const project = await createProject(started.url, repository);
    const session = await createSession(started.url, project.projectId, "direct", "leave clean");

    const state = await waitForState(started.url, session.sessionId, (snapshot) =>
      snapshot.activeRun === null && snapshot.messages.some((message) => message.speaker === "agent"),
    );
    expect(state.workspaceDiff).toEqual({ available: true, fileCount: 0, reason: null });
  }, 20_000);

  it("returns unavailable for non-Git projects and legacy sessions without a baseline", async () => {
    const root = await temporaryRoot();
    const nonGit = path.join(root, "plain-folder");
    await fs.mkdir(nonGit, { recursive: true });
    await fs.writeFile(path.join(nonGit, "notes.txt"), "plain project\n", "utf8");
    const started = await startHarness(root, async (options) => successfulRun(options, "done"));
    const plainProject = await createProject(started.url, nonGit);
    const plainSession = await createSession(started.url, plainProject.projectId, "direct", "plain folder");
    const plainState = await waitForState(started.url, plainSession.sessionId, (snapshot) =>
      snapshot.activeRun === null && snapshot.messages.some((message) => message.speaker === "agent"),
    );
    expect(plainState.workspaceDiff).toEqual({ available: false, fileCount: null, reason: "missing-baseline" });
    await expect(getJson(
      started.url,
      `/api/local-console/sessions/${encodeURIComponent(plainSession.sessionId)}/workspace-diff`,
    )).resolves.toMatchObject({
      available: false,
      files: [],
      reason: "missing-baseline",
      workspaceMode: "direct",
    });
    await expect(getJson(
      started.url,
      `/api/local-console/sessions/${encodeURIComponent(plainSession.sessionId)}/files`,
    )).resolves.toMatchObject({
      available: true,
      files: [expect.objectContaining({ path: "notes.txt", changed: false })],
      workspaceMode: "direct",
    });

    const repository = path.join(root, "repository");
    await initializeRepository(repository);
    const gitProject = await createProject(started.url, repository);
    const response = await fetch(new URL("/api/local-console/sessions", started.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: gitProject.projectId, workspaceMode: "direct" }),
    });
    const legacy = await response.json() as { session: { sessionId: string } };
    await fetch(new URL(`/api/local-console/sessions/${encodeURIComponent(legacy.session.sessionId)}/messages`, started.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "legacy first message" }),
    });
    const legacyState = await waitForState(started.url, legacy.session.sessionId, (snapshot) =>
      snapshot.activeRun === null && snapshot.messages.some((message) => message.speaker === "agent"),
    );
    expect(legacyState.workspaceDiff).toEqual({ available: false, fileCount: null, reason: "missing-baseline" });
  }, 20_000);

  it("explains large, binary, missing, and out-of-workspace files instead of returning blank content", async () => {
    const root = await temporaryRoot();
    const repository = path.join(root, "repository");
    await initializeRepository(repository);
    const started = await startHarness(root, async (options) => {
      const cwd = requireCwd(options);
      await fs.writeFile(path.join(cwd, "large.txt"), "x".repeat(2 * 1024 * 1024 + 1), "utf8");
      await fs.writeFile(path.join(cwd, "binary.dat"), Buffer.from([0, 1, 2, 3]));
      return successfulRun(options, "special files");
    });
    const project = await createProject(started.url, repository);
    const session = await createSession(started.url, project.projectId, "direct", "create special files");
    await waitForState(started.url, session.sessionId, (snapshot) =>
      snapshot.activeRun === null && snapshot.messages.some((message) => message.speaker === "agent"),
    );

    for (const [filePath, reason] of [
      ["large.txt", "file-too-large"],
      ["binary.dat", "binary-file"],
      ["missing.txt", "not-found"],
      ["../outside.txt", "outside-workspace"],
    ] as const) {
      const endpoint = new URL(
        `/api/local-console/sessions/${encodeURIComponent(session.sessionId)}/files/content`,
        started.url,
      );
      endpoint.searchParams.set("path", filePath);
      const response = await fetch(endpoint);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        available: false,
        path: filePath,
        lines: [],
        reason,
      });
    }
  }, 20_000);

  it("restores full run output through the persisted HTTP run locator after restart", async () => {
    const root = await temporaryRoot();
    const repository = path.join(root, "repository");
    await initializeRepository(repository);
    const runCodex = async (options: CodexRunOptions): Promise<CodexRunResult> => {
      await fs.mkdir(options.runDir, { recursive: true });
      await fs.writeFile(path.join(options.runDir, "stdout.jsonl"), '{"type":"item","text":"complete stdout"}\n', "utf8");
      await fs.writeFile(path.join(options.runDir, "stderr.log"), "complete stderr\n", "utf8");
      return successfulRun(options, "output persisted");
    };
    const started = await startHarness(root, runCodex);
    const project = await createProject(started.url, repository);
    const session = await createSession(started.url, project.projectId, "direct", "persist output");
    const finished = await waitForState(started.url, session.sessionId, (snapshot) =>
      snapshot.activeRun === null && snapshot.messages.some((message) => message.speaker === "agent"),
    );
    const runId = finished.messages.find((message) => message.speaker === "agent")?.runId;
    expect(runId).toBeTruthy();
    await started.close();
    servers.splice(servers.indexOf(started), 1);

    const restarted = await startHarness(root, runCodex);
    const response = await fetch(new URL(
      `/api/local-console/sessions/${encodeURIComponent(session.sessionId)}/runs/${encodeURIComponent(runId!)}/output`,
      restarted.url,
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sessionId: session.sessionId,
      runId,
      role: "dev",
      stdout: expect.stringContaining("complete stdout"),
      stderr: expect.stringContaining("complete stderr"),
    });
  }, 20_000);

  it("serves friendly Codex rollout history and append pages without runDir fallback", async () => {
    const root = await temporaryRoot();
    const repository = path.join(root, "repository");
    const codexHome = path.join(root, "codex-home");
    const threadId = "019f8cd7-cbc4-7a72-b0f7-71fecb7bd2e3";
    const rolloutPath = path.join(
      codexHome,
      "sessions",
      "2026",
      "07",
      "23",
      `rollout-http-${threadId}.jsonl`,
    );
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      await initializeRepository(repository);
      await fs.mkdir(path.dirname(rolloutPath), { recursive: true });
      await fs.writeFile(rolloutPath, `${JSON.stringify(rolloutAssistant("开始检查"))}\n`, "utf8");
      const started = await startHarness(root, async (options) => {
        await fs.mkdir(options.runDir, { recursive: true });
        await fs.writeFile(path.join(options.runDir, "stdout.jsonl"), "RUN_DIR_FALLBACK_MUST_NOT_APPEAR\n");
        await fs.writeFile(path.join(options.runDir, "stderr.log"), "RUN_DIR_STDERR_MUST_NOT_APPEAR\n");
        await options.onThreadStarted?.(threadId);
        return successfulRun(options, "final reply must stay in the main timeline");
      });
      const project = await createProject(started.url, repository);
      const session = await createSession(started.url, project.projectId, "direct", "请检查实现");
      const finished = await waitForState(started.url, session.sessionId, (snapshot) =>
        snapshot.activeRun === null && snapshot.messages.some((message) => message.speaker === "agent"),
      );
      const runId = finished.messages.find((message) => message.speaker === "agent")?.runId;
      expect(runId).toBeTruthy();

      const endpoint = new URL(
        `/api/local-console/sessions/${encodeURIComponent(session.sessionId)}/runs/${encodeURIComponent(runId!)}/process-output`,
        started.url,
      );
      const initialResponse = await fetch(endpoint);
      expect(initialResponse.status).toBe(200);
      const initial = await initialResponse.json() as {
        status: string;
        events: Array<{ kind: string; markdown?: string }>;
        appendCursor: string | null;
      };
      expect(initial.status).toBe("settled");
      expect(initial.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "public-message", markdown: "请检查实现" }),
        expect.objectContaining({ kind: "agent-markdown", markdown: "开始检查" }),
      ]));
      expect(JSON.stringify(initial)).not.toContain("RUN_DIR_");
      expect(JSON.stringify(initial)).not.toContain("final reply must stay");
      expect(initial.appendCursor).not.toBeNull();

      await fs.appendFile(rolloutPath, `${JSON.stringify(rolloutAssistant("新增过程"))}\n`, "utf8");
      const appendEndpoint = new URL(endpoint);
      appendEndpoint.searchParams.set("appendCursor", initial.appendCursor!);
      const appendResponse = await fetch(appendEndpoint);
      expect(appendResponse.status).toBe(200);
      await expect(appendResponse.json()).resolves.toMatchObject({
        events: [expect.objectContaining({ kind: "agent-markdown", markdown: "新增过程" })],
      });

      await fs.rename(rolloutPath, `${rolloutPath}.bak`);
      const unavailableResponse = await fetch(endpoint);
      expect(unavailableResponse.status).toBe(200);
      await expect(unavailableResponse.json()).resolves.toMatchObject({
        status: "settled",
        unavailableReason: null,
        attempts: [expect.objectContaining({
          attempt: 1,
          elapsedMs: expect.any(Number),
          completedAt: expect.any(String),
        })],
        events: expect.arrayContaining([
          expect.objectContaining({
            kind: "error",
            message: "这次执行的过程记录不可用",
          }),
        ]),
      });
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
    }
  }, 20_000);
});

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-evidence-outlets-"));
  roots.push(root);
  return root;
}

async function readSessionFactLog(root: string, sessionId: string): Promise<unknown[]> {
  const filename = `${Buffer.from(sessionId, "utf8").toString("base64url")}.jsonl`;
  const content = await fs.readFile(path.join(root, "sessions", filename), "utf8");
  return content.trim().split("\n").map((line) => JSON.parse(line) as unknown);
}

async function initializeRepository(repository: string): Promise<void> {
  await fs.mkdir(repository, { recursive: true });
  await git(repository, "init");
  await git(repository, "config", "user.name", "Evidence Test");
  await git(repository, "config", "user.email", "evidence@example.test");
  await fs.writeFile(path.join(repository, "committed.txt"), "baseline\n", "utf8");
  await fs.writeFile(path.join(repository, "unchanged.txt"), "keep me\n", "utf8");
  await git(repository, "add", ".");
  await git(repository, "commit", "-m", "baseline");
}

async function startHarness(
  root: string,
  runCodex: (options: CodexRunOptions) => Promise<CodexRunResult>,
): Promise<StartedLocalConsoleServer> {
  const started = await startLocalConsoleServer({
    host: "127.0.0.1",
    port: 0,
    projectRoot: root,
    workdirRoot: path.join(root, "workdir"),
    sqlitePath: path.join(root, "state", "local-console.sqlite"),
    listAgentFiles: async () => [{
      name: "dev",
      agentMarkdown: "---\nname: dev\n---\nDeveloper\n",
    }],
    runCodex,
    makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
  });
  servers.push(started);
  return started;
}

function successfulRun(options: CodexRunOptions, finalText: string): Extract<CodexRunResult, { ok: true }> {
  return {
    ok: true,
    finalText: `${finalText}\n\n<!-- moebius:stage=code-verified -->`,
    threadId: "thread-evidence",
    cachedInputTokens: 0,
    runDir: options.runDir,
    stdoutPath: path.join(options.runDir, "stdout.jsonl"),
    stderrPath: path.join(options.runDir, "stderr.log"),
  };
}

function rolloutAssistant(markdown: string): unknown {
  return {
    timestamp: "2026-07-23T01:00:00.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: markdown }],
    },
  };
}

function requireCwd(options: CodexRunOptions): string {
  if (options.cwd === undefined) throw new Error("test run requires cwd");
  return options.cwd;
}

async function createProject(url: string, folderPath: string): Promise<{ projectId: string }> {
  const response = await fetch(new URL("/api/local-console/projects", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ folderPath, worktreeMode: false }),
  });
  expect(response.status).toBe(201);
  return (await response.json() as { project: { projectId: string } }).project;
}

async function createSession(
  url: string,
  projectId: string,
  workspaceMode: "direct" | "worktree",
  initialMessage: string,
): Promise<{ sessionId: string }> {
  const response = await fetch(new URL("/api/local-console/sessions", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, workspaceMode, initialMessage }),
  });
  expect(response.status).toBe(201);
  return (await response.json() as { session: { sessionId: string } }).session;
}

async function waitForState(
  url: string,
  sessionId: string,
  predicate: (snapshot: LocalConsoleStateSnapshot) => boolean,
): Promise<LocalConsoleStateSnapshot> {
  let latest: LocalConsoleStateSnapshot | null = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const endpoint = new URL("/api/local-console/state", url);
    endpoint.searchParams.set("sessionId", sessionId);
    const response = await fetch(endpoint);
    latest = await response.json() as LocalConsoleStateSnapshot;
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for local state: ${JSON.stringify(latest)}`);
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", cwd, ...args]);
}

async function getJson<T = unknown>(url: string, pathname: string): Promise<T> {
  const response = await fetch(new URL(pathname, url));
  expect(response.status).toBe(200);
  return await response.json() as T;
}
