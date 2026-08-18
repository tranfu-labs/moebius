import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodexRunOptions, CodexRunResult } from "../src/codex.js";
import { startLocalConsoleServer } from "../src/local-console/start.js";

const roots: string[] = [];
const LEGACY_ATTACHMENT_CAPABILITY_HEADER = ["x", "agent", "moebius", "attachment", "capability"].join("-");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("local attachment HTTP boundary", () => {
  it("guards attachment IO with a capability and sends only images through Codex imagePaths", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-attachment-api-"));
    roots.push(root);
    await fs.mkdir(path.join(root, "agents"), { recursive: true });
    await fs.writeFile(path.join(root, "agents", "dev.md"), "# Dev\n\nReply briefly.\n");
    const capability = "test-capability-never-log";
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => ({
      ok: true,
      finalText: "done",
      threadId: null,
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));
    let started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      attachmentCapability: capability,
      // 本用例只测附件边界；显式关闭标题生成，避免 create+initialMessage 的标题 one-shot 污染 runCodex spy
      // （与其他 local-console 测试的隔离口径一致）。
      enableSessionTitleGeneration: false,
      listAgentFiles: async () => [],
      loadAgentTeamSnapshot: async () => ({
        members: [
          { name: "manager", agentMarkdown: "# Manager\n\nROLE:manager" },
          { name: "qa", agentMarkdown: "# QA\n\nROLE:qa" },
        ],
      }),
      runCodex,
      storeTimeoutMs: 10_000,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
    });
    try {
      const forbidden = await fetch(new URL("api/local-console/attachments?draftKey=draft%3Anew", started.url));
      expect(forbidden.status).toBe(403);
      const legacyHeaderResponse = await fetch(
        new URL("api/local-console/attachments?draftKey=draft%3Anew", started.url),
        { headers: { [LEGACY_ATTACHMENT_CAPABILITY_HEADER]: capability } },
      );
      expect(legacyHeaderResponse.status).toBe(403);
      const preflight = await fetch(new URL("api/local-console/attachments", started.url), { method: "OPTIONS" });
      expect(preflight.headers.get("access-control-allow-headers")).toContain("x-moebius-attachment-capability");

      const missingPreview = await fetch(
        new URL("api/local-console/attachments/uploads/00000000-0000-4000-8000-000000000000/preview?draftKey=draft%3Anew", started.url),
        {
          method: "POST",
          headers: capabilityHeaders(capability, "image/png"),
          body: new Uint8Array(pngHeader(40, 20)),
        },
      );
      const missingPreviewBody = await missingPreview.text();
      expect(missingPreview.status).toBe(400);
      expect(missingPreviewBody).not.toContain(root);

      const imageUpload = await upload(started.url, capability, "screen.png", "image/png", pngHeader(40, 20));
      expect(imageUpload.status).toBe("preview-required");
      const imageFinalize = await fetch(
        new URL(`api/local-console/attachments/uploads/${encodeURIComponent(imageUpload.uploadId!)}/preview?draftKey=draft%3Anew`, started.url),
        {
          method: "POST",
          headers: capabilityHeaders(capability, "image/png"),
          body: new Uint8Array(pngHeader(40, 20)),
        },
      );
      const imageBody = await imageFinalize.json() as { attachment: { attachmentId: string } };
      expect(imageFinalize.status).toBe(201);

      const fileUpload = await upload(started.url, capability, "notes.pdf", "application/pdf", Buffer.from("pdf-body"));
      expect(fileUpload.status).toBe("ready");
      const attachmentIds = [imageBody.attachment.attachmentId, fileUpload.attachment!.attachmentId];
      const createResponse = await fetch(new URL("api/local-console/sessions", started.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: "local",
          initialMessage: "@qa inspect managed attachments",
          attachmentIds,
          agentTeamOwnership: "system",
          agentTeamId: "development",
        }),
      });
      const created = await createResponse.json() as { session: { sessionId: string; title: string } };
      expect(createResponse.status).toBe(201);
      expect(created.session.title).toBe("@qa inspect managed attachments");

      await vi.waitFor(() => expect(runCodex).toHaveBeenCalledOnce(), { timeout: 10_000 });
      const options = runCodex.mock.calls[0]![0];
      expect(options.imagePaths).toHaveLength(1);
      expect(options.imagePaths?.[0]).toContain("screen.png");
      expect(options.prompt).toContain("notes.pdf");
      expect(options.prompt).toContain("input-attachments");
      expect(options.prompt).toContain("ROLE:qa");
      expect(options.prompt).not.toContain("ROLE:manager");
      expect(options.imagePaths?.some((candidate) => candidate.includes("notes.pdf"))).toBe(false);

      const view = await fetch(new URL(`api/local-console/sessions/${encodeURIComponent(created.session.sessionId)}/view`, started.url));
      const viewBody = await view.json() as { messages: Array<{ attachments?: unknown[] }> };
      const attachmentPayload = JSON.stringify(viewBody.messages.flatMap((message) => message.attachments ?? []));
      expect(attachmentPayload).not.toContain(root);
      expect(attachmentPayload).not.toContain("storageKey");
      expect(attachmentPayload).not.toContain("blobId");
      expect(viewBody.messages.flatMap((message) => message.attachments ?? [])).toHaveLength(2);
      const factLogPath = path.join(
        root,
        "sessions",
        `${Buffer.from(created.session.sessionId, "utf8").toString("base64url")}.jsonl`,
      );
      const factLog = await fs.readFile(factLogPath, "utf8");
      expect(factLog).toContain(imageBody.attachment.attachmentId);
      expect(factLog).toContain(fileUpload.attachment!.attachmentId);
      const preview = await fetch(
        new URL(`api/local-console/attachments/${encodeURIComponent(imageBody.attachment.attachmentId)}/preview?sessionId=${encodeURIComponent(created.session.sessionId)}`, started.url),
        { headers: capabilityHeaders(capability) },
      );
      expect(preview.headers.get("content-type")).toBe("image/png");

      await started.close();
      started = await startLocalConsoleServer({
        projectRoot: root,
        port: 0,
        attachmentCapability: capability,
        runCodex,
        storeTimeoutMs: 10_000,
        makeRunDir: (count) => path.join(root, "runs", `restart-${String(count)}`),
      });
      const reopenedView = await fetch(
        new URL(`api/local-console/sessions/${encodeURIComponent(created.session.sessionId)}/view`, started.url),
      );
      const reopenedBody = await reopenedView.json() as { messages: Array<{ attachments?: unknown[] }> };
      expect(reopenedBody.messages.flatMap((message) => message.attachments ?? [])).toHaveLength(2);
      const reopenedPreview = await fetch(
        new URL(`api/local-console/attachments/${encodeURIComponent(imageBody.attachment.attachmentId)}/preview?sessionId=${encodeURIComponent(created.session.sessionId)}`, started.url),
        { headers: capabilityHeaders(capability) },
      );
      expect(reopenedPreview.status).toBe(200);
    } finally {
      await started.close();
    }
  }, 15_000);
});

async function upload(
  base: string,
  capability: string,
  displayName: string,
  mediaType: string,
  bytes: Buffer,
): Promise<{
  status: "ready" | "preview-required";
  uploadId?: string;
  attachment?: { attachmentId: string };
}> {
  const url = new URL("api/local-console/attachments", base);
  url.searchParams.set("draftKey", "draft:new");
  url.searchParams.set("displayName", displayName);
  const response = await fetch(url, {
    method: "POST",
    headers: capabilityHeaders(capability, mediaType),
    body: new Uint8Array(bytes),
  });
  expect([201, 202]).toContain(response.status);
  return await response.json() as {
    status: "ready" | "preview-required";
    uploadId?: string;
    attachment?: { attachmentId: string };
  };
}

function capabilityHeaders(capability: string, contentType?: string): Record<string, string> {
  return {
    "x-moebius-attachment-capability": capability,
    ...(contentType === undefined ? {} : { "content-type": contentType }),
  };
}

function pngHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
