import { ManagedAttachmentFailure } from "./managed-attachment-model.js";

export const ATTACHMENT_PREVIEW_MAX_EDGE = 512;
export const ATTACHMENT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
export const ATTACHMENT_PREVIEW_LARGE_MAX_EDGE = 2048;
export const ATTACHMENT_PREVIEW_LARGE_MAX_BYTES = 8 * 1024 * 1024;

export const ATTACHMENT_SOURCE_HEAD_MAX_BYTES = 8192;

/** File-class image media types that render as previews but commit as ordinary files (like SVG). */
export const FILE_IMAGE_MEDIA_TYPES: readonly string[] = [
  "image/svg+xml",
  "image/x-icon",
  "image/bmp",
  "image/avif",
];

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ImagePreviewDependencies {
  /**
   * Decodes the source; `maxEdge` is the tier edge the caller will encode from this
   * decode (thumbnail 512 / large 2048) so vector sources (SVG) can rasterize at the
   * tier budget instead of Chromium's default replaced-element size.
   */
  decode(file: Blob, maxEdge: number): Promise<{ width: number; height: number; source: CanvasImageSource; close(): void }>;
  encode(source: CanvasImageSource, width: number, height: number): Promise<Blob>;
}

export interface DerivedPngPreviews {
  thumbnail: Blob;
  large: Blob;
}

/** Two-tier derivation (desktop domain): encode thumbnail and large PNG tiers from the same decoded source. */
export async function createBoundedPngPreviews(
  file: File,
  dependencies: ImagePreviewDependencies = browserPreviewDependencies(),
): Promise<DerivedPngPreviews | null> {
  if (!(await hasSupportedImageSignature(file))) {
    return null;
  }
  const decoded = await dependencies.decode(file, ATTACHMENT_PREVIEW_LARGE_MAX_EDGE).catch((error) => {
    // A renderer-side file-class image (SVG/ICO/BMP/AVIF) that cannot be decoded must
    // fall back to the server-recognized ordinary-file path instead of failing the upload;
    // raster failures keep their failure semantics.
    if (FILE_IMAGE_MEDIA_TYPES.includes(file.type)) return null;
    throw error;
  });
  if (decoded === null) {
    return null;
  }
  try {
    const thumbnail = await encodeWithinBudget(
      dependencies,
      decoded.source,
      decoded.width,
      decoded.height,
      ATTACHMENT_PREVIEW_MAX_EDGE,
      ATTACHMENT_PREVIEW_MAX_BYTES,
    );
    const large = await encodeWithinBudget(
      dependencies,
      decoded.source,
      decoded.width,
      decoded.height,
      ATTACHMENT_PREVIEW_LARGE_MAX_EDGE,
      ATTACHMENT_PREVIEW_LARGE_MAX_BYTES,
    );
    return { thumbnail, large };
  } catch (error) {
    if (FILE_IMAGE_MEDIA_TYPES.includes(file.type)) return null;
    throw error;
  } finally {
    decoded.close();
  }
}

export async function createBoundedPngPreview(
  file: File,
  dependencies: ImagePreviewDependencies = browserPreviewDependencies(),
): Promise<Blob | null> {
  if (!(await hasSupportedImageSignature(file))) {
    return null;
  }
  const decoded = await dependencies.decode(file, ATTACHMENT_PREVIEW_MAX_EDGE);
  try {
    return await encodeWithinBudget(
      dependencies,
      decoded.source,
      decoded.width,
      decoded.height,
      ATTACHMENT_PREVIEW_MAX_EDGE,
      ATTACHMENT_PREVIEW_MAX_BYTES,
    );
  } finally {
    decoded.close();
  }
}

async function encodeWithinBudget(
  dependencies: ImagePreviewDependencies,
  source: CanvasImageSource,
  width: number,
  height: number,
  maxEdge: number,
  maxBytes: number,
): Promise<Blob> {
  let { width: targetWidth, height: targetHeight } = fitWithin(width, height, maxEdge);
  while (targetWidth >= 1 && targetHeight >= 1) {
    const preview = await dependencies.encode(source, targetWidth, targetHeight);
    if (preview.type === "image/png" && preview.size <= maxBytes) {
      return preview;
    }
    if (targetWidth === 1 && targetHeight === 1) {
      break;
    }
    targetWidth = Math.max(1, Math.floor(targetWidth * 0.75));
    targetHeight = Math.max(1, Math.floor(targetHeight * 0.75));
  }
  throw new ManagedAttachmentFailure("image-preview-budget");
}

