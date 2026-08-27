import type {
  LocalConsolePersistedWorkspaceBinding,
  LocalConsoleSessionSummary,
} from "./types.js";

export type LocalWorkspaceBindingKind = "project-root" | "worktree";

export type LocalWorkspaceBindingLifecycle =
  | "project-root"
  | "moebius-temporary"
  | "user-managed"
  | "unknown";

export interface LocalWorkspaceBinding {
  projectId: string;
  kind: LocalWorkspaceBindingKind;
  canonicalPath: string;
  branchName: string | null;
  baseRef: string | null;
  originalRepoRoot: string | null;
  lifecycle: LocalWorkspaceBindingLifecycle;
}

export type LocalWorkspaceSwitchTarget =
  | { target: "project-root" }
  | { target: "branch"; branchName: string };

export type LocalWorkspaceBindingSourcePlan =
  | { kind: "persisted"; binding: LocalConsolePersistedWorkspaceBinding }
  | { kind: "legacy"; revision: number };

export function planWorkspaceBindingSource(input: {
  sessionId: string;
  sourceBinding?: LocalWorkspaceBinding;
  sourceBaselineCommit?: string | null;
  sourceRevision?: number;
  persisted: LocalConsolePersistedWorkspaceBinding | null;
}): LocalWorkspaceBindingSourcePlan {
  if (input.sourceBinding !== undefined) {
    return {
      kind: "persisted",
      binding: {
        sessionId: input.sessionId,
        workspace: input.sourceBinding,
        baselineCommit: input.sourceBaselineCommit ?? null,
        revision: input.sourceRevision ?? 0,
      },
    };
  }
  if (input.persisted !== null) return { kind: "persisted", binding: input.persisted };
  return { kind: "legacy", revision: input.sourceRevision ?? 0 };
}

export function decideWorkspaceBindingPersistenceCapability(input: {
  getAvailable: boolean;
  setAvailable: boolean;
}): "available" | "unavailable" {
  return input.getAvailable && input.setAvailable ? "available" : "unavailable";
}

export function decideWorkspaceBindingPersistenceAction(input: {
  plan: LocalWorkspaceBindingSwitchPlan;
  persisted: LocalConsolePersistedWorkspaceBinding | null;
}): "reuse" | "write" {
  return input.plan.kind === "unchanged" && input.persisted !== null ? "reuse" : "write";
}

export function planWorkspaceBindingReferences(
  sessions: readonly Pick<LocalConsoleSessionSummary, "sessionId" | "workspaceBinding">[],
): LocalWorkspaceBindingReference[] {
  return sessions.flatMap((session) => session.workspaceBinding === undefined
    ? []
    : [{ sessionId: session.sessionId, workspace: session.workspaceBinding }]);
}

export function decideWorkspacePathMatch(input: {
  workspacePath: string;
  candidatePath: string;
}): boolean {
  return input.workspacePath === input.candidatePath;
}

export function planWorkspaceSwitchSession(input: {
  sessionId: string;
  sourceSession?: LocalConsoleSessionSummary;
  sessions: readonly LocalConsoleSessionSummary[];
}): LocalConsoleSessionSummary {
  if (input.sourceSession !== undefined) return input.sourceSession;
  const session = input.sessions.find((candidate) => candidate.sessionId === input.sessionId);
  if (session === undefined) throw new Error(`local console session not found: ${input.sessionId}`);
  return session;
}

export function decideWorkspaceBindingSource(
  binding: LocalWorkspaceBinding | undefined,
): "legacy" | "binding" {
  return binding === undefined ? "legacy" : "binding";
}

export function planResolvedWorkspaceFromBinding(binding: LocalWorkspaceBinding): {
  cwd: string;
  mode: "direct" | "worktree";
  worktreePath: string | null;
  worktreeUnavailableReason: string | null;
  branchName: string | null;
  baseRef: string | null;
  originalRepoRoot: string | null;
} {
  const mode = binding.kind === "worktree" ? "worktree" : "direct";
  return {
    cwd: binding.canonicalPath,
    mode,
    worktreePath: mode === "worktree" ? binding.canonicalPath : null,
    worktreeUnavailableReason: null,
    branchName: binding.branchName,
    baseRef: binding.baseRef,
    originalRepoRoot: binding.originalRepoRoot,
  };
}

export function planWorkspaceReadPath(input: {
  binding?: LocalWorkspaceBinding;
  fallbackPath: string;
}): string {
  return input.binding?.canonicalPath ?? input.fallbackPath;
}

export function planActiveWorkspacePaths(
  runs: readonly { cwd: string | null }[],
): string[] {
  return runs.flatMap((run) => run.cwd === null ? [] : [run.cwd]);
}

export function planManagedWorkspaceRoots(roots: readonly string[] | undefined): readonly string[] {
  return roots ?? [];
}

export interface LocalSessionWorkspaceBinding {
  sessionId: string;
  workspace: LocalWorkspaceBinding;
  revision: number;
}

export interface LocalWorkspaceBindingReference {
  sessionId: string;
  workspace: LocalWorkspaceBinding;
}

export type LocalWorkspaceCleanupPlan =
  | { kind: "trash"; workspace: LocalWorkspaceBinding }
  | {
      kind: "preserve";
      workspace: LocalWorkspaceBinding;
      reason:
        | "project-root"
        | "not-temporary"
        | "shared-reference"
        | "active-provider-run"
        | "active-managed-process"
        | "trash-unavailable"
        | "trash-failed";
    };

