import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";

import { OnboardingCliReadinessService } from "../desktop/src/onboarding/cli-readiness.js";
import { runClaude } from "../src/claude.js";
import { LocalAttachmentManager } from "../src/local-console/attachments.js";
import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";

const enabled = process.env.MOEBIUS_REAL_CLAUDE === "1";
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
};

afterAll(async () => {
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

  it("runs full and resumes the exact same external session", async () => {
    const full = await runClaude({
      prompt: "Reply with exactly: FULL_OK alpha",
      runDir: path.join(root, "full"),
      cwd: root,
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
    evidence.session = createHash("sha256").update(sessionId).digest("hex").slice(0, 12);

    const resumed = await runClaude({
      prompt: "Recall the token from your previous reply. Reply with exactly: RESUME_OK alpha",
      runDir: path.join(root, "resume"),
      cwd: root,
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
  });

  it("reads a managed PNG and ordinary file", async () => {
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
    const result = await runClaude({
      prompt: [
        "Use the Read tool on both managed attachments.",
        prepared.promptSuffix,
        "Reply with both markers: FILE=MOEBIUS_FILE_FACT_7429 and IMAGE=PNG.",
      ].join("\n"),
      runDir,
      cwd: root,
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
    const result = await runClaude({
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