/** Bounded image source predicate (desktop domain): raster magic bytes; SVG root within a bounded UTF-8/XML prefix. */
export async function hasSupportedImageSignature(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, ATTACHMENT_SOURCE_HEAD_MAX_BYTES).arrayBuffer());
  if (startsWith(head, PNG_SIGNATURE)) return true;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return true;
  const ascii = new TextDecoder("ascii").decode(head);
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return true;
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return true;
  if (head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x01 && head[3] === 0x00) return true;
  if (head[0] === 0x42 && head[1] === 0x4d) return true;
  if (ascii.slice(4, 8) === "ftyp" && (ascii.slice(8, 12) === "avif" || ascii.slice(8, 12) === "avis")) return true;
  return looksLikeSvgXml(head);
}

export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new ManagedAttachmentFailure("image-dimensions-invalid");
  }
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function browserPreviewDependencies(): ImagePreviewDependencies {
  return {
    async decode(file, maxEdge) {
      // SVG always decodes through the <img> vector path (Chromium rejects
      // createImageBitmap on SVG blobs); routing on the media type keeps the
      // vector re-rasterization deterministic instead of relying on that failure.
      if (file.type === SVG_MEDIA_TYPE) {
        return await decodeSvgImage(file, maxEdge);
      }
      try {
        const bitmap = await createImageBitmap(file);
        return {
          width: bitmap.width,
          height: bitmap.height,
          source: bitmap,
          close: () => bitmap.close(),
        };
      } catch {
        // A mislabeled file-class image (e.g. SVG served as text/plain) still gets
        // the same decode treatment as the server-classified SVG path above.
        return await decodeSvgImage(file, maxEdge);
      }
    },
    async encode(source, width, height) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (context === null) throw new ManagedAttachmentFailure("image-preview-canvas");
      context.drawImage(source, 0, 0, width, height);
      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob === null
          ? reject(new ManagedAttachmentFailure("image-preview-encode"))
          : resolve(blob), "image/png");
      });
    },
  };
}

const SVG_MEDIA_TYPE = "image/svg+xml";

/**
 * SVG decode with a bounded vector re-rasterization (desktop domain): when the root
 * tag lacks explicit absolute width/height and carries a viewBox, the root tag is
 * rewritten to declare the viewBox size fitted to the tier edge, so Chromium
 * rasterizes the vector at that resolution (crisp at 1x on Retina) instead of the
 * 300×150 default replaced-element box. A failed rewrite falls back to the original
 * bytes, keeping the existing degradation semantics.
 */
async function decodeSvgImage(file: Blob, maxEdge: number): Promise<{
  width: number;
  height: number;
  source: CanvasImageSource;
  close(): void;
}> {
  const prefix = new Uint8Array(await file.slice(0, ATTACHMENT_SOURCE_HEAD_MAX_BYTES).arrayBuffer());
  const info = parseSvgRootTag(prefix);
  const target = info === null ? null : planSvgRasterTarget(info, maxEdge);
  if (info !== null && target !== null) {
    const rewritten = rewriteSvgRootSize(prefix, info, target.width, target.height);
    const rewrittenFile = new Blob([rewritten, file.slice(prefix.byteLength)], {
      type: SVG_MEDIA_TYPE,
    });
    try {
      return await decodeSvgBlob(rewrittenFile);
    } catch {
      // Fall back to the original bytes; a rewrite surprise must not regress
      // previewability for SVGs that decode today.
    }
  }
  return await decodeSvgBlob(file);
}

/** SVG decodes only in an <img> image context from a Blob URL, then draws to Canvas; never inserted into the DOM. */
async function decodeSvgBlob(file: Blob): Promise<{
  width: number;
  height: number;
  source: CanvasImageSource;
  close(): void;
}> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new ManagedAttachmentFailure("image-preview-decode"));
      image.src = url;
    });
    if (!Number.isFinite(image.naturalWidth) || !Number.isFinite(image.naturalHeight)
      || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      throw new ManagedAttachmentFailure("image-preview-decode");
    }
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      source: image,
      close: () => {
        image.src = "";
        URL.revokeObjectURL(url);
      },
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export interface SvgRootTagInfo {
  /** Byte offset just past the `<svg` tag name (insertion point for missing width/height). */
  tagNameEnd: number;
  /** Byte spans of the root tag's attributes (token start through the closing quote/value). */
  attrs: Map<string, { start: number; end: number; value: string }>;
}

