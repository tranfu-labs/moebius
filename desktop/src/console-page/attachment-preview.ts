import { ManagedAttachmentFailure } from "./managed-attachment-model.js";

export const ATTACHMENT_PREVIEW_MAX_EDGE = 512;
export const ATTACHMENT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
export const ATTACHMENT_PREVIEW_LARGE_MAX_EDGE = 2048;
export const ATTACHMENT_PREVIEW_LARGE_MAX_BYTES = 8 * 1024 * 1024;

export const ATTACHMENT_SOURCE_HEAD_MAX_BYTES = 8192;

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ImagePreviewDependencies {
  decode(file: Blob): Promise<{ width: number; height: number; source: CanvasImageSource; close(): void }>;
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
  const decoded = await dependencies.decode(file);
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
  const decoded = await dependencies.decode(file);
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
    async decode(file) {
      try {
        const bitmap = await createImageBitmap(file);
        return {
          width: bitmap.width,
          height: bitmap.height,
          source: bitmap,
          close: () => bitmap.close(),
        };
      } catch {
        return await decodeSvgImage(file);
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

/** SVG decodes only in an <img> image context from a Blob URL, then draws to Canvas; never inserted into the DOM. */
async function decodeSvgImage(file: Blob): Promise<{
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

function looksLikeSvgXml(head: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(head);
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
