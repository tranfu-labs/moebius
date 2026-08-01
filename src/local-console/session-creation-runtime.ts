import { log } from "../log.js";
import type { LocalAttachmentManager } from "./attachments.js";
import { deriveSessionTitle } from "./title.js";
import { resolveLocalUserMessageDispatch } from "./user-message-routing.js";
import { assertTextFragments, formatLocalError, normalizeTitle } from "./runtime-domain.js";
import { serializeTextFragmentReferences } from "./session-reference-text.js";
import { readLocalConversationBaselineCommit } from "./workspace-diff.js";
import { readCachedLocalWorkspaceFacts } from "./workspace-source.js";
import type {
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
    now(): Date;
    nowIso(): string;
    defaultProjectId(): Promise<string>;
    assertProjectDirectoryAvailable(projectId: string): Promise<void>;
    storedProject(projectId: string): Promise<LocalConsoleProjectSummary | undefined>;
    loadAgentTeamSnapshot?: (binding: { ownership: "system" | "user"; id: string }) => Promise<LocalConsoleAgentTeamSnapshot>;
    listAgentNames(sessionId: string): Promise<string[]>;
    attachmentManager?: LocalAttachmentManager;
    workspaceGitTimeoutMs?: number;
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
    const sessionId = `local:${this.input.now().toISOString()}-${Math.random().toString(36).slice(2, 8)}`;
    const resolvedProjectId = projectId ?? (await this.input.defaultProjectId());
    const normalizedInitialMessage = initialMessage?.trim();
    if (initialMessage !== undefined && normalizedInitialMessage === "" && attachmentIds.length === 0) {
      throw new Error("Message body must not be empty");
    }
    if (new Set(attachmentIds).size !== attachmentIds.length) throw new Error("Attachment ids must be unique");
    assertTextFragments(metadata.textFragments ?? []);
    const persistedInitialMessage = normalizedInitialMessage === undefined
      ? undefined
      : serializeTextFragmentReferences(normalizedInitialMessage, metadata.textFragments ?? []);
    await this.input.assertProjectDirectoryAvailable(resolvedProjectId);
    const project = await this.input.storedProject(resolvedProjectId);
    if (project === undefined) throw new Error(`local console project not found: ${resolvedProjectId}`);
    if (workspaceMode === "worktree") {
      const facts = await readCachedLocalWorkspaceFacts({
        folderPath: project.folderPath,
        gitTimeoutMs: this.input.workspaceGitTimeoutMs,
      });
      if (!facts.isGitRepository) throw new Error("not-git-repository");
    }
    let baselineCommit: string | null | undefined;
    if (normalizedInitialMessage !== undefined || attachmentIds.length > 0) {
      try {
        baselineCommit = await readLocalConversationBaselineCommit({
          folderPath: project.folderPath,
          gitTimeoutMs: this.input.workspaceGitTimeoutMs,
        });
      } catch (error) {
        baselineCommit = null;
        log({
          event: "local-console-conversation-baseline-unavailable",
          projectId: resolvedProjectId,
          error: formatLocalError(error),
        });
      }
    }
    const snapshot = agentTeam === undefined || this.input.loadAgentTeamSnapshot === undefined
      ? undefined
      : await this.input.loadAgentTeamSnapshot(agentTeam);
    let routeAgentNames = snapshot?.members.map((member) => member.name) ?? [];
    if (routeAgentNames.length === 0) {
      try {
        routeAgentNames = await this.input.listAgentNames(sessionId);
      } catch {
        // Legacy/custom stores without an available team keep fail-safe primary dispatch.
      }
    }
    const initialDispatch = normalizedInitialMessage === undefined && attachmentIds.length === 0
      ? undefined
      : routeAgentNames[0] === undefined
        ? undefined
        : resolveLocalUserMessageDispatch({
            body: normalizedInitialMessage ?? "",
            availableAgentNames: routeAgentNames,
            primaryAgent: routeAgentNames[0],
          });
    const firstAttachment = attachmentIds.length === 0
      ? undefined
      : (await this.input.attachmentManager?.listDraft("draft:new"))
        ?.find((attachment) => attachment.attachmentId === attachmentIds[0]);
    const session = await this.input.storeCall("local-console-store-create-session", () =>
      this.input.store.createSession({
        sessionId,
        projectId: resolvedProjectId,
        title: normalizedInitialMessage
          ? deriveSessionTitle(normalizedInitialMessage)
          : firstAttachment === undefined ? normalizeTitle(title) : deriveSessionTitle(firstAttachment.displayName),
        agentTeamOwnership: agentTeam?.ownership,
        agentTeamId: agentTeam?.id,
        agentTeamSnapshot: snapshot,
        workspaceMode,
        initialMessage: persistedInitialMessage,
        initialDispatch,
        initialAttachmentIds: attachmentIds,
        attachmentDraftKey: metadata.attachmentDraftKey ?? "draft:new",
        baselineCommit,
        originSessionId: metadata.originSessionId,
        analysisParentSessionId: metadata.analysisParentSessionId,
        entryTemplate: metadata.entryTemplate,
        writePolicy: metadata.writePolicy,
        initialTextFragments: [],
        now: this.input.nowIso(),
      }));
    this.input.baselineCommits.set(sessionId, baselineCommit ?? null);
    if (normalizedInitialMessage !== undefined || attachmentIds.length > 0) this.input.processPending(sessionId);
    return session;
  }
}
