import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform, type Readable } from "node:stream";
import {
  LOCAL_CONSOLE_ATTACHMENT_MAX_BYTES,
  LOCAL_CONSOLE_ATTACHMENT_PREVIEW_MAX_BYTES,
  LOCAL_CONSOLE_ATTACHMENT_PREVIEW_MAX_EDGE,
  LOCAL_CONSOLE_ATTACHMENT_STAGING_TTL_MS,
} from "../config.js";
import {
  classifyAttachmentSourceHead,
  LOCAL_ATTACHMENT_SOURCE_HEAD_MAX_BYTES,
  planProviderImagePathEligibility,
  readPngDimensions,
} from "./attachment-plan.js";
export { readPngDimensions } from "./attachment-plan.js";
import type {
  LocalAttachment,
  LocalAttachmentContentRecord,
  LocalAttachmentKind,
  LocalAttachmentRemovalResult,
  LocalAttachmentStorageReconciliation,
  LocalConsoleMessage,
  LocalConsoleStore,
} from "./types.js";

export const LOCAL_ATTACHMENT_MAX_BYTES = LOCAL_CONSOLE_ATTACHMENT_MAX_BYTES;
export const LOCAL_ATTACHMENT_PREVIEW_MAX_BYTES = LOCAL_CONSOLE_ATTACHMENT_PREVIEW_MAX_BYTES;
export const LOCAL_ATTACHMENT_PREVIEW_MAX_EDGE = LOCAL_CONSOLE_ATTACHMENT_PREVIEW_MAX_EDGE;
export const LOCAL_ATTACHMENT_STAGING_TTL_MS = LOCAL_CONSOLE_ATTACHMENT_STAGING_TTL_MS;

interface AttachmentPersistenceStore {
  addDraftAttachment(input: {
    blobId: string;
    attachmentId: string;
    draftKey: string;
    kind: LocalAttachmentKind;
    displayName: string;
    mediaType: string;
    byteSize: number;
    sha256: string;
    storageKey: string;
    now: string;
  }): Promise<LocalAttachment>;
  listDraftAttachments(draftKey: string): Promise<LocalAttachment[]>;
  removeDraftAttachment(input: { attachmentId: string; draftKey: string }): Promise<LocalAttachmentRemovalResult>;
  cloneMessageAttachmentsToDraft(input: {
    sessionId: string;
    sourceMessageId: number;
    targetDraftKey: string;
    now: string;
  }): Promise<LocalAttachment[]>;
  getAttachmentContentRecord(input: {
    attachmentId: string;
    draftKey?: string;
    sessionId?: string;
  }): Promise<LocalAttachmentContentRecord | null>;
  listMessageAttachmentContentRecords(messageIds: number[]): Promise<LocalAttachmentContentRecord[]>;
  listAttachmentStorageKeys(): Promise<string[]>;
  pruneOrphanAttachmentBlobs(): Promise<LocalAttachmentStorageReconciliation>;
}

export type LocalAttachmentUploadResult =
  | { status: "ready"; attachment: LocalAttachment }
  | {
      status: "preview-required";
      uploadId: string;
      displayName: string;
      mediaType: string;
      byteSize: number;
    };

interface StagedMetadata {
  uploadId: string;
  draftKey: string;
  displayName: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
  kind: LocalAttachmentKind;
  createdAt: string;
}

export interface PreparedLocalAttachments {
  promptSuffix: string;
  imagePaths: string[];
}

export class LocalAttachmentManager {
  private readonly store: AttachmentPersistenceStore;

  constructor(
    readonly root: string,
    store: LocalConsoleStore,
    private readonly maxBytes = LOCAL_ATTACHMENT_MAX_BYTES,
    private readonly stagingTtlMs = LOCAL_ATTACHMENT_STAGING_TTL_MS,
  ) {
    this.store = requireAttachmentStore(store);
  }

  async init(now = new Date()): Promise<void> {
    try {
      await fs.mkdir(this.stagingRoot(), { recursive: true });
      await this.cleanup(now);
    } catch (error) {
      throw publicAttachmentError(error, "托管附件存储初始化失败");
    }
  }

