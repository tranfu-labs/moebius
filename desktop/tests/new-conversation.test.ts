import { describe, expect, it, vi } from "vitest";
import {
  canSubmitNewConversation,
  createNewConversationDraft,
  reduceNewConversationDraft,
  submitNewConversation,
} from "../src/console-page/new-conversation.js";

describe("new conversation draft state machine", () => {
  it("allows drafting without a project but requires project, team, text, and an idle submit state", () => {
    const draft = createNewConversationDraft({ teamKey: "system:development", draft: "目标" });
    expect(draft).toEqual({
      isOpen: true,
      projectId: null,
      workspaceMode: "direct",
      teamKey: "system:development",
      draft: "目标",
      isSubmitting: false,
      error: null,
    });
    expect(canSubmitNewConversation(draft)).toBe(false);
    expect(canSubmitNewConversation({ ...draft, projectId: "project-a" })).toBe(true);
    expect(canSubmitNewConversation({ ...draft, projectId: "project-a", isSubmitting: true })).toBe(false);
  });

  it("owns project, workspace, team, text, and submission transitions outside the app shell", () => {
    const opened = reduceNewConversationDraft(null, {
      type: "open",
      draft: createNewConversationDraft({ teamKey: "system:development", draft: "" }),
    });
    const withProject = reduceNewConversationDraft(opened, { type: "select-project", projectId: "project-a" });
    const withWorkspace = reduceNewConversationDraft(withProject, { type: "select-workspace", workspaceMode: "worktree" });
    const withTeam = reduceNewConversationDraft(withWorkspace, { type: "select-team", teamKey: "user:custom" });
    const withText = reduceNewConversationDraft(withTeam, { type: "edit-draft", draft: "保留的目标" });
    const submitting = reduceNewConversationDraft(withText, { type: "submit-started" });
    const failed = reduceNewConversationDraft(submitting, { type: "submit-failed", error: "请重试" });

    expect(failed).toEqual({
      isOpen: true,
      projectId: "project-a",
      workspaceMode: "worktree",
      teamKey: "user:custom",
      draft: "保留的目标",
      isSubmitting: false,
      error: "请重试",
    });
    const hidden = reduceNewConversationDraft(failed, { type: "hide" });
    expect(hidden).toEqual({ ...failed, isOpen: false });
    expect(reduceNewConversationDraft(hidden, { type: "show" })).toEqual(failed);
    expect(reduceNewConversationDraft(failed, { type: "consume" })).toBeNull();
    expect(reduceNewConversationDraft(null, { type: "edit-draft", draft: "ignored" })).toBeNull();
  });

  it("keeps the isolated workspace draft while browsing a session and consumes it only after success", () => {
    const isolated = createNewConversationDraft({
      projectId: "project-a",
      workspaceMode: "worktree",
      teamKey: "system:development",
      draft: "保留这段目标",
    });

    const hidden = reduceNewConversationDraft(isolated, { type: "hide" });
    const restored = reduceNewConversationDraft(hidden, { type: "show" });
    const submitting = reduceNewConversationDraft(restored, { type: "submit-started" });
    const failed = reduceNewConversationDraft(submitting, { type: "submit-failed", error: "创建失败" });

    expect(restored).toEqual(isolated);
    expect(failed).toMatchObject({
      isOpen: true,
      projectId: "project-a",
      workspaceMode: "worktree",
      teamKey: "system:development",
      draft: "保留这段目标",
      isSubmitting: false,
    });
    expect(reduceNewConversationDraft(failed, { type: "consume" })).toBeNull();
  });

  it("does not update the last-used record when session creation fails", async () => {
    const recordSuccessfulTeam = vi.fn();

    await expect(submitNewConversation({
      projectId: "project-a",
      workspaceMode: "direct",
      initialMessage: "first message",
      team: { teamId: "development", ownership: "system" },
      createSessionWithFirstMessage: vi.fn().mockResolvedValue(null),
      recordSuccessfulTeam,
    })).resolves.toEqual({ created: false });

    expect(recordSuccessfulTeam).not.toHaveBeenCalled();
  });

  it("updates the record exactly once after session creation succeeds", async () => {
    const recordSuccessfulTeam = vi.fn().mockResolvedValue(undefined);
    const createSessionWithFirstMessage = vi.fn().mockResolvedValue({ sessionId: "local:created" });

    await expect(submitNewConversation({
      projectId: "project-a",
      workspaceMode: "worktree",
      initialMessage: "first message",
      team: { teamId: "my-team", ownership: "user" },
      createSessionWithFirstMessage,
      recordSuccessfulTeam,
    })).resolves.toEqual({ created: true, sessionId: "local:created", preferenceRecorded: true });

    expect(recordSuccessfulTeam).toHaveBeenCalledTimes(1);
    expect(recordSuccessfulTeam).toHaveBeenCalledWith({
      sessionId: "local:created",
      teamId: "my-team",
      ownership: "user",
    });
    expect(createSessionWithFirstMessage).toHaveBeenCalledWith(
      "project-a",
      "first message",
      { teamId: "my-team", ownership: "user" },
      "worktree",
    );
  });

  it("keeps a successfully created conversation successful when preference persistence fails", async () => {
    const preferenceError = new Error("disk unavailable");

    await expect(submitNewConversation({
      projectId: "project-a",
      workspaceMode: "direct",
      initialMessage: "first message",
      team: { teamId: "development", ownership: "system" },
      createSessionWithFirstMessage: vi.fn().mockResolvedValue({ sessionId: "local:created" }),
      recordSuccessfulTeam: vi.fn().mockRejectedValue(preferenceError),
    })).resolves.toEqual({ created: true, sessionId: "local:created", preferenceRecorded: false, preferenceError });
  });
});
