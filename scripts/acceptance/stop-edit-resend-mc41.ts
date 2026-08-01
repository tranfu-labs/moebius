import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import type { CodexRunOptions, CodexRunResult } from "../../src/codex.js";
import { startLocalConsoleServer } from "../../src/local-console/start.js";

const attachmentCapability = "stop-edit-resend-mc41";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const stateDir = readStateDir(process.argv.slice(2));
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-mc41-"));
const sqlitePath = path.join(runtimeRoot, ".state", "local-console.sqlite");
const preservedFile = path.join(runtimeRoot, "preserved-before-resend.txt");
let codexInvocation = 0;

await fs.mkdir(path.join(runtimeRoot, "agents"), { recursive: true });
await fs.writeFile(path.join(runtimeRoot, "agents", "dev.md"), "# Dev\n\nImplement and hand off when needed.\n", "utf8");
await fs.writeFile(path.join(runtimeRoot, "agents", "qa.md"), "# QA\n\nVerify the current step.\n", "utf8");
await fs.mkdir(stateDir, { recursive: true });

const started = await startLocalConsoleServer({
  projectRoot: runtimeRoot,
  sqlitePath,
  port: 0,
  attachmentCapability,
  runCodex: fakeCodex,
  makeRunDir: (count) => path.join(runtimeRoot, "runs", `run-${String(count)}`),
  codexIdleTimeoutMs: 30_000,
  codexMaxDurationMs: 60_000,
  storeTimeoutMs: 5_000,
});
const alternateSession = await createSession(started.url, "切换验证会话");
const staticServer = await startStaticServer(path.join(projectRoot, "desktop", "dist", "console-page"));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

