import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import type { CodexRunOptions, CodexRunResult } from "../../src/codex.js";
import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../../src/local-console/start.js";
import { createAcceptanceOutputDirectory } from "./temp-output.js";

interface Evidence {
  acceptance: Array<{
    id: number;
    statement: string;
    evidence: unknown;
  }>;
  live: unknown;
  interrupted: unknown;
  failure: unknown;
  boundedTail: unknown;
  emptyFallback: unknown;
  crossSessionInterrupt: unknown;
  stuck: unknown;
  restartRecovery: unknown;
  artifacts: Record<string, string>;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const artifactDir = await createAcceptanceOutputDirectory("local-console-t4");
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-t4-acceptance-"));
const sqlitePath = path.join(runtimeRoot, ".state", "local-console.sqlite");
const distPage = path.join(projectRoot, "desktop", "dist", "console-page", "index.html");

await fs.mkdir(path.join(runtimeRoot, "agents"), { recursive: true });
await fs.writeFile(path.join(runtimeRoot, "agents", "dev.md"), "# Dev\n\nReply concisely.", "utf8");
await fs.mkdir(artifactDir, { recursive: true });

let started = await startFakeServer();
const staticServer = await startStaticServer(path.dirname(distPage));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 });
const artifacts = {
  live: path.join(artifactDir, "t4-live.png"),
  interrupted: path.join(artifactDir, "t4-interrupted.png"),
  failed: path.join(artifactDir, "t4-failed.png"),
  evidence: path.join(artifactDir, "t4-evidence.json"),
};

const evidence: Evidence = {
  acceptance: [],
  live: null,
  interrupted: null,
  failure: null,
  boundedTail: null,
  emptyFallback: null,
  crossSessionInterrupt: null,
  stuck: null,
  restartRecovery: null,
  artifacts,
};

