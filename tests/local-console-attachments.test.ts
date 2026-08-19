import { Readable } from "node:stream";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAttachmentManager } from "../src/local-console/attachments.js";
import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("local managed attachments", () => {
  it("persists a managed file, atomically claims it, and prepares only a manifest entry", async () => {
    const fixture = await createFixture();
    const original = Buffer.from("ordinary attachment");
    const uploaded = await fixture.manager.upload({
      draftKey: "draft:local:test",
      displayName: "../../spec.pdf",
      mediaTypeHint: "application/pdf",
      stream: Readable.from([original]),
    });
    expect(uploaded.status).toBe("ready");
    if (uploaded.status !== "ready") throw new Error("expected ready attachment");
    expect(uploaded.attachment).toMatchObject({
      kind: "file",
      displayName: "spec.pdf",
      mediaType: "application/pdf",
    });
    expect(JSON.stringify(uploaded.attachment)).not.toContain(fixture.root);
    const restartedManager = new LocalAttachmentManager(
      path.join(fixture.root, ".state", "local-console-attachments"),
      fixture.store,
    );
    await restartedManager.init();
    expect(await restartedManager.listDraft("draft:local:test")).toEqual([uploaded.attachment]);

    const message = await fixture.store.appendUserMessage({
      sessionId: "local:test",
      body: "",
      attachmentIds: [uploaded.attachment.attachmentId],
      attachmentDraftKey: "draft:local:test",
      now: new Date().toISOString(),
    });
    expect(message.attachments).toEqual([uploaded.attachment]);
    expect(await fixture.manager.listDraft("draft:local:test")).toEqual([]);

    const runDir = path.join(fixture.root, "run");
    const prepared = await fixture.manager.prepareRunAttachments({ messages: [message], runDir });
    expect(prepared.imagePaths).toEqual([]);
    expect(prepared.promptSuffix).toContain("spec.pdf");
    expect(prepared.promptSuffix).toContain(path.join(runDir, "input-attachments"));
    const copied = path.join(runDir, "input-attachments", uploaded.attachment.attachmentId, "spec.pdf");
    expect(await fs.readFile(copied)).toEqual(original);
  });

  it("commits server-recognized SVG content through preview staging and falls back to an ordinary file", async () => {
    const fixture = await createFixture();
    const staged = await fixture.manager.upload({
      draftKey: "draft:local:test",
      displayName: "diagram.svg",
      mediaTypeHint: "text/plain",
      stream: Readable.from([Buffer.from(
        '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
        "utf8",
      )]),
    });
    expect(staged.status).toBe("preview-required");
    if (staged.status !== "preview-required") throw new Error("expected staged SVG");
    expect(staged).toMatchObject({ mediaType: "image/svg+xml", svg: true });
    expect(await fixture.manager.listDraft("draft:local:test")).toEqual([]);

    const attachment = await fixture.manager.fallbackSvgToFile({
      uploadId: staged.uploadId,
      draftKey: "draft:local:test",
    });
    expect(attachment).toMatchObject({
      kind: "file",
      displayName: "diagram.svg",
      mediaType: "image/svg+xml",
    });

    const message = await fixture.store.appendUserMessage({
      sessionId: "local:test",
      body: "",
      attachmentIds: [attachment.attachmentId],
      now: new Date().toISOString(),
    });
    const prepared = await fixture.manager.prepareRunAttachments({
      messages: [message],
      runDir: path.join(fixture.root, "run-svg"),
    });
    expect(prepared.imagePaths).toEqual([]);
    expect(prepared.promptSuffix).toContain("type=image/svg+xml");
  });

  it("rejects SVG fallback for non-SVG preview candidates and keeps them staged", async () => {
    const fixture = await createFixture();
    const staged = await fixture.manager.upload({
      draftKey: "draft:local:test",
      displayName: "screen.png",
      stream: Readable.from([pngHeader(32, 16)]),
    });
    if (staged.status !== "preview-required") throw new Error("expected staged image");
    expect(staged).toMatchObject({ svg: false });
    await expect(fixture.manager.fallbackSvgToFile({
      uploadId: staged.uploadId,
      draftKey: "draft:local:test",
    })).rejects.toThrow(/只有服务端识别的 SVG/u);
    expect(await fixture.manager.listDraft("draft:local:test")).toEqual([]);
  });

  it("keeps HTML masquerading as SVG on the ordinary file path without image capability", async () => {
    const fixture = await createFixture();
    const uploaded = await fixture.manager.upload({
      draftKey: "draft:local:test",
      displayName: "fake.svg",
      mediaTypeHint: "text/html",
      stream: Readable.from([Buffer.from("<html><body>not svg</body></html>", "utf8")]),
    });
    expect(uploaded.status).toBe("ready");
    if (uploaded.status !== "ready") throw new Error("expected ready file");
    expect(uploaded.attachment).toMatchObject({ kind: "file", mediaType: "text/html" });
    expect(await fixture.manager.previewPath({
      attachmentId: uploaded.attachment.attachmentId,
      sessionId: "local:test",
    })).toBeNull();
  });

  it("requires both derived preview tiers before an image becomes ready and maps it to imagePaths", async () => {
    const fixture = await createFixture();
    const original = pngHeader(32, 16);
    const staged = await fixture.manager.upload({
      draftKey: "draft:local:test",
      displayName: "screen.png",
      mediaTypeHint: "application/octet-stream",
      stream: Readable.from([original]),
    });
    expect(staged.status).toBe("preview-required");
    if (staged.status !== "preview-required") throw new Error("expected staged image");
    expect(staged).toMatchObject({ svg: false });
    expect(await fixture.manager.listDraft("draft:local:test")).toEqual([]);

    const afterThumbnail = await fixture.manager.finalizeImagePreview({
      uploadId: staged.uploadId,
      draftKey: "draft:local:test",
      preview: pngHeader(32, 16),
    });
    expect(afterThumbnail).toEqual({ status: "staged" });
    expect(await fixture.manager.listDraft("draft:local:test")).toEqual([]);

    const afterLarge = await fixture.manager.finalizeImagePreviewLarge({
      uploadId: staged.uploadId,
      draftKey: "draft:local:test",
      preview: pngHeader(32, 16),
    });
    expect(afterLarge.status).toBe("ready");
    if (afterLarge.status !== "ready") throw new Error("expected ready image");
    const attachment = afterLarge.attachment;
    expect(attachment.kind).toBe("image");

    const message = await fixture.store.appendUserMessage({
      sessionId: "local:test",
      body: "inspect",
      attachmentIds: [attachment.attachmentId],
      now: new Date().toISOString(),
    });
    const prepared = await fixture.manager.prepareRunAttachments({
      messages: [message],
      runDir: path.join(fixture.root, "run-image"),
    });
    expect(prepared.imagePaths).toHaveLength(1);
    expect(prepared.promptSuffix).toContain("timeline[0] image");
    expect(await fixture.manager.previewPath({
      attachmentId: attachment.attachmentId,
      sessionId: "local:test",
    })).toContain("preview");
    expect(await fixture.manager.previewPath({
      attachmentId: attachment.attachmentId,
      sessionId: "local:test",
      tier: "large",
    })).toContain("preview-large");
  });

  it("rejects derived previews beyond their tier budgets without committing", async () => {
    const fixture = await createFixture();
    const staged = await fixture.manager.upload({
      draftKey: "draft:local:test",
      displayName: "screen.png",
      stream: Readable.from([pngHeader(32, 16)]),
    });
    if (staged.status !== "preview-required") throw new Error("expected staged image");
    await expect(fixture.manager.finalizeImagePreview({
      uploadId: staged.uploadId,
      draftKey: "draft:local:test",
      preview: pngHeader(513, 16),
    })).rejects.toThrow(/时间线缩略图预览/u);
    await expect(fixture.manager.finalizeImagePreviewLarge({
      uploadId: staged.uploadId,
      draftKey: "draft:local:test",
      preview: Buffer.alloc(8 * 1024 * 1024 + 1),
    })).rejects.toThrow(/大图预览/u);
    expect(await fixture.manager.listDraft("draft:local:test")).toEqual([]);
  });

  it("binds staged image finalization to its original draft and redacts managed paths from IO failures", async () => {
    const fixture = await createFixture();
    const staged = await fixture.manager.upload({
      draftKey: "draft:local:test",
      displayName: "screen.png",
      stream: Readable.from([pngHeader(32, 16)]),
    });
    if (staged.status !== "preview-required") throw new Error("expected staged image");

    await expect(fixture.manager.finalizeImagePreview({
      uploadId: staged.uploadId,
      draftKey: "draft:local:other",
      preview: pngHeader(32, 16),
    })).rejects.toThrow(/不属于当前附件草稿/u);
    expect(await fixture.manager.listDraft("draft:local:test")).toEqual([]);
    expect(await fixture.manager.listDraft("draft:local:other")).toEqual([]);

    let missingError: unknown;
    try {
      await fixture.manager.finalizeImagePreview({
        uploadId: "00000000-0000-4000-8000-000000000000",
        draftKey: "draft:local:test",
        preview: pngHeader(32, 16),
      });
    } catch (error) {
      missingError = error;
    }
    expect(String(missingError)).not.toContain(fixture.root);
    expect(String(missingError)).toContain("图片预览保存失败");
  });

  it("redacts managed and run paths when a persisted attachment cannot be prepared", async () => {
    const fixture = await createFixture();
    const attachment = await uploadFile(fixture.manager, "draft:local:test", "missing.txt");
    const message = await fixture.store.appendUserMessage({
      sessionId: "local:test",
      body: "inspect",
      attachmentIds: [attachment.attachmentId],
      now: new Date().toISOString(),
    });
    await fs.rm(path.join(fixture.root, ".state", "local-console-attachments"), { recursive: true, force: true });
    const runDir = path.join(fixture.root, "sensitive-run-dir");
    let preparationError: unknown;
    try {
      await fixture.manager.prepareRunAttachments({ messages: [message], runDir });
    } catch (error) {
      preparationError = error;
    }
    expect(String(preparationError)).toContain("本地附件准备失败");
    expect(String(preparationError)).not.toContain(fixture.root);
    expect(String(preparationError)).not.toContain(runDir);
  });

  it("rolls back an entire message claim and rejects cross-session reference cloning", async () => {
    const fixture = await createFixture();
    const first = await uploadFile(fixture.manager, "draft:local:test", "one.txt");
    const second = await uploadFile(fixture.manager, "draft:local:test", "two.txt");
    await expect(fixture.store.appendUserMessage({
      sessionId: "local:test",
      body: "",
      attachmentIds: [first.attachmentId, "missing-ref", second.attachmentId],
      now: new Date().toISOString(),
    })).rejects.toThrow(/missing|belongs/u);
    expect((await fixture.manager.listDraft("draft:local:test")).map((item) => item.attachmentId)).toEqual([
      first.attachmentId,
      second.attachmentId,
    ]);
    expect(await fixture.store.listMessages("local:test")).toEqual([]);

    const sent = await fixture.store.appendUserMessage({
      sessionId: "local:test",
      body: "",
      attachmentIds: [first.attachmentId, second.attachmentId],
      now: new Date().toISOString(),
    });
    await fixture.store.createSession({
      sessionId: "local:other",
      projectId: "local",
      title: "other",
      now: new Date().toISOString(),
    });
    await expect(fixture.manager.cloneMessageAttachments({
      sessionId: "local:other",
      sourceMessageId: sent.id,
      targetDraftKey: "draft:local:other",
    })).rejects.toThrow(/same session|source/u);
    const clones = await fixture.manager.cloneMessageAttachments({
      sessionId: "local:test",
      sourceMessageId: sent.id,
      targetDraftKey: "draft:local:test",
    });
    expect(clones).toHaveLength(2);
    expect(clones.map((item) => item.attachmentId)).not.toEqual([first.attachmentId, second.attachmentId]);
    expect((await fixture.store.listMessages("local:test"))[0]?.attachments).toEqual([first, second]);
  });

  it("commits a GIF through the two-tier preview pipeline like any raster image", async () => {
    const fixture = await createFixture();
    const gif = Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.alloc(8)]);
    const staged = await fixture.manager.upload({
      draftKey: "draft:local:test",
      displayName: "loop.gif",
      mediaTypeHint: "application/octet-stream",
      stream: Readable.from([gif]),
    });
    expect(staged.status).toBe("preview-required");
    if (staged.status !== "preview-required") throw new Error("expected staged gif");
    expect(staged).toMatchObject({ mediaType: "image/gif", svg: false });
    const afterThumbnail = await fixture.manager.finalizeImagePreview({
      uploadId: staged.uploadId,
      draftKey: "draft:local:test",
      preview: pngHeader(32, 16),
    });
    expect(afterThumbnail).toEqual({ status: "staged" });
    const afterLarge = await fixture.manager.finalizeImagePreviewLarge({
      uploadId: staged.uploadId,
      draftKey: "draft:local:test",
      preview: pngHeader(32, 16),
    });
    expect(afterLarge.status).toBe("ready");
    if (afterLarge.status !== "ready") throw new Error("expected ready gif");
    expect(afterLarge.attachment).toMatchObject({ kind: "image", displayName: "loop.gif", mediaType: "image/gif" });
    const message = await fixture.store.appendUserMessage({
      sessionId: "local:test",
      body: "inspect",
      attachmentIds: [afterLarge.attachment.attachmentId],
      now: new Date().toISOString(),
    });
    const prepared = await fixture.manager.prepareRunAttachments({
      messages: [message],
      runDir: path.join(fixture.root, "run-gif"),
    });
    expect(prepared.imagePaths).toHaveLength(1);
  });

  it("rejects a stream over its high-water byte guard without creating a ready ref", async () => {
    const fixture = await createFixture();
    const bounded = new LocalAttachmentManager(
      path.join(fixture.root, ".state", "bounded-attachments"),
      fixture.store,
      4,
    );
    await bounded.init();
    await expect(bounded.upload({
      draftKey: "draft:local:test",
      displayName: "too-large.bin",
      stream: Readable.from([Buffer.from("123"), Buffer.from("45")]),
    })).rejects.toThrow(/安全处理/u);
    expect(await bounded.listDraft("draft:local:test")).toEqual([]);
  });
});

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-attachments-"));
  temporaryRoots.push(root);
  const store = await createSqliteLocalConsoleStore({
    sqlitePath: path.join(root, ".state", "local-console.sqlite"),
    timeoutMs: 10_000,
  });
  await store.init();
  await store.createSession({
    sessionId: "local:test",
    projectId: "local",
    title: "test",
    now: new Date().toISOString(),
  });
  const manager = new LocalAttachmentManager(path.join(root, ".state", "local-console-attachments"), store);
  await manager.init();
  return { root, store, manager };
}

async function uploadFile(manager: LocalAttachmentManager, draftKey: string, displayName: string) {
  const result = await manager.upload({
    draftKey,
    displayName,
    mediaTypeHint: "text/plain",
    stream: Readable.from([Buffer.from(displayName)]),
  });
  if (result.status !== "ready") throw new Error("expected ordinary file");
  return result.attachment;
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
