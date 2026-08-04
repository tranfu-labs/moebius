import { formatLocalError } from "./runtime-domain.js";
import { withOptionalAgentTeamSnapshotLoadedAt } from "./session-team-snapshot.js";
import {
  decideSessionCreationAgentNames,
  decideSessionCreationAttachmentRead,
  decideSessionCreationBaselineRead,
  decideSessionCreationProcessing,
  decideSessionCreationProject,
  decideSessionCreationTeamLoad,
  decideSessionCreationWorkspace,
  decideSessionCreationWorkspaceRead,
  planSessionCreationContent,
  planSessionCreationDispatch,
  planSessionCreationBaselineCacheValue,
  planSessionCreationTitle,
} from "./session-creation-plan.js";
import type {
  LocalAttachment,
  LocalConsoleAgentTeamSnapshot,
  LocalConsoleEntryTemplate,
  LocalConsoleProjectSummary,
  LocalConsoleSessionSummary,
  LocalConsoleStore,
  LocalConsoleTextFragment,
  LocalConsoleWorkspaceMode,
  LocalConsoleWritePolicy,
} from "./types.js";

export class LocalSessionCreationRuntime {
  constructor(private readonly input: {
    store: LocalConsoleStore;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    createSessionId(): string;
    nowIso(): string;
    resolveProjectId(projectId: string | undefined): Promise<string>;
    assertProjectDirectoryAvailable(projectId: string): Promise<void>;
    storedProject(projectId: string): Promise<LocalConsoleProjectSummary | undefined>;
    loadAgentTeamSnapshot?: (binding: { ownership: "system" | "user"; id: string }) => Promise<LocalConsoleAgentTeamSnapshot>;
    listAgentNames(sessionId: string): Promise<string[]>;
    findDraftAttachment?: (draftKey: string, attachmentId: string) => Promise<LocalAttachment | undefined>;
    readWorkspaceFacts(folderPath: string): Promise<{ isGitRepository: boolean }>;
    readBaselineCommit(folderPath: string): Promise<string | null>;
    logBaselineUnavailable(input: { projectId: string; error: string }): void;
    baselineCommits: Map<string, string | null>;
    processPending(sessionId: string): void;
  }) {}

  async create(
    title?: string,
    projectId?: string,
    agentTeam?: { ownership: "system" | "user"; id: string },
    initialMessage?: string,
    workspaceMode?: LocalConsoleWorkspaceMode,
    attachmentIds: string[] = [],
    metadata: {
      originSessionId?: string | null;
      analysisParentSessionId?: string | null;
      entryTemplate?: LocalConsoleEntryTemplate | null;
      writePolicy?: LocalConsoleWritePolicy;
      textFragments?: LocalConsoleTextFragment[];
      attachmentDraftKey?: string;
    } = {},
  ): Promise<LocalConsoleSessionSummary> {
    const sessionId = this.input.createSessionId();
    const resolvedProjectId = await this.input.resolveProjectId(projectId);
    const content = planSessionCreationContent({
      initialMessage,
      attachmentIds,
      textFragments: metadata.textFragments,
      attachmentDraftKey: metadata.attachmentDraftKey,
    });
    await this.input.assertProjectDirectoryAvailable(resolvedProjectId);
    const projectDecision = decideSessionCreationProject(await this.input.storedProject(resolvedProjectId));
    if (projectDecision.kind === "missing") throw new Error(`local console project not found: ${resolvedProjectId}`);
    const project = projectDecision.project;
    const workspaceRead = decideSessionCreationWorkspaceRead(workspaceMode);
    if (workspaceRead.kind === "read") {
      const workspace = decideSessionCreationWorkspace(
        (await this.input.readWorkspaceFacts(project.folderPath)).isGitRepository,
      );
      if (workspace.kind === "reject") throw new Error("not-git-repository");
    }
    let baselineCommit: string | null | undefined;
    const baselineRead = decideSessionCreationBaselineRead(content.hasInitialContent);
    if (baselineRead.kind === "read") {
      try {
        baselineCommit = await this.input.readBaselineCommit(project.folderPath);
      } catch (error) {
        baselineCommit = null;
        this.input.logBaselineUnavailable({
          projectId: resolvedProjectId,
          error: formatLocalError(error),
        });
      }
    }
    const teamLoad = decideSessionCreationTeamLoad({
      agentTeam,
      portAvailable: this.input.loadAgentTeamSnapshot !== undefined,
    });
    const loadedSnapshot = teamLoad.kind === "skip"
      ? undefined
      : await this.input.loadAgentTeamSnapshot!(teamLoad.binding);
    const now = this.input.nowIso();
    const snapshot = withOptionalAgentTeamSnapshotLoadedAt(loadedSnapshot, now);
    const agentNames = decideSessionCreationAgentNames(snapshot);
    let routeAgentNames = agentNames.kind === "snapshot" ? agentNames.names : [];
    if (agentNames.kind === "fallback") {
      try {
        routeAgentNames = await this.input.listAgentNames(sessionId);
      } catch {
        // Legacy/custom stores without an available team keep fail-safe primary dispatch.
      }
    }
    const initialDispatch = planSessionCreationDispatch({ content, routeAgentNames });
    const attachmentRead = decideSessionCreationAttachmentRead({
      firstAttachmentId: content.attachmentIds[0],
      portAvailable: this.input.findDraftAttachment !== undefined,
    });
    const firstAttachment = attachmentRead.kind === "skip"
      ? undefined
      : await this.input.findDraftAttachment!("draft:new", attachmentRead.attachmentId);
    const session = await this.input.storeCall("local-console-store-create-session", () =>
      this.input.store.createSession({
        sessionId,
        projectId: resolvedProjectId,
        title: planSessionCreationTitle({
          requestedTitle: title,
          normalizedInitialMessage: content.normalizedInitialMessage,
          firstAttachment,
        }),
        agentTeamOwnership: agentTeam?.ownership,
        agentTeamId: agentTeam?.id,
        agentTeamSnapshot: snapshot,
        workspaceMode,
        initialMessage: content.persistedInitialMessage,
        initialDispatch,
        initialAttachmentIds: content.attachmentIds,
        attachmentDraftKey: content.attachmentDraftKey,
        baselineCommit,
        originSessionId: metadata.originSessionId,
        analysisParentSessionId: metadata.analysisParentSessionId,
        entryTemplate: metadata.entryTemplate,
        writePolicy: metadata.writePolicy,
        initialTextFragments: [],
        now,
      }));
    this.input.baselineCommits.set(sessionId, planSessionCreationBaselineCacheValue(baselineCommit));
    const processing = decideSessionCreationProcessing(content.hasInitialContent);
    if (processing.kind === "start") this.input.processPending(sessionId);
    return session;
  }
}
