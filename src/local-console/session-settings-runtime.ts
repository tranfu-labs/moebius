import { formatLocalError } from "./runtime-domain.js";
import { decideSessionWorkspaceSwitch } from "./session-workspace-policy.js";
import { invalidateLocalWorkspaceFacts, readCachedLocalWorkspaceFacts } from "./workspace-source.js";
import {
  LocalConsoleSessionRunningError,
  LocalConsoleSessionWorkspaceLockedError,
  type LocalConsoleAgentTeamOwnership,
  type LocalConsoleAgentTeamSnapshot,
  type LocalConsoleSessionArchiveResult,
  type LocalConsoleSessionSummary,
  type LocalConsoleStore,
  type LocalConsoleWorkspaceMode,
} from "./types.js";

export class LocalSessionSettingsRuntime {
  constructor(private readonly input: {
    store: LocalConsoleStore;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    nowIso(): string;
    loadAgentTeamSnapshot?: (binding: { ownership: LocalConsoleAgentTeamOwnership; id: string }) => Promise<LocalConsoleAgentTeamSnapshot>;
    workspaceGitTimeoutMs?: number;
    hasActiveRun(sessionId: string): boolean;
    inactiveSessions: Set<string>;
    processPending(sessionId: string): void;
  }) {}

  async moveEmpty(input: { sessionId: string; projectId: string }): Promise<LocalConsoleSessionSummary> {
    return await this.input.storeCall("local-console-store-move-empty-session", () =>
      this.input.store.moveEmptySessionToProject({ ...input, now: this.input.nowIso() }));
  }

  async switchWorkspace(input: {
    sessionId: string;
    workspaceMode: LocalConsoleWorkspaceMode;
  }): Promise<LocalConsoleSessionSummary> {
    const messages = await this.input.storeCall("local-console-store-list-session-messages", () =>
      this.input.store.listMessages(input.sessionId));
    const source = messages.length === 0
      ? await this.input.storeCall("local-console-store-session-workspace", () =>
          this.input.store.getSessionWorkspace(input.sessionId))
      : null;
    const facts = source !== null && input.workspaceMode === "worktree"
      ? await readCachedLocalWorkspaceFacts({
          folderPath: source.folderPath,
          gitTimeoutMs: this.input.workspaceGitTimeoutMs,
        })
      : null;
    const decision = decideSessionWorkspaceSwitch({
      messageCount: messages.length,
      requestedMode: input.workspaceMode,
      workspaceIsGitRepository: facts?.isGitRepository ?? true,
    });
    if (decision.kind === "reject" && decision.reason === "workspace-locked") {
      throw new LocalConsoleSessionWorkspaceLockedError();
    }
    if (decision.kind === "reject") throw new Error(decision.reason);
    try {
      const session = await this.input.storeCall("local-console-store-switch-session-workspace", () =>
        this.input.store.switchSessionWorkspace({ ...input, now: this.input.nowIso() }));
      invalidateLocalWorkspaceFacts();
      return session;
    } catch (error) {
      if (formatLocalError(error) === "SESSION_WORKSPACE_LOCKED") {
        throw new LocalConsoleSessionWorkspaceLockedError();
      }
      throw error;
    }
  }

  async switchTeam(input: {
    sessionId: string;
    agentTeamOwnership: LocalConsoleAgentTeamOwnership;
    agentTeamId: string;
  }): Promise<LocalConsoleSessionSummary> {
    const snapshot = this.input.loadAgentTeamSnapshot === undefined
      ? undefined
      : await this.input.loadAgentTeamSnapshot({ ownership: input.agentTeamOwnership, id: input.agentTeamId });
    return await this.input.storeCall("local-console-store-switch-session-team", () =>
      this.input.store.switchSessionTeam({ ...input, agentTeamSnapshot: snapshot, now: this.input.nowIso() }));
  }

  async archive(sessionId: string): Promise<LocalConsoleSessionArchiveResult> {
    if (this.input.store.archiveSession === undefined) throw new Error("local console session archive unavailable");
    if (this.input.hasActiveRun(sessionId)) throw new LocalConsoleSessionRunningError();
    this.input.inactiveSessions.add(sessionId);
    try {
      return await this.input.storeCall("local-console-store-archive-session", () =>
        this.input.store.archiveSession!({ sessionId, now: this.input.nowIso() }));
    } catch (error) {
      this.input.inactiveSessions.delete(sessionId);
      throw error;
    }
  }

  async restore(sessionId: string): Promise<LocalConsoleSessionSummary> {
    if (this.input.store.restoreSession === undefined) throw new Error("local console session restore unavailable");
    const session = await this.input.storeCall("local-console-store-restore-session", () =>
      this.input.store.restoreSession!({ sessionId, now: this.input.nowIso() }));
    this.input.inactiveSessions.delete(sessionId);
    this.input.processPending(sessionId);
    return session;
  }
}
