import { resolveLocalSessionContinuation } from "./session-status.js";
import { directoryAvailable } from "./runtime-file-support.js";
import { formatLocalError } from "./runtime-domain.js";
import {
  LOCAL_CONSOLE_PROJECT_ID,
  LocalConsoleProjectFolderError,
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
  }) {}

  async defaultProjectId(): Promise<string> {
    const projects = await this.input.storeCall("local-console-store-list-projects", () =>
      this.input.store.listProjects());
    return projects[0]?.projectId ?? LOCAL_CONSOLE_PROJECT_ID;
  }

  async assertProjectDirectoryAvailable(projectId: string): Promise<void> {
    const project = await this.storedProject(projectId);
    if (project === undefined) {
      throw new LocalConsoleProjectFolderError("LOCAL_PROJECT_NOT_FOUND", "项目不存在或已移除");
    }
    if (!(await directoryAvailable(project.folderPath))) {
      throw new LocalConsoleProjectFolderError(
        "PROJECT_DIRECTORY_UNAVAILABLE",
        "当前项目本地文件夹不可用，请先使用红色扳手修复",
      );
    }
  }

  async storedProject(projectId: string): Promise<LocalConsoleProjectSummary | undefined> {
    if (this.input.store.getProject !== undefined) {
      return (await this.input.storeCall("local-console-store-get-project", () =>
        this.input.store.getProject!(projectId))) ?? undefined;
    }
    return (await this.input.storeCall("local-console-store-list-projects", () =>
      this.input.store.listProjects())).find((candidate) => candidate.projectId === projectId);
  }

  async assertSessionProjectDirectoryAvailable(sessionId: string): Promise<void> {
    if (!(await this.sessionProjectDirectoryAvailable(sessionId))) {
      throw new LocalConsoleProjectFolderError(
        "PROJECT_DIRECTORY_UNAVAILABLE",
        "当前项目本地文件夹不可用，请先使用红色扳手修复",
      );
    }
  }

  async assertSessionCanContinue(sessionId: string): Promise<void> {
    await this.assertSessionProjectDirectoryAvailable(sessionId);
    const session = (await this.input.storeCall("local-console-store-list-sessions", () =>
      this.input.store.listSessions())).find((candidate) => candidate.sessionId === sessionId);
    if (session === undefined) throw new Error(`local console session not found: ${sessionId}`);
    const healthy = await this.withAgentTeamHealth(session);
    const continuation = resolveLocalSessionContinuation({
      projectDirectoryAvailable: true,
      agentTeamHealth: healthy.agentTeamHealth,
      agentTeamHealthReason: healthy.agentTeamHealthReason,
    });
    if (!continuation.canContinue) throw new Error(continuation.reason);
  }

  async continuableSessionWorkspace(sessionId: string): Promise<LocalConsoleSessionWorkspaceSource | null> {
    const source = await this.input.storeCall("local-console-store-session-workspace", () =>
      this.input.store.getSessionWorkspace(sessionId));
    if (!(await directoryAvailable(source.folderPath))) return null;
    const session = source.session ?? (await this.input.storeCall(
      "local-console-store-list-sessions",
      () => this.input.store.listSessions(),
    )).find((candidate) => candidate.sessionId === sessionId);
    if (session === undefined) return null;
    const healthy = await this.withAgentTeamHealth(session);
    return healthy.agentTeamHealth === "deleted" || healthy.agentTeamHealth === "needs-repair" ? null : source;
  }

  async sessionProjectDirectoryAvailable(sessionId: string): Promise<boolean> {
    const source = await this.input.storeCall("local-console-store-session-workspace", () =>
      this.input.store.getSessionWorkspace(sessionId));
    return directoryAvailable(source.folderPath);
  }

  async withDirectoryAvailability(
    project: LocalConsoleProjectSummary,
    knownAvailable?: boolean,
  ): Promise<LocalConsoleProjectSummary> {
    const available = knownAvailable ?? await directoryAvailable(project.folderPath);
    return {
      ...project,
      directoryAvailable: available,
      directoryUnavailableReason: available ? null : "当前项目本地文件夹未找到，可以指定新的文件夹",
      newConversationDisabledReason: available ? null : "当前项目本地文件夹不可用，无法新建对话",
    };
  }

  async withAgentTeamHealth(session: LocalConsoleSessionSummary): Promise<LocalConsoleSessionSummary> {
    if (session.agentTeamOwnership == null || session.agentTeamId == null) {
      return { ...session, agentTeamHealth: null, agentTeamHealthReason: null };
    }
    if (this.input.resolveAgentTeamHealth === undefined) return session;
    try {
      const result = await this.input.resolveAgentTeamHealth(session);
      return { ...session, agentTeamHealth: result.health, agentTeamHealthReason: result.reason };
    } catch (error) {
      return { ...session, agentTeamHealth: "needs-repair", agentTeamHealthReason: formatLocalError(error) };
    }
  }
}
