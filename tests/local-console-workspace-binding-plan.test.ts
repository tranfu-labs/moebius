import { describe, expect, it } from "vitest";

import {
  countOtherWorkspaceReferences,
  planWorkspaceBindingSwitch,
  planWorkspaceCleanup,
  workspaceBindingKey,
  type LocalSessionWorkspaceBinding,
  type LocalWorkspaceBinding,
} from "../src/local-console/workspace-binding-plan.js";

const temporaryWorktree: LocalWorkspaceBinding = {
  projectId: "project-a",
  kind: "worktree",
  canonicalPath: "/worktrees/feature-a",
  branchName: "feature/a",
  baseRef: "abc123",
  originalRepoRoot: "/projects/a",
  lifecycle: "moebius-temporary",
};

const projectRoot: LocalWorkspaceBinding = {
  projectId: "project-a",
  kind: "project-root",
  canonicalPath: "/projects/a",
  branchName: "main",
  baseRef: "abc123",
  originalRepoRoot: "/projects/a",
  lifecycle: "project-root",
};

function sessionBinding(workspace: LocalWorkspaceBinding, revision = 4): LocalSessionWorkspaceBinding {
  return { sessionId: "session-a", workspace, revision };
}

describe("workspace binding plan", () => {
  it("uses project, kind, and canonical path as the shared identity", () => {
    expect(workspaceBindingKey(temporaryWorktree)).toBe(
      ["project-a", "worktree", "/worktrees/feature-a"].join("\u0000"),
    );
    expect(workspaceBindingKey(temporaryWorktree)).not.toBe(
      workspaceBindingKey({ ...temporaryWorktree, projectId: "project-b" }),
    );
  });

  it("counts distinct other sessions referencing the same workspace", () => {
    expect(countOtherWorkspaceReferences({
      currentSessionId: "session-a",
      workspace: temporaryWorktree,
      references: [
        { sessionId: "session-a", workspace: temporaryWorktree },
        { sessionId: "session-b", workspace: temporaryWorktree },
        { sessionId: "session-b", workspace: temporaryWorktree },
        { sessionId: "session-c", workspace: projectRoot },
      ],
    })).toBe(1);
  });

  it("increments the session revision without rejecting a shared target", () => {
    const plan = planWorkspaceBindingSwitch({
      current: sessionBinding(projectRoot),
      target: temporaryWorktree,
      otherSessionReferenceCount: 2,
      activeProviderRun: false,
      activeManagedProcess: false,
    });

    expect(plan).toEqual({
      kind: "switched",
      previous: sessionBinding(projectRoot),
      next: sessionBinding(temporaryWorktree, 5),
      cleanup: { kind: "preserve", workspace: projectRoot, reason: "project-root" },
    });
  });

  it("keeps the same binding stable", () => {
    const current = sessionBinding(temporaryWorktree);
    expect(planWorkspaceBindingSwitch({
      current,
      target: { ...temporaryWorktree, branchName: "feature/a-renamed" },
      otherSessionReferenceCount: 0,
      activeProviderRun: false,
      activeManagedProcess: false,
    })).toEqual({
      kind: "unchanged",
      next: current,
      cleanup: { kind: "none", reason: "same-binding" },
    });
  });

  it.each([
    ["shared", 1, false, false, { kind: "preserve", reason: "shared-reference" }],
    ["provider", 0, true, false, { kind: "preserve", reason: "active-provider-run" }],
    ["managed process", 0, false, true, { kind: "preserve", reason: "active-managed-process" }],
    ["user-managed", 0, false, false, { kind: "preserve", reason: "not-temporary" }],
  ] as const)("preserves a temporary workspace when cleanup is unsafe: %s", (_label, references, provider, managed, expected) => {
    expect(planWorkspaceCleanup({
      workspace: _label === "user-managed" ? { ...temporaryWorktree, lifecycle: "user-managed" } : temporaryWorktree,
      otherSessionReferenceCount: references,
      activeProviderRun: provider,
      activeManagedProcess: managed,
    })).toMatchObject(expected);
  });

  it("plans Trash only for an idle, unshared Moebius temporary worktree", () => {
    expect(planWorkspaceCleanup({
      workspace: temporaryWorktree,
      otherSessionReferenceCount: 0,
      activeProviderRun: false,
      activeManagedProcess: false,
    })).toEqual({ kind: "trash", workspace: temporaryWorktree });
  });
});
