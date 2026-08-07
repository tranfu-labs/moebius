import type { LocalConsoleMessageCommandRuntime } from "./message-command-runtime.js";
import type { LocalProjectCommandRuntime } from "./project-command-runtime.js";
import type { LocalConsoleRunOutputRuntime } from "./run-output-runtime.js";
import type { LocalConsoleRunRetryRuntime } from "./run-retry-runtime.js";
import type { LocalSessionCreationRuntime } from "./session-creation-runtime.js";
import type { LocalConsoleSessionMetadataRuntime } from "./session-metadata-runtime.js";
import type { LocalSessionReferenceRuntime } from "./session-reference-runtime.js";
import type { LocalSessionSettingsRuntime } from "./session-settings-runtime.js";
import type { LocalConsoleStateQueryRuntime } from "./state-query-runtime.js";
import type { LocalConsoleWorkspaceQueryRuntime } from "./workspace-query-runtime.js";
import type {
  LocalChildSessionCreateInput,
  LocalFileReferenceInput,
  LocalPendingMessageInput,
  LocalPendingMessageUpdateInput,
  LocalProjectCreateInput,
  LocalProjectRemoveInput,
  LocalProjectRenameInput,
  LocalProjectRepairInput,
  LocalProjectUpdateInput,
  LocalRunIdentityInput,
  LocalRunRetryInput,
  LocalSessionCreationMetadata,
  LocalSessionMoveInput,
  LocalSessionMemberExecutionUpdateInput,
  LocalSessionPinInput,
  LocalSessionReadStateInput,
  LocalSessionReferenceInput,
  LocalSessionRenameInput,
  LocalSessionResultReadInput,
  LocalSessionSearchInput,
  LocalSessionTeamSwitchInput,
  LocalSessionWorkspaceSwitchInput,
} from "./runtime-contracts.js";
import type {
  LocalConsoleFileContent,
  LocalConsoleFileReferenceContent,
  LocalConsoleMessage,
  LocalConsoleProjectFiles,
  LocalConsoleProjectRemovalResult,
  LocalConsoleProjectSummary,
  LocalConsoleRunOutput,
  LocalConsoleSessionArchiveResult,
  LocalConsoleSessionReferenceText,
  LocalConsoleSessionSearchResult,
  LocalConsoleSessionSummary,
  LocalConsoleSessionTeamUpdateState,
  LocalConsoleSnapshot,
  LocalConsoleStateSnapshot,
  LocalConsoleTextFragment,
  LocalConsoleWorkspaceDiffDetail,
  LocalConsoleWorkspaceMode,
} from "./types.js";
import type {
  LocalConsoleProcessAppendPage,
  LocalConsoleProcessDebugInvocation,
  LocalConsoleProcessHistoryPage,
} from "./process-history.js";

interface LocalConsoleFacadePorts {
  defaultSessionId(): string;
  projects: LocalProjectCommandRuntime;
  sessions: LocalSessionCreationRuntime;
  settings: LocalSessionSettingsRuntime;
  references: LocalSessionReferenceRuntime;
  metadata: LocalConsoleSessionMetadataRuntime;
  messages: LocalConsoleMessageCommandRuntime;
  retries: LocalConsoleRunRetryRuntime;
  state: LocalConsoleStateQueryRuntime;
  output: LocalConsoleRunOutputRuntime;
  workspace: LocalConsoleWorkspaceQueryRuntime;
}

export class LocalConsoleRuntimeFacade {
  private facade!: LocalConsoleFacadePorts;

  protected bindFacade(facade: LocalConsoleFacadePorts): void {
    this.facade = facade;
  }

  async createProject(input: LocalProjectCreateInput): Promise<LocalConsoleProjectSummary> {
    return await this.facade.projects.create(input);
  }

  async updateProject(input: LocalProjectUpdateInput): Promise<LocalConsoleProjectSummary> {
    return await this.facade.projects.update(input);
  }

  async repairProjectFolder(input: LocalProjectRepairInput): Promise<LocalConsoleProjectSummary> {
    return await this.facade.projects.repairFolder(input);
  }

  async renameProject(input: LocalProjectRenameInput): Promise<LocalConsoleProjectSummary> {
    return await this.facade.projects.rename(input);
  }

