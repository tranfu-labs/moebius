import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OnboardingCliReadinessService } from "../desktop/src/onboarding/cli-readiness.js";
import { ClaudeTuiRuntime, runClaude, type ClaudeRunOptions } from "../src/claude.js";
import { ClaudeTuiLifecycleReceiver } from "../src/claude-tui-lifecycle.js";
import { createNodePtyFactory } from "../src/claude-tui-node-pty.js";
import type { ClaudeTuiPtyFactory } from "../src/claude-tui-transport.js";
import { LocalAttachmentManager } from "../src/local-console/attachments.js";
import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";
import { waitForValue } from "../src/testing/wait.js";

const enabled = process.env.MOEBIUS_REAL_CLAUDE === "1";
const trustedWorkspace = process.env.MOEBIUS_REAL_CLAUDE_TRUSTED_CWD;
const inferenceEnabled = enabled && trustedWorkspace !== undefined && trustedWorkspace.trim() !== "";
// This opt-in acceptance creates a temporary workspace that Claude Code may
// itself remember as trusted. Ordinary real-CLI checks keep it disabled.
const trustFlowEnabled = enabled && process.env.MOEBIUS_REAL_CLAUDE_TRUST_FLOW === "1";
const root = enabled
  ? await fs.mkdtemp(path.join(os.tmpdir(), "moebius-real-claude-"))
  : path.join(os.tmpdir(), "moebius-real-claude-disabled");
const evidence: Record<string, unknown> = {
  version: 1,
  readiness: false,
  full: false,
  resume: false,
  file: false,
  image: false,
  cancel: false,
  workspaceTrust: false,
  terminalTrace: false,
  inferenceSkippedWithoutTrustedWorkspace: !inferenceEnabled && !trustFlowEnabled,
};
let lifecycleServer: Server | null = null;
let lifecycleReceiver: ClaudeTuiLifecycleReceiver | null = null;
let claudeTuiRuntime: ClaudeTuiRuntime | null = null;

