import { log } from "../log.js";
import { formatLocalError, planRuntimeFallback } from "./runtime-domain.js";
import {
  decideOriginalRepoStatus,
  decideConversationBaselineRead,
  decideConversationDiffRead,
  planConversationWorkspaceContext,
  planOriginalRepoStatusRead,
  planWorkspaceDiffRecording,
  planWorkspaceWorktreeMode,
} from "./conversation-workspace-plan.js";
import type {
  LocalConsoleStore,
  LocalConsoleWorkspaceDiffSummary,
  LocalConsoleWorkspaceMode,
  LocalConsoleSessionWorkspaceSource,
} from "./types.js";
import type { LocalSessionFactWritingStore } from "./runtime-store-ports.js";
import type { ResolvedLocalWorkspace } from "./workspace-source.js";

export class LocalConversationWorkspaceRuntime {
  constructor(private readonly input: {
    store: LocalConsoleStore;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    baselineCommits: Map<string, string | null>;
    workdirRoot: string;
    gitTimeoutMs?: number;
    nowIso(): string;
    worktreePath(workdirRoot: string, projectId: string, sessionId: string): string;
    readWorkspaceDiff(input: {
      workspacePath: string;
      baselineCommit: string | null;
      gitTimeoutMs?: number;
    }): Promise<LocalConsoleWorkspaceDiffSummary>;
    readGitStatus(input: {
      folderPath: string;
      gitTimeoutMs?: number;
      signal: AbortSignal;
    }): Promise<string>;
    generateWorkspaceDiff(input: {
      worktreePath: string;
      runDir: string;
      baseRef: string | null;
      branchName: string | null;
      originalRepoRoot: string | null;
      gitTimeoutMs?: number;
      signal: AbortSignal;
    }): Promise<{
      baseRef: string;
      branchName: string;
      worktreePath: string;
      patchPath: string;
      affectedFiles: string[];
    }>;
    recordWorkspaceDiff(input: Parameters<LocalSessionFactWritingStore["recordWorkspaceDiff"]>[0]): Promise<void>;
    workspacePatchPath(runDir: string): string;
    reportWorkspaceDiffError(error: string, sessionId: string, runId: string): void;
    resolveWorkspaceSource: typeof import("./workspace-source.js").resolveLocalWorkspaceSource;
    recordProjectWorkspaceStatus: LocalConsoleStore["recordProjectWorkspaceStatus"];
  }) {}

  async resolveSource(
    sessionId: string,
    source: LocalConsoleSessionWorkspaceSource,
    signal: AbortSignal,
  ): Promise<ResolvedLocalWorkspace> {
    const workspace = await this.input.resolveWorkspaceSource({
      projectId: source.projectId,
      sessionId,
      folderPath: source.folderPath,
      worktreeMode: planWorkspaceWorktreeMode(source.workspaceMode),
      workdirRoot: this.input.workdirRoot,
      gitTimeoutMs: this.input.gitTimeoutMs,
      signal,
    });
    await this.input.storeCall("local-console-store-record-workspace", () =>
      this.input.recordProjectWorkspaceStatus({
        projectId: source.projectId,
        cwd: workspace.cwd,
        mode: workspace.mode,
        worktreePath: workspace.worktreePath,
        worktreeUnavailableReason: workspace.worktreeUnavailableReason,
        now: this.input.nowIso(),
      }));
    return workspace;
  }

