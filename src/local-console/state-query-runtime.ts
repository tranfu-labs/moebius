import { projectLocalConsoleMemberIdentities } from "./member-identity.js";
import {
  decideSelectedSessionRead,
  decideSessionView,
  planLocalSnapshotStatus,
  planPrimaryActiveRun,
  planSelectedConsoleState,
  planStateQueryRequest,
} from "./state-query-plan.js";
import {
  isPendingDispatchMessage,
  isPendingPrimaryMessage,
  isVisibleTimelineMessage,
  noSessionWorkspaceDiff,
  projectPendingDispatch,
} from "./runtime-domain.js";
import { projectRoundStates } from "./round-state-projection.js";
import type {
  LocalConsoleChildSessionSummary,
  LocalConsoleProjectSummary,
  LocalConsoleAgentTeamSnapshot,
  LocalConsoleRunSnapshot,
  LocalConsoleSnapshot,
  LocalConsoleStateSnapshot,
  LocalConsoleSessionSummary,
  LocalConsoleSessionView,
  LocalConsoleStore,
  LocalConsoleWorkspaceDiffSummary,
} from "./types.js";

export class LocalConsoleStateQueryRuntime {
  constructor(private readonly input: {
    store: LocalConsoleStore;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    defaultSessionId: string;
    projectRoot: string;
    lastError(): string | null;
    withDirectoryAvailability(project: LocalConsoleProjectSummary): Promise<LocalConsoleProjectSummary>;
    withSessionWorkspaceContext(project: LocalConsoleProjectSummary): Promise<LocalConsoleProjectSummary>;
    withRuntimeActivity(project: LocalConsoleProjectSummary): LocalConsoleProjectSummary;
    synchronizeNonContinuableRecords(projects: LocalConsoleProjectSummary[]): Promise<void>;
    stopUnsafeRunsWithUnavailableContext(projects: LocalConsoleProjectSummary[]): Promise<void>;
    primaryRunId(sessionId: string): string | null;
    activeRunSnapshots(sessionId: string): Promise<LocalConsoleRunSnapshot[]>;
    listChildSessions(parentSessionId: string): Promise<LocalConsoleChildSessionSummary[]>;
    readWorkspaceDiff(sessionId: string): Promise<LocalConsoleWorkspaceDiffSummary>;
    loadTeamSnapshot(sessionId: string): Promise<LocalConsoleAgentTeamSnapshot | null>;
    /** 轮次收束评估：幂等，可能落盘新收束事实并发布事件；无能力时返回 not-started。 */
    evaluateRound?(sessionId: string): Promise<import("./round-closeout-plan.js").LocalRoundState>;
    /** 读上次收束事实（不评估）。 */
    readLastRoundFact?(sessionId: string): Promise<import("./round-terminal-runtime.js").LocalRoundPersistedFact | null>;
  }) {}

  async snapshot(sessionId = this.input.defaultSessionId): Promise<LocalConsoleSnapshot> {
    const messages = await this.input.storeCall("local-console-store-list", () =>
      this.input.store.listMessages(sessionId));
    const activeRuns = await this.input.activeRunSnapshots(sessionId);
    return {
      sessionId,
      status: planLocalSnapshotStatus({ messages, activeRunCount: activeRuns.length }),
      messages: messages.filter(isVisibleTimelineMessage),
      sqlitePath: this.input.store.sqlitePath,
      lastError: this.input.lastError(),
      pendingDispatchMessages: messages.filter(isPendingDispatchMessage).map(projectPendingDispatch),
      pendingPrimaryMessages: messages.filter(isPendingPrimaryMessage),
      activeRuns,
      activeRun: planPrimaryActiveRun(activeRuns, this.input.primaryRunId(sessionId)),
    };
  }