  async upload(
    input: {
      draftKey: string;
      displayName: string;
      mediaTypeHint?: string;
      contentLength?: number;
      stream: Readable;
      now?: Date;
      isCancelled?: () => boolean;
    },
  ): Promise<LocalAttachmentUploadResult> {
    assertDraftKey(input.draftKey);
    if (input.contentLength !== undefined && input.contentLength > this.maxBytes) {
      throw new Error("附件超过系统可安全处理的单文件规模");
    }
    const uploadId = randomUUID();
    const stagingDir = this.safeStagingDirectory(uploadId);
    try {
      await fs.mkdir(stagingDir, { recursive: false });
    } catch (error) {
      throw publicAttachmentError(error, "附件上传失败，请重试");
    }
    const partialPath = path.join(stagingDir, "content.partial");
    const contentPath = path.join(stagingDir, "content");
    const digest = createHash("sha256");
    let byteSize = 0;
    const headChunks: Buffer[] = [];
    let headSize = 0;
    const writer = createWriteStream(partialPath, { flags: "wx" });

    try {
      for await (const rawChunk of input.stream) {
        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
        byteSize += chunk.byteLength;
        if (byteSize > this.maxBytes) {
          throw new Error("附件超过系统可安全处理的单文件规模");
        }
        digest.update(chunk);
        if (headSize < LOCAL_ATTACHMENT_SOURCE_HEAD_MAX_BYTES) {
          const slice = chunk.subarray(0, Math.min(chunk.length, LOCAL_ATTACHMENT_SOURCE_HEAD_MAX_BYTES - headSize));
          headChunks.push(slice);
          headSize += slice.length;
        }
        if (!writer.write(chunk)) {
          await new Promise<void>((resolve, reject) => {
            writer.once("drain", resolve);
            writer.once("error", reject);
          });
        }
      }
      await new Promise<void>((resolve, reject) => {
        writer.end(resolve);
        writer.once("error", reject);
      });
      await fs.rename(partialPath, contentPath);

      const detected = classifyAttachmentSourceHead(Buffer.concat(headChunks));
      const metadata: StagedMetadata = {
        uploadId,
        draftKey: input.draftKey,
        displayName: sanitizeDisplayName(input.displayName),
        mediaType: detected.mediaType ?? sanitizeMediaType(input.mediaTypeHint),
        byteSize,
        sha256: digest.digest("hex"),
        kind: detected.kind,
        createdAt: (input.now ?? new Date()).toISOString(),
      };
      await fs.writeFile(path.join(stagingDir, "metadata.json"), JSON.stringify(metadata), { flag: "wx" });
      if (input.isCancelled?.() === true) {
        throw new Error("附件上传已取消");
      }
      if (metadata.kind === "image") {
        return {
          status: "preview-required",
          uploadId,
          displayName: metadata.displayName,
          mediaType: metadata.mediaType,
          byteSize,
        };
      }
      const attachment = await this.commitStagedAttachment(stagingDir, metadata, input.draftKey);
      return { status: "ready", attachment };
    } catch (error) {
      writer.destroy();
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
      throw publicAttachmentError(error, "附件上传失败，请重试");
    }
  }

  async finalizeImagePreview(input: {
    uploadId: string;
    draftKey: string;
    preview: Buffer;
  }): Promise<LocalAttachment> {
    try {
      assertDraftKey(input.draftKey);
      if (input.preview.byteLength > LOCAL_ATTACHMENT_PREVIEW_MAX_BYTES) {
        throw new Error("图片预览超过 2 MiB 安全预算");
      }
      const dimensions = readPngDimensions(input.preview);
      if (
        dimensions === null
        || dimensions.width > LOCAL_ATTACHMENT_PREVIEW_MAX_EDGE
        || dimensions.height > LOCAL_ATTACHMENT_PREVIEW_MAX_EDGE
      ) {
        throw new Error("图片预览必须是最长边不超过 512px 的 PNG");
      }
      const stagingDir = this.safeStagingDirectory(input.uploadId);
      const metadata = await this.readStagedMetadata(stagingDir, input.uploadId);
      if (metadata.draftKey !== input.draftKey) {
        throw new Error("图片上传阶段不属于当前附件草稿");
      }
      if (metadata.kind !== "image") {
        throw new Error("普通文件不接受图片预览");
      }
      await fs.writeFile(path.join(stagingDir, "preview"), input.preview, { flag: "wx" });
      return await this.commitStagedAttachment(stagingDir, metadata, input.draftKey);
    } catch (error) {
      throw publicAttachmentError(error, "图片预览保存失败，请重试");
    }
  }

  async listDraft(draftKey: string): Promise<LocalAttachment[]> {
    assertDraftKey(draftKey);
    return await this.store.listDraftAttachments(draftKey);
  }

  async removeDraftAttachment(input: { attachmentId: string; draftKey: string }): Promise<boolean> {
    assertDraftKey(input.draftKey);
    const result = await this.store.removeDraftAttachment(input);
    if (result.orphanedStorageKey !== null) {
      const contentPath = this.resolveStorageKey(result.orphanedStorageKey);
      await fs.rm(path.dirname(contentPath), { recursive: true, force: true }).catch(() => undefined);
    }
    return result.removed;
  }

