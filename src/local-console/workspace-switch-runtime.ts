import path from "node:path";

import {
  countOtherWorkspaceReferences,
  decideWorkspaceCleanupFlush,
  decideWorkspaceBindingPersistenceAction,
  decideWorkspaceBindingPersistenceCapability,
  decideWorkspacePathMatch,
  planActiveWorkspacePaths,
  planManagedWorkspaceRoots,
  planWorkspaceBindingSource,
  planWorkspaceBindingSwitch,
  planWorkspaceCleanup,
  planWorkspaceCleanupExecution,
  planDeferredWorkspaceCleanup,
  planWorkspaceSwitchSession,
  type LocalWorkspaceCleanup,
  type LocalWorkspaceCleanupPlan,
  type LocalWorkspaceBinding,
  type LocalWorkspaceBindingReference,
  type LocalWorkspaceSwitchTarget,
} from "./workspace-binding-plan.js";
import type {
  LocalConsolePersistedWorkspaceBinding,
  LocalConsoleStore,
  LocalConsoleWorkspaceSwitchResult,
} from "./types.js";

export class LocalWorkspaceSwitchRuntime {
  private readonly deferredCleanups = new Map<string, {
    sessionId: string;
    workspace: LocalWorkspaceCleanupPlan["workspace"];
  }>();
  private cleanupFlush: Promise<void> | null = null;

  constructor(private readonly input: {
    store: LocalConsoleStore;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    nowIso(): string;
    workdirRoot: string;
    resolveWorkspaceTarget(input: {
      projectId: string;
      folderPath: string;
      workdirRoot: string;
      target: LocalWorkspaceSwitchTarget;
      gitTimeoutMs?: number;
      signal?: AbortSignal;
    }): Promise<LocalWorkspaceBinding>;
    resolveExistingWorkspaceBinding(input: {
      projectId: string;
      sessionId: string;
      folderPath: string;
      workdirRoot: string;
      gitTimeoutMs?: number;
      signal?: AbortSignal;
    }): Promise<LocalWorkspaceBinding>;
    workspaceGitTimeoutMs?: number;
    listWorkspaceBindingReferences(): Promise<LocalWorkspaceBindingReference[]>;
    activeProviderWorkspacePaths(): Iterable<string>;
    activeManagedProcessWorkspaceRoots(): Iterable<string>;
    moveWorkspaceToTrash?: (workspacePath: string) => Promise<void>;
    invalidateWorkspaceFacts(): void;
    invalidateWorkspaceBindingCache(sessionId: string): void;
  }) {}

  async switch(input: {
    sessionId: string;
    target: LocalWorkspaceSwitchTarget;
    signal?: AbortSignal;
  }): Promise<LocalConsoleWorkspaceSwitchResult> {
    const capability = decideWorkspaceBindingPersistenceCapability({
      getAvailable: this.input.store.getSessionWorkspaceBinding !== undefined,
      setAvailable: this.input.store.setSessionWorkspaceBinding !== undefined,
    });
    if (capability === "unavailable") {
      throw new Error("local console workspace binding persistence unavailable");
    }
    const source = await this.input.storeCall("local-console-store-session-workspace-binding-switch", () =>
      this.input.store.getSessionWorkspace(input.sessionId));
    const persistedCurrent = await this.input.storeCall("local-console-store-get-session-workspace-binding", () =>
      this.input.store.getSessionWorkspaceBinding!(input.sessionId));
    const sourcePlan = planWorkspaceBindingSource({
      sessionId: input.sessionId,
      sourceBinding: source.workspaceBinding,
      sourceBaselineCommit: source.baselineCommit,
      sourceRevision: source.workspaceRevision,
      persisted: persistedCurrent,
    });
    const current = sourcePlan.kind === "persisted"
      ? {
          sessionId: input.sessionId,
          workspace: sourcePlan.binding.workspace,
          revision: sourcePlan.binding.revision,
        }
      : {
          sessionId: input.sessionId,
          workspace: await this.input.resolveExistingWorkspaceBinding({
            projectId: source.projectId,
            sessionId: input.sessionId,
            folderPath: source.folderPath,
            workdirRoot: this.input.workdirRoot,
            gitTimeoutMs: this.input.workspaceGitTimeoutMs,
            signal: input.signal,
          }),
          revision: sourcePlan.revision,
        };
    const target = await this.input.resolveWorkspaceTarget({
      projectId: source.projectId,
      folderPath: source.folderPath,
      workdirRoot: this.input.workdirRoot,
      target: input.target,
      gitTimeoutMs: this.input.workspaceGitTimeoutMs,
      signal: input.signal,
    });
    const references = await this.input.storeCall(
      "local-console-store-list-session-workspace-bindings",
      () => this.input.listWorkspaceBindingReferences(),
    );
    const plan = planWorkspaceBindingSwitch({
      current,
      target,
      otherSessionReferenceCount: countOtherWorkspaceReferences({
        currentSessionId: input.sessionId,
        workspace: current.workspace,
        references,
      }),
      activeProviderRun: hasWorkspacePath(
        current.workspace.canonicalPath,
        planActiveWorkspacePaths([...this.input.activeProviderWorkspacePaths()].map((cwd) => ({ cwd }))),
      ),
      activeManagedProcess: hasWorkspacePath(
        current.workspace.canonicalPath,
        planManagedWorkspaceRoots([...this.input.activeManagedProcessWorkspaceRoots()]),
      ),
    });
    let binding: LocalConsolePersistedWorkspaceBinding;
    try {
      const persistenceAction = decideWorkspaceBindingPersistenceAction({
        plan,
        persisted: persistedCurrent,
      });
      if (persistenceAction === "reuse") {
        binding = persistedCurrent!;
      } else {
        const next = plan.next;
        binding = await this.input.storeCall("local-console-store-set-session-workspace-binding", () =>
          this.input.store.setSessionWorkspaceBinding!({
            sessionId: input.sessionId,
            workspace: next.workspace,
            revision: next.revision,
            now: this.input.nowIso(),
          }));
        this.input.invalidateWorkspaceFacts();
        this.input.invalidateWorkspaceBindingCache(input.sessionId);
      }
    } catch (error) {
      throw error;
    }
    this.rememberDeferredCleanup(input.sessionId, plan.cleanup);
    const cleanup = await this.completeWorkspaceCleanup(plan.cleanup);

    const sessionSource = await this.input.storeCall("local-console-store-session-workspace-after-binding-switch", () =>
      this.input.store.getSessionWorkspace(input.sessionId));
    const sessions = await this.input.storeCall("local-console-store-list-sessions-after-binding-switch", () =>
      this.input.store.listSessions());
    const session = planWorkspaceSwitchSession({
      sessionId: input.sessionId,
      sourceSession: sessionSource.session,
      sessions,
    });
    return {
      session,
      binding,
      cleanup,
    };
  }