export type LocalWorkspaceCleanup =
  | LocalWorkspaceCleanupPlan
  | { kind: "none"; reason: "same-binding" };

export function planWorkspaceCleanupExecution(input: {
  cleanup: LocalWorkspaceCleanup;
  trashAvailable: boolean;
}):
  | { kind: "none"; reason: "same-binding" }
  | { kind: "trash"; workspace: LocalWorkspaceBinding }
  | { kind: "preserve"; cleanup: LocalWorkspaceCleanupPlan } {
  if (input.cleanup.kind === "none") return input.cleanup;
  if (input.cleanup.kind !== "trash") {
    return { kind: "preserve", cleanup: input.cleanup };
  }
  if (!input.trashAvailable) {
    return {
      kind: "preserve",
      cleanup: { kind: "preserve", workspace: input.cleanup.workspace, reason: "trash-unavailable" },
    };
  }
  return { kind: "trash", workspace: input.cleanup.workspace };
}

export type LocalWorkspaceBindingSwitchPlan =
  | {
      kind: "unchanged";
      next: LocalSessionWorkspaceBinding;
      cleanup: { kind: "none"; reason: "same-binding" };
    }
  | {
      kind: "switched";
      previous: LocalSessionWorkspaceBinding;
      next: LocalSessionWorkspaceBinding;
      cleanup: LocalWorkspaceCleanup;
    };

export function workspaceBindingKey(workspace: LocalWorkspaceBinding): string {
  return [workspace.projectId, workspace.kind, workspace.canonicalPath].join("\u0000");
}

export type DeferredWorkspaceCleanupPlan =
  | {
      kind: "defer";
      key: string;
      sessionId: string;
      workspace: LocalWorkspaceBinding;
    }
  | { kind: "none" };

export function planDeferredWorkspaceCleanup(input: {
  sessionId: string;
  cleanup: LocalWorkspaceCleanup;
}): DeferredWorkspaceCleanupPlan {
  if (
    input.cleanup.kind !== "preserve"
    || (input.cleanup.reason !== "active-provider-run" && input.cleanup.reason !== "active-managed-process")
  ) {
    return { kind: "none" };
  }
  return {
    kind: "defer",
    key: workspaceBindingKey(input.cleanup.workspace),
    sessionId: input.sessionId,
    workspace: input.cleanup.workspace,
  };
}

export type WorkspaceCleanupFlushDecision = "skip" | "join" | "start";

export function decideWorkspaceCleanupFlush(input: {
  pendingCount: number;
  inFlight: boolean;
}): WorkspaceCleanupFlushDecision {
  if (input.pendingCount === 0) return "skip";
  if (input.inFlight) return "join";
  return "start";
}

export function countOtherWorkspaceReferences(input: {
  currentSessionId: string;
  workspace: LocalWorkspaceBinding;
  references: readonly LocalWorkspaceBindingReference[];
}): number {
  const targetKey = workspaceBindingKey(input.workspace);
  const otherSessionIds = new Set<string>();
  for (const reference of input.references) {
    if (reference.sessionId === input.currentSessionId) continue;
    if (workspaceBindingKey(reference.workspace) === targetKey) {
      otherSessionIds.add(reference.sessionId);
    }
  }
  return otherSessionIds.size;
}

export function planWorkspaceCleanup(input: {
  workspace: LocalWorkspaceBinding;
  otherSessionReferenceCount: number;
  activeProviderRun: boolean;
  activeManagedProcess: boolean;
}): LocalWorkspaceCleanupPlan {
  if (input.workspace.kind === "project-root") {
    return { kind: "preserve", workspace: input.workspace, reason: "project-root" };
  }
  if (input.workspace.lifecycle !== "moebius-temporary") {
    return { kind: "preserve", workspace: input.workspace, reason: "not-temporary" };
  }
  if (input.otherSessionReferenceCount > 0) {
    return { kind: "preserve", workspace: input.workspace, reason: "shared-reference" };
  }
  if (input.activeProviderRun) {
    return { kind: "preserve", workspace: input.workspace, reason: "active-provider-run" };
  }
  if (input.activeManagedProcess) {
    return { kind: "preserve", workspace: input.workspace, reason: "active-managed-process" };
  }
  return { kind: "trash", workspace: input.workspace };
}

export function planWorkspaceBindingSwitch(input: {
  current: LocalSessionWorkspaceBinding;
  target: LocalWorkspaceBinding;
  otherSessionReferenceCount: number;
  activeProviderRun: boolean;
  activeManagedProcess: boolean;
}): LocalWorkspaceBindingSwitchPlan {
  if (workspaceBindingKey(input.current.workspace) === workspaceBindingKey(input.target)) {
    return {
      kind: "unchanged",
      next: input.current,
      cleanup: { kind: "none", reason: "same-binding" },
    };
  }

  return {
    kind: "switched",
    previous: input.current,
    next: {
      sessionId: input.current.sessionId,
      workspace: input.target,
      revision: input.current.revision + 1,
    },
    cleanup: planWorkspaceCleanup({
      workspace: input.current.workspace,
      otherSessionReferenceCount: input.otherSessionReferenceCount,
      activeProviderRun: input.activeProviderRun,
      activeManagedProcess: input.activeManagedProcess,
    }),
  };
}