beforeAll(async () => {
  if (!enabled) return;
  lifecycleReceiver = new ClaudeTuiLifecycleReceiver();
  const receiver = lifecycleReceiver;
  lifecycleServer = createServer((request, response) => {
    void receiver.handle(request, response).then((handled) => {
      if (!handled && !response.writableEnded) {
        response.writeHead(404);
        response.end();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    lifecycleServer!.once("error", reject);
    lifecycleServer!.listen(0, "127.0.0.1", () => {
      lifecycleServer!.off("error", reject);
      resolve();
    });
  });
  const address = lifecycleServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected Claude lifecycle TCP listener");
  }
  receiver.setLoopbackOrigin(`http://127.0.0.1:${String(address.port)}/`);
  claudeTuiRuntime = new ClaudeTuiRuntime({ lifecycleReceiver: receiver });
});

afterAll(async () => {
  await claudeTuiRuntime?.close();
  if (lifecycleServer !== null) {
    await new Promise<void>((resolve, reject) => lifecycleServer!.close((error) => error === undefined ? resolve() : reject(error)));
  }
  lifecycleReceiver = null;
  if (!enabled) return;
  const evidencePath = path.join(root, "evidence.json");
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`CLAUDE_REAL_EVIDENCE=${evidencePath}\n`);
});

describe.runIf(enabled)("real Claude CLI adapter acceptance", { timeout: 180_000 }, () => {
  let sessionId = "";

  it("passes the product version and authentication readiness checks without inference", async () => {
    const readiness = new OnboardingCliReadinessService();
    const snapshot = await readiness.check("claude");
    expect(snapshot.status).toBe("ready");
    expect(snapshot.version).toMatch(/^\d+\.\d+\.\d+/u);
    evidence.readiness = true;
    evidence.cliVersion = snapshot.version;
  });

  it.runIf(trustFlowEnabled)("automatically confirms native workspace trust in one PTY, then resumes the exact session after idle", { timeout: 360_000 }, async () => {
    if (lifecycleReceiver === null) throw new Error("expected Claude lifecycle receiver");
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-real-claude-trust-flow-"));
    const launchArguments: string[][] = [];
    const exitedGenerations: number[] = [];
    const ptyWrites: string[][] = [];
    const runtime = new ClaudeTuiRuntime({
      lifecycleReceiver,
      createPtyFactory: async () => await createRecordingPtyFactory(launchArguments, exitedGenerations, ptyWrites),
      terminationGraceMs: 1_000,
    });
    let terminalByteCount = 0;
    let terminalTail = Buffer.alloc(0);
    const common = {
      cwd: workspace,
      profile: { cli: "claude" as const, model: "sonnet", effort: "high" as const },
      idleTimeoutMs: 2_000,
      maxDurationMs: 120_000,
      tuiRuntime: runtime,
      onTerminalData: (data: string | Uint8Array) => {
        const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
        terminalByteCount += bytes.byteLength;
        terminalTail = Buffer.concat([terminalTail, bytes]).subarray(-16 * 1024);
      },
    };

    try {
      const firstPrompt = [
        "Reply with exactly: FIRST_TOKEN alpha",
        "Do not use tools.",
      ].join("\n");
      const fullPromise = runClaude({
        ...common,
        prompt: firstPrompt,
        runDir: path.join(root, "trust-flow-full"),
        mode: { kind: "full" },
        // Product code intentionally has no fixed wall-clock kill switch for
        // live progress. This is only a bounded acceptance diagnostic so a
        // failed native prompt hand-off cannot leave this foreground test open.
        signal: AbortSignal.timeout(45_000),
        managedProcess: { sessionId: "real-trust-flow", providerRunId: "real-trust-flow-full" },
      });

      const full = await fullPromise;
      if (!full.ok) {
        const terminalTailPath = path.join(root, "trust-flow-terminal-tail.bin");
        await fs.writeFile(terminalTailPath, terminalTail);
        throw new Error(`real Claude trust-flow full turn did not complete (${full.reason}); terminal tail: ${terminalTailPath}`);
      }
      expect(full.finalText).toContain("FIRST_TOKEN alpha");
      expect(full.threadId).toMatch(/^[0-9a-f-]{36}$/iu);
      const sessionId = full.threadId!;
      expect(launchArguments).toHaveLength(1);
      expect(launchArguments[0]).toEqual(expect.arrayContaining(["--session-id", sessionId]));
      expect(ptyWrites[0]?.slice(0, 3)).toEqual(["\r", firstPrompt, "\r"]);
      evidence.workspaceTrust = true;
      evidence.terminalTrace = true;

      const live = await runClaude({
        ...common,
        prompt: "Recall alpha and reply with exactly: LIVE_PTY_TOKEN alpha",
        runDir: path.join(root, "trust-flow-live"),
        mode: { kind: "resume", externalSessionId: sessionId },
      });
      expect(live.ok).toBe(true);
      if (!live.ok) return;
      expect(live.threadId).toBe(sessionId);
      expect(live.finalText).toContain("LIVE_PTY_TOKEN alpha");
      // No second process or --resume is allowed while the original PTY is live.
      expect(launchArguments).toHaveLength(1);

      await waitForValue(() => exitedGenerations.includes(1) ? true : undefined, {
        describe: "idle Claude PTY exits before exact-session resume",
        kind: "io",
        timeoutMs: 15_000,
        snapshot: () => ({ launchCount: launchArguments.length, exitedGenerations }),
      });

      const afterIdle = await runClaude({
        ...common,
        prompt: "Recall alpha and reply with exactly: IDLE_RESUME_TOKEN alpha",
        runDir: path.join(root, "trust-flow-idle-resume"),
        mode: { kind: "resume", externalSessionId: sessionId },
      });
      expect(afterIdle.ok).toBe(true);
      if (!afterIdle.ok) return;
      expect(afterIdle.threadId).toBe(sessionId);
      expect(afterIdle.finalText).toContain("IDLE_RESUME_TOKEN alpha");
      expect(launchArguments).toHaveLength(2);
      expect(launchArguments[1]).toEqual(expect.arrayContaining(["--resume", sessionId]));
      expect(launchArguments[1]).not.toContain("--session-id");
      expect(terminalByteCount).toBeGreaterThan(0);

      evidence.trustFlow = {
        terminalByteCount,
        automaticTrustWrites: ptyWrites[0]?.filter((write) => write === "\r").length ?? 0,
        ptyGenerations: launchArguments.length,
        cacheReadInputTokens: {
          full: full.cachedInputTokens,
          live: live.cachedInputTokens,
          idleResume: afterIdle.cachedInputTokens,
        },
        session: createHash("sha256").update(sessionId).digest("hex").slice(0, 12),
      };
    } finally {
      await runtime.close();
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it.runIf(inferenceEnabled)("runs full and resumes the exact same external session in a user-pretrusted workspace", async () => {
    const full = await runRealClaude({
      prompt: "Reply with exactly: FULL_OK alpha",
      runDir: path.join(root, "full"),
      cwd: trustedWorkspace!,
      profile: { cli: "claude", model: "sonnet", effort: "high" },
      mode: { kind: "full" },
      idleTimeoutMs: 60_000,
      maxDurationMs: 120_000,
    });
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    expect(full.finalText).toContain("FULL_OK alpha");
    expect(full.threadId).toMatch(/^[0-9a-f-]{36}$/iu);
    sessionId = full.threadId!;
    evidence.full = true;
    evidence.fullCachedInputTokens = full.cachedInputTokens;
    evidence.session = createHash("sha256").update(sessionId).digest("hex").slice(0, 12);

    const resumed = await runRealClaude({
      prompt: "Recall the token from your previous reply. Reply with exactly: RESUME_OK alpha",
      runDir: path.join(root, "resume"),
      cwd: trustedWorkspace!,
      profile: { cli: "claude", model: "sonnet", effort: "high" },
      mode: { kind: "resume", externalSessionId: sessionId },
      idleTimeoutMs: 60_000,
      maxDurationMs: 120_000,
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.threadId).toBe(sessionId);
    expect(resumed.finalText).toContain("RESUME_OK alpha");
    evidence.resume = true;
    evidence.resumeCachedInputTokens = resumed.cachedInputTokens;
  });

  it.runIf(inferenceEnabled)("reads a managed PNG and ordinary file in a user-pretrusted workspace", async () => {
    const runDir = path.join(root, "attachments");
    const store = await createSqliteLocalConsoleStore({
      sqlitePath: path.join(root, "attachments.sqlite"),
      timeoutMs: 10_000,
    });
    await store.init();
    await store.createSession({
      sessionId: "local:claude-real-attachments",
      projectId: "local",
      title: "Claude real attachments",
      now: new Date().toISOString(),
    });
    const manager = new LocalAttachmentManager(path.join(root, "managed-attachments"), store);
    await manager.init();
    const fileUpload = await manager.upload({
      draftKey: "draft:claude-real",
      displayName: "fact.txt",
      mediaTypeHint: "text/plain",
      stream: Readable.from([Buffer.from("MOEBIUS_FILE_FACT_7429\n")]),
    });
    expect(fileUpload.status).toBe("ready");
    if (fileUpload.status !== "ready") return;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=",
      "base64",
    );
    const imageUpload = await manager.upload({
      draftKey: "draft:claude-real",
      displayName: "red.png",
      mediaTypeHint: "image/png",
      stream: Readable.from([png]),
    });
    expect(imageUpload.status).toBe("preview-required");
    if (imageUpload.status !== "preview-required") return;
    const imageStaged = await manager.finalizeImagePreview({
      uploadId: imageUpload.uploadId,
      draftKey: "draft:claude-real",
      preview: png,
    });
    expect(imageStaged.status).toBe("staged");
    const imageResult = await manager.finalizeImagePreviewLarge({
      uploadId: imageUpload.uploadId,
      draftKey: "draft:claude-real",
      preview: png,
    });
    if (imageResult.status !== "ready") return;
    const image = imageResult.attachment;
    const message = await store.appendUserMessage({
      sessionId: "local:claude-real-attachments",
      body: "inspect",
      attachmentIds: [fileUpload.attachment.attachmentId, image.attachmentId],
      attachmentDraftKey: "draft:claude-real",
      now: new Date().toISOString(),
    });
    const prepared = await manager.prepareRunAttachments({ messages: [message], runDir });
    expect(prepared.imagePaths).toHaveLength(1);
    const result = await runRealClaude({
      prompt: [
        "Use the Read tool on both managed attachments.",
        prepared.promptSuffix,
        "Reply with both markers: FILE=MOEBIUS_FILE_FACT_7429 and IMAGE=PNG.",
      ].join("\n"),
      runDir,
      cwd: trustedWorkspace!,
      profile: { cli: "claude", model: "sonnet", effort: "high" },
      mode: { kind: "full" },
      idleTimeoutMs: 60_000,
      maxDurationMs: 120_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.finalText).toContain("FILE=MOEBIUS_FILE_FACT_7429");
    expect(result.finalText).toContain("IMAGE=PNG");
    evidence.file = true;
    evidence.image = true;
  });

  it("cancels a real initialized process within the bounded escalation", async () => {
    const controller = new AbortController();
    let initialized = false;
    const result = await runRealClaude({
      prompt: "Inspect the workspace thoroughly before answering with CANCEL_TOO_LATE.",
      runDir: path.join(root, "cancel"),
      cwd: root,
      profile: { cli: "claude", model: "sonnet", effort: "high" },
      mode: { kind: "full" },
      signal: controller.signal,
      interruptTerminationDelayMs: 500,
      interruptKillDelayMs: 500,
      idleTimeoutMs: 60_000,
      maxDurationMs: 120_000,
      onSessionStarted: () => {
        initialized = true;
        controller.abort();
      },
    });
    expect(initialized).toBe(true);
    expect(result).toMatchObject({ ok: false, reason: "claude-cancelled" });
    evidence.cancel = true;
  });
});

async function runRealClaude(options: ClaudeRunOptions): Promise<Awaited<ReturnType<typeof runClaude>>> {
  if (claudeTuiRuntime === null) throw new Error("Claude TUI acceptance runtime was not initialized");
  return await runClaude({ ...options, tuiRuntime: claudeTuiRuntime });
}

async function createRecordingPtyFactory(
  launchArguments: string[][],
  exitedGenerations: number[],
  writesByGeneration: string[][],
): Promise<ClaudeTuiPtyFactory> {
  const delegate = await createNodePtyFactory();
  return {
    spawn(options) {
      launchArguments.push([...options.args]);
      const generation = launchArguments.length;
      writesByGeneration.push([]);
      const pty = delegate.spawn(options);
      return {
        write(data) {
          writesByGeneration[generation - 1]!.push(data);
          pty.write(data);
        },
        resize(columns, rows) {
          pty.resize(columns, rows);
        },
        kill(signal) {
          pty.kill(signal);
        },
        onData(listener) {
          return pty.onData(listener);
        },
        onExit(listener) {
          return pty.onExit((event) => {
            exitedGenerations.push(generation);
            listener(event);
          });
        },
      };
    },
  };
}
