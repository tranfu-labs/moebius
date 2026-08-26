// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OperatorProject } from "@moebius/console-ui";

import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";
import type { ConsoleErrorController } from "./use-console-error-state.js";
import type { ConversationDraftStore } from "./draft-store.js";
import type { NewConversationDraftState } from "./new-conversation.js";
import { useNewConversationLauncher } from "./use-new-conversation-launcher.js";

const project = (projectId: string): OperatorProject => ({
  projectId,
  sourceType: "local-folder",
  title: projectId,
  folderPath: `/tmp/${projectId}`,
  worktreeMode: false,
  workspaceCwd: null,
  workspaceMode: "direct",
  worktreePath: null,
  worktreeUnavailableReason: null,
  workspaceUpdatedAt: null,
  sessions: [],
  runningCount: 0,
  waitingCount: 0,
  stuckCount: 0,
  errorCount: 0,
});

const conversation = (projectId: string | null): NewConversationDraftState => ({
  isOpen: true,
  projectId,
  workspaceMode: "direct",
  teamKey: null,
  draft: "",
  isSubmitting: false,
  error: null,
});

function catalog(): AgentTeamCatalogBundle {
  return {
    state: { status: "ready", teams: [] },
    setState: vi.fn(),
    lastUsedTeamKey: null,
    setLastUsedTeamKey: vi.fn(),
    selection: null,
    setSelection: vi.fn(),
    replaceTeams: vi.fn(),
    refresh: vi.fn(),
  };
}

function draftStore(): ConversationDraftStore {
  return {
    read: () => "",
    write: vi.fn(),
    clear: vi.fn(),
    readResumeRunId: () => null,
    writeResumeRunId: vi.fn(),
    clearResumeRunId: vi.fn(),
  };
}

function errors(): ConsoleErrorController {
  return {
    begin: vi.fn(() => ({ operationId: "workspace-preference" } as never)),
    fail: vi.fn(),
    succeed: vi.fn(),
    report: vi.fn(),
  };
}

describe("useNewConversationLauncher workspace preference", () => {
  it("persists an explicit workspace selection for the selected project", async () => {
    const dispatch = vi.fn();
    const update = vi.fn(async () => undefined);
    const errorController = errors();
    const { result } = renderHook(() => useNewConversationLauncher(
      [project("project-a")],
      conversation("project-a"),
      dispatch,
      catalog(),
      null,
      vi.fn(),
      draftStore(),
      (_teams, lastUsedTeamKey) => lastUsedTeamKey,
      vi.fn(async () => null),
      errorController,
      update,
    ));

    act(() => result.current.selectWorkspace("worktree"));

    expect(dispatch).toHaveBeenCalledWith({ type: "select-workspace", workspaceMode: "worktree" });
    await waitFor(() => expect(update).toHaveBeenCalledWith("project-a", "worktree"));
    expect(errorController.succeed).toHaveBeenCalledOnce();
  });

  it("keeps the draft selection and reports a preference write failure", async () => {
    const dispatch = vi.fn();
    const update = vi.fn(async () => {
      throw new Error("preference write failed");
    });
    const errorController = errors();
    const { result } = renderHook(() => useNewConversationLauncher(
      [project("project-a")],
      conversation("project-a"),
      dispatch,
      catalog(),
      null,
      vi.fn(),
      draftStore(),
      (_teams, lastUsedTeamKey) => lastUsedTeamKey,
      vi.fn(async () => null),
      errorController,
      update,
    ));

    act(() => result.current.selectWorkspace("worktree"));

    expect(dispatch).toHaveBeenCalledWith({ type: "select-workspace", workspaceMode: "worktree" });
    await waitFor(() => expect(errorController.fail).toHaveBeenCalledWith(
      expect.anything(),
      "preference write failed",
    ));
  });

  it("does not write a project preference when no project is selected", async () => {
    const update = vi.fn(async () => undefined);
    const { result } = renderHook(() => useNewConversationLauncher(
      [],
      conversation(null),
      vi.fn(),
      catalog(),
      null,
      vi.fn(),
      draftStore(),
      (_teams, lastUsedTeamKey) => lastUsedTeamKey,
      vi.fn(async () => null),
      errors(),
      update,
    ));

    act(() => result.current.selectWorkspace("worktree"));
    await Promise.resolve();

    expect(update).not.toHaveBeenCalled();
  });
});