export interface SvgRasterTarget {
  width: number;
  height: number;
}

/**
 * Root `<svg>` open-tag parser (desktop domain): byte-space scanning so attribute
 * values of any encoding round-trip untouched; the bounded prefix is guaranteed to
 * contain the root tag name by `hasSupportedImageSignature`. Returns null when the
 * tag cannot be located or parsed (caller keeps the original decode behavior).
 */
export function parseSvgRootTag(bytes: Uint8Array<ArrayBuffer>): SvgRootTagInfo | null {
  const svgStart = findSvgRootStart(bytes);
  if (svgStart === -1) return null;
  const tagEnd = findRootTagEnd(bytes, svgStart);
  if (tagEnd === -1) return null;
  const attrs = new Map<string, { start: number; end: number; value: string }>();
  let index = svgStart + 4;
  while (index < tagEnd) {
    index = skipAsciiWhitespace(bytes, index, tagEnd);
    if (index >= tagEnd || bytes[index] === 0x2f /* '/' */) break;
    if (!isXmlNameStart(bytes[index]!)) return null;
    const nameStart = index;
    index += 1;
    while (index < tagEnd && isXmlNameChar(bytes[index]!)) index += 1;
    const name = utf8Text(bytes, nameStart, index);
    index = skipAsciiWhitespace(bytes, index, tagEnd);
    if (index >= tagEnd || bytes[index] !== 0x3d /* '=' */) return null;
    index += 1;
    index = skipAsciiWhitespace(bytes, index, tagEnd);
    if (index >= tagEnd) return null;
    let valueStart = index;
    let valueEnd: number;
    const quote = bytes[index]!;
    if (quote === 0x22 /* '"' */ || quote === 0x27 /* "'" */) {
      valueStart = index + 1;
      const closing = findByte(bytes, quote, valueStart, tagEnd);
      if (closing === -1) return null;
      valueEnd = closing;
      index = closing + 1;
    } else {
      index += 1;
      while (index < tagEnd
        && !isAsciiWhitespace(bytes[index]!)
        && bytes[index] !== 0x3e /* '>' */
        && bytes[index] !== 0x2f /* '/' */) {
        index += 1;
      }
      valueEnd = index;
    }
    attrs.set(name, { start: nameStart, end: index, value: utf8Text(bytes, valueStart, valueEnd) });
  }
  return { tagNameEnd: svgStart + 4, attrs };
}

/**
 * Rasterization target plan (desktop domain): explicit absolute width/height keep the
 * declared design size (no rewrite, matching raster images); otherwise a viewBox
 * drives a fit-to-edge target so the vector re-rasterizes at the tier budget instead
 * of Chromium's default replaced-element box. Returns null when no rewrite applies.
 */
export function planSvgRasterTarget(info: SvgRootTagInfo, maxEdge: number): SvgRasterTarget | null {
  const widthAttr = info.attrs.get("width");
  const heightAttr = info.attrs.get("height");
  const absoluteWidth = widthAttr === undefined ? null : parseAbsoluteLength(widthAttr.value);
  const absoluteHeight = heightAttr === undefined ? null : parseAbsoluteLength(heightAttr.value);
  if (absoluteWidth !== null && absoluteHeight !== null) {
    return null;
  }
  const viewBoxAttr = info.attrs.get("viewBox");
  if (viewBoxAttr === undefined) return null;
  const viewBox = parseViewBoxSize(viewBoxAttr.value);
  if (viewBox === null) return null;
  return fitToEdge(viewBox.width, viewBox.height, maxEdge);
}

/**
 * Root-tag width/height rewrite (desktop domain): replaces existing attribute tokens
 * in place and inserts missing ones right after the tag name; everything outside the
 * tokens is preserved byte-for-byte. Never called without a plan, so it always yields
 * a rewritten prefix.
 */
