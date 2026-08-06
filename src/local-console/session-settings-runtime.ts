import { formatLocalError } from "./runtime-domain.js";
import { withOptionalAgentTeamSnapshotLoadedAt } from "./session-team-snapshot.js";
import { LocalSessionTeamUpdateRuntime } from "./session-team-update-runtime.js";
import { decideSessionWorkspaceSwitch } from "./session-workspace-policy.js";
import {
  decideSessionArchive,
  decideSessionRestore,
  decideSessionWorkspaceInspection,
  decideSessionWorkspacePersistenceError,
  decideTeamSnapshotLoad,
} from "./session-settings-plan.js";
import {
  LocalConsoleSessionRunningError,
  LocalConsoleSessionWorkspaceLockedError,
  type LocalConsoleAgentTeamOwnership,
  type LocalConsoleAgentTeamSnapshot,
  type LocalConsoleSessionArchiveResult,
  type LocalConsoleSessionTeamUpdateState,
  type LocalConsoleSessionSummary,
  type LocalConsoleStore,
  type LocalConsoleWorkspaceMode,
} from "./types.js";
import { updateSessionMemberExecution } from "./session-execution-settings-runtime.js";

export class LocalSessionSettingsRuntime {
  private readonly teamUpdates: LocalSessionTeamUpdateRuntime;

  constructor(private readonly input: {
    store: LocalConsoleStore;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    nowIso(): string;
    loadAgentTeamSnapshot?: (binding: { ownership: LocalConsoleAgentTeamOwnership; id: string }) => Promise<LocalConsoleAgentTeamSnapshot>;
    workspaceGitTimeoutMs?: number;
    hasActiveRun(sessionId: string): boolean;
    inactiveSessions: Set<string>;
    processPending(sessionId: string): void;
    readWorkspaceFacts(folderPath: string): Promise<{ isGitRepository: boolean }>;
    invalidateWorkspaceFacts(): void;
  }) {
    this.teamUpdates = new LocalSessionTeamUpdateRuntime(input);
  }

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
    const inspection = decideSessionWorkspaceInspection({
      messageCount: messages.length,
      requestedMode: input.workspaceMode,
    });
    if (inspection.kind === "reject-locked") throw new LocalConsoleSessionWorkspaceLockedError();
    const workspaceIsGitRepository = inspection.kind === "inspect-git"
      ? await this.input.storeCall("local-console-store-session-workspace", () =>
          this.input.store.getSessionWorkspace(input.sessionId)).then((source) =>
            this.input.readWorkspaceFacts(source.folderPath)).then((facts) => facts.isGitRepository)
      : true;
    const decision = decideSessionWorkspaceSwitch({
      messageCount: messages.length,
      requestedMode: input.workspaceMode,
      workspaceIsGitRepository,
    });
    if (decision.kind === "reject" && decision.reason === "workspace-locked") {
      throw new LocalConsoleSessionWorkspaceLockedError();
    }
    if (decision.kind === "reject") throw new Error(decision.reason);
    try {
      const session = await this.input.storeCall("local-console-store-switch-session-workspace", () =>
        this.input.store.switchSessionWorkspace({ ...input, now: this.input.nowIso() }));
      this.input.invalidateWorkspaceFacts();
      return session;
    } catch (error) {
      const persistenceError = decideSessionWorkspacePersistenceError(formatLocalError(error));
      if (persistenceError.kind === "workspace-locked") {
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
    const load = decideTeamSnapshotLoad(this.input.loadAgentTeamSnapshot !== undefined);
    const loadedSnapshot = load.kind === "load"
      ? await this.input.loadAgentTeamSnapshot!({ ownership: input.agentTeamOwnership, id: input.agentTeamId })
      : undefined;
    const now = this.input.nowIso();
    const snapshot = withOptionalAgentTeamSnapshotLoadedAt(loadedSnapshot, now);
    return await this.input.storeCall("local-console-store-switch-session-team", () =>
      this.input.store.switchSessionTeam({ ...input, agentTeamSnapshot: snapshot, now }));
  }

  async inspectTeamUpdate(sessionId: string): Promise<LocalConsoleSessionTeamUpdateState> {
    return await this.teamUpdates.inspect(sessionId);
  }

  async applyTeamUpdate(sessionId: string, expectedUpdateToken?: string | null): Promise<LocalConsoleSessionTeamUpdateState> {
    return await this.teamUpdates.apply(sessionId, expectedUpdateToken);
  }

  async retryTeamUpdate(sessionId: string, expectedUpdateToken?: string | null): Promise<LocalConsoleSessionTeamUpdateState> {
    return await this.teamUpdates.retry(sessionId, expectedUpdateToken);
  }

  async cancelTeamUpdate(sessionId: string, expectedUpdateToken?: string | null): Promise<LocalConsoleSessionTeamUpdateState> {
    return await this.teamUpdates.cancel(sessionId, expectedUpdateToken);
  }

  async updateMemberExecution(input: {
    sessionId: string;
    memberName: string;
    action: "migrate" | "end";
    executionProfile?: import("./types.js").LocalConsoleExecutionProfile;
  }): Promise<LocalConsoleAgentTeamSnapshot> {
    return await updateSessionMemberExecution({
      store: this.input.store,
      storeCall: this.input.storeCall,
      nowIso: this.input.nowIso,
      hasActiveRun: this.input.hasActiveRun,
      request: input,
    });
  }

  async archive(sessionId: string): Promise<LocalConsoleSessionArchiveResult> {
    const decision = decideSessionArchive({
      capabilityAvailable: this.input.store.archiveSession !== undefined,
      activeRun: this.input.hasActiveRun(sessionId),
    });
    if (decision.kind === "unavailable") throw new Error("local console session archive unavailable");
    if (decision.kind === "running") throw new LocalConsoleSessionRunningError();
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
    const decision = decideSessionRestore(this.input.store.restoreSession !== undefined);
    if (decision.kind === "unavailable") throw new Error("local console session restore unavailable");
    const session = await this.input.storeCall("local-console-store-restore-session", () =>
      this.input.store.restoreSession!({ sessionId, now: this.input.nowIso() }));
    this.input.inactiveSessions.delete(sessionId);
    this.input.processPending(sessionId);
    return session;
  }
}
