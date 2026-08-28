import { describe, expect, it, vi } from "vitest";
import {
  ATTACHMENT_PREVIEW_MAX_BYTES,
  ATTACHMENT_PREVIEW_LARGE_MAX_BYTES,
  ATTACHMENT_PREVIEW_LARGE_MAX_EDGE,
  ATTACHMENT_PREVIEW_MAX_EDGE,
  ATTACHMENT_SOURCE_HEAD_MAX_BYTES,
  createBoundedPngPreview,
  createBoundedPngPreviews,
  fitWithin,
  hasSupportedImageSignature,
  parseSvgRootTag,
  planSvgRasterTarget,
  rewriteSvgRootSize,
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

  it("recognizes SVG when the bounded UTF-8 sample ends inside a multi-byte character", async () => {
    const encoder = new TextEncoder();
    const opening = encoder.encode('<svg xmlns="http://www.w3.org/2000/svg"><text>');
    const tail = encoder.encode("中</text></svg>");
    const source = new Uint8Array(ATTACHMENT_SOURCE_HEAD_MAX_BYTES - 1 + tail.byteLength);
    source.set(opening);
    source.fill(0x61, opening.byteLength, ATTACHMENT_SOURCE_HEAD_MAX_BYTES - 1);
    source.set(tail, ATTACHMENT_SOURCE_HEAD_MAX_BYTES - 1);
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(
      source.subarray(0, ATTACHMENT_SOURCE_HEAD_MAX_BYTES),
    )).toThrow();
    expect(await hasSupportedImageSignature(new File([
      source,
    ], "diagram.svg", { type: "image/svg+xml" }))).toBe(true);
    expect(await hasSupportedImageSignature(new File([
      encoder.encode('<?xml version="1.0"?>'),
      new Uint8Array([0xff]),
      encoder.encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    ], "malformed.svg", { type: "image/svg+xml" }))).toBe(false);
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

function svgBytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function svgText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

describe("svg root tag parsing", () => {
  it("parses viewBox and namespace attributes from a plain root tag", () => {
    const info = parseSvgRootTag(svgBytes('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1260 1000"></svg>'));
    expect(info).not.toBeNull();
    expect(info!.tagNameEnd).toBe(4);
    expect(info!.attrs.get("viewBox")?.value).toBe("0 0 1260 1000");
    expect(info!.attrs.get("xmlns")?.value).toBe("http://www.w3.org/2000/svg");
  });

  it("accepts single-quoted values and a self-closing root", () => {
    const info = parseSvgRootTag(svgBytes("<svg width='100%' viewBox='0 0 32 32'/>"));
    expect(info).not.toBeNull();
    expect(info!.attrs.get("width")?.value).toBe("100%");
    expect(info!.attrs.get("viewBox")?.value).toBe("0 0 32 32");
  });

  it("accepts unquoted attribute values", () => {
    const info = parseSvgRootTag(svgBytes("<svg width=800 height=600>"));
    expect(info).not.toBeNull();
    expect(info!.attrs.get("width")?.value).toBe("800");
    expect(info!.attrs.get("height")?.value).toBe("600");
  });

  it("skips an XML prolog and whitespace before the root", () => {
    const info = parseSvgRootTag(svgBytes('<?xml version="1.0" encoding="UTF-8"?>\n  <svg viewBox="0 0 10 10">'));
    expect(info).not.toBeNull();
    expect(info!.attrs.get("viewBox")?.value).toBe("0 0 10 10");
    expect(info!.tagNameEnd).toBeGreaterThan(4);
  });

  it("ignores a > inside a quoted attribute value", () => {
    const info = parseSvgRootTag(svgBytes('<svg title="a > b" viewBox="0 0 1 1">'));
    expect(info).not.toBeNull();
    expect(info!.attrs.get("title")?.value).toBe("a > b");
    expect(info!.attrs.get("viewBox")?.value).toBe("0 0 1 1");
  });

  it("does not confuse data-width with width", () => {
    const info = parseSvgRootTag(svgBytes('<svg data-width="1" width="2" data-height="3" height="4">'));
    expect(info!.attrs.get("width")?.value).toBe("2");
    expect(info!.attrs.get("height")?.value).toBe("4");
  });

  it("returns null for an unterminated quote, a missing root and a missing tag end", () => {
    expect(parseSvgRootTag(svgBytes('<svg width="1260'))).toBeNull();
    expect(parseSvgRootTag(svgBytes("<html><body>not svg</body></html>"))).toBeNull();
    expect(parseSvgRootTag(svgBytes("<svg"))).toBeNull();
    expect(parseSvgRootTag(new Uint8Array([]))).toBeNull();
  });

  it("returns an empty attribute map for a bare root", () => {
    const info = parseSvgRootTag(svgBytes("<svg>"));
    expect(info).not.toBeNull();
    expect(info!.attrs.size).toBe(0);
  });
});

describe("svg raster target planning", () => {
  function plan(text: string, maxEdge: number) {
    const info = parseSvgRootTag(svgBytes(text));
    expect(info).not.toBeNull();
    return planSvgRasterTarget(info!, maxEdge);
  }

  it("upscales a viewBox-only svg to the large tier edge", () => {
    expect(plan('<svg viewBox="0 0 1260 1000">', ATTACHMENT_PREVIEW_LARGE_MAX_EDGE))
      .toEqual({ width: 2048, height: 1625 });
  });

  it("fits the same svg to the thumbnail tier edge", () => {
    expect(plan('<svg viewBox="0 0 1260 1000">', ATTACHMENT_PREVIEW_MAX_EDGE))
      .toEqual({ width: 512, height: 406 });
  });

  it("keeps explicit absolute sizes unchanged (no rewrite)", () => {
    expect(plan('<svg width="800" height="600" viewBox="0 0 1600 1200">', ATTACHMENT_PREVIEW_LARGE_MAX_EDGE)).toBeNull();
    expect(plan('<svg width="800px" height="600px">', ATTACHMENT_PREVIEW_LARGE_MAX_EDGE)).toBeNull();
  });

  it("treats percentage sizes as absent and uses the viewBox", () => {
    expect(plan('<svg width="100%" height="100%" viewBox="0 0 1260 1000">', ATTACHMENT_PREVIEW_LARGE_MAX_EDGE))
      .toEqual({ width: 2048, height: 1625 });
  });

  it("uses the viewBox when only one absolute dimension is declared", () => {
    expect(plan('<svg width="800" viewBox="0 0 1260 1000">', ATTACHMENT_PREVIEW_LARGE_MAX_EDGE))
      .toEqual({ width: 2048, height: 1625 });
  });

  it("returns null without a viewBox", () => {
    expect(plan('<svg width="100%">', ATTACHMENT_PREVIEW_LARGE_MAX_EDGE)).toBeNull();
    expect(plan("<svg>", ATTACHMENT_PREVIEW_LARGE_MAX_EDGE)).toBeNull();
  });

  it("rejects degenerate viewBox values", () => {
    expect(plan('<svg viewBox="0 0 0 100">', ATTACHMENT_PREVIEW_LARGE_MAX_EDGE)).toBeNull();
    expect(plan('<svg viewBox="abc">', ATTACHMENT_PREVIEW_LARGE_MAX_EDGE)).toBeNull();
    expect(plan('<svg viewBox="0 0 1260">', ATTACHMENT_PREVIEW_LARGE_MAX_EDGE)).toBeNull();
    expect(plan('<svg viewBox="">', ATTACHMENT_PREVIEW_LARGE_MAX_EDGE)).toBeNull();
  });

  it("accepts a two-number viewBox", () => {
    expect(plan('<svg viewBox="1260 1000">', ATTACHMENT_PREVIEW_LARGE_MAX_EDGE))
      .toEqual({ width: 2048, height: 1625 });
  });

  it("accepts comma-separated viewBox numbers", () => {
    expect(plan('<svg viewBox="0,0,1260,1000">', ATTACHMENT_PREVIEW_LARGE_MAX_EDGE))
      .toEqual({ width: 2048, height: 1625 });
  });

  it("downscales a huge viewBox to the tier edge", () => {
    expect(plan('<svg viewBox="0 0 100000 50000">', ATTACHMENT_PREVIEW_LARGE_MAX_EDGE))
      .toEqual({ width: 2048, height: 1024 });
  });

  it("treats non-px units as absent (documented limitation)", () => {
    expect(plan('<svg width="10em" viewBox="0 0 1260 1000">', ATTACHMENT_PREVIEW_LARGE_MAX_EDGE))
      .toEqual({ width: 2048, height: 1625 });
  });
});

describe("svg root size rewrite", () => {
  it("inserts missing width/height right after the tag name", () => {
    const source = '<svg viewBox="0 0 1260 1000"><rect/></svg>';
    const info = parseSvgRootTag(svgBytes(source))!;
    const rewritten = rewriteSvgRootSize(svgBytes(source), info, 2048, 1625);
    expect(svgText(rewritten)).toBe('<svg width="2048" height="1625" viewBox="0 0 1260 1000"><rect/></svg>');
  });

  it("replaces existing width/height tokens in place", () => {
    const source = '<svg width="100%" height="100%" viewBox="0 0 32 32"/>';
    const info = parseSvgRootTag(svgBytes(source))!;
    const rewritten = rewriteSvgRootSize(svgBytes(source), info, 2048, 2048);
    expect(svgText(rewritten)).toBe('<svg width="2048" height="2048" viewBox="0 0 32 32"/>');
  });

  it("replaces the declared token and inserts the missing one", () => {
    const source = '<svg width="800" viewBox="0 0 1260 1000">text</svg>';
    const info = parseSvgRootTag(svgBytes(source))!;
    const rewritten = rewriteSvgRootSize(svgBytes(source), info, 2048, 1625);
    expect(svgText(rewritten)).toBe('<svg height="1625" width="2048" viewBox="0 0 1260 1000">text</svg>');
  });

  it("preserves everything outside the tokens byte-for-byte", () => {
    const source = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1260 1000" font-family="sans-serif">\n  <rect width="100%" height="100%"/>\n</svg>';
    const info = parseSvgRootTag(svgBytes(source))!;
    const rewritten = rewriteSvgRootSize(svgBytes(source), info, 2048, 1625);
    expect(svgText(rewritten)).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<svg width="2048" height="1625" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1260 1000" font-family="sans-serif">\n  <rect width="100%" height="100%"/>\n</svg>',
    );
  });
});

describe("decode tier edge passthrough", () => {
  it("passes the large tier edge into the decode dependency for two-tier derivation", async () => {
    const decode = vi.fn(async (_file: Blob, maxEdge: number) => ({
      width: 100,
      height: 100,
      source: {} as CanvasImageSource,
      close: vi.fn(),
    }));
    const previews = await createBoundedPngPreviews(pngFile(), {
      decode,
      encode: async () => new Blob([new Uint8Array(64)], { type: "image/png" }),
    });
    expect(previews).not.toBeNull();
    expect(decode.mock.calls[0]?.[1]).toBe(ATTACHMENT_PREVIEW_LARGE_MAX_EDGE);
  });

  it("passes the thumbnail tier edge into the decode dependency for single-tier derivation", async () => {
    const decode = vi.fn(async (_file: Blob, maxEdge: number) => ({
      width: 100,
      height: 100,
      source: {} as CanvasImageSource,
      close: vi.fn(),
    }));
    await createBoundedPngPreview(pngFile(), {
      decode,
      encode: async () => new Blob([new Uint8Array(64)], { type: "image/png" }),
    });
    expect(decode.mock.calls[0]?.[1]).toBe(ATTACHMENT_PREVIEW_MAX_EDGE);
  });
});
