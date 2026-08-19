import fs from "node:fs/promises";
import path from "node:path";

import { LOCAL_CONSOLE_AGENT_IMAGE_SOURCE_MAX_BYTES } from "../config.js";
import { classifyAttachmentSourceHead, planStableSourceRead } from "./attachment-plan.js";

export type LocalAgentImageSourceResult =
  | { available: true; mediaType: string; bytes: Buffer }
  | {
      available: false;
      reason:
        | "invalid-path"
        | "not-found"
        | "not-file"
        | "file-too-large"
        | "not-image"
        | "changed-during-read"
        | "unavailable";
    };

/**
 * 会话级 Agent 本地图片源读取（adapter）：只接受绝对本地路径，复用 realpath
 * 普通文件边界；读取前后校验同一稳定文件事实，并以集中配置的源字节上限读取。
 * 只有内容识别为 PNG/JPEG/GIF/WebP/SVG 的受限源 Blob 会被返回，其余一律
 * 结构化不可用，不返回其他本地内容。
 */
export async function readLocalAgentImageSource(input: {
  workspacePath: string;
  filePath: string;
  maxBytes?: number;
}): Promise<LocalAgentImageSourceResult> {
  if (!path.posix.isAbsolute(input.filePath) || input.filePath.includes("\0")) {
    return { available: false, reason: "invalid-path" };
  }
  let candidate: string;
  try {
    candidate = await fs.realpath(input.filePath);
    await fs.realpath(input.workspacePath);
  } catch (error) {
    return { available: false, reason: isMissingFileError(error) ? "not-found" : "unavailable" };
  }

  let before;
  try {
    before = await fs.stat(candidate);
  } catch (error) {
    return { available: false, reason: isMissingFileError(error) ? "not-found" : "unavailable" };
  }
  if (!before.isFile()) {
    return { available: false, reason: "not-file" };
  }

  const maxBytes = Math.max(1, input.maxBytes ?? LOCAL_CONSOLE_AGENT_IMAGE_SOURCE_MAX_BYTES);
  if (before.size > maxBytes) {
    return { available: false, reason: "file-too-large" };
  }

  let handle;
  try {
    handle = await fs.open(candidate, "r");
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);
    if (bytesRead > maxBytes) {
      return { available: false, reason: "file-too-large" };
    }
    let after;
    try {
      after = await fs.stat(candidate);
    } catch (error) {
      return { available: false, reason: isMissingFileError(error) ? "not-found" : "unavailable" };
    }
    if (planStableSourceRead({
      before: { size: before.size, mtimeMs: before.mtimeMs, ino: before.ino },
      after: { size: after.size, mtimeMs: after.mtimeMs, ino: after.ino },
      bytesRead,
    }).kind === "changed") {
      return { available: false, reason: "changed-during-read" };
    }
    const classified = classifyAttachmentSourceHead(buffer.subarray(0, bytesRead));
    if (!classified.previewCandidate || classified.mediaType === null) {
      return { available: false, reason: "not-image" };
    }
    return {
      available: true,
      mediaType: classified.mediaType,
      bytes: Buffer.from(buffer.subarray(0, bytesRead)),
    };
  } catch (error) {
    return { available: false, reason: isMissingFileError(error) ? "not-found" : "unavailable" };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error.code === "ENOENT" || error.code === "ENOTDIR");
}
