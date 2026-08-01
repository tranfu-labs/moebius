import { log } from "../log.js";
import { localSessionWorktreePath } from "./workspace-source.js";
import { readLocalConversationWorkspaceDiff } from "./workspace-diff.js";
import { formatLocalError } from "./runtime-domain.js";
import type {
  LocalConsoleStore,
  LocalConsoleWorkspaceDiffSummary,
  LocalConsoleWorkspaceMode,
} from "./types.js";

export class LocalConversationWorkspaceRuntime {
  constructor(private readonly input: {
    store: LocalConsoleStore;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    baselineCommits: Map<string, string | null>;
    workdirRoot: string;
    gitTimeoutMs?: number;
  }) {}

  async readDiff(sessionId: string): Promise<LocalConsoleWorkspaceDiffSummary> {
    try {
      await this.loadBaselineIfNeeded(sessionId);
      if (this.input.baselineCommits.get(sessionId) === null) {
        return { available: false, fileCount: null, reason: "missing-baseline" };
      }
      const context = await this.readContext(sessionId);
      const diff = await readLocalConversationWorkspaceDiff({
        workspacePath: context.workspacePath,
        baselineCommit: context.baselineCommit,
        gitTimeoutMs: this.input.gitTimeoutMs,
      });
      return diff.available
        ? { available: true, fileCount: diff.fileCount, reason: null }
        : { available: false, fileCount: null, reason: diff.reason };
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
    const baselineCommit = source.baselineCommit
      ?? this.input.baselineCommits.get(sessionId)
      ?? null;
    this.input.baselineCommits.set(sessionId, baselineCommit);
    return {
      workspacePath: source.workspaceMode === "worktree"
        ? localSessionWorktreePath(this.input.workdirRoot, source.projectId, sessionId)
        : source.folderPath,
      workspaceMode: source.workspaceMode,
      baselineCommit,
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
    if (
      this.input.baselineCommits.has(sessionId)
      || this.input.store.getSessionBaselineCommit === undefined
    ) {
      return;
    }
    const baselineCommit = await this.input.storeCall("local-console-store-session-baseline", () =>
      this.input.store.getSessionBaselineCommit!(sessionId));
    this.input.baselineCommits.set(sessionId, baselineCommit);
  }
}