  async state(
    selected: string | { sessionId?: string; projectId?: string } = this.input.defaultSessionId,
  ): Promise<LocalConsoleStateSnapshot> {
    const requested = planStateQueryRequest(selected, this.input.defaultSessionId);
    const storedProjects = await this.input.storeCall("local-console-store-list-projects", () =>
      this.input.store.listProjects());
    const availableProjects = await Promise.all(storedProjects.map((project) =>
      this.input.withDirectoryAvailability(project)));
    const projectsWithWorkspace = await Promise.all(availableProjects.map((project) =>
      this.input.withSessionWorkspaceContext(project)));
    const projects = projectsWithWorkspace.map((project) => this.input.withRuntimeActivity(project));
    await this.input.synchronizeNonContinuableRecords(projects);
    await this.input.stopUnsafeRunsWithUnavailableContext(projects);
    const selection = planSelectedConsoleState({
      projects,
      requestedProjectId: requested.projectId,
      selectedSessionId: requested.sessionId,
      projectRoot: this.input.projectRoot,
    });
    const projectedProjects = await projectRoundStates(projects, {
      evaluateRound: this.input.evaluateRound,
      readLastRoundFact: this.input.readLastRoundFact,
    });
    const projectedSelection = planSelectedConsoleState({
      projects: projectedProjects,
      requestedProjectId: requested.projectId,
      selectedSessionId: requested.sessionId,
      projectRoot: this.input.projectRoot,
    });
    const read = decideSelectedSessionRead(projectedSelection.selectedSession);
    const messages = read.kind === "empty"
      ? []
      : await this.input.storeCall("local-console-store-list", () =>
        this.input.store.listMessages(selection.sessionId));
    const childSessions = read.kind === "empty"
      ? []
      : await this.input.listChildSessions(read.session.sessionId);
    const memberIdentities = read.kind === "empty"
      ? []
      : projectLocalConsoleMemberIdentities(
          await this.input.storeCall("local-console-store-list-session-agent-team-snapshot", () =>
            this.input.loadTeamSnapshot(selection.sessionId)),
        );
    const activeRuns = await this.input.activeRunSnapshots(selection.sessionId);
    return {
      projects: projectedProjects,
      project: projectedSelection.selectedProject,
      selectedProjectId: projectedSelection.selectedProject.projectId,
      selectedSessionId: projectedSelection.sessionId,
      selectedSession: projectedSelection.selectedSession,
      messages: messages.filter(isVisibleTimelineMessage),
      pendingDispatchMessages: messages.filter(isPendingDispatchMessage).map(projectPendingDispatch),
      pendingPrimaryMessages: messages.filter(isPendingPrimaryMessage),
      childSessions,
      memberIdentities,
      activeRuns,
      activeRun: planPrimaryActiveRun(activeRuns, this.input.primaryRunId(projectedSelection.sessionId)),
      workspaceDiff: read.kind === "empty"
        ? noSessionWorkspaceDiff()
        : await this.input.readWorkspaceDiff(read.session.sessionId),
      sqlitePath: this.input.store.sqlitePath,
      lastError: this.input.lastError(),
    };
  }

  async sessionView(sessionId: string): Promise<LocalConsoleSessionView> {
    const sessions = await this.input.storeCall("local-console-store-list-sessions", () =>
      this.input.store.listSessions());
    const decision = decideSessionView(sessions.find((candidate) => candidate.sessionId === sessionId));
    if (decision.kind === "missing") throw new Error(`local console session not found: ${sessionId}`);
    const messages = await this.input.storeCall("local-console-store-list", () =>
      this.input.store.listMessages(sessionId));
    const activeRuns = await this.input.activeRunSnapshots(sessionId);
    const memberIdentities = projectLocalConsoleMemberIdentities(
      await this.input.storeCall("local-console-store-list-session-agent-team-snapshot", () =>
        this.input.loadTeamSnapshot(sessionId)),
    );
    return {
      session: decision.session,
      messages: messages.filter(isVisibleTimelineMessage),
      pendingDispatchMessages: messages.filter(isPendingDispatchMessage).map(projectPendingDispatch),
      pendingPrimaryMessages: messages.filter(isPendingPrimaryMessage),
      memberIdentities,
      activeRuns,
      activeRun: planPrimaryActiveRun(activeRuns, this.input.primaryRunId(sessionId)),
      workspaceDiff: await this.input.readWorkspaceDiff(sessionId),
    };
  }

  async childSessionSummaries(parentSessionId: string): Promise<LocalConsoleChildSessionSummary[]> {
    return await this.input.listChildSessions(parentSessionId);
  }
}