try {
  const pageUrl = new URL("index.html", staticServer.url);
  pageUrl.searchParams.set("api", started.url);
  await page.goto(pageUrl.toString());
  await page.getByLabel("消息内容").fill("@dev T4_LIVE start a slow local console run");
  await page.getByRole("button", { name: "发送消息" }).click();
  await page.getByRole("button", { name: "中断开发运行" }).waitFor();
  await page.getByText("live tail from codex").waitFor();
  await page.screenshot({ path: artifacts.live, fullPage: true });

  const liveState = await waitForState("default", (state) => state.activeRun?.lastOutputSummary === "live tail from codex");
  const liveActiveRun = summarizeActiveRun(liveState.activeRun);
  evidence.live = {
    selectedSessionId: liveState.selectedSessionId,
    activeRun: liveState.activeRun,
    messageStatuses: summarizeMessages(liveState.messages),
  };

  await page.getByRole("button", { name: /中断/u }).click();
  await page.getByText("运行已中断").first().waitFor();
  const interruptedState = await waitForState("default", (state) =>
    state.messages.some((message) => message.status === "interrupted"),
  );
  const interruptedMessages = summarizeMessages(interruptedState.messages);
  await page.getByLabel("消息内容").fill("@dev T4_AFTER interrupt should release the session");
  await page.getByRole("button", { name: "发送消息" }).click();
  await page.getByText("after interrupt").waitFor();
  const releasedState = await waitForState("default", (state) =>
    state.messages.some((message) => message.body === "after interrupt"),
  );
  const releasedMessages = summarizeMessages(releasedState.messages);
  await page.screenshot({ path: artifacts.interrupted, fullPage: true });
  evidence.interrupted = {
    interrupted: interruptedMessages,
    released: releasedMessages,
  };

  const failureSession = await createSession("failure visible");
  await postMessage(failureSession.sessionId, "@dev T4_FAIL construct a visible failure");
  await waitForState(failureSession.sessionId, (state) =>
    state.messages.some((message: any) => message.error === "exit:42"),
  );
  await page.getByRole("button", { name: "failure visible", exact: true }).click();
  await page.getByText("运行失败").first().waitFor();
  await page.screenshot({ path: artifacts.failed, fullPage: true });
  const failedSessionId = failureSession.sessionId;
  const failedState = await getState(failedSessionId);
  const failureMessages = summarizeMessages(failedState.messages);
  evidence.failure = failureMessages;

  const tailSession = await createSession("bounded tail");
  await postMessage(tailSession.sessionId, "@dev T4_TAIL keep a large stdout file open");
  const tailStarted = await waitForState(tailSession.sessionId, (state) =>
    state.activeRun?.tailDiagnostic?.includes("tail-truncated:stdout.jsonl") === true,
  );
  const beforeTailPoll = Date.now();
  const tailPoll = await getState(tailSession.sessionId);
  const tailPollMs = Date.now() - beforeTailPoll;
  const boundedTailActiveRun = summarizeActiveRun(tailPoll.activeRun);
  evidence.boundedTail = {
    pollMs: tailPollMs,
    activeRun: boundedTailActiveRun,
  };
  await interrupt(tailSession.sessionId, tailStarted.activeRun?.runId ?? "");
  await waitForState(tailSession.sessionId, (state) => state.messages.some((message) => message.status === "interrupted"));

  const emptySession = await createSession("empty fallback");
  await postMessage(emptySession.sessionId, "@dev T4_EMPTY no parseable output");
  const emptyState = await waitForState(emptySession.sessionId, (state) =>
    state.activeRun?.lastOutputSummary === "正在运行，等待输出",
  );
  const emptyActiveRun = summarizeActiveRun(emptyState.activeRun);
  evidence.emptyFallback = emptyActiveRun;
  await interrupt(emptySession.sessionId, emptyState.activeRun?.runId ?? "");
  await waitForState(emptySession.sessionId, (state) => state.messages.some((message) => message.status === "interrupted"));

  const sessionA = await createSession("cross A");
  const sessionB = await createSession("cross B");
  await postMessage(sessionA.sessionId, "@dev T4_CROSS session A must keep running");
  const runningA = await waitForState(sessionA.sessionId, (state) => state.activeRun !== null);
  const wrongInterrupt = await interrupt(sessionB.sessionId, runningA.activeRun?.runId ?? "");
  const stillRunningA = await getState(sessionA.sessionId);
  const activeRunAfterWrongInterrupt = summarizeActiveRun(stillRunningA.activeRun);
  const rightInterrupt = await interrupt(sessionA.sessionId, runningA.activeRun?.runId ?? "");
  const stoppedA = await waitForState(sessionA.sessionId, (state) => state.messages.some((message) => message.status === "interrupted"));
  const stoppedAMessages = summarizeMessages(stoppedA.messages);
  evidence.crossSessionInterrupt = {
    wrongInterrupt,
    activeRunAfterWrongInterrupt: stillRunningA.activeRun,
    rightInterrupt,
    stoppedA: stoppedAMessages,
  };

  const stuckSession = await createSession("stuck");
  await postMessage(stuckSession.sessionId, "@dev T4_STUCK simulate idle timeout");
  const stuckState = await waitForState(stuckSession.sessionId, (state) =>
    state.messages.some((message) => message.status === "stuck"),
  );
  const stuckMessages = summarizeMessages(stuckState.messages);
  evidence.stuck = stuckMessages;

  await page.close();
  await started.close();
  started = await startFakeServer();
  const restartInterrupted = await getState("default");
  const restartFailed = await getState(failedSessionId);
  const restartStuck = await getState(stuckSession.sessionId);
  const restartInterruptedMessages = summarizeMessages(restartInterrupted.messages);
  const restartFailedMessages = summarizeMessages(restartFailed.messages);
  const restartStuckMessages = summarizeMessages(restartStuck.messages);
  evidence.restartRecovery = {
    interrupted: restartInterruptedMessages,
    failed: restartFailedMessages,
    stuck: restartStuckMessages,
  };
  evidence.acceptance = [
    {
      id: 1,
      statement: "桌面台发起一次对话 -> 应在同一时间线看到运行摘要与中断动作",
      evidence: {
        screenshot: artifacts.live,
        activeRun: liveActiveRun,
        messageStatuses: summarizeMessages(liveState.messages),
      },
    },
    {
      id: 2,
      statement: "运行中点中断 -> 应看到本轮 codex 被停下且状态如实反映",
      evidence: {
        screenshot: artifacts.interrupted,
        interruptedMessages,
        releasedMessages,
      },
    },
    {
      id: 3,
      statement: "构造一个失败 -> 应看到本地错误记录而非静默",
      evidence: {
        screenshot: artifacts.failed,
        messages: failureMessages,
      },
    },
    {
      id: 4,
      statement: "构造 stdout.jsonl 大文件或慢读取故障 -> state API 有界返回并显示 tail 或降级概括",
      evidence: {
        pollMs: tailPollMs,
        activeRun: boundedTailActiveRun,
      },
    },
    {
      id: 5,
      statement: "构造无可解析 JSONL 且 stderr 为空的慢 Codex run -> 显示非空运行概括和 elapsed，runDir 只保留为状态证据",
      evidence: {
        activeRun: emptyActiveRun,
      },
    },
    {
      id: 6,
      statement: "session A 运行中切到 B 并对 B 中断 -> 不应中断 A，只有 A 的 sessionId/runId 会 abort A",
      evidence: {
        wrongInterrupt,
        activeRunAfterWrongInterrupt,
        rightInterrupt,
        stoppedA: stoppedAMessages,
      },
    },
    {
      id: 7,
      statement: "构造 Codex idle-timeout 或 stale running 修复 -> 显示并持久化 stuck",
      evidence: {
        messages: stuckMessages,
      },
    },
    {
      id: 8,
      statement: "刷新 renderer 或重启桌面窗口后查看 interrupted/failed/stuck 记录 -> 可读状态仍恢复，reason/runDir 保留为诊断证据而不常驻对话",
      evidence: {
        interrupted: restartInterruptedMessages,
        failed: restartFailedMessages,
        stuck: restartStuckMessages,
      },
    },
  ];

  await fs.writeFile(artifacts.evidence, JSON.stringify(evidence, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, artifacts })}\n`);
} finally {
  await browser.close();
  await started.close();
  await staticServer.close();
}

async function startFakeServer(): Promise<StartedLocalConsoleServer> {
  return await startLocalConsoleServer({
    projectRoot: runtimeRoot,
    sqlitePath,
    port: 0,
    runCodex: fakeCodex,
    makeRunDir: (count) => path.join(runtimeRoot, "runs", `run-${String(count)}-${Date.now()}`),
    codexIdleTimeoutMs: 30_000,
    codexMaxDurationMs: 60_000,
    storeTimeoutMs: 1_000,
  });
}

async function fakeCodex(options: CodexRunOptions): Promise<CodexRunResult> {
  await fs.mkdir(options.runDir, { recursive: true });
  const stdoutPath = path.join(options.runDir, "stdout.jsonl");
  const stderrPath = path.join(options.runDir, "stderr.log");
  await fs.writeFile(stderrPath, "", "utf8");
  if (options.prompt.includes("T4_AFTER")) {
    await fs.writeFile(stdoutPath, JSON.stringify({ message: "after interrupt" }) + "\n", "utf8");
    return okResult(options, "after interrupt");
  }
  if (options.prompt.includes("T4_FAIL")) {
    await fs.writeFile(stdoutPath, "", "utf8");
    return failedResult(options, "exit:42");
  }
  if (options.prompt.includes("T4_STUCK")) {
    await fs.writeFile(stdoutPath, "", "utf8");
    return failedResult(options, "idle-timeout:10ms");
  }
  if (options.prompt.includes("T4_TAIL")) {
    await fs.writeFile(
      stdoutPath,
      Array.from({ length: 8_000 }, (_, index) => JSON.stringify({ message: `tail line ${String(index).padStart(4, "0")}` })).join("\n") + "\n",
      "utf8",
    );
    return await waitForAbort(options);
  }
  if (options.prompt.includes("T4_EMPTY")) {
    await fs.writeFile(stdoutPath, "", "utf8");
    return await waitForAbort(options);
  }
  await fs.writeFile(stdoutPath, JSON.stringify({ message: "live tail from codex" }) + "\n", "utf8");
  return await waitForAbort(options);
}

function okResult(options: CodexRunOptions, finalText: string): CodexRunResult {
  return {
    ok: true,
    finalText,
    threadId: null,
    cachedInputTokens: null,
    runDir: options.runDir,
    stdoutPath: path.join(options.runDir, "stdout.jsonl"),
    stderrPath: path.join(options.runDir, "stderr.log"),
  };
}

function failedResult(options: CodexRunOptions, reason: string): CodexRunResult {
  return {
    ok: false,
    reason,
    runDir: options.runDir,
    stdoutPath: path.join(options.runDir, "stdout.jsonl"),
    stderrPath: path.join(options.runDir, "stderr.log"),
  };
}

function waitForAbort(options: CodexRunOptions): Promise<CodexRunResult> {
  if (options.signal?.aborted === true) {
    return Promise.resolve(failedResult(options, `interrupted:${String(options.signal.reason ?? "abort")}`));
  }
  return new Promise((resolve) => {
    options.signal?.addEventListener(
      "abort",
      () => {
        resolve(failedResult(options, `interrupted:${String(options.signal?.reason ?? "abort")}`));
      },
      { once: true },
    );
  });
}

async function createSession(title: string): Promise<{ sessionId: string; title: string }> {
  const response = await fetch(new URL("/api/local-console/sessions", started.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const body = await response.json() as { session: { sessionId: string; title: string } };
  if (!response.ok) {
    throw new Error(`create session failed: ${JSON.stringify(body)}`);
  }
  return body.session;
}

async function postMessage(sessionId: string, body: string): Promise<void> {
  const response = await fetch(new URL(`/api/local-console/sessions/${encodeURIComponent(sessionId)}/messages`, started.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!response.ok) {
    throw new Error(`post message failed: ${response.status} ${await response.text()}`);
  }
}

async function interrupt(sessionId: string, runId: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(new URL(`/api/local-console/sessions/${encodeURIComponent(sessionId)}/interrupt`, started.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId }),
  });
  return { status: response.status, body: await response.json() };
}

async function getState(sessionId: string): Promise<any> {
  const url = new URL("/api/local-console/state", started.url);
  url.searchParams.set("sessionId", sessionId);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`state failed: ${response.status} ${await response.text()}`);
  }
  return await response.json();
}

async function waitForState(sessionId: string, predicate: (state: any) => boolean): Promise<any> {
  return await waitForAnyState((state) => state.selectedSessionId === sessionId && predicate(state), sessionId);
}

async function waitForAnyState(predicate: (state: any) => boolean, sessionId = "default"): Promise<any> {
  const deadline = Date.now() + 8_000;
  let latest: any = null;
  while (Date.now() < deadline) {
    latest = await getState(sessionId);
    if (predicate(latest)) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for state: ${JSON.stringify(latest)}`);
}