try {
  await page.addInitScript({
    content: `
      localStorage.setItem("moebius.console.selection", JSON.stringify({ projectId: "local", sessionId: "default" }));
      Object.defineProperty(window, "moebius", {
        configurable: true,
        value: { getLocalConsoleAttachmentCapability: async () => "${attachmentCapability}" }
      });
    `,
  });
  const pageUrl = new URL("index.html", staticServer.url);
  pageUrl.searchParams.set("api", started.url);
  await page.goto(pageUrl.toString());
  await page.getByRole("heading", { name: "默认会话" }).waitFor();

  const fileInput = page.locator('input[type="file"]');
  const attachmentNames = ["mc41-context.txt", "mc41-notes.md"];
  await fileInput.setInputFiles([
    {
      name: attachmentNames[0]!,
      mimeType: "text/plain",
      buffer: Buffer.from("original attachment"),
    },
    {
      name: attachmentNames[1]!,
      mimeType: "text/markdown",
      buffer: Buffer.from("second attachment"),
    },
  ]);
  for (const attachmentName of attachmentNames) {
    await waitForReadyAttachment(page, attachmentName);
  }
  const originalBody = "@dev MC41_ORIGINAL 请检查附件";
  await page.getByLabel("消息内容").fill(originalBody);
  await page.getByRole("button", { name: "发送消息" }).click();

  const runningQa = await waitForState(started.url, (state) => state.activeRun?.role === "qa");
  await page.getByTestId("active-run-block").getByText("测试").waitFor();
  const interruptResponse = await fetch(
    new URL("/api/local-console/sessions/default/interrupt", started.url),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: runningQa.activeRun.runId }),
    },
  );
  if (interruptResponse.status !== 202) {
    throw new Error(`interrupt API failed: ${interruptResponse.status} ${await interruptResponse.text()}`);
  }
  const stopped = await waitForState(started.url, (state) =>
    state.messages.some((message) => message.systemEventKind === "user-stopped"),
  );
  await page.getByText("你让这一步停下了").waitFor();
  const resendActions = page.getByRole("button", { name: "改一改重发这轮消息" });
  if (await resendActions.count() !== 1) {
    throw new Error("user-stopped record did not expose exactly one edit-and-resend action");
  }
  await resendActions.click();
  await waitForComposer(page, originalBody, attachmentNames);

  await page.locator(`[data-testid="conversation-sidebar-session"][title="${alternateSession.title}"]`).click();
  await page.getByRole("heading", { name: alternateSession.title }).waitFor();
  await page.locator('[data-testid="conversation-sidebar-session"][title="默认会话"]').click();
  await page.getByRole("heading", { name: "默认会话" }).waitFor();
  await waitForComposer(page, originalBody, attachmentNames);
  const draftPreservedAcrossSessionSwitch = true;

  await page.reload();
  await waitForComposer(page, originalBody, attachmentNames);
  const draftPreservedAcrossReload = true;
  const editedBody = "@dev MC41_EDITED 请按修改后的要求处理";
  await page.getByLabel("消息内容").fill(editedBody);
  await page.getByRole("button", { name: "发送消息" }).click();
  const resent = await waitForState(started.url, (state) =>
    state.messages.filter((message) => message.speaker === "user").length === 2
      && state.messages.some((message) => message.speaker === "agent" && message.body.includes("edited run complete")),
  );

  const users = resent.messages.filter((message) => message.speaker === "user");
  const original = users[0];
  const replacement = users[1];
  const preservedContents = await fs.readFile(preservedFile, "utf8");
  const evidence = {
    acceptanceId: "mc-41",
    multiMemberStartRole: runningQa.activeRun?.role,
    stoppedMessageId: stopped.messages.find((message) => message.systemEventKind === "user-stopped")?.id,
    original: summarizeUserMessage(original),
    replacement: summarizeUserMessage(replacement),
    attachmentIdsAreNew:
      original.attachments.length === 2
      && replacement.attachments.length === 2
      && original.attachments.every((attachment, index) =>
        attachment.attachmentId !== replacement.attachments[index]?.attachmentId),
    attachmentOrderPreserved:
      original.attachments.map((attachment) => attachment.displayName).join("|")
      === replacement.attachments.map((attachment) => attachment.displayName).join("|"),
    originalMessagePreserved:
      original.body === originalBody && original.attachments.length === 2,
    replacementIsNewMessage:
      replacement.id !== original.id && replacement.body === editedBody,
    worktreeFilePreserved: preservedContents === "created before user stop",
    draftPreservedAcrossSessionSwitch,
    draftPreservedAcrossReload,
    editResendActionCount: await resendActions.count(),
  };
  if (
    evidence.multiMemberStartRole !== "qa"
    || !evidence.attachmentIdsAreNew
    || !evidence.attachmentOrderPreserved
    || !evidence.originalMessagePreserved
    || !evidence.replacementIsNewMessage
    || !evidence.worktreeFilePreserved
    || !evidence.draftPreservedAcrossSessionSwitch
    || !evidence.draftPreservedAcrossReload
    || evidence.editResendActionCount !== 1
  ) {
    throw new Error(`mc-41 evidence failed: ${JSON.stringify(evidence)}`);
  }
  await fs.writeFile(path.join(stateDir, "mc-41-evidence.json"), JSON.stringify(evidence, null, 2), "utf8");
} finally {
  await page.close();
  await browser.close();
  await staticServer.close();
  await started.close();
  await fs.rm(runtimeRoot, { recursive: true, force: true });
}

async function fakeCodex(options: CodexRunOptions): Promise<CodexRunResult> {
  codexInvocation += 1;
  await fs.mkdir(options.runDir, { recursive: true });
  await fs.writeFile(path.join(options.runDir, "stdout.jsonl"), "", "utf8");
  await fs.writeFile(path.join(options.runDir, "stderr.log"), "", "utf8");
  if (codexInvocation === 1) {
    return okResult(options, "开发检查完成，交给 @qa 继续验证");
  }
  if (codexInvocation === 2) {
    await fs.writeFile(preservedFile, "created before user stop", "utf8");
    return await waitForAbort(options);
  }
  return okResult(options, "edited run complete");
}