  async cloneMessageAttachments(input: {
    sessionId: string;
    sourceMessageId: number;
    targetDraftKey: string;
    now?: Date;
  }): Promise<LocalAttachment[]> {
    return await this.store.cloneMessageAttachmentsToDraft({
      sessionId: input.sessionId,
      sourceMessageId: input.sourceMessageId,
      targetDraftKey: input.targetDraftKey,
      now: (input.now ?? new Date()).toISOString(),
    });
  }

  async previewPath(input: {
    attachmentId: string;
    draftKey?: string;
    sessionId?: string;
  }): Promise<string | null> {
    const record = await this.store.getAttachmentContentRecord(input);
    if (record === null || record.kind !== "image") {
      return null;
    }
    const previewPath = path.join(path.dirname(this.resolveStorageKey(record.storageKey)), "preview");
    return this.assertWithinRoot(previewPath);
  }

  async prepareRunAttachments(input: {
    messages: LocalConsoleMessage[];
    runDir: string;
  }): Promise<PreparedLocalAttachments> {
    try {
      const records = await this.store.listMessageAttachmentContentRecords(input.messages.map((message) => message.id));
      if (records.length === 0) {
        return { promptSuffix: "", imagePaths: [] };
      }
      const runRoot = path.resolve(input.runDir, "input-attachments");
      await fs.mkdir(runRoot, { recursive: true });
      const messageIndexes = new Map(input.messages.map((message, index) => [message.id, index]));
      records.sort((left, right) => {
        const messageOrder = (messageIndexes.get(left.messageId ?? -1) ?? Number.MAX_SAFE_INTEGER)
          - (messageIndexes.get(right.messageId ?? -1) ?? Number.MAX_SAFE_INTEGER);
        return messageOrder === 0 ? left.position - right.position : messageOrder;
      });
      const manifest: string[] = ["", "本轮本地附件（路径仅在当前 runDir 内有效）："];
      const imagePaths: string[] = [];

      for (const record of records) {
        if (record.messageId === null) {
          throw new Error("附件运行准备遇到未归属消息的引用");
        }
        const source = this.resolveStorageKey(record.storageKey);
        const destinationDir = assertPathWithin(runRoot, path.resolve(runRoot, record.attachmentId));
        await fs.mkdir(destinationDir, { recursive: false });
        const destination = assertPathWithin(
          runRoot,
          path.resolve(destinationDir, sanitizeDisplayName(record.displayName)),
        );
        const copiedDigest = createHash("sha256");
        let copiedBytes = 0;
        await pipeline(
          createReadStream(source),
          new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              copiedBytes += chunk.byteLength;
              copiedDigest.update(chunk);
              callback(null, chunk);
            },
          }),
          createWriteStream(destination, { flags: "wx" }),
        );
        if (copiedBytes !== record.byteSize || copiedDigest.digest("hex") !== record.sha256) {
          throw new Error(`托管附件完整性校验失败：${record.displayName}`);
        }
        const timelineIndex = messageIndexes.get(record.messageId);
        manifest.push(
          `- timeline[${String(timelineIndex ?? -1)}] ${record.kind} ${JSON.stringify(record.displayName)}; `
            + `type=${record.mediaType}; bytes=${String(record.byteSize)}; path=${JSON.stringify(destination)}`,
        );
        if (planProviderImagePathEligibility(record)) {
          imagePaths.push(destination);
        }
      }
      return { promptSuffix: manifest.join("\n"), imagePaths };
    } catch (error) {
      throw publicAttachmentError(error, "本地附件准备失败，请重试");
    }
  }

  async cleanup(now = new Date()): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    await fs.mkdir(this.stagingRoot(), { recursive: true });
    const cutoff = now.getTime() - this.stagingTtlMs;
    await this.removeOldDirectories(this.stagingRoot(), cutoff);
    const reconciliation = await this.store.pruneOrphanAttachmentBlobs();
    const orphanedStorageKeys = reconciliation.orphanedStorageKeys;
    for (const storageKey of orphanedStorageKeys) {
      const contentPath = this.resolveStorageKey(storageKey);
      await fs.rm(path.dirname(contentPath), { recursive: true, force: true }).catch(() => undefined);
    }
    const storageKeys = new Set(reconciliation.liveStorageKeys);
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "staging") {
        continue;
      }
      const storageKey = `${entry.name}/content`;
      if (storageKeys.has(storageKey)) {
        continue;
      }
      const candidate = path.join(this.root, entry.name);
      const stat = await fs.stat(candidate).catch(() => null);
      if (stat !== null && stat.mtimeMs < cutoff) {
        await fs.rm(candidate, { recursive: true, force: true });
      }
    }
  }

  private async commitStagedAttachment(
    stagingDir: string,
    metadata: StagedMetadata,
    draftKey: string,
  ): Promise<LocalAttachment> {
    const blobId = randomUUID();
    const attachmentId = randomUUID();
    const destinationDir = this.safeBlobDirectory(blobId);
    const storageKey = `${blobId}/content`;
    await fs.rename(stagingDir, destinationDir);
    try {
      return await this.store.addDraftAttachment({
        blobId,
        attachmentId,
        draftKey,
        kind: metadata.kind,
        displayName: metadata.displayName,
        mediaType: metadata.mediaType,
        byteSize: metadata.byteSize,
        sha256: metadata.sha256,
        storageKey,
        now: metadata.createdAt,
      });
    } catch (error) {
      await fs.rm(destinationDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async readStagedMetadata(stagingDir: string, uploadId: string): Promise<StagedMetadata> {
    const raw = JSON.parse(await fs.readFile(path.join(stagingDir, "metadata.json"), "utf8")) as unknown;
    if (!isRecord(raw) || raw.uploadId !== uploadId) {
      throw new Error("图片上传阶段不存在或已过期");
    }
    return raw as unknown as StagedMetadata;
  }

  private resolveStorageKey(storageKey: string): string {
    if (!/^[0-9a-f-]+\/content$/u.test(storageKey)) {
      throw new Error("Invalid attachment storage key");
    }
    return this.assertWithinRoot(path.resolve(this.root, storageKey));
  }

  private safeStagingDirectory(uploadId: string): string {
    if (!/^[0-9a-f-]+$/u.test(uploadId)) {
      throw new Error("Invalid attachment upload id");
    }
    return this.assertWithinRoot(path.resolve(this.stagingRoot(), uploadId));
  }

  private safeBlobDirectory(blobId: string): string {
    if (!/^[0-9a-f-]+$/u.test(blobId)) {
      throw new Error("Invalid attachment blob id");
    }
    return this.assertWithinRoot(path.resolve(this.root, blobId));
  }

  private stagingRoot(): string {
    return path.join(this.root, "staging");
  }

  private assertWithinRoot(candidate: string): string {
    return assertPathWithin(path.resolve(this.root), path.resolve(candidate));
  }

  private async removeOldDirectories(directory: string, cutoff: number): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const candidate = path.join(directory, entry.name);
      const stat = await fs.stat(candidate).catch(() => null);
      if (stat !== null && stat.mtimeMs < cutoff) {
        await fs.rm(candidate, { recursive: true, force: true });
      }
    }
  }
}