function summarizeMessages(messages: any[]): Array<Record<string, unknown>> {
  return messages.map((message) => ({
    speaker: message.speaker,
    role: message.role,
    status: message.status,
    body: message.body,
    error: message.error,
    runDir: message.runDir,
  }));
}

function summarizeActiveRun(activeRun: any): Record<string, unknown> | null {
  if (activeRun === null || activeRun === undefined) {
    return null;
  }
  return {
    sessionId: activeRun.sessionId,
    runId: activeRun.runId,
    status: activeRun.status,
    elapsedMs: activeRun.elapsedMs,
    runDir: activeRun.runDir,
    lastOutputSummary: activeRun.lastOutputSummary,
    tailDiagnostic: activeRun.tailDiagnostic,
    stdoutTailLength: typeof activeRun.stdoutTail === "string" ? activeRun.stdoutTail.length : null,
    stderrTailLength: typeof activeRun.stderrTail === "string" ? activeRun.stderrTail.length : null,
  };
}

async function startStaticServer(root: string): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const relativePath = requestUrl.pathname === "/" ? "index.html" : decodeURIComponent(requestUrl.pathname.slice(1));
      const filePath = path.resolve(root, relativePath);
      if (!filePath.startsWith(path.resolve(root) + path.sep)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }
      try {
        const body = await fs.readFile(filePath);
        response.writeHead(200, { "content-type": contentType(filePath) });
        response.end(body);
      } catch {
        response.writeHead(404);
        response.end("Not found");
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("static server did not expose a port");
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}/`,
    async close() {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (filePath.endsWith(".map")) {
    return "application/json; charset=utf-8";
  }
  return "application/octet-stream";
}
