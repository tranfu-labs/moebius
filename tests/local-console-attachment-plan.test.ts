import { describe, expect, it } from "vitest";

import {
  assertAttachmentCloneTarget,
  classifyAttachmentSourceHead,
  LOCAL_ATTACHMENT_SOURCE_HEAD_MAX_BYTES,
  planAttachmentContentScopeValue,
  planAttachmentDraftKey,
  planDerivedPreviewFileName,
  planDerivedPreviewValidation,
  planProviderImagePathEligibility,
  planStableSourceRead,
  planSvgFallbackMetadata,
  readPngDimensions,
  SVG_MEDIA_TYPE,
} from "../src/local-console/attachment-plan.js";

describe("local attachment plan", () => {
  it("keeps draft ownership and content scope bound to the session", () => {
    expect(planAttachmentDraftKey({ requestedDraftKey: undefined, sessionId: "session-a" }))
      .toBe("draft:session-a");
    expect(() => assertAttachmentCloneTarget({ targetDraftKey: "draft:other", sessionId: "session-a" }))
      .toThrow("Attachment target draft does not belong to the session");
    expect(planAttachmentContentScopeValue({ draftKey: undefined, sessionId: "session-a" })).toBe("session-a");
    expect(planAttachmentContentScopeValue({ draftKey: undefined, sessionId: undefined })).toBe("");
  });

  it("plans fixed server-side derived preview keys per tier", () => {
    expect(planDerivedPreviewFileName("thumbnail")).toBe("preview");
    expect(planDerivedPreviewFileName("large")).toBe("preview-large");
  });

  it("treats only unchanged source facts as a stable read", () => {
    const facts = { size: 100, mtimeMs: 1000, ino: 7 };
    expect(planStableSourceRead({ before: facts, after: facts, bytesRead: 100 })).toEqual({ kind: "stable" });
    expect(planStableSourceRead({ before: facts, after: { ...facts, size: 101 }, bytesRead: 100 }))
      .toEqual({ kind: "changed" });
    expect(planStableSourceRead({ before: facts, after: facts, bytesRead: 99 }))
      .toEqual({ kind: "changed" });
    expect(planStableSourceRead({ before: facts, after: { ...facts, mtimeMs: 1001 }, bytesRead: 100 }))
      .toEqual({ kind: "changed" });
    expect(planStableSourceRead({ before: facts, after: { ...facts, ino: 8 }, bytesRead: 100 }))
      .toEqual({ kind: "changed" });
  });
});

