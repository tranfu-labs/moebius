export const ATTACHMENT_PREVIEW_MAX_EDGE = 512;
export const ATTACHMENT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ImagePreviewDependencies {
  decode(file: Blob): Promise<{ width: number; height: number; source: CanvasImageSource; close(): void }>;
  encode(source: CanvasImageSource, width: number, height: number): Promise<Blob>;
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
    let { width, height } = fitWithin(decoded.width, decoded.height, ATTACHMENT_PREVIEW_MAX_EDGE);
    while (width >= 1 && height >= 1) {
      const preview = await dependencies.encode(decoded.source, width, height);
      if (preview.type === "image/png" && preview.size <= ATTACHMENT_PREVIEW_MAX_BYTES) {
        return preview;
      }
      if (width === 1 && height === 1) {
        break;
      }
      width = Math.max(1, Math.floor(width * 0.75));
      height = Math.max(1, Math.floor(height * 0.75));
    }
    throw new ManagedAttachmentFailure("image-preview-budget");
  } finally {
    decoded.close();
  }
}

export async function hasSupportedImageSignature(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (startsWith(head, PNG_SIGNATURE)) return true;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return true;
  const ascii = new TextDecoder("ascii").decode(head);
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return true;
  return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
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
      const bitmap = await createImageBitmap(file);
      return {
        width: bitmap.width,
        height: bitmap.height,
        source: bitmap,
        close: () => bitmap.close(),
      };
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

function startsWith(value: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((byte, index) => value[index] === byte);
}
import { ManagedAttachmentFailure } from "./managed-attachment-model.js";
