import { nonContinuableSystemMessage, resolveLocalSessionContinuation } from "./session-status.js";
import { resolveSessionWorkspaceContext } from "./workspace-resolution.js";
import {
  localSessionWorktreePath,
  readCachedLocalWorkspaceFacts,
} from "./workspace-source.js";
import { directoryAvailable, fileAvailable } from "./runtime-file-support.js";
import type {
  LocalConsoleProjectSummary,
  LocalConsoleSessionSummary,
  LocalConsoleStore,
} from "./types.js";

export interface LocalSessionPresentationActiveRun {
  sessionId: string;
  workspaceMode: "direct" | "worktree" | null;
  sourceDisposition: "primary" | "user-direct" | "agent-handoff";
  resuming: boolean;
  cwd: string | null;
  controller: AbortController;
}

export class LocalSessionPresentationRuntime {
  constructor(private readonly input: {
    store: LocalConsoleStore;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    nowIso(): string;
    withAgentTeamHealth(session: LocalConsoleSessionSummary): Promise<LocalConsoleSessionSummary>;
    activeRuns(): Iterable<LocalSessionPresentationActiveRun>;
    activeRunCount(sessionId: string): number;
    getSessionFactLogPath(sessionId: string): string;
    workdirRoot: string;
    gitTimeoutMs?: number;
  }) {}

  async withSessionWorkspaceContext(project: LocalConsoleProjectSummary): Promise<LocalConsoleProjectSummary> {
    const projectFacts = project.directoryAvailable === false
      ? { isGitRepository: false, branchName: null }
      : await readCachedLocalWorkspaceFacts({
          folderPath: project.folderPath,
          gitTimeoutMs: this.input.gitTimeoutMs,
        });
    const sessions = await Promise.all(project.sessions.map(async (session) => {
      const healthySession = await this.input.withAgentTeamHealth(session);
      const context = resolveSessionWorkspaceContext(session, projectFacts);
      const analysisRecordAvailable = await fileAvailable(this.input.getSessionFactLogPath(session.sessionId));
      let branchName = context.workspaceMode === "direct" ? projectFacts.branchName : null;
      if (context.workspaceMode === "worktree") {
        const worktreePath = localSessionWorktreePath(
          this.input.workdirRoot,
          project.projectId,
          session.sessionId,
        );
        if (await directoryAvailable(worktreePath)) {
          branchName = await readCachedLocalWorkspaceFacts({
            folderPath: worktreePath,
            gitTimeoutMs: this.input.gitTimeoutMs,
          }).then((facts) => facts.branchName, () => null);
        }
      }
      const continuation = resolveLocalSessionContinuation({
        projectDirectoryAvailable: project.directoryAvailable !== false,
        agentTeamHealth: healthySession.agentTeamHealth,
        agentTeamHealthReason: healthySession.agentTeamHealthReason,
      });
      const desiredAttentionKind = continuation.canContinue ? null : continuation.kind;
      const syncedAttention = this.input.store.syncSessionContinuationAttention === undefined
        || (healthySession.attentionKind ?? null) === desiredAttentionKind
        ? healthySession
        : await this.input.storeCall("local-console-store-sync-session-continuation-attention", () =>
          this.input.store.syncSessionContinuationAttention!({
            sessionId: session.sessionId,
            kind: desiredAttentionKind,
            now: this.input.nowIso(),
          }));
      return {
        ...healthySession,
        attentionRevision: syncedAttention.attentionRevision,
        attentionAcknowledgedRevision: syncedAttention.attentionAcknowledgedRevision,
        attentionKind: syncedAttention.attentionKind,
        hasUnacknowledgedAttention: syncedAttention.hasUnacknowledgedAttention,
        analysisRecordAvailable,
        workspaceUnavailableReason: context.independentWorkspaceUnavailableReason,
        branchName,
        continuation,
      };
    }));
    return { ...project, branchName: projectFacts.branchName, isGitRepository: projectFacts.isGitRepository, sessions };
  }

  withRuntimeActivity(project: LocalConsoleProjectSummary): LocalConsoleProjectSummary {
    const sessions = project.sessions.map((session) => {
      const runningCount = Math.max(session.runningCount, this.input.activeRunCount(session.sessionId));
      return {
        ...session,
        status: runningCount > 0 ? "running" as const : session.status,
        runningCount,
        hasPendingControlWork: session.hasPendingControlWork === true || runningCount > 0,
      };
    });
    return {
      ...project,
      sessions,
      runningCount: sessions.reduce((total, session) => total + session.runningCount, 0),
    };
  }

  async synchronizeNonContinuableRecords(projects: LocalConsoleProjectSummary[]): Promise<void> {
    for (const session of projects.flatMap((project) => project.sessions)) {
      if (session.continuation === undefined || session.continuation.canContinue) continue;
      const continuation = session.continuation;
      const body = nonContinuableSystemMessage(continuation);
      if (body === null) continue;
      const messages = await this.input.storeCall("local-console-store-list", () =>
        this.input.store.listMessages(session.sessionId));
      if (messages.some((message) => message.speaker === "system" && message.body === body)) continue;
      await this.input.storeCall("local-console-store-record-non-continuable", () =>
        this.input.store.recordSystemMessage({
          sessionId: session.sessionId,
          body,
          systemEventKind: "other",
          runId: null,
          runDir: null,
          error: continuation.kind,
          status: "displayed",
          now: this.input.nowIso(),
        }));
    }
  }

  async stopUnsafeRunsWithUnavailableContext(projects: LocalConsoleProjectSummary[]): Promise<void> {
    const unavailableProjectIds = new Set(
      projects.filter((project) => project.directoryAvailable === false).map((project) => project.projectId),
    );
    const sessions = new Map(projects.flatMap((project) =>
      project.sessions.map((session) => [session.sessionId, session] as const)));
    for (const active of this.input.activeRuns()) {
      const source = await this.input.storeCall("local-console-store-session-workspace", () =>
        this.input.store.getSessionWorkspace(active.sessionId));
      if (active.workspaceMode === "direct" && unavailableProjectIds.has(source.projectId)) {
        active.controller.abort("project-directory-unavailable");
        continue;
      }
      const session = sessions.get(active.sessionId);
      if (session?.agentTeamHealth === "deleted" || session?.agentTeamHealth === "needs-repair") {
        const snapshot = await this.input.store.listSessionAgentTeamSnapshot?.(active.sessionId) ?? null;
        if (snapshot === null) active.controller.abort("agent-team-unavailable");
      }
    }
  }
}
