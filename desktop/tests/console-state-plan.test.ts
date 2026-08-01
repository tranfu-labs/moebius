import { describe, expect, it } from "vitest";

import {
  planArchivedSession,
  planMessageSubmission,
  planOpenedProjectSelection,
  planRefreshResponse,
  planSessionCreation,
} from "../src/console-page/console-state-plan.js";

describe("console state decisions", () => {
  it("admits an attachment-only conversation while rejecting a truly empty draft", () => {
    expect(planSessionCreation({ initialMessage: "  ", attachmentIds: [] })).toEqual({ kind: "skip" });
    expect(planSessionCreation({
      initialMessage: "  ",
      attachmentIds: ["attachment-a"],
      workspaceMode: "worktree",
    })).toEqual({
      kind: "submit",
      payload: {
        initialMessage: "",
        attachmentIds: ["attachment-a"],
        workspaceMode: "worktree",
      },
    });
  });

  it("selects the first root session and preserves the fallback when a project has only children", () => {
    expect(planOpenedProjectSelection({
      projectId: "project-b",
      sessions: [
        { sessionId: "child", parentSessionId: "root" },
        { sessionId: "root", parentSessionId: null },
      ],
      fallbackSessionId: "previous",
    })).toEqual({ projectId: "project-b", sessionId: "root" });
    expect(planOpenedProjectSelection({
      projectId: "project-b",
      sessions: [{ sessionId: "child", parentSessionId: "root" }],
      fallbackSessionId: "previous",
    })).toEqual({ projectId: "project-b", sessionId: "previous" });
  });

  it("rejects an archive response for another target and commits the server-selected replacement", () => {
    expect(planArchivedSession({
      requestedSessionId: "session-a",
      requestedProjectId: "project-a",
      response: { sessionId: "session-b", projectId: "project-a" },
      currentSelection: { projectId: "project-a", sessionId: "session-a" },
    })).toEqual({ kind: "rejected", message: "archive session failed" });
    expect(planArchivedSession({
      requestedSessionId: "session-a",
      requestedProjectId: "project-a",
      response: {
        sessionId: "session-a",
        projectId: "project-a",
        selectedSessionId: "session-b",
        archivedSessionIds: ["session-a", "analysis-a"],
      },
      currentSelection: { projectId: "project-a", sessionId: "session-a" },
    })).toEqual({
      kind: "accepted",
      selection: { projectId: "project-a", sessionId: "session-b" },
      archivedIds: ["session-a", "analysis-a"],
    });
  });

  it("builds one message payload for text, attachments, and an exact resume run", () => {
    expect(planMessageSubmission({
      apiBase: "http://127.0.0.1:8787/",
      body: "继续",
      attachmentIds: ["attachment-a"],
      resumeRunId: "run-a",
    })).toEqual({
      kind: "submit",
      apiBase: "http://127.0.0.1:8787/",
      payload: {
        body: "继续",
        attachmentIds: ["attachment-a"],
        resumeRunId: "run-a",
      },
    });
  });

  it("normalizes failed and successful refresh responses before state commit", () => {
    expect(planRefreshResponse(false, { error: "offline" })).toEqual({
      kind: "rejected",
      message: "offline",
    });
    expect(planRefreshResponse(true, { selectedSessionId: "session-a" })).toEqual({
      kind: "accepted",
      state: { selectedSessionId: "session-a" },
    });
  });
});
