import { describe, expect, it } from "vitest";
import {
  agentImageCacheKey,
  agentImageReferenceKey,
  planAgentImagePreviewOutcome,
  planAgentImageReferenceCandidates,
  planAgentMessageImageAttachments,
} from "../src/console-page/agent-image-reference-plan.js";
import type { AgentImagePreviewState } from "../src/console-page/agent-image-reference-plan.js";

describe("agent image reference plan", () => {
  it("maps restricted source read failures to the correct preview slots", () => {
    expect(planAgentImagePreviewOutcome({ ok: false, reason: "not-found" })).toEqual({ kind: "missing" });
    expect(planAgentImagePreviewOutcome({ ok: false, reason: "not-image" })).toEqual({ kind: "failed" });
    expect(planAgentImagePreviewOutcome({ ok: false, reason: "changed-during-read" })).toEqual({ kind: "changed" });
    expect(planAgentImagePreviewOutcome({ ok: false, reason: "invalid-path" })).toEqual({ kind: "failed" });
    expect(planAgentImagePreviewOutcome({ ok: false, reason: "file-too-large" })).toEqual({ kind: "failed" });
    expect(planAgentImagePreviewOutcome({ ok: false, reason: "unavailable" })).toEqual({ kind: "failed" });
  });

  it("synthesizes a changed preview state with the shared image structure", () => {
    const messages = [{ sessionId: "session-a", speaker: "agent", role: "dev", body: "见 /docs/logo.ico。" }];
    const states: Record<string, AgentImagePreviewState> = {
      [agentImageCacheKey("session-a", "/docs/logo.ico")]: { status: "changed" },
    };
    const [message] = planAgentMessageImageAttachments(messages, states);
    expect(message.attachments).toEqual([
      {
        attachmentId: "/docs/logo.ico",
        kind: "image",
        displayName: "logo.ico",
        mediaType: "image/png",
        byteSize: 0,
        previewStatus: "changed",
      },
    ]);
  });
  it("collects ordered candidates from agent messages only", () => {
    expect(planAgentImageReferenceCandidates([
      { sessionId: "session-a", speaker: "user", body: "看 /docs/user.png" },
      { sessionId: "session-a", speaker: "agent", body: "生成结果见 /docs/result.png。" },
      { sessionId: "session-a", speaker: "system", body: "系统 /docs/system.png" },
    ])).toEqual([{ sessionId: "session-a", path: "/docs/result.png" }]);
  });

  it("deduplicates the same path across messages and sessions by cache key", () => {
    const candidates = planAgentImageReferenceCandidates([
      { sessionId: "session-a", speaker: "agent", body: "见 /docs/logo.svg。" },
      { sessionId: "session-a", speaker: "agent", body: "再次见 /docs/logo.svg。" },
      { sessionId: "session-b", speaker: "agent", body: "另一个会话 /docs/logo.svg。" },
    ]);
    expect(candidates).toEqual([{ sessionId: "session-a", path: "/docs/logo.svg" }]);
    expect(agentImageCacheKey("session-a", "/docs/logo.svg")).not.toBe(
      agentImageCacheKey("session-b", "/docs/logo.svg"),
    );
    expect(agentImageReferenceKey({ sessionId: "session-a", path: "/docs/logo.svg" }))
      .toBe(agentImageCacheKey("session-a", "/docs/logo.svg"));
  });

  it("synthesizes message attachments from preview states with the shared image structure", () => {
    const messages = [{ sessionId: "session-a", speaker: "agent", role: "dev", body: "见 /docs/a.png 与 /docs/b.svg。" }];
    const states: Record<string, AgentImagePreviewState> = {
      [agentImageCacheKey("session-a", "/docs/a.png")]: {
        status: "ready",
        previewUrl: "blob:a",
        largePreviewUrl: "blob:a-large",
        mediaType: "image/png",
      },
      [agentImageCacheKey("session-a", "/docs/b.svg")]: { status: "missing" },
    };
    const [message] = planAgentMessageImageAttachments(messages, states);
    expect(message.attachments).toEqual([
      {
        attachmentId: "/docs/a.png",
        kind: "image",
        displayName: "a.png",
        mediaType: "image/png",
        byteSize: 0,
        previewUrl: "blob:a",
        largePreviewUrl: "blob:a-large",
        previewStatus: "ready",
      },
      {
        attachmentId: "/docs/b.svg",
        kind: "image",
        displayName: "b.svg",
        mediaType: "image/png",
        byteSize: 0,
        previewStatus: "missing",
      },
    ]);
    expect(planAgentMessageImageAttachments([
      { sessionId: "session-a", speaker: "user", role: null, body: "用户正文", attachments: [{ attachmentId: "kept", kind: "file", displayName: "kept.txt", mediaType: "text/plain", byteSize: 1 }] },
      { sessionId: "session-a", speaker: "agent", role: "dev", body: "见 /docs/a.png。", attachments: [{ attachmentId: "existing", kind: "file", displayName: "existing.txt", mediaType: "text/plain", byteSize: 1 }] },
    ], states).map((message) => message.attachments.map((attachment) => (attachment as { attachmentId: string }).attachmentId))).toEqual([
      ["kept"],
      ["existing", "/docs/a.png"],
    ]);
  });
});