  async removeProject(input: LocalProjectRemoveInput): Promise<LocalConsoleProjectRemovalResult> {
    return await this.facade.projects.remove(input);
  }

  async reorderProjects(projectIds: string[]): Promise<LocalConsoleProjectSummary[]> {
    return await this.facade.projects.reorder(projectIds);
  }

  async createSession(
    title?: string,
    projectId?: string,
    agentTeam?: { ownership: "system" | "user"; id: string },
    initialMessage?: string,
    workspaceMode?: LocalConsoleWorkspaceMode,
    attachmentIds: string[] = [],
    metadata: LocalSessionCreationMetadata = {},
  ): Promise<LocalConsoleSessionSummary> {
    return await this.facade.sessions.create(
      title,
      projectId,
      agentTeam,
      initialMessage,
      workspaceMode,
      attachmentIds,
      metadata,
    );
  }

  async moveEmptySessionToProject(input: LocalSessionMoveInput): Promise<LocalConsoleSessionSummary> {
    return await this.facade.settings.moveEmpty(input);
  }

  async switchSessionWorkspace(input: LocalSessionWorkspaceSwitchInput): Promise<LocalConsoleSessionSummary> {
    return await this.facade.settings.switchWorkspace(input);
  }

  async switchSessionTeam(input: LocalSessionTeamSwitchInput): Promise<LocalConsoleSessionSummary> {
    return await this.facade.settings.switchTeam(input);
  }

  async inspectSessionTeamUpdate(sessionId: string): Promise<LocalConsoleSessionTeamUpdateState> {
    return await this.facade.settings.inspectTeamUpdate(sessionId);
  }

  async getRunAgentInfo(input: { sessionId: string; runId: string }) {
    return await this.facade.output.runAgentInfo(input);
  }

  async getRunAgentMarkdown(input: { sessionId: string; runId: string }): Promise<{ markdown: string }> {
    return await this.facade.output.runAgentMarkdown(input);
  }

  async applySessionTeamUpdate(sessionId: string, expectedUpdateToken?: string | null): Promise<LocalConsoleSessionTeamUpdateState> {
    return await this.facade.settings.applyTeamUpdate(sessionId, expectedUpdateToken);
  }

  async retrySessionTeamUpdate(sessionId: string, expectedUpdateToken?: string | null): Promise<LocalConsoleSessionTeamUpdateState> {
    return await this.facade.settings.retryTeamUpdate(sessionId, expectedUpdateToken);
  }

  async cancelSessionTeamUpdate(sessionId: string, expectedUpdateToken?: string | null): Promise<LocalConsoleSessionTeamUpdateState> {
    return await this.facade.settings.cancelTeamUpdate(sessionId, expectedUpdateToken);
  }

  async updateSessionMemberExecution(input: LocalSessionMemberExecutionUpdateInput) {
    return await this.facade.settings.updateMemberExecution(input);
  }

  async archiveSession(sessionId: string): Promise<LocalConsoleSessionArchiveResult> {
    return await this.facade.settings.archive(sessionId);
  }

  async restoreSession(sessionId: string): Promise<LocalConsoleSessionSummary> {
    return await this.facade.settings.restore(sessionId);
  }

  async searchSessions(input: LocalSessionSearchInput): Promise<LocalConsoleSessionSearchResult[]> {
    return await this.facade.references.search(input);
  }

  async sessionReferenceText(input: LocalSessionReferenceInput): Promise<LocalConsoleSessionReferenceText> {
    return await this.facade.references.referenceText(input);
  }

  async createChildSession(input: LocalChildSessionCreateInput): Promise<LocalConsoleSessionSummary> {
    return await this.facade.metadata.createChildSession(input);
  }

  getSessionFactLogPath(sessionId: string): string {
    return this.facade.metadata.getSessionFactLogPath(sessionId);
  }

  async submitUserMessage(
    body: string,
    sessionId = this.facade.defaultSessionId(),
    attachmentIds: string[] = [],
    resumeRunId?: string,
    textFragments: LocalConsoleTextFragment[] = [],
  ): Promise<LocalConsoleMessage> {
    return await this.facade.messages.submit(body, sessionId, attachmentIds, resumeRunId, textFragments);
  }

