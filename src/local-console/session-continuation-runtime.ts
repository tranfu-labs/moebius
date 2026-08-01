import { resolveLocalSessionContinuation } from "./session-status.js";
import { formatLocalError } from "./runtime-domain.js";
import {
  decideAgentTeamHealthRead,
  decideDirectoryAvailabilityRead,
  decideProjectReadSource,
  decideWorkspaceContinuationCandidate,
  planContinuableWorkspace,
  planDefaultProjectId,
  planProjectDirectoryAvailability,
  planStoredProject,
  requireContinuableSession,
  requireProjectDirectoryAvailable,
  requireStoredProject,
  requireStoredSession,
} from "./session-continuation-plan.js";
import {
  type LocalConsoleProjectSummary,
  type LocalConsoleSessionSummary,
  type LocalConsoleSessionWorkspaceSource,
  type LocalConsoleStore,
} from "./types.js";

export class LocalSessionContinuationRuntime {
  constructor(private readonly input: {
    store: LocalConsoleStore;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    resolveAgentTeamHealth?: (
      session: LocalConsoleSessionSummary,
    ) => Promise<{ health: "usable" | "deleted" | "needs-repair"; reason: string | null }>;
    directoryAvailable(folderPath: string): Promise<boolean>;
  }) {}

  async sessionSummary(sessionId: string): Promise<LocalConsoleSessionSummary> {
    const sessions = await this.input.storeCall(
      "local-console-store-list-session-policy",
      () => this.input.store.listSessions(),
    );
    return requireStoredSession(
      sessions.find((candidate) => candidate.sessionId === sessionId),
      sessionId,
    );
  }

  async defaultProjectId(): Promise<string> {
    const projects = await this.input.storeCall("local-console-store-list-projects", () =>
      this.input.store.listProjects());
    return planDefaultProjectId(projects);
  }

  async assertProjectDirectoryAvailable(projectId: string): Promise<void> {
    const project = requireStoredProject(await this.storedProject(projectId));
    requireProjectDirectoryAvailable(await this.input.directoryAvailable(project.folderPath));
  }

  async storedProject(projectId: string): Promise<LocalConsoleProjectSummary | undefined> {
    const source = decideProjectReadSource(this.input.store.getProject !== undefined);
    if (source.kind === "direct") {
      return planStoredProject(await this.input.storeCall("local-console-store-get-project", () =>
        this.input.store.getProject!(projectId)));
    }
    return (await this.input.storeCall("local-console-store-list-projects", () =>
      this.input.store.listProjects())).find((candidate) => candidate.projectId === projectId);
  }

  async assertSessionProjectDirectoryAvailable(sessionId: string): Promise<void> {
    requireProjectDirectoryAvailable(await this.sessionProjectDirectoryAvailable(sessionId));
  }

  async assertSessionCanContinue(sessionId: string): Promise<void> {
    await this.assertSessionProjectDirectoryAvailable(sessionId);
    const session = (await this.input.storeCall("local-console-store-list-sessions", () =>
      this.input.store.listSessions())).find((candidate) => candidate.sessionId === sessionId);
    const healthy = await this.withAgentTeamHealth(requireStoredSession(session, sessionId));
    const continuation = resolveLocalSessionContinuation({
      projectDirectoryAvailable: true,
      agentTeamHealth: healthy.agentTeamHealth,
      agentTeamHealthReason: healthy.agentTeamHealthReason,
    });
    requireContinuableSession(continuation);
  }

  async continuableSessionWorkspace(sessionId: string): Promise<LocalConsoleSessionWorkspaceSource | null> {
    const source = await this.input.storeCall("local-console-store-session-workspace", () =>
      this.input.store.getSessionWorkspace(sessionId));
    const storedSession = source.session ?? (await this.input.storeCall(
      "local-console-store-list-sessions",
      () => this.input.store.listSessions(),
    )).find((candidate) => candidate.sessionId === sessionId);
    const candidate = decideWorkspaceContinuationCandidate({
      directoryAvailable: await this.input.directoryAvailable(source.folderPath),
      session: storedSession,
    });
    if (candidate.kind === "unavailable") return null;
    const healthy = await this.withAgentTeamHealth(candidate.session);
    return planContinuableWorkspace({ source, session: healthy });
  }

  async sessionProjectDirectoryAvailable(sessionId: string): Promise<boolean> {
    const source = await this.input.storeCall("local-console-store-session-workspace", () =>
      this.input.store.getSessionWorkspace(sessionId));
    return this.input.directoryAvailable(source.folderPath);
  }

  async withDirectoryAvailability(
    project: LocalConsoleProjectSummary,
    knownAvailable?: boolean,
  ): Promise<LocalConsoleProjectSummary> {
    const read = decideDirectoryAvailabilityRead(knownAvailable);
    const available = read.kind === "known"
      ? read.available
      : await this.input.directoryAvailable(project.folderPath);
    return planProjectDirectoryAvailability(project, available);
  }

  async withAgentTeamHealth(session: LocalConsoleSessionSummary): Promise<LocalConsoleSessionSummary> {
    const read = decideAgentTeamHealthRead({
      ownership: session.agentTeamOwnership,
      teamId: session.agentTeamId,
      resolverAvailable: this.input.resolveAgentTeamHealth !== undefined,
    });
    if (read.kind === "not-bound") {
      return { ...session, agentTeamHealth: null, agentTeamHealthReason: null };
    }
    if (read.kind === "preserve") return session;
    try {
      const result = await this.input.resolveAgentTeamHealth!(session);
      return { ...session, agentTeamHealth: result.health, agentTeamHealthReason: result.reason };
    } catch (error) {
      return { ...session, agentTeamHealth: "needs-repair", agentTeamHealthReason: formatLocalError(error) };
    }
  }
}
