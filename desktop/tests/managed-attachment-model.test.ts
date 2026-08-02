import { describe, expect, it } from "vitest";

import {
  decideAttachmentRestorationCommit,
  decideAttachmentService,
  decideSidebarAttachmentPresenceCommit,
  planConsoleAttachmentDraftKeys,
  planMergedDraftAttachments,
  planPendingAttachment,
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