export function rewriteSvgRootSize(
  bytes: Uint8Array<ArrayBuffer>,
  info: SvgRootTagInfo,
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  const widthToken = info.attrs.get("width");
  const heightToken = info.attrs.get("height");
  const encoder = new TextEncoder();
  const edits: Array<{ start: number; end: number; token: Uint8Array }> = [];
  if (widthToken !== undefined) {
    edits.push({ start: widthToken.start, end: widthToken.end, token: encoder.encode(`width="${String(width)}"`) });
  }
  if (heightToken !== undefined) {
    edits.push({ start: heightToken.start, end: heightToken.end, token: encoder.encode(`height="${String(height)}"`) });
  }
  edits.sort((left, right) => right.start - left.start);
  let result = bytes;
  for (const edit of edits) {
    result = concatBytes(result.slice(0, edit.start), edit.token, result.slice(edit.end));
  }
  if (widthToken === undefined || heightToken === undefined) {
    const missing = `${widthToken === undefined ? ` width="${String(width)}"` : ""}${heightToken === undefined ? ` height="${String(height)}"` : ""}`;
    result = concatBytes(result.slice(0, info.tagNameEnd), encoder.encode(missing), result.slice(info.tagNameEnd));
  }
  return result;
}

/** Unitless or px lengths count as explicit absolute SVG sizes; anything else (%, em, auto, …) does not. */
function parseAbsoluteLength(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(?:px)?$/u.exec(trimmed);
  if (match === null) return null;
  const size = Number(match[1]);
  return Number.isFinite(size) && size > 0 ? size : null;
}

/** viewBox accepts two or four numbers; only the width/height pair (last two) matters. */
function parseViewBoxSize(value: string): { width: number; height: number } | null {
  const tokens = value.trim().split(/[\s,]+/u);
  if (tokens.length !== 2 && tokens.length !== 4) return null;
  const numbers = tokens.map(Number);
  if (numbers.some((number) => !Number.isFinite(number))) return null;
  const width = numbers[numbers.length - 2]!;
  const height = numbers[numbers.length - 1]!;
  if (!(width > 0) || !(height > 0)) return null;
  return { width, height };
}

function fitToEdge(width: number, height: number, maxEdge: number): SvgRasterTarget {
  const scale = maxEdge / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function findSvgRootStart(bytes: Uint8Array): number {
  for (let index = 0; index + 4 < bytes.length; index += 1) {
    if (bytes[index] !== 0x3c /* '<' */) continue;
    if (bytes[index + 1] !== 0x73 /* 's' */ || bytes[index + 2] !== 0x76 /* 'v' */ || bytes[index + 3] !== 0x67 /* 'g' */) {
      continue;
    }
    const next = bytes[index + 4]!;
    if (next === 0x20 || next === 0x09 || next === 0x0a || next === 0x0d || next === 0x3e || next === 0x2f) {
      return index;
    }
  }
  return -1;
}

function findRootTagEnd(bytes: Uint8Array, start: number): number {
  let quote = 0;
  for (let index = start + 4; index < bytes.length; index += 1) {
    const byte = bytes[index]!;
    if (quote !== 0) {
      if (byte === quote) quote = 0;
    } else if (byte === 0x22 || byte === 0x27) {
      quote = byte;
    } else if (byte === 0x3e /* '>' */) {
      return index;
    }
  }
  return -1;
}

function skipAsciiWhitespace(bytes: Uint8Array, index: number, end: number): number {
  while (index < end && isAsciiWhitespace(bytes[index]!)) index += 1;
  return index;
}

function isAsciiWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

function isXmlNameStart(byte: number): boolean {
  return (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || byte === 0x5f || byte === 0x3a;
}

function isXmlNameChar(byte: number): boolean {
  return isXmlNameStart(byte) || (byte >= 0x30 && byte <= 0x39) || byte === 0x2d || byte === 0x2e;
}

function findByte(bytes: Uint8Array, byte: number, start: number, end: number): number {
  for (let index = start; index < end; index += 1) {
    if (bytes[index] === byte) return index;
  }
  return -1;
}

function utf8Text(bytes: Uint8Array, start: number, end: number): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(start, end));
}

function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (const part of parts) total += part.byteLength;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function looksLikeSvgXml(head: Uint8Array): boolean {
  let text: string;
  try {
    // `head` is a bounded byte sample, so its last byte can land inside an
    // otherwise valid multi-byte code point. Streaming mode preserves strict
    // validation for malformed bytes inside the sample while tolerating that
    // incomplete trailing code point.
    text = new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
  } catch {
    return false;
  }
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  index = skipXmlWhitespace(text, index);
  if (text.startsWith("<?xml", index)) {
    const prologueEnd = text.indexOf("?>", index + 5);
    if (prologueEnd === -1 || prologueEnd - index > 512) return false;
    index = skipXmlWhitespace(text, prologueEnd + 2);
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

function startsWith(value: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((byte, index) => value[index] === byte);
}
