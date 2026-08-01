import { log } from "../log.js";
import { formatLocalError } from "./runtime-domain.js";
import {
  decideConversationBaselineRead,
  decideConversationDiffRead,
  planConversationWorkspaceContext,
} from "./conversation-workspace-plan.js";
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
    worktreePath(workdirRoot: string, projectId: string, sessionId: string): string;
    readWorkspaceDiff(input: {
      workspacePath: string;
      baselineCommit: string | null;
      gitTimeoutMs?: number;
    }): Promise<LocalConsoleWorkspaceDiffSummary>;
  }) {}

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
