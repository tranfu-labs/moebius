import { describe, expect, it, vi } from "vitest";

import { LocalConversationWorkspaceRuntime } from "../src/local-console/conversation-workspace-runtime.js";
import { LocalWorkspaceSwitchRuntime } from "../src/local-console/workspace-switch-runtime.js";
import type {
  LocalConsolePersistedWorkspaceBinding,
  LocalConsoleSessionSummary,
  LocalConsoleSessionWorkspaceSource,
  LocalConsoleStore,
} from "../src/local-console/types.js";
import type {
  LocalWorkspaceBinding,
  LocalWorkspaceBindingReference,
} from "../src/local-console/workspace-binding-plan.js";

const projectRoot: LocalWorkspaceBinding = {
  projectId: "project-a",
  kind: "project-root",
  canonicalPath: "/repo/project-a",
  branchName: "main",
  baseRef: "root-commit",
  originalRepoRoot: "/repo/project-a",
  lifecycle: "project-root",
};

const temporaryWorktree: LocalWorkspaceBinding = {
  projectId: "project-a",
  kind: "worktree",
  canonicalPath: "/runtime/worktrees/feature-a",
  branchName: "feature/a",
  baseRef: "feature-commit",
  originalRepoRoot: "/repo/project-a",
  lifecycle: "moebius-temporary",
};