  async retryPendingUserMessage(input: LocalPendingMessageInput): Promise<void> {
    await this.facade.messages.retryPending(input);
  }

  async updatePendingUserMessage(input: LocalPendingMessageUpdateInput): Promise<LocalConsoleMessage> {
    return await this.facade.messages.updatePending(input);
  }

  async removePendingUserMessage(input: LocalPendingMessageInput): Promise<void> {
    await this.facade.messages.removePending(input);
  }

  async retryRun(input: LocalRunRetryInput): Promise<boolean> {
    return await this.facade.retries.retry(input);
  }

  async interruptRun(input: LocalRunIdentityInput): Promise<boolean> {
    return await this.facade.metadata.interruptRun(input);
  }

  async markSessionResultRead(input: LocalSessionResultReadInput): Promise<boolean> {
    return await this.facade.metadata.markSessionResultRead(input);
  }

  async updateSessionReadState(input: LocalSessionReadStateInput): Promise<LocalConsoleSessionSummary> {
    return await this.facade.metadata.updateSessionReadState(input);
  }

  async armSessionManualUnread(sessionId: string): Promise<LocalConsoleSessionSummary> {
    return await this.facade.metadata.armSessionManualUnread(sessionId);
  }

  async markSessionViewed(sessionId: string): Promise<LocalConsoleSessionSummary> {
    return await this.facade.metadata.markSessionViewed(sessionId);
  }

  async setSessionPinned(input: LocalSessionPinInput): Promise<LocalConsoleSessionSummary> {
    return await this.facade.metadata.setSessionPinned(input);
  }

  async renameSession(input: LocalSessionRenameInput): Promise<LocalConsoleSessionSummary> {
    return await this.facade.metadata.renameSession(input);
  }

  async snapshot(sessionId = this.facade.defaultSessionId()): Promise<LocalConsoleSnapshot> {
    return await this.facade.state.snapshot(sessionId);
  }

  async state(
    selected: string | { sessionId?: string; projectId?: string } = this.facade.defaultSessionId(),
  ): Promise<LocalConsoleStateSnapshot> {
    return await this.facade.state.state(selected);
  }

  async sessionView(sessionId: string) {
    return await this.facade.state.sessionView(sessionId);
  }

  async runOutput(sessionId: string, runId: string): Promise<LocalConsoleRunOutput> {
    return await this.facade.output.runOutput(sessionId, runId);
  }

  async workspaceDiffDetail(sessionId: string): Promise<LocalConsoleWorkspaceDiffDetail> {
    return await this.facade.workspace.workspaceDiffDetail(sessionId);
  }

  async projectFiles(sessionId: string): Promise<LocalConsoleProjectFiles> {
    return await this.facade.workspace.projectFiles(sessionId);
  }

  async projectFile(sessionId: string, filePath: string): Promise<LocalConsoleFileContent> {
    return await this.facade.workspace.projectFile(sessionId, filePath);
  }

  async workspaceDiffFile(sessionId: string, filePath: string): Promise<LocalConsoleFileContent> {
    return await this.facade.workspace.workspaceDiffFile(sessionId, filePath);
  }

  async fileReference(
    sessionId: string,
    input: LocalFileReferenceInput,
  ): Promise<LocalConsoleFileReferenceContent> {
    return await this.facade.workspace.fileReference(sessionId, input);
  }

  async processOutput(
    sessionId: string,
    runId: string,
    cursor?: string,
  ): Promise<LocalConsoleProcessHistoryPage> {
    return await this.facade.output.processOutput(sessionId, runId, cursor);
  }

  async processOutputAppend(
    sessionId: string,
    runId: string,
    appendCursor: string,
  ): Promise<LocalConsoleProcessAppendPage> {
    return await this.facade.output.processOutputAppend(sessionId, runId, appendCursor);
  }

  async processDebugInvocation(
    sessionId: string,
    runId: string,
  ): Promise<LocalConsoleProcessDebugInvocation> {
    return await this.facade.output.processDebugInvocation(sessionId, runId);
  }

  async childSessionSummaries(parentSessionId: string) {
    return await this.facade.state.childSessionSummaries(parentSessionId);
  }
}
