import { describe, expect, it, vi } from "vitest";
import {
  ATTACHMENT_PREVIEW_MAX_BYTES,
  createBoundedPngPreview,
  fitWithin,
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

  it("does not decode an ordinary file that merely claims an image MIME", async () => {
    const decode = vi.fn();
    const result = await createBoundedPngPreview(
      new File(["not-png"], "fake.png", { type: "image/png" }),
      { decode, encode: vi.fn() },
    );
    expect(result).toBeNull();
    expect(decode).not.toHaveBeenCalled();
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