  async flushPendingWorkspaceCleanup(): Promise<void> {
    const decision = decideWorkspaceCleanupFlush({
      pendingCount: this.deferredCleanups.size,
      inFlight: this.cleanupFlush !== null,
    });
    if (decision === "skip") return;
    if (decision === "join") return await this.cleanupFlush!;
    const flush = this.flushDeferredWorkspaceCleanup();
    this.cleanupFlush = flush;
    try {
      await flush;
    } finally {
      this.cleanupFlush = null;
    }
  }

  private async flushDeferredWorkspaceCleanup(): Promise<void> {
    let references: LocalWorkspaceBindingReference[];
    try {
      references = await this.input.storeCall(
        "local-console-store-list-session-workspace-bindings-for-cleanup",
        () => this.input.listWorkspaceBindingReferences(),
      );
    } catch {
      return;
    }
    const activeProviderPaths = planActiveWorkspacePaths(
      [...this.input.activeProviderWorkspacePaths()].map((cwd) => ({ cwd })),
    );
    const activeManagedRoots = planManagedWorkspaceRoots(
      [...this.input.activeManagedProcessWorkspaceRoots()],
    );
    for (const [key, pending] of this.deferredCleanups) {
      const cleanup = planWorkspaceCleanup({
        workspace: pending.workspace,
        otherSessionReferenceCount: countOtherWorkspaceReferences({
          currentSessionId: pending.sessionId,
          workspace: pending.workspace,
          references,
        }),
        activeProviderRun: hasWorkspacePath(pending.workspace.canonicalPath, activeProviderPaths),
        activeManagedProcess: hasWorkspacePath(pending.workspace.canonicalPath, activeManagedRoots),
      });
      if (cleanup.kind === "preserve") continue;
      this.deferredCleanups.delete(key);
      await this.completeWorkspaceCleanup(cleanup);
    }
  }

  private rememberDeferredCleanup(
    sessionId: string,
    cleanup: LocalWorkspaceCleanup,
  ): string | null {
    const decision = planDeferredWorkspaceCleanup({ sessionId, cleanup });
    if (decision.kind === "none") return null;
    this.deferredCleanups.set(decision.key, {
      sessionId: decision.sessionId,
      workspace: decision.workspace,
    });
    return decision.key;
  }

  private async completeWorkspaceCleanup(
    cleanup: LocalWorkspaceCleanup,
  ): Promise<LocalWorkspaceCleanup> {
    const decision = planWorkspaceCleanupExecution({
      cleanup,
      trashAvailable: this.input.moveWorkspaceToTrash !== undefined,
    });
    if (decision.kind === "none") return decision;
    if (decision.kind === "preserve") return decision.cleanup;
    try {
      await this.input.moveWorkspaceToTrash!(decision.workspace.canonicalPath);
      return { kind: "trash", workspace: decision.workspace };
    } catch {
      return { kind: "preserve", workspace: decision.workspace, reason: "trash-failed" };
    }
  }

}

function hasWorkspacePath(workspacePath: string, candidates: Iterable<string>): boolean {
  const normalized = path.resolve(workspacePath);
  return [...candidates].some((candidate) => decideWorkspacePathMatch({
    workspacePath: normalized,
    candidatePath: path.resolve(candidate),
  }));
}