describe("local console workspace switch runtime", () => {
  it("switches after messages, keeps a shared target, and increments the visible revision", async () => {
    const fixture = makeFixture({ current: persisted(projectRoot, 4), references: [temporaryWorktree] });
    const result = await fixture.runtime.switch({
      sessionId: "session-a",
      target: { target: "branch", branchName: "feature/a" },
    });

    expect(result.binding).toMatchObject({ workspace: temporaryWorktree, revision: 5 });
    expect(result.cleanup).toEqual({
      kind: "preserve",
      workspace: projectRoot,
      reason: "project-root",
    });
    expect(fixture.setBinding).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-a",
      workspace: temporaryWorktree,
      revision: 5,
    }));
    expect(fixture.invalidated).toHaveBeenCalledTimes(1);
  });

  it("does not reject a target already referenced by another session", async () => {
    const fixture = makeFixture({ current: persisted(projectRoot, 0), references: [temporaryWorktree] });
    fixture.sessions.push(summary("session-b", temporaryWorktree, 8));

    const result = await fixture.runtime.switch({
      sessionId: "session-a",
      target: { target: "branch", branchName: "feature/a" },
    });

    expect(result.binding.workspace).toEqual(temporaryWorktree);
    expect(fixture.sessions.find((session) => session.sessionId === "session-b")?.workspaceBinding)
      .toEqual(temporaryWorktree);
  });

  it("preserves a temporary workspace referenced by an archived session", async () => {
    const fixture = makeFixture({ current: persisted(temporaryWorktree, 3) });
    fixture.workspaceBindingReferences.push({
      sessionId: "archived-session",
      workspace: temporaryWorktree,
    });

    const result = await fixture.runtime.switch({
      sessionId: "session-a",
      target: { target: "project-root" },
    });

    expect(result.cleanup).toEqual({
      kind: "preserve",
      workspace: temporaryWorktree,
      reason: "shared-reference",
    });
    expect(fixture.moveWorkspaceToTrash).not.toHaveBeenCalled();
  });

  it("resolves before writing and preserves the old binding when target resolution fails", async () => {
    const fixture = makeFixture({ current: persisted(projectRoot, 4) });
    fixture.resolveTarget.mockRejectedValueOnce(new Error("target-not-found"));

    await expect(fixture.runtime.switch({
      sessionId: "session-a",
      target: { target: "branch", branchName: "missing" },
    })).rejects.toThrow("target-not-found");
    expect(fixture.setBinding).not.toHaveBeenCalled();
    expect(fixture.current.workspace).toEqual(projectRoot);
    expect(fixture.invalidated).not.toHaveBeenCalled();
  });

  it("keeps an active provider run on the old workspace and does not trash it", async () => {
    const fixture = makeFixture({ current: persisted(temporaryWorktree, 3) });
    const activeRun = { cwd: temporaryWorktree.canonicalPath };
    fixture.activeProviderPaths.push(activeRun.cwd);

    const result = await fixture.runtime.switch({
      sessionId: "session-a",
      target: { target: "project-root" },
    });

    expect(result.binding.workspace).toEqual(projectRoot);
    expect(result.cleanup).toEqual({
      kind: "preserve",
      workspace: temporaryWorktree,
      reason: "active-provider-run",
    });
    expect(activeRun.cwd).toBe(temporaryWorktree.canonicalPath);
    expect(fixture.moveWorkspaceToTrash).not.toHaveBeenCalled();
  });

  it("trashes the deferred temporary workspace after the provider run ends", async () => {
    const fixture = makeFixture({ current: persisted(temporaryWorktree, 3) });
    fixture.activeProviderPaths.push(temporaryWorktree.canonicalPath);

    const result = await fixture.runtime.switch({
      sessionId: "session-a",
      target: { target: "project-root" },
    });
    expect(result.cleanup).toEqual({
      kind: "preserve",
      workspace: temporaryWorktree,
      reason: "active-provider-run",
    });

    fixture.activeProviderPaths.length = 0;
    await fixture.runtime.flushPendingWorkspaceCleanup();

    expect(fixture.moveWorkspaceToTrash).toHaveBeenCalledWith(temporaryWorktree.canonicalPath);
  });

  it("keeps a temporary workspace when a managed process still uses it", async () => {
    const fixture = makeFixture({ current: persisted(temporaryWorktree, 3) });
    fixture.activeManagedPaths.push(temporaryWorktree.canonicalPath);

    const result = await fixture.runtime.switch({
      sessionId: "session-a",
      target: { target: "project-root" },
    });

    expect(result.cleanup).toEqual({
      kind: "preserve",
      workspace: temporaryWorktree,
      reason: "active-managed-process",
    });
    expect(fixture.moveWorkspaceToTrash).not.toHaveBeenCalled();
  });

  it("trashes the deferred temporary workspace after the managed process ends", async () => {
    const fixture = makeFixture({ current: persisted(temporaryWorktree, 3) });
    fixture.activeManagedPaths.push(temporaryWorktree.canonicalPath);

    const result = await fixture.runtime.switch({
      sessionId: "session-a",
      target: { target: "project-root" },
    });
    expect(result.cleanup).toEqual({
      kind: "preserve",
      workspace: temporaryWorktree,
      reason: "active-managed-process",
    });

    fixture.activeManagedPaths.length = 0;
    await fixture.runtime.flushPendingWorkspaceCleanup();

    expect(fixture.moveWorkspaceToTrash).toHaveBeenCalledWith(temporaryWorktree.canonicalPath);
  });

  it("plans Trash only after leaving an idle unshared temporary workspace", async () => {
    const fixture = makeFixture({ current: persisted(temporaryWorktree, 3) });

    const result = await fixture.runtime.switch({
      sessionId: "session-a",
      target: { target: "project-root" },
    });

    expect(result.cleanup).toEqual({ kind: "trash", workspace: temporaryWorktree });
    expect(fixture.moveWorkspaceToTrash).toHaveBeenCalledWith(temporaryWorktree.canonicalPath);
  });

  it("preserves an eligible temporary workspace when Trash is unavailable", async () => {
    const fixture = makeFixture({ current: persisted(temporaryWorktree, 3), trashAvailable: false });

    const result = await fixture.runtime.switch({
      sessionId: "session-a",
      target: { target: "project-root" },
    });

    expect(result.cleanup).toEqual({
      kind: "preserve",
      workspace: temporaryWorktree,
      reason: "trash-unavailable",
    });
    expect(fixture.moveWorkspaceToTrash).not.toHaveBeenCalled();
  });

  it("preserves an eligible temporary workspace when Trash fails", async () => {
    const fixture = makeFixture({ current: persisted(temporaryWorktree, 3) });
    fixture.moveWorkspaceToTrash.mockRejectedValueOnce(new Error("trash failed"));

    const result = await fixture.runtime.switch({
      sessionId: "session-a",
      target: { target: "project-root" },
    });

    expect(result.cleanup).toEqual({
      kind: "preserve",
      workspace: temporaryWorktree,
      reason: "trash-failed",
    });
    expect(fixture.moveWorkspaceToTrash).toHaveBeenCalledWith(temporaryWorktree.canonicalPath);
  });

  it("keeps legacy workspace sessions switchable without creating their old worktree", async () => {
    const fixture = makeFixture({ current: null });
    fixture.source.workspaceBinding = undefined;
    fixture.source.workspaceRevision = undefined;
    fixture.resolveExisting.mockResolvedValueOnce(temporaryWorktree);

    const result = await fixture.runtime.switch({
      sessionId: "session-a",
      target: { target: "project-root" },
    });

    expect(fixture.resolveExisting).toHaveBeenCalledTimes(1);
    expect(result.binding.revision).toBe(1);
    expect(result.binding.workspace).toEqual(projectRoot);
  });
});