  async recordGeneratedDiffIfNeeded(input: {
    sessionId: string;
    runId: string;
    runDir: string;
    workspace: ResolvedLocalWorkspace;
    finalText: string;
    signal: AbortSignal;
  }): Promise<void> {
    const recording = planWorkspaceDiffRecording({
      workspaceMode: input.workspace.mode,
      worktreePath: input.workspace.worktreePath,
      finalText: input.finalText,
    });
    if (recording.kind === "skip") return;
    try {
      const statusRead = planOriginalRepoStatusRead(input.workspace.originalRepoRoot);
      const originalStatus = statusRead.kind === "clean"
        ? ""
        : await this.input.readGitStatus({
            folderPath: statusRead.folderPath,
            gitTimeoutMs: this.input.gitTimeoutMs,
            signal: input.signal,
          });
      const status = decideOriginalRepoStatus(originalStatus);
      if (status.kind === "dirty") throw new Error(`original-repo-dirty-before-diff:${status.status}`);
      const diff = await this.input.generateWorkspaceDiff({
        worktreePath: recording.worktreePath,
        runDir: input.runDir,
        baseRef: input.workspace.baseRef,
        branchName: input.workspace.branchName,
        originalRepoRoot: input.workspace.originalRepoRoot,
        gitTimeoutMs: this.input.gitTimeoutMs,
        signal: input.signal,
      });
      await this.input.storeCall("local-console-store-record-workspace-diff", () =>
        this.input.recordWorkspaceDiff({
          sessionId: input.sessionId,
          runId: input.runId,
          originalRepoRoot: input.workspace.originalRepoRoot,
          baseRef: diff.baseRef,
          branchName: diff.branchName,
          worktreePath: diff.worktreePath,
          patchPath: diff.patchPath,
          affectedFiles: diff.affectedFiles,
          status: "generated",
          error: null,
          now: this.input.nowIso(),
        }));
    } catch (error) {
      const message = formatLocalError(error);
      this.input.reportWorkspaceDiffError(message, input.sessionId, input.runId);
      await this.input.recordWorkspaceDiff({
        sessionId: input.sessionId,
        runId: input.runId,
        originalRepoRoot: input.workspace.originalRepoRoot,
        baseRef: planRuntimeFallback(input.workspace.baseRef, "unknown"),
        branchName: planRuntimeFallback(input.workspace.branchName, "unknown"),
        worktreePath: recording.worktreePath,
        patchPath: this.input.workspacePatchPath(input.runDir),
        affectedFiles: [],
        status: "failed",
        error: message,
        now: this.input.nowIso(),
      });
    }
  }

  async readDiff(sessionId: string): Promise<LocalConsoleWorkspaceDiffSummary> {
    try {
      await this.loadBaselineIfNeeded(sessionId);
      const baselineDecision = decideConversationDiffRead(this.input.baselineCommits.get(sessionId));
      if (baselineDecision.kind === "missing-baseline") {
        return { available: false, fileCount: null, reason: "missing-baseline" };
      }
      const context = await this.readContext(sessionId);
      const diff = await this.input.readWorkspaceDiff({
        workspacePath: context.workspacePath,
        baselineCommit: context.baselineCommit,
        gitTimeoutMs: this.input.gitTimeoutMs,
      });
      return diff;
    } catch (error) {
      log({ event: "local-console-workspace-diff-count-unavailable", sessionId, error: formatLocalError(error) });
      return { available: false, fileCount: null, reason: "workspace-unavailable" };
    }
  }

  async readContext(sessionId: string): Promise<{
    workspacePath: string;
    workspaceMode: LocalConsoleWorkspaceMode;
    baselineCommit: string | null;
  }> {
    await this.loadBaselineIfNeeded(sessionId);
    const source = await this.input.storeCall("local-console-store-session-workspace-files", () =>
      this.input.store.getSessionWorkspace(sessionId));
    const plan = planConversationWorkspaceContext({
      workspaceMode: source.workspaceMode,
      persistedBaselineCommit: source.baselineCommit,
      cachedBaselineCommit: this.input.baselineCommits.get(sessionId),
    });
    this.input.baselineCommits.set(sessionId, plan.baselineCommit);
    return {
      workspacePath: plan.workspaceKind === "worktree"
        ? this.input.worktreePath(this.input.workdirRoot, source.projectId, sessionId)
        : source.folderPath,
      workspaceMode: source.workspaceMode,
      baselineCommit: plan.baselineCommit,
    };
  }

  async readModeBestEffort(sessionId: string): Promise<LocalConsoleWorkspaceMode> {
    try {
      const source = await this.input.storeCall("local-console-store-session-workspace-mode", () =>
        this.input.store.getSessionWorkspace(sessionId));
      return source.workspaceMode;
    } catch {
      return "direct";
    }
  }

  private async loadBaselineIfNeeded(sessionId: string): Promise<void> {
    const decision = decideConversationBaselineRead({
      cached: this.input.baselineCommits.has(sessionId),
      persistenceAvailable: this.input.store.getSessionBaselineCommit !== undefined,
    });
    if (decision.kind === "skip") return;
    const baselineCommit = await this.input.storeCall("local-console-store-session-baseline", () =>
      this.input.store.getSessionBaselineCommit!(sessionId));
    this.input.baselineCommits.set(sessionId, baselineCommit);
  }
}