export function supportsManagedAttachments(store: LocalConsoleStore): boolean {
  const candidate = store as Partial<AttachmentPersistenceStore>;
  return attachmentStoreMethods().every((method) => typeof candidate[method] === "function");
}

export function sanitizeDisplayName(value: string): string {
  const basename = path.basename(value.replaceAll("\\", "/"));
  const cleaned = basename.replace(/[\u0000-\u001f\u007f]/gu, "").trim();
  return (cleaned || "attachment").slice(0, 180);
}

function sanitizeMediaType(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(normalized)
    ? normalized
    : "application/octet-stream";
}

function assertDraftKey(value: string): void {
  if (!/^draft:[A-Za-z0-9:._-]+$/u.test(value)) {
    throw new Error("Invalid attachment draft key");
  }
}

function assertPathWithin(root: string, candidate: string): string {
  const relative = path.relative(root, candidate);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return candidate;
  }
  throw new Error("Attachment path escaped its allowed root");
}

function requireAttachmentStore(store: LocalConsoleStore): AttachmentPersistenceStore {
  const candidate = store as Partial<AttachmentPersistenceStore>;
  if (!attachmentStoreMethods().every((method) => typeof candidate[method] === "function")) {
    throw new Error("Local console store does not support managed attachments");
  }
  return candidate as AttachmentPersistenceStore;
}

function attachmentStoreMethods(): Array<keyof AttachmentPersistenceStore> {
  return [
    "addDraftAttachment",
    "listDraftAttachments",
    "removeDraftAttachment",
    "cloneMessageAttachmentsToDraft",
    "getAttachmentContentRecord",
    "listMessageAttachmentContentRecords",
    "listAttachmentStorageKeys",
    "pruneOrphanAttachmentBlobs",
  ];
}

function publicAttachmentError(error: unknown, fallback: string): Error {
  if (isRecord(error) && ("path" in error || "dest" in error)) {
    return new Error(fallback);
  }
  return error instanceof Error ? error : new Error(fallback);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
