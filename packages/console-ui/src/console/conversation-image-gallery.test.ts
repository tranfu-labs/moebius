import { describe, expect, it } from "vitest";
import { buildConversationImageGallery } from "./conversation-image-gallery.js";
import type { OperatorMessage } from "./operator-console.js";

describe("buildConversationImageGallery", () => {
  it("orders ready images by message order with per-source labels", () => {
    const messages: OperatorMessage[] = [
      message(1, "session-a", "user", null, [
        image("a1", "/docs/user.png", "blob:u1"),
        image("a2", "/docs/user2.png", "blob:u2"),
      ]),
      message(2, "session-a", "agent", "dev", [
        image("a3", "/docs/agent.svg", "blob:g1", "image/svg+xml"),
      ]),
      message(3, "session-a", "user", null, [
        image("a4", "/docs/last.png", "blob:u3"),
      ]),
    ];
    const gallery = buildConversationImageGallery(
      messages,
      [{ slug: "dev", displayName: "Dev" }],
      (key) => key,
    );
    expect(gallery.map((item) => item.id)).toEqual(["a1", "a2", "a3", "a4"]);
    expect(gallery[0]?.sourceLabel).toBe("console.imagePreview.sourceYou");
    expect(gallery[2]?.sourceLabel).toBe("console.imagePreview.sourceMember");
    expect(gallery[2]).toMatchObject({
      displayName: "/docs/agent.svg",
      mediaType: "image/svg+xml",
      previewUrl: "blob:g1",
      largePreviewUrl: "blob:g1",
    });
  });

  it("skips system messages, non-image attachments, and images without previews", () => {
    const messages: OperatorMessage[] = [
      message(1, "session-a", "system", null, [image("s1", "note.txt", "blob:file")]),
      message(2, "session-a", "agent", "dev", [
        { attachmentId: "pending", kind: "image", displayName: "pending.png", mediaType: "image/png", byteSize: 1 },
        image("ok", "/docs/ok.png", "blob:ok"),
      ]),
    ];
    const gallery = buildConversationImageGallery(
      messages,
      [{ slug: "dev", displayName: "Dev" }],
      (key) => key,
    );
    expect(gallery.map((item) => item.id)).toEqual(["ok"]);
  });
});

function message(
  id: number,
  sessionId: string,
  speaker: OperatorMessage["speaker"],
  role: string | null,
  attachments: OperatorMessage["attachments"],
): OperatorMessage {
  return {
    id,
    sessionId,
    speaker,
    role,
    body: "",
    status: "completed",
    runId: null,
    runDir: null,
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    attachments,
  };
}

function image(
  attachmentId: string,
  displayName: string,
  previewUrl: string,
  mediaType = "image/png",
): NonNullable<OperatorMessage["attachments"]>[number] {
  return {
    attachmentId,
    kind: "image",
    displayName,
    mediaType,
    byteSize: 1,
    previewUrl,
    previewStatus: "ready",
  };
}
