import type { LocalAttachmentKind } from "./types.js";

export function planAttachmentDraftKey(input: {
  requestedDraftKey: string | undefined;
  sessionId: string;
}): string {
  return input.requestedDraftKey ?? `draft:${input.sessionId}`;
}

export function assertAttachmentCloneTarget(input: {
  targetDraftKey: string;
  sessionId: string;
}): void {
  if (input.targetDraftKey !== `draft:${input.sessionId}`) {
    throw new Error("Attachment target draft does not belong to the session");
  }
}

export function planAttachmentContentScopeValue(input: {
  draftKey?: string;
  sessionId?: string;
}): string {
  return input.draftKey ?? input.sessionId ?? "";
}

/**
 * 受限图片源判定的有界内容前缀上限（domain）：附件流只保留该字节数的头部用于
 * 内容识别，SVG 判定只在这个有界 UTF-8 前缀内找 XML/SVG 根，不信任扩展名或客户端 MIME。
 */
export const LOCAL_ATTACHMENT_SOURCE_HEAD_MAX_BYTES = 8192;

/** 服务端识别的 SVG 媒体类型；SVG 始终作为 manifest 普通文件（kind=file）提交。 */
export const SVG_MEDIA_TYPE = "image/svg+xml";
/** 服务端识别的 ICO 媒体类型（Windows 图标容器）。 */
export const ICO_MEDIA_TYPE = "image/x-icon";
/** 服务端识别的 BMP 媒体类型。 */
export const BMP_MEDIA_TYPE = "image/bmp";
/** 服务端识别的 AVIF 媒体类型。 */
export const AVIF_MEDIA_TYPE = "image/avif";

/**
 * 以普通文件提交、但可参与图片预览并可降级为 ready 普通文件的图片媒体类型
 * （domain）：与 SVG 同语义——不进 provider imagePaths、派生失败可降级普通文件。
 */
export const FILE_IMAGE_MEDIA_TYPES: readonly string[] = [
  SVG_MEDIA_TYPE,
  ICO_MEDIA_TYPE,
  BMP_MEDIA_TYPE,
  AVIF_MEDIA_TYPE,
];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ClassifiedAttachmentSource {
  /** 是否允许进入图片预览候选（需要 renderer 提交并服务端校验派生 PNG 后才能 ready）。 */
  previewCandidate: boolean;
  kind: LocalAttachmentKind;
  mediaType: string | null;
  /** 服务端是否在有界 UTF-8 前缀内识别为 SVG（只有这类 staging 项允许降级为普通文件）。 */
  svg: boolean;
}

/** 图片源判定（domain）：栅格格式只看 magic bytes，SVG 只在有界 UTF-8/XML 前缀内识别根元素；ICO/BMP/AVIF 与 SVG 同语义（kind=file + 可降级）。 */
export function classifyAttachmentSourceHead(head: Buffer): ClassifiedAttachmentSource {
  const prefix = head.subarray(0, LOCAL_ATTACHMENT_SOURCE_HEAD_MAX_BYTES);
  if (prefix.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { previewCandidate: true, kind: "image", mediaType: "image/png", svg: false };
  }
  if (prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) {
    return { previewCandidate: true, kind: "image", mediaType: "image/jpeg", svg: false };
  }
  const gif = prefix.toString("ascii", 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") {
    return { previewCandidate: true, kind: "image", mediaType: "image/gif", svg: false };
  }
  if (prefix.toString("ascii", 0, 4) === "RIFF" && prefix.toString("ascii", 8, 12) === "WEBP") {
    return { previewCandidate: true, kind: "image", mediaType: "image/webp", svg: false };
  }
  if (isSvgXmlRoot(prefix)) {
    return { previewCandidate: true, kind: "file", mediaType: SVG_MEDIA_TYPE, svg: true };
  }
  if (prefix.length >= 4 && prefix[0] === 0x00 && prefix[1] === 0x00 && prefix[2] === 0x01 && prefix[3] === 0x00) {
    return { previewCandidate: true, kind: "file", mediaType: ICO_MEDIA_TYPE, svg: true };
  }
  if (prefix.length >= 2 && prefix[0] === 0x42 && prefix[1] === 0x4d) {
    return { previewCandidate: true, kind: "file", mediaType: BMP_MEDIA_TYPE, svg: true };
  }
  if (
    prefix.length >= 12
    && prefix.toString("ascii", 4, 8) === "ftyp"
    && (prefix.toString("ascii", 8, 12) === "avif" || prefix.toString("ascii", 8, 12) === "avis")
  ) {
    return { previewCandidate: true, kind: "file", mediaType: AVIF_MEDIA_TYPE, svg: true };
  }
  return { previewCandidate: false, kind: "file", mediaType: null, svg: false };
}

