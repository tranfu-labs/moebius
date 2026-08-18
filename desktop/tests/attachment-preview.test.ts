import { describe, expect, it, vi } from "vitest";
import {
  ATTACHMENT_PREVIEW_MAX_BYTES,
  ATTACHMENT_PREVIEW_LARGE_MAX_BYTES,
  createBoundedPngPreview,
  createBoundedPngPreviews,
  fitWithin,
  hasSupportedImageSignature,
} from "../src/console-page/attachment-preview.js";
import { ManagedAttachmentFailure } from "../src/console-page/managed-attachment-model.js";

describe("managed attachment preview", () => {
  it("fits an image inside the bounded edge while preserving its ratio", () => {
    expect(fitWithin(2048, 1024, 512)).toEqual({ width: 512, height: 256 });
    expect(fitWithin(32, 64, 512)).toEqual({ width: 32, height: 64 });
  });

  it("retries PNG encoding at smaller dimensions until it meets the byte budget", async () => {
    const close = vi.fn();
    const encode = vi.fn()
      .mockResolvedValueOnce(new Blob([new Uint8Array(ATTACHMENT_PREVIEW_MAX_BYTES + 1)], { type: "image/png" }))
      .mockResolvedValueOnce(new Blob([new Uint8Array(128)], { type: "image/png" }));
    const preview = await createBoundedPngPreview(
      pngFile(),
      {
        decode: async () => ({ width: 1024, height: 512, source: {} as CanvasImageSource, close }),
        encode,
      },
    );
    expect(preview?.size).toBe(128);
    expect(encode.mock.calls.map((call) => call.slice(1))).toEqual([[512, 256], [384, 192]]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("derives both tiers from a single decode and applies each tier budget", async () => {
    const close = vi.fn();
    const encode = vi.fn(async (_source: CanvasImageSource, width: number, height: number) =>
      new Blob([new Uint8Array(width * 100 + height)], { type: "image/png" }));
    const previews = await createBoundedPngPreviews(
      pngFile(),
      {
        decode: async () => ({ width: 4096, height: 2048, source: {} as CanvasImageSource, close }),
        encode,
      },
    );
    expect(previews).not.toBeNull();
    expect(encode.mock.calls.map((call) => call.slice(1))).toEqual([
      [512, 256],
      [2048, 1024],
    ]);
    expect(previews!.thumbnail.size).toBeLessThanOrEqual(ATTACHMENT_PREVIEW_MAX_BYTES);
    expect(previews!.large.size).toBeLessThanOrEqual(ATTACHMENT_PREVIEW_LARGE_MAX_BYTES);
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not decode an ordinary file that merely claims an image MIME", async () => {
    const decode = vi.fn();
    const result = await createBoundedPngPreview(
      new File(["not-png"], "fake.png", { type: "image/png" }),
      { decode, encode: vi.fn() },
    );
    expect(result).toBeNull();
    expect(decode).not.toHaveBeenCalled();
  });

  it("recognizes SVG content as a preview candidate without trusting the file name", async () => {
    expect(await hasSupportedImageSignature(new File([
      new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    ], "diagram.svg", { type: "image/svg+xml" }))).toBe(true);
    expect(await hasSupportedImageSignature(new File([
      new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"/>"),
    ], "bare.svg", { type: "text/plain" }))).toBe(true);
    expect(await hasSupportedImageSignature(new File([
      new TextEncoder().encode("<html><body>not svg</body></html>"),
    ], "fake.svg", { type: "image/svg+xml" }))).toBe(false);
  });

  it("recognizes ICO, BMP and AVIF signatures as preview candidates", async () => {
    expect(await hasSupportedImageSignature(new File([
      new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10]),
    ], "favicon.ico", { type: "image/x-icon" }))).toBe(true);
    expect(await hasSupportedImageSignature(new File([
      new Uint8Array([0x42, 0x4d, 0x3a, 0x00, 0x00, 0x00, 0x00, 0x00]),
    ], "wallpaper.bmp", { type: "image/bmp" }))).toBe(true);
    expect(await hasSupportedImageSignature(new File([
      new TextEncoder().encode("\x00\x00\x00\x20ftypavif\x00\x00\x00\x00"),
    ], "photo.avif", { type: "image/avif" }))).toBe(true);
  });

  it("turns an undecodable file-class image into null so the upload can fall back to an ordinary file", async () => {
    for (const file of [
      new File(["<svg"], "broken.svg", { type: "image/svg+xml" }),
      new File(["\x00\x00\x01\x00"], "broken.ico", { type: "image/x-icon" }),
    ]) {
      const result = await createBoundedPngPreviews(file, {
        decode: async () => { throw new ManagedAttachmentFailure("image-preview-decode"); },
        encode: vi.fn(),
      });
      expect(result).toBeNull();
    }
  });

  it("reports stable failure codes for invalid dimensions and an exhausted preview budget", async () => {
    expect(() => fitWithin(Number.NaN, 64, 512))
      .toThrow(new ManagedAttachmentFailure("image-dimensions-invalid"));

    await expect(createBoundedPngPreview(pngFile(), {
      decode: async () => ({ width: 1, height: 1, source: {} as CanvasImageSource, close: vi.fn() }),
      encode: async () => new Blob([
        new Uint8Array(ATTACHMENT_PREVIEW_MAX_BYTES + 1),
      ], { type: "image/png" }),
    })).rejects.toEqual(new ManagedAttachmentFailure("image-preview-budget"));
  });
});

function pngFile(): File {
  return new File([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]),
  ], "screen.png", { type: "image/png" });
}