describe("classifyAttachmentSourceHead", () => {
  it("recognizes raster formats by magic bytes and marks them as image preview candidates", () => {
    expect(classifyAttachmentSourceHead(pngBytes(32, 16))).toEqual({
      previewCandidate: true,
      kind: "image",
      mediaType: "image/png",
      svg: false,
    });
    expect(classifyAttachmentSourceHead(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]))).toEqual({
      previewCandidate: true,
      kind: "image",
      mediaType: "image/jpeg",
      svg: false,
    });
    expect(classifyAttachmentSourceHead(Buffer.from("GIF89a\x01\x00\x01\x00"))).toEqual({
      previewCandidate: true,
      kind: "image",
      mediaType: "image/gif",
      svg: false,
    });
    expect(classifyAttachmentSourceHead(Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8 "))).toEqual({
      previewCandidate: true,
      kind: "image",
      mediaType: "image/webp",
      svg: false,
    });
  });

  it("recognizes SVG with an XML prologue and a namespace root as a file preview candidate", () => {
    expect(classifyAttachmentSourceHead(Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
      "utf8",
    ))).toEqual({
      previewCandidate: true,
      kind: "file",
      mediaType: SVG_MEDIA_TYPE,
      svg: true,
    });
  });

  it("recognizes a bare SVG root, a BOM/whitespace prefix, and a doctype before the root", () => {
    expect(classifyAttachmentSourceHead(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', "utf8"))).toMatchObject({
      previewCandidate: true,
      kind: "file",
      mediaType: SVG_MEDIA_TYPE,
      svg: true,
    });
    expect(classifyAttachmentSourceHead(Buffer.from(
      '\ufeff\n \t<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" '
      + '"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<!-- generated -->\n<svg xmlns="http://www.w3.org/2000/svg"/>',
      "utf8",
    ))).toMatchObject({
      previewCandidate: true,
      kind: "file",
      mediaType: SVG_MEDIA_TYPE,
      svg: true,
    });
  });

  it("rejects non-SVG XML roots, lookalike roots, and unknown binary content", () => {
    expect(classifyAttachmentSourceHead(Buffer.from("<html><body>text</body></html>", "utf8"))).toEqual({
      previewCandidate: false,
      kind: "file",
      mediaType: null,
      svg: false,
    });
    expect(classifyAttachmentSourceHead(Buffer.from('<svgx xmlns="http://www.w3.org/2000/svg"/>', "utf8"))).toEqual({
      previewCandidate: false,
      kind: "file",
      mediaType: null,
      svg: false,
    });
    expect(classifyAttachmentSourceHead(Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd, 0x7f, 0x80]))).toEqual({
      previewCandidate: false,
      kind: "file",
      mediaType: null,
      svg: false,
    });
    expect(classifyAttachmentSourceHead(Buffer.alloc(0))).toEqual({
      previewCandidate: false,
      kind: "file",
      mediaType: null,
      svg: false,
    });
  });

  it("still recognizes hostile SVG payloads as SVG preview candidates (safety is enforced at decode)", () => {
    expect(classifyAttachmentSourceHead(Buffer.from(
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      "utf8",
    ))).toMatchObject({ previewCandidate: true, kind: "file", mediaType: SVG_MEDIA_TYPE, svg: true });
    expect(classifyAttachmentSourceHead(Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe src="https://evil.example/"/></foreignObject></svg>',
      "utf8",
    ))).toMatchObject({ previewCandidate: true, kind: "file", mediaType: SVG_MEDIA_TYPE, svg: true });
    expect(classifyAttachmentSourceHead(Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>',
      "utf8",
    ))).toMatchObject({ previewCandidate: true, kind: "file", mediaType: SVG_MEDIA_TYPE, svg: true });
  });

  it("rejects invalid UTF-8, truncated prologues, and SVG roots beyond the bounded prefix", () => {
    expect(classifyAttachmentSourceHead(Buffer.concat([
      Buffer.from('<?xml version="1.0"?>', "utf8"),
      Buffer.from([0xff, 0xfe, 0x00, 0x80]),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', "utf8"),
    ]))).toMatchObject({ svg: false, previewCandidate: false });
    expect(classifyAttachmentSourceHead(Buffer.from('<?xml version="1.0"', "utf8"))).toMatchObject({
      svg: false,
      previewCandidate: false,
    });
    const beyondBound = Buffer.concat([
      Buffer.from(" ".repeat(LOCAL_ATTACHMENT_SOURCE_HEAD_MAX_BYTES), "utf8"),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', "utf8"),
    ]);
    expect(beyondBound.byteLength).toBeGreaterThan(LOCAL_ATTACHMENT_SOURCE_HEAD_MAX_BYTES);
    expect(classifyAttachmentSourceHead(beyondBound)).toMatchObject({ svg: false, previewCandidate: false });
  });
});

