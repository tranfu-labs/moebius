import { describe, expect, it } from "vitest";

import {
  decideSessionCreationAgentNames,
  decideSessionCreationAttachmentRead,
  decideSessionCreationTeamLoad,
  decideSessionCreationWorkspace,
  decideSessionCreationWorkspaceRead,
  assertAnalysisParent,
  assertChildProject,
  planChildAgentTeam,
  planInitialDispatchRole,
  planSessionCreationContent,
  planSessionCreationDispatch,
  planSessionCreationTitle,
} from "../src/local-console/session-creation-plan.js";

describe("local console session creation plan", () => {
  it("normalizes initial content and rejects ambiguous inputs before persistence", () => {
    expect(() => planSessionCreationContent({
      initialMessage: "   ",
      attachmentIds: [],
      textFragments: undefined,
      attachmentDraftKey: undefined,
    })).toThrow("Message body must not be empty");
    expect(() => planSessionCreationContent({
      initialMessage: "hello",
      attachmentIds: ["attachment-1", "attachment-1"],
      textFragments: undefined,
      attachmentDraftKey: undefined,
    })).toThrow("Attachment ids must be unique");

    expect(planSessionCreationContent({
      initialMessage: "  inspect this  ",
      attachmentIds: ["attachment-1"],
      textFragments: [{ id: "source-1", label: "Source", text: "[record](moebius-ref:conversation/source)" }],
      attachmentDraftKey: "draft:custom",
    })).toEqual({
      normalizedInitialMessage: "inspect this",
      persistedInitialMessage: [
        "> 来源：",
        "> - [record](moebius-ref:conversation/source)",
        "",
        "inspect this",
      ].join("\n"),
      attachmentIds: ["attachment-1"],
      attachmentDraftKey: "draft:custom",
      hasInitialContent: true,
    });
  });

  it("allows worktree creation only after the selected project is confirmed as Git", () => {
    expect(decideSessionCreationWorkspaceRead("direct")).toEqual({ kind: "skip" });
    expect(decideSessionCreationWorkspaceRead("worktree")).toEqual({ kind: "read" });
    expect(decideSessionCreationWorkspace(false)).toEqual({ kind: "reject" });
    expect(decideSessionCreationWorkspace(true)).toEqual({ kind: "available" });
  });

  it("uses a bound team snapshot for routing and falls back when no members are available", () => {
    const binding = { ownership: "system" as const, id: "development" };
    expect(decideSessionCreationTeamLoad({ agentTeam: binding, portAvailable: true }))
      .toEqual({ kind: "load", binding });
    expect(decideSessionCreationTeamLoad({ agentTeam: binding, portAvailable: false }))
      .toEqual({ kind: "skip" });
    expect(decideSessionCreationAgentNames({ members: [{ name: "dev", agentMarkdown: "# dev" }] }))
      .toEqual({ kind: "snapshot", names: ["dev"] });
    expect(decideSessionCreationAgentNames({ members: [] })).toEqual({ kind: "fallback" });

    const content = planSessionCreationContent({
      initialMessage: "@qa verify",
      attachmentIds: [],
      textFragments: undefined,
      attachmentDraftKey: undefined,
    });
    expect(planSessionCreationDispatch({ content, routeAgentNames: ["dev-manager", "qa"] }))
      .toMatchObject({ lane: "worker", role: "qa", reason: "single-valid-mention" });
    expect(planSessionCreationDispatch({ content, routeAgentNames: [] })).toBeUndefined();
  });

  it("derives the title from message, attachment, then requested fallback in that order", () => {
    const attachment = {
      attachmentId: "attachment-1",
      kind: "file" as const,
      displayName: "requirements.md",
      mediaType: "text/markdown",
      byteSize: 128,
    };
    expect(planSessionCreationTitle({
      requestedTitle: "Requested",
      normalizedInitialMessage: "Ship the refactor",
      firstAttachment: attachment,
    })).toBe("Ship the refactor");
    expect(planSessionCreationTitle({
      requestedTitle: "Requested",
      normalizedInitialMessage: undefined,
      firstAttachment: attachment,
    })).toBe("requirements.md");
    expect(planSessionCreationTitle({
      requestedTitle: "  Requested  ",
      normalizedInitialMessage: undefined,
      firstAttachment: undefined,
    })).toBe("Requested");
    expect(decideSessionCreationAttachmentRead({ firstAttachmentId: undefined, portAvailable: true }))
      .toEqual({ kind: "skip" });
  });

  it("owns persisted analysis, dispatch, and child inheritance rules", () => {
    expect(() => assertAnalysisParent({ sessionId: "a", analysisParentSessionId: "a" }))
      .toThrow("analysis session cannot parent itself");
    expect(planInitialDispatchRole({ requestedRole: undefined, firstTeamMemberName: "dev" })).toBe("dev");
    expect(planInitialDispatchRole({ requestedRole: undefined, firstTeamMemberName: undefined })).toBeNull();
    expect(() => assertChildProject({ requestedProjectId: "other", parentProjectId: "parent" }))
      .toThrow("local child project mismatch");
    expect(planChildAgentTeam({ ownership: null, id: null })).toEqual({ ownership: undefined, id: undefined });
  });
});
