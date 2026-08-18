import { describe, expect, it } from "vitest";

import {
  decideAttachmentRestorationCommit,
  decideAttachmentService,
  decideSidebarAttachmentPresenceCommit,
  planConsoleAttachmentDraftKeys,
  planMergedDraftAttachments,
  planPendingAttachment,
  decidePreviewLoad,
  planMessagePreviewRetention,
  planMessagesWithAttachmentPreviews,
  planUploadPreviewArgs,
  previewCacheKey,
  planVisibleRestoredAttachments,
} from "../src/console-page/managed-attachment-model.js";

describe("managed attachment decisions", () => {
  it("fails closed until both the local endpoint and capability are available", () => {
    expect(decideAttachmentService({ apiBase: null, capability: "cap" })).toEqual({
      kind: "unavailable",
    });
    expect(decideAttachmentService({ apiBase: "http://127.0.0.1:8787/", capability: "cap" }))
      .toEqual({
        kind: "available",
        apiBase: "http://127.0.0.1:8787/",
        capability: "cap",
      });
  });

  it("preserves file metadata and the owning draft in a pending upload", () => {
    const file = new File(["body"], "notes.txt", { type: "text/plain" });
    expect(planPendingAttachment({
      clientId: "client-a",
      draftKey: "draft:session-a",
      file,
      previewUrl: null,
      presenceGeneration: 3,
    })).toMatchObject({
      handle: { draftKey: "draft:session-a", file, presenceGeneration: 3 },
      item: {
        clientId: "client-a",
        kind: "file",
        displayName: "notes.txt",
        mediaType: "text/plain",
        status: "pending",
      },
    });
  });

  it("keeps late ready uploads and transient work when an authoritative list arrives", () => {
    const merged = planMergedDraftAttachments({
      current: [
        attachment("old", "ready", "blob:old"),
        attachment("late", "ready", "blob:late"),
        attachment("pending", "pending"),
      ],
      restored: [attachment("old", "ready", "blob:new")],
    });
    expect(merged.items.map((item) => item.attachmentId)).toEqual(["old", "late", "pending"]);
    expect(merged.revokeUrls).toEqual(["blob:old"]);
  });

  it("strips and releases previews when restored attachments belong to a hidden draft", () => {
    expect(planVisibleRestoredAttachments(
      [attachment("image-a", "ready", "blob:image-a")],
      false,
    )).toEqual({
      items: [{
        clientId: "image-a",
        attachmentId: "image-a",
        kind: "file",
        displayName: "image-a.txt",
        mediaType: "text/plain",
        byteSize: 1,
        status: "ready",
      }],
      revokeUrls: ["blob:image-a"],
    });
  });

  it("rejects a slow restoration after cancellation or a newer draft revision", () => {
    expect(decideAttachmentRestorationCommit({
      aborted: true,
      currentRevision: 2,
      expectedRevision: 2,
    })).toBe("stale");
    expect(decideAttachmentRestorationCommit({
      aborted: false,
      currentRevision: 3,
      expectedRevision: 2,
    })).toBe("stale");
  });

  it("scopes message preview cache entries to the conversation and projects preview status", () => {
    const firstKey = previewCacheKey("session-a", "image");
    const secondKey = previewCacheKey("session-b", "image");
    expect(firstKey).not.toBe(secondKey);
    const retained = planMessagePreviewRetention(
      { [firstKey]: { status: "ready", previewUrl: "blob:first" } },
      new Set([secondKey]),
    );
    expect(retained).toEqual({ states: {}, revokeUrls: ["blob:first"] });
    expect(planMessagesWithAttachmentPreviews([
      message("session-b", "image"),
    ], {
      [firstKey]: { status: "ready", previewUrl: "blob:first" },
      [secondKey]: { status: "failed" },
    })[0]?.attachments?.[0]).toMatchObject({
      attachmentId: "image",
      previewStatus: "failed",
    });
    expect(planMessagesWithAttachmentPreviews([
      message("session-b", "image"),
    ], {
      [secondKey]: { status: "ready", previewUrl: "blob:second" },
    })[0]?.attachments?.[0]?.previewUrl).toBe("blob:second");
    expect(decidePreviewLoad(undefined)).toBe("load");
    expect(decidePreviewLoad("failed")).toBe("skip");
  });

  it("falls back to the plain attachment when the server has no derived preview", () => {
    const key = previewCacheKey("session-a", "svg-fallback");
    const [projected] = planMessagesWithAttachmentPreviews([
      message("session-a", "svg-fallback"),
    ], {
      [key]: { status: "no-preview" },
    });
    expect(projected.attachments?.[0]).toMatchObject({
      attachmentId: "svg-fallback",
    });
    expect("previewStatus" in projected.attachments![0]!).toBe(false);
  });

  it("assigns each attachment controller to its current draft owner", () => {
    expect(planConsoleAttachmentDraftKeys({
      newConversationOpen: false,
      composerDraftKey: "draft:main",
      activeSubSessionId: "child",
      activeSidebarSessionId: "sidebar",
      activeSidebarAttachmentDraftKey: null,
    })).toEqual({
      main: "draft:main",
      subSession: "draft:child",
      sidebar: "draft:sidebar",
    });
    expect(planConsoleAttachmentDraftKeys({
      newConversationOpen: true,
      composerDraftKey: "draft:main",
      activeSubSessionId: null,
      activeSidebarSessionId: null,
      activeSidebarAttachmentDraftKey: "draft:sidebar:draft-a",
    })).toMatchObject({ main: "draft:new", sidebar: "draft:sidebar:draft-a" });
    expect(decideSidebarAttachmentPresenceCommit(false)).toBe("skip");
    expect(decideSidebarAttachmentPresenceCommit(true)).toBe("commit");
  });

  it("maps derived previews to upload arguments and fails to null without a decode", () => {
    expect(planUploadPreviewArgs(null)).toEqual({ preview: null, largePreview: null });
    expect(planUploadPreviewArgs({ thumbnail: new Blob(["t"]), large: new Blob(["l"]) })).toEqual({
      preview: new Blob(["t"]),
      largePreview: new Blob(["l"]),
    });
  });
});

function attachment(
  attachmentId: string,
  status: "ready" | "pending",
  previewUrl?: string,
) {
  return {
    clientId: attachmentId,
    attachmentId,
    kind: "file" as const,
    displayName: `${attachmentId}.txt`,
    mediaType: "text/plain",
    byteSize: 1,
    status,
    ...(previewUrl === undefined ? {} : { previewUrl }),
  };
}

function message(sessionId: string, attachmentId: string) {
  return {
    id: 1,
    sessionId,
    speaker: "user" as const,
    role: null,
    body: "",
    status: "completed" as const,
    runId: null,
    runDir: null,
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    attachments: [{
      attachmentId,
      kind: "image" as const,
      displayName: "image.png",
      mediaType: "image/png",
      byteSize: 1,
    }],
  };
}