async function createSession(
  serverUrl: string,
  title: string,
): Promise<{ sessionId: string; title: string }> {
  const response = await fetch(new URL("/api/local-console/sessions", serverUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const body = await response.json() as { session?: { sessionId: string; title: string }; error?: string };
  if (!response.ok || body.session === undefined) {
    throw new Error(`create alternate session failed: ${body.error ?? response.status}`);
  }
  return body.session;
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

function waitForAbort(options: CodexRunOptions): Promise<CodexRunResult> {
  return new Promise((resolve) => {
    options.signal?.addEventListener("abort", () => resolve({
      ok: false,
      reason: `interrupted:${String(options.signal?.reason ?? "abort")}`,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }), { once: true });
  });
}

async function waitForComposer(page: import("playwright").Page, body: string, attachmentNames: string[]): Promise<void> {
  await page.waitForFunction((expected) => {
    const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="消息内容"]');
    return input?.value === expected;
  }, body);
  for (const attachmentName of attachmentNames) {
    await waitForReadyAttachment(page, attachmentName);
  }
}

async function waitForReadyAttachment(page: import("playwright").Page, attachmentName: string): Promise<void> {
  try {
    const attachmentDraft = page.getByLabel("附件草稿");
    const ready = attachmentDraft.getByLabel(`${attachmentName}，已准备`);
    const failed = attachmentDraft.getByLabel(`${attachmentName}，准备失败`);
    await Promise.race([
      ready.waitFor({ timeout: 5_000 }),
      failed.waitFor({ timeout: 5_000 }),
    ]);
    if (await failed.isVisible()) {
      await page.getByRole("button", { name: `重试附件 ${attachmentName}` }).click();
    }
    await ready.waitFor({ timeout: 5_000 });
  } catch (error) {
    const attachmentLabels = await page.locator(`[aria-label*="${attachmentName}"]`).evaluateAll(
      (elements) => elements.map((element) => ({ label: element.getAttribute("aria-label"), text: element.textContent })),
    );
    const capabilityProbe = await page.evaluate(async () => {
      const api = (window as Window & { moebius?: { getLocalConsoleAttachmentCapability?: () => Promise<string | null> } }).moebius;
      return {
        hasApi: api !== undefined,
        hasCapabilityMethod: api?.getLocalConsoleAttachmentCapability !== undefined,
        capability: await api?.getLocalConsoleAttachmentCapability?.(),
      };
    });
    throw new Error(`attachment did not become ready: ${JSON.stringify({ attachmentLabels, capabilityProbe })}`, { cause: error });
  }
}

async function waitForState(url: string, predicate: (state: any) => boolean): Promise<any> {
  const deadline = Date.now() + 10_000;
  let latest: any = null;
  while (Date.now() < deadline) {
    const response = await fetch(new URL("/api/local-console/state?sessionId=default", url));
    latest = await response.json();
    if (response.ok && predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for mc-41 state: ${JSON.stringify(latest)}`);
}

function summarizeUserMessage(message: any): unknown {
  return {
    id: message.id,
    body: message.body,
    attachments: message.attachments.map((attachment: any) => ({
      attachmentId: attachment.attachmentId,
      displayName: attachment.displayName,
    })),
  };
}

function readStateDir(args: string[]): string {
  const index = args.indexOf("--state-dir");
  const value = index < 0 ? undefined : args[index + 1];
  if (value === undefined || value.trim() === "") {
    throw new Error("usage: stop-edit-resend-mc41.ts --state-dir <directory>");
  }
  return path.resolve(value);
}

async function startStaticServer(root: string): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer((request, response) => {
    void fs.readFile(path.join(root, new URL(request.url ?? "/", "http://127.0.0.1").pathname.slice(1) || "index.html"))
      .then((body) => {
        response.writeHead(200, { "content-type": contentType(request.url ?? "") });
        response.end(body);
      })
      .catch(() => {
        response.writeHead(404);
        response.end("Not found");
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("static server did not expose a port");
  return {
    url: `http://127.0.0.1:${String(address.port)}/`,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function contentType(url: string): string {
  if (url.includes(".css")) return "text/css; charset=utf-8";
  if (url.includes(".js")) return "text/javascript; charset=utf-8";
  return "text/html; charset=utf-8";
}
