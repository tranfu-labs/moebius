import { resolveLocalSessionContinuation } from "./session-status.js";
import { resolveSessionWorkspaceContext } from "./workspace-resolution.js";
import {
  decideNonContinuableRecordWrite,
  decideProjectWorkspaceFactsRead,
  decideUnavailableTeamStop,
  decideWorktreeBranchRead,
  planAttentionSynchronization,
  planNonContinuableRecord,
  planRuntimeActivity,
  planSessionBranchRead,
  planUnsafeRunContext,
} from "./session-presentation-plan.js";
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
    readWorkspaceFacts(folderPath: string): Promise<{ isGitRepository: boolean; branchName: string | null }>;
    worktreePath(workdirRoot: string, projectId: string, sessionId: string): string;
    directoryAvailable(folderPath: string): Promise<boolean>;
    fileAvailable(filePath: string): Promise<boolean>;
  }) {}

  async withSessionWorkspaceContext(project: LocalConsoleProjectSummary): Promise<LocalConsoleProjectSummary> {
    const factsRead = decideProjectWorkspaceFactsRead(project.directoryAvailable);
    const projectFacts = factsRead.kind === "fallback"
      ? { isGitRepository: false, branchName: null }
      : await this.input.readWorkspaceFacts(project.folderPath);
    const sessions = await Promise.all(project.sessions.map(async (session) => {
      const healthySession = await this.input.withAgentTeamHealth(session);
      const context = resolveSessionWorkspaceContext(session, projectFacts);
      const analysisRecordAvailable = await this.input.fileAvailable(this.input.getSessionFactLogPath(session.sessionId));
      const branchRead = planSessionBranchRead({
        workspaceMode: context.workspaceMode,
        projectBranchName: projectFacts.branchName,
      });
      let branchName = branchRead.kind === "direct" ? branchRead.branchName : null;
      if (branchRead.kind === "worktree") {
        const worktreePath = this.input.worktreePath(
          this.input.workdirRoot,
          project.projectId,
          session.sessionId,
        );
        const worktreeRead = decideWorktreeBranchRead(await this.input.directoryAvailable(worktreePath));
        if (worktreeRead.kind === "read") {
          branchName = await this.input.readWorkspaceFacts(worktreePath).then((facts) => facts.branchName, () => null);
        }
      }
      const continuation = resolveLocalSessionContinuation({
        projectDirectoryAvailable: project.directoryAvailable !== false,
        agentTeamHealth: healthySession.agentTeamHealth,
        agentTeamHealthReason: healthySession.agentTeamHealthReason,
      });
      const attentionPlan = planAttentionSynchronization({
        continuation,
        currentKind: healthySession.attentionKind,
        portAvailable: this.input.store.syncSessionContinuationAttention !== undefined,
      });
      const syncedAttention = attentionPlan.kind === "preserve"
        ? healthySession
        : await this.input.storeCall("local-console-store-sync-session-continuation-attention", () =>
          this.input.store.syncSessionContinuationAttention!({
            sessionId: session.sessionId,
            kind: attentionPlan.desiredKind,
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
    return planRuntimeActivity(project, Object.fromEntries(
      project.sessions.map((session) => [session.sessionId, this.input.activeRunCount(session.sessionId)]),
    ));
  }

  async synchronizeNonContinuableRecords(projects: LocalConsoleProjectSummary[]): Promise<void> {
    for (const session of projects.flatMap((project) => project.sessions)) {
      const plan = planNonContinuableRecord(session);
      if (plan.kind === "skip") continue;
      const messages = await this.input.storeCall("local-console-store-list", () =>
        this.input.store.listMessages(session.sessionId));
      const write = decideNonContinuableRecordWrite(messages, plan.body);
      if (write.kind === "skip") continue;
      await this.input.storeCall("local-console-store-record-non-continuable", () =>
        this.input.store.recordSystemMessage({
          sessionId: session.sessionId,
          body: plan.body,
          systemEventKind: "other",
          runId: null,
          runDir: null,
          error: plan.error,
          status: "displayed",
          role: null,
          processSteps: [],
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
      const action = planUnsafeRunContext({
        workspaceMode: active.workspaceMode,
        sourceProjectId: source.projectId,
        unavailableProjectIds,
        sessionHealth: sessions.get(active.sessionId)?.agentTeamHealth,
      });
      if (action.kind === "abort-project") {
        active.controller.abort("project-directory-unavailable");
        continue;
      }
      if (action.kind === "inspect-team") {
        const snapshot = await this.input.store.listSessionAgentTeamSnapshot?.(active.sessionId);
        const stop = decideUnavailableTeamStop(snapshot);
        if (stop.kind === "abort") active.controller.abort("agent-team-unavailable");
      }
    }
  }
}