describe("local console binding-backed workspace context", () => {
  it("uses the persisted binding for the next run and read-only workspace queries", async () => {
    const source: LocalConsoleSessionWorkspaceSource = {
      projectId: "project-a",
      title: "Session A",
      folderPath: projectRoot.canonicalPath,
      workspaceMode: "worktree",
      workspacePendingMode: null,
      workspaceBinding: temporaryWorktree,
      workspaceRevision: 7,
      baselineCommit: "feature-baseline",
    };
    const resolveWorkspaceSource = vi.fn();
    const store = {
      getSessionWorkspace: vi.fn(async () => source),
      getSessionBaselineCommit: vi.fn(async () => source.baselineCommit ?? null),
    } as unknown as LocalConsoleStore;
    const workspace = new LocalConversationWorkspaceRuntime({
      store,
      storeCall: async (_label, operation) => await operation(),
      baselineCommits: new Map(),
      workdirRoot: "/runtime",
      nowIso: () => "2026-08-26T00:00:00.000Z",
      worktreePath: vi.fn(() => "/runtime/worktrees/legacy-session"),
      readWorkspaceDiff: vi.fn(),
      readGitStatus: vi.fn(),
      generateWorkspaceDiff: vi.fn(),
      recordWorkspaceDiff: vi.fn(),
      workspacePatchPath: vi.fn(() => "/tmp/workspace.patch"),
      reportWorkspaceDiffError: vi.fn(),
      resolveWorkspaceSource,
      recordProjectWorkspaceStatus: vi.fn(async () => undefined),
    });

    await expect(workspace.resolveSource("session-a", source, new AbortController().signal)).resolves.toMatchObject({
      cwd: temporaryWorktree.canonicalPath,
      mode: "worktree",
      branchName: "feature/a",
    });
    await expect(workspace.readContext("session-a")).resolves.toEqual({
      workspacePath: temporaryWorktree.canonicalPath,
      workspaceMode: "worktree",
      baselineCommit: "feature-baseline",
    });
    expect(resolveWorkspaceSource).not.toHaveBeenCalled();
  });
});

function persisted(workspace: LocalWorkspaceBinding, revision: number): LocalConsolePersistedWorkspaceBinding {
  return {
    sessionId: "session-a",
    workspace,
    baselineCommit: `${workspace.branchName ?? "root"}-baseline`,
    revision,
  };
}

