import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cloneManagedMessageAttachments,
  listManagedDraftAttachments,
  managedAttachmentFetch,
  uploadManagedAttachment,
} from "../src/console-page/attachment-client.js";
import { ManagedAttachmentFailure } from "../src/console-page/managed-attachment-model.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("managed attachment client", () => {
  it("invokes browser fetch with its global receiver", async () => {
    const receiverAwareFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(new Response(JSON.stringify({ attachments: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    });
    globalThis.fetch = receiverAwareFetch as typeof fetch;

    await expect(listManagedDraftAttachments({
      apiBase: "http://127.0.0.1:8788/",
      capability: "test-capability",
      draftKey: "draft:new",
      fetch: managedAttachmentFetch,
    })).resolves.toEqual([]);
    expect(receiverAwareFetch).toHaveBeenCalledOnce();
  });

  it("clones message attachments into the session draft through the capability endpoint", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      attachments: [{
        attachmentId: "clone-1",
        kind: "file",
        displayName: "brief.txt",
        mediaType: "text/plain",
        byteSize: 5,
      }],
    }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));

    await expect(cloneManagedMessageAttachments({
      apiBase: "http://127.0.0.1:8788/",
      capability: "test-capability",
      fetch,
      sessionId: "session-a",
      sourceMessageId: 41,
      targetDraftKey: "draft:session-a",
    })).resolves.toMatchObject([{ attachmentId: "clone-1" }]);

    expect(fetch).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:8788/api/local-console/attachments/clone"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-moebius-attachment-capability": "test-capability",
        }),
        body: JSON.stringify({
          sessionId: "session-a",
          sourceMessageId: 41,
          targetDraftKey: "draft:session-a",
        }),
      }),
    );
  });

  it("preserves a server error but exposes a stable code for the upload fallback", async () => {
    const file = new File(["body"], "brief.txt", { type: "text/plain" });
    const options = {
      apiBase: "http://127.0.0.1:8788/",
      capability: "test-capability",
      draftKey: "draft:new",
      file,
      preview: null,
      largePreview: null,
      signal: new AbortController().signal,
    };

    await expect(uploadManagedAttachment({
      ...options,
      fetch: vi.fn(async () => jsonResponse({ error: "server-sentinel" }, 500)),
    })).rejects.toThrow("server-sentinel");
    await expect(uploadManagedAttachment({
      ...options,
      fetch: vi.fn(async () => jsonResponse({}, 500)),
    })).rejects.toEqual(new ManagedAttachmentFailure("attachment-upload"));
  });

  it("submits both derived preview tiers before the attachment becomes ready", async () => {
    const responses = [
      jsonResponse({ status: "preview-required", uploadId: "upload-1", svg: false }, 202),
      jsonResponse({ status: "staged" }, 202),
      jsonResponse({ attachment: {
        attachmentId: "final",
        kind: "image",
        displayName: "screen.png",
        mediaType: "image/png",
        byteSize: 3,
      } }, 201),
    ];
    const fetch = vi.fn(async (_input: RequestInfo | URL) => responses.shift()!);
    const attachment = await uploadManagedAttachment({
      apiBase: "http://127.0.0.1:8788/",
      capability: "test-capability",
      draftKey: "draft:new",
      file: new File(["png-bytes"], "screen.png", { type: "image/png" }),
      preview: new Blob(["thumbnail"]),
      largePreview: new Blob(["large"]),
      signal: new AbortController().signal,
      fetch,
    });
    expect(attachment.attachmentId).toBe("final");
    expect(fetch.mock.calls.map((call) => new URL(String(call[0])).pathname)).toEqual([
      "/api/local-console/attachments",
      "/api/local-console/attachments/uploads/upload-1/preview",
      "/api/local-console/attachments/uploads/upload-1/preview-large",
    ]);
  });

  it("falls back a server-recognized SVG to an ordinary file when previews are unavailable", async () => {
    const responses = [
      jsonResponse({ status: "preview-required", uploadId: "upload-svg", svg: true }, 202),
      jsonResponse({ attachment: {
        attachmentId: "svg-file",
        kind: "file",
        displayName: "diagram.svg",
        mediaType: "image/svg+xml",
        byteSize: 4,
      } }, 200),
    ];
    const fetch = vi.fn(async (_input: RequestInfo | URL) => responses.shift()!);
    const attachment = await uploadManagedAttachment({
      apiBase: "http://127.0.0.1:8788/",
      capability: "test-capability",
      draftKey: "draft:new",
      file: new File(["<svg/>"], "diagram.svg", { type: "image/svg+xml" }),
      preview: null,
      largePreview: null,
      signal: new AbortController().signal,
      fetch,
    });
    expect(attachment).toMatchObject({ attachmentId: "svg-file", kind: "file", mediaType: "image/svg+xml" });
    expect(fetch.mock.calls.map((call) => new URL(String(call[0])).pathname)).toEqual([
      "/api/local-console/attachments",
      "/api/local-console/attachments/uploads/upload-svg/fallback",
    ]);
  });

  it("keeps a preview candidate without previews and without the SVG mark unavailable", async () => {
    const fetch = vi.fn(async () => jsonResponse({ status: "preview-required", uploadId: "upload-1", svg: false }, 202));
    await expect(uploadManagedAttachment({
      apiBase: "http://127.0.0.1:8788/",
      capability: "test-capability",
      draftKey: "draft:new",
      file: new File(["x"], "x.png", { type: "image/png" }),
      preview: null,
      largePreview: null,
      signal: new AbortController().signal,
      fetch,
    })).rejects.toEqual(new ManagedAttachmentFailure("attachment-preview-not-ready"));
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