/** PNG IHDR 宽高（domain）：只接受完整的 PNG 签名 + IHDR 块，非 PNG 或畸形返回 null。 */
export function readPngDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (
    bytes.length < 24
    || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
    || bytes.toString("ascii", 12, 16) !== "IHDR"
  ) {
    return null;
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

export type DerivedPreviewTier = "thumbnail" | "large";

export type DerivedPreviewValidation =
  | { ok: true; width: number; height: number }
  | { ok: false; reason: "bytes-exceeded" | "not-png" | "edge-exceeded" };

/**
 * 服务端生成的固定派生键（domain）：renderer 不提交文件名，只按档位读写固定键；
 * 两档齐备前候选不得成为 ready 图片。
 */
export function planDerivedPreviewFileName(tier: DerivedPreviewTier): "preview" | "preview-large" {
  return tier === "large" ? "preview-large" : "preview";
}

/**
 * 派生 PNG 校验（domain）：服务端只接受同时满足格式、尺寸与字节预算的派生文件。
 * 时间线缩略图与大图两档各自传入集中配置的 maxEdge/maxBytes 预算。
 */
export function planDerivedPreviewValidation(input: {
  bytes: Buffer;
  maxEdge: number;
  maxBytes: number;
}): DerivedPreviewValidation {
  if (input.bytes.byteLength > input.maxBytes) {
    return { ok: false, reason: "bytes-exceeded" };
  }
  const dimensions = readPngDimensions(input.bytes);
  if (dimensions === null) {
    return { ok: false, reason: "not-png" };
  }
  if (dimensions.width > input.maxEdge || dimensions.height > input.maxEdge) {
    return { ok: false, reason: "edge-exceeded" };
  }
  return { ok: true, ...dimensions };
}

export type FileImageFallbackPlan =
  | { ok: true; kind: "file"; mediaType: string }
  | { ok: false; reason: "not-file-image" };

/**
 * 文件类图片普通文件降级（domain）：只有服务端已识别的文件类图片 staging 项
 * （SVG/ICO/BMP/AVIF）可以降级为 ready 普通文件；损坏的 PNG/JPEG/GIF/WebP 或
 * 其他内容一律不能绕过失败状态。
 */
export function planFileImageFallbackMetadata(input: {
  kind: LocalAttachmentKind;
  mediaType: string;
  svg: boolean;
}): FileImageFallbackPlan {
  return input.kind === "file" && input.svg && FILE_IMAGE_MEDIA_TYPES.includes(input.mediaType)
    ? { ok: true, kind: "file", mediaType: input.mediaType }
    : { ok: false, reason: "not-file-image" };
}

/**
 * provider `imagePaths` 资格（domain）：只收服务端识别为原生栅格图片的附件；
 * SVG 即使有图片预览也只作为 manifest 普通文件进入 Agent 输入。
 */
export function planProviderImagePathEligibility(input: {
  kind: LocalAttachmentKind;
  mediaType: string;
}): boolean {
  return input.kind === "image"
    && (
      input.mediaType === "image/png"
      || input.mediaType === "image/jpeg"
      || input.mediaType === "image/gif"
      || input.mediaType === "image/webp"
    );
}

export interface LocalSourceFileFacts {
  size: number;
  mtimeMs: number;
  ino: number | null;
}

/**
 * 受限源读取的稳定文件事实判定（domain）：读取前后的 realpath/regular file
 * 事实不一致或实际读到的字节数与读取前 stat 不符时，视为读取期间变化，
 * 不得把两版内容拼接返回。
 */
export function planStableSourceRead(input: {
  before: LocalSourceFileFacts;
  after: LocalSourceFileFacts;
  bytesRead: number;
}): { kind: "stable" } | { kind: "changed" } {
  return input.before.size === input.after.size
    && input.before.size === input.bytesRead
    && input.before.mtimeMs === input.after.mtimeMs
    && input.before.ino === input.after.ino
    ? { kind: "stable" }
    : { kind: "changed" };
}

function isSvgXmlRoot(head: Buffer): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(head);
  } catch {
    return false;
  }
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let constructs = 0;
  for (;;) {
    index = skipXmlWhitespace(text, index);
    if (constructs > 0 && text.startsWith("<?xml", index)) {
      return false;
    }
    if (text.startsWith("<?xml", index)) {
      const prologueEnd = text.indexOf("?>", index + 5);
      if (prologueEnd === -1 || prologueEnd - index > 512) return false;
      index = prologueEnd + 2;
    } else if (text.startsWith("<!DOCTYPE", index)) {
      const doctypeEnd = text.indexOf(">", index + 9);
      if (doctypeEnd === -1 || doctypeEnd - index > 2048) return false;
      index = doctypeEnd + 1;
    } else if (text.startsWith("<!--", index)) {
      const commentEnd = text.indexOf("-->", index + 4);
      if (commentEnd === -1 || commentEnd - index > 2048) return false;
      index = commentEnd + 3;
    } else {
      break;
    }
    constructs += 1;
    if (constructs > 8) {
      return false;
    }
  }
  return isSvgRootStart(text, index);
}

function skipXmlWhitespace(text: string, index: number): number {
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      break;
    }
    index += 1;
  }
  return index;
}

function isSvgRootStart(text: string, index: number): boolean {
  if (!text.startsWith("<svg", index)) {
    return false;
  }
  const next = text.charCodeAt(index + 4);
  return next === 0x20 || next === 0x09 || next === 0x0a || next === 0x0d || next === 0x3e || next === 0x2f;
}