function summary(
  sessionId: string,
  workspace: LocalWorkspaceBinding,
  revision: number,
): LocalConsoleSessionSummary {
  return {
    sessionId,
    projectId: workspace.projectId,
    workspaceMode: workspace.kind === "worktree" ? "worktree" : "direct",
    workspacePendingMode: null,
    workspaceBinding: workspace,
    workspaceRevision: revision,
    title: sessionId,
    status: "waiting",
    awaitsHumanReason: null,
    unreadSince: null,
    runningCount: 0,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
    interruptedCount: 0,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
}

function makeFixture(input: {
  current: LocalConsolePersistedWorkspaceBinding | null;
  references?: LocalWorkspaceBinding[];
  trashAvailable?: boolean;
}) {
  let current = input.current;
  const source: LocalConsoleSessionWorkspaceSource = {
    projectId: "project-a",
    title: "Session A",
    folderPath: projectRoot.canonicalPath,
    workspaceMode: current?.workspace.kind === "worktree" ? "worktree" : "direct",
    workspacePendingMode: null,
    ...(current === null ? {} : {
      workspaceBinding: current.workspace,
      workspaceRevision: current.revision,
      baselineCommit: current.baselineCommit,
    }),
  };
  const sessions = [
    summary("session-a", current?.workspace ?? projectRoot, current?.revision ?? 0),
    ...(input.references ?? []).map((workspace, index) => summary(`reference-${String(index)}`, workspace, 0)),
  ];
  const workspaceBindingReferences: LocalWorkspaceBindingReference[] = sessions.flatMap((session) =>
    session.workspaceBinding === undefined
      ? []
      : [{ sessionId: session.sessionId, workspace: session.workspaceBinding }]);
  const setBinding = vi.fn(async (setInput: {
    sessionId: string;
    workspace: LocalWorkspaceBinding;
    revision: number;
    now: string;
  }) => {
    current = {
      sessionId: setInput.sessionId,
      workspace: setInput.workspace,
      baselineCommit: `${setInput.workspace.branchName ?? "root"}-baseline`,
      revision: setInput.revision,
    };
    source.workspaceMode = setInput.workspace.kind === "worktree" ? "worktree" : "direct";
    source.workspaceBinding = setInput.workspace;
    source.workspaceRevision = setInput.revision;
    source.baselineCommit = current.baselineCommit;
    const next = summary("session-a", setInput.workspace, setInput.revision);
    sessions[0] = next;
    return current;
  });
  const resolveTarget = vi.fn(async (targetInput: { target: { target: string; branchName?: string } }) =>
    targetInput.target.target === "project-root" ? projectRoot : temporaryWorktree);
  const resolveExisting = vi.fn(async () => current?.workspace ?? temporaryWorktree);
  const activeProviderPaths: string[] = [];
  const activeManagedPaths: string[] = [];
  const cacheInvalidated = vi.fn();
  const moveWorkspaceToTrash = vi.fn(async (_workspacePath: string) => undefined);
  const store = {
    sqlitePath: "/tmp/workspace-switch-runtime.sqlite",
    getSessionWorkspace: async () => source,
    getSessionWorkspaceBinding: async () => current,
    setSessionWorkspaceBinding: setBinding,
    listSessionWorkspaceBindings: async () => workspaceBindingReferences,
    listSessions: async () => sessions,
  } as unknown as LocalConsoleStore;
  const runtime = new LocalWorkspaceSwitchRuntime({
    store,
    storeCall: async (_label, operation) => await operation(),
    nowIso: () => "2026-08-26T00:00:00.000Z",
    workdirRoot: "/runtime",
    resolveWorkspaceTarget: resolveTarget,
    resolveExistingWorkspaceBinding: resolveExisting,
    listWorkspaceBindingReferences: async () => workspaceBindingReferences,
    activeProviderWorkspacePaths: () => activeProviderPaths,
    activeManagedProcessWorkspaceRoots: () => activeManagedPaths,
    moveWorkspaceToTrash: input.trashAvailable === false ? undefined : moveWorkspaceToTrash,
    invalidateWorkspaceFacts: vi.fn(),
    invalidateWorkspaceBindingCache: cacheInvalidated,
  });
  return {
    runtime,
    source,
    store,
    sessions,
    setBinding,
    resolveTarget,
    resolveExisting,
    activeProviderPaths,
    activeManagedPaths,
    workspaceBindingReferences,
    invalidated: (runtime as unknown as { input: { invalidateWorkspaceFacts: ReturnType<typeof vi.fn> } }).input.invalidateWorkspaceFacts,
    cacheInvalidated,
    moveWorkspaceToTrash,
    get current() { return current!; },
  };
}