describe("planDerivedPreviewValidation", () => {
  it("accepts thumbnail PNGs within the 512px/2MiB budget", () => {
    const result = planDerivedPreviewValidation({
      bytes: pngBytes(512, 300),
      maxEdge: 512,
      maxBytes: 2 * 1024 * 1024,
    });
    expect(result).toEqual({ ok: true, width: 512, height: 300 });
  });

  it("accepts large PNGs within the 2048px/8MiB budget", () => {
    const result = planDerivedPreviewValidation({
      bytes: pngBytes(2048, 1024),
      maxEdge: 2048,
      maxBytes: 8 * 1024 * 1024,
    });
    expect(result).toEqual({ ok: true, width: 2048, height: 1024 });
  });

  it("rejects oversized bytes, non-PNG payloads, and over-budget edges", () => {
    expect(planDerivedPreviewValidation({
      bytes: Buffer.alloc(2 * 1024 * 1024 + 1),
      maxEdge: 512,
      maxBytes: 2 * 1024 * 1024,
    })).toEqual({ ok: false, reason: "bytes-exceeded" });
    expect(planDerivedPreviewValidation({
      bytes: Buffer.alloc(8 * 1024 * 1024 + 1),
      maxEdge: 2048,
      maxBytes: 8 * 1024 * 1024,
    })).toEqual({ ok: false, reason: "bytes-exceeded" });
    expect(planDerivedPreviewValidation({
      bytes: Buffer.from("not a png at all", "utf8"),
      maxEdge: 512,
      maxBytes: 2 * 1024 * 1024,
    })).toEqual({ ok: false, reason: "not-png" });
    expect(planDerivedPreviewValidation({
      bytes: pngBytes(0, 0),
      maxEdge: 512,
      maxBytes: 2 * 1024 * 1024,
    })).toEqual({ ok: false, reason: "not-png" });
    expect(planDerivedPreviewValidation({
      bytes: pngBytes(513, 16),
      maxEdge: 512,
      maxBytes: 2 * 1024 * 1024,
    })).toEqual({ ok: false, reason: "edge-exceeded" });
    expect(planDerivedPreviewValidation({
      bytes: pngBytes(2049, 10),
      maxEdge: 2048,
      maxBytes: 8 * 1024 * 1024,
    })).toEqual({ ok: false, reason: "edge-exceeded" });
  });

  it("exposes PNG dimensions only for well-formed PNG headers", () => {
    expect(readPngDimensions(pngBytes(320, 240))).toEqual({ width: 320, height: 240 });
    expect(readPngDimensions(Buffer.alloc(24))).toBeNull();
  });
});

describe("planSvgFallbackMetadata", () => {
  it("allows only server-recognized SVG staging items to downgrade to an ordinary file", () => {
    expect(planSvgFallbackMetadata({ kind: "file", mediaType: SVG_MEDIA_TYPE, svg: true }))
      .toEqual({ ok: true, kind: "file", mediaType: SVG_MEDIA_TYPE });
    expect(planSvgFallbackMetadata({ kind: "image", mediaType: "image/png", svg: false }))
      .toEqual({ ok: false, reason: "not-svg" });
    expect(planSvgFallbackMetadata({ kind: "file", mediaType: SVG_MEDIA_TYPE, svg: false }))
      .toEqual({ ok: false, reason: "not-svg" });
    expect(planSvgFallbackMetadata({ kind: "file", mediaType: "application/octet-stream", svg: true }))
      .toEqual({ ok: false, reason: "not-svg" });
    expect(planSvgFallbackMetadata({ kind: "image", mediaType: SVG_MEDIA_TYPE, svg: true }))
      .toEqual({ ok: false, reason: "not-svg" });
  });
});

describe("planProviderImagePathEligibility", () => {
  it("admits only native raster images and excludes SVG from provider imagePaths", () => {
    expect(planProviderImagePathEligibility({ kind: "image", mediaType: "image/png" })).toBe(true);
    expect(planProviderImagePathEligibility({ kind: "image", mediaType: "image/jpeg" })).toBe(true);
    expect(planProviderImagePathEligibility({ kind: "image", mediaType: "image/gif" })).toBe(true);
    expect(planProviderImagePathEligibility({ kind: "image", mediaType: "image/webp" })).toBe(true);
    expect(planProviderImagePathEligibility({ kind: "file", mediaType: SVG_MEDIA_TYPE })).toBe(false);
    expect(planProviderImagePathEligibility({ kind: "file", mediaType: "text/plain" })).toBe(false);
    expect(planProviderImagePathEligibility({ kind: "image", mediaType: SVG_MEDIA_TYPE })).toBe(false);
    expect(planProviderImagePathEligibility({ kind: "image", mediaType: "application/octet-stream" })).toBe(false);
  });
});

function pngBytes(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
