import type { OperatorSession, RightSidebarTabsState } from "@moebius/console-ui";
import type { ConsoleNavigationScene } from "./console-state-action-contract.js";
import type { LocalConsoleState } from "./console-state-contract.js";
import type { ConsoleSelection } from "./console-state-coordinator.js";
import type { RightSidebarTabsStoreSnapshot } from "./right-sidebar-tabs-store.js";
import type { ConsolePresentationRoute } from "./presentation-route.js";
import type { RightSidebarVisibilityPreference } from "./right-sidebar-preference.js";

export function planConsoleEndpoint(base: string, path: string): URL {
  return new URL(path.replace(/^\//u, ""), base.endsWith("/") ? base : `${base}/`);
}

export function planConsoleErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function decideConsoleErrorCommit(
  previousVisibleMessage: string | null,
  nextVisibleMessage: string | null,
): "commit" | "skip" {
  return previousVisibleMessage === nextVisibleMessage ? "skip" : "commit";
}

export function planSessionMetadataState(
  state: LocalConsoleState | null,
  updated: OperatorSession,
): LocalConsoleState | null {
  if (state === null) return null;
  const mergeSessions = (sessions: OperatorSession[]) => sessions.map((session) =>
    session.sessionId === updated.sessionId ? { ...session, ...updated } : session);
  return {
    ...state,
    projects: state.projects.map((project) => ({
      ...project,
      sessions: mergeSessions(project.sessions),
    })),
    project: { ...state.project, sessions: mergeSessions(state.project.sessions) },
    selectedSession: state.selectedSession?.sessionId === updated.sessionId
      ? { ...state.selectedSession, ...updated }
      : state.selectedSession,
  };
}

export function planComposerTargetSessionId(
  sessionId: string | null | undefined,
  selectedSessionId: string,
): string {
  return sessionId ?? selectedSessionId;
}

export function decideProjectFolderSelectionAvailability(
  available: boolean,
): "available" | "unavailable" {
  return available ? "available" : "unavailable";
}

export function decideRefreshLease<T>(lease: T | null):
  | { kind: "skip" }
  | { kind: "run"; lease: T } {
  return lease === null ? { kind: "skip" } : { kind: "run", lease };
}

export function planRefreshResponse<T>(
  ok: boolean,
  body: T | { error?: string },
): { kind: "accepted"; state: T } | { kind: "rejected"; message: string } {
  if (ok) return { kind: "accepted", state: body as T };
  const message = typeof body === "object"
    && body !== null
    && "error" in body
    && typeof body.error === "string"
    ? body.error
    : "state request failed";
  return { kind: "rejected", message };
}

export function decideRefreshCommit(canCommit: boolean): "commit" | "ignore" {
  return canCommit ? "commit" : "ignore";
}

export function planConsoleStateRequestInit(etag: string | undefined): RequestInit {
  return etag === undefined ? {} : { headers: { "if-none-match": etag } };
}

export function decideRefreshResponse(status: number): "not-modified" | "body" {
  return status === 304 ? "not-modified" : "body";
}

export function decideResponseEtag(etag: string | null):
  | { kind: "skip" }
  | { kind: "write"; etag: string } {
  return etag === null ? { kind: "skip" } : { kind: "write", etag };
}

export function decideStateEtagAvailability(
  state: { selectedProjectId: string; selectedSessionId: string } | null,
  selection: ConsoleSelection,
): "use" | "skip" {
  return state !== null
    && state.selectedProjectId === selection.projectId
    && state.selectedSessionId === selection.sessionId
    ? "use"
    : "skip";
}

export function decideConsoleStatePoll(selectionMutationPending: boolean): "refresh" | "wait" {
  return selectionMutationPending ? "wait" : "refresh";
}

export function decideComposerDraftActivation(newConversationOpen: boolean): "activate" | "keep" {
  return newConversationOpen ? "keep" : "activate";
}

export function planDisplayedResultAcknowledgement(
  apiBase: string | null,
  state: {
    selectedSession: { sessionId: string; unreadSince?: string | null } | null;
    messages: readonly { speaker: string; createdAt: string }[];
  } | null,
  acknowledged: ReadonlySet<string>,
):
  | { kind: "skip" }
  | { kind: "acknowledge"; key: string; sessionId: string; unreadSince: string; apiBase: string } {
  const unreadSince = state?.selectedSession?.unreadSince;
  if (apiBase === null || state === null || state.selectedSession === null || unreadSince == null) {
    return { kind: "skip" };
  }
  const displayed = state.messages.some(
    (message) => message.speaker === "agent" && message.createdAt >= unreadSince,
  );
  if (!displayed) return { kind: "skip" };
  const key = `${state.selectedSession.sessionId}:${unreadSince}`;
  return acknowledged.has(key)
    ? { kind: "skip" }
    : { kind: "acknowledge", key, sessionId: state.selectedSession.sessionId, unreadSince, apiBase };
}

export function planRemoteConversationView(
  apiBase: string | null,
  sessionId: string | null,
): { kind: "skip" } | { kind: "load"; apiBase: string; sessionId: string } {
  return apiBase === null || sessionId === null
    ? { kind: "skip" }
    : { kind: "load", apiBase, sessionId };
}

export function decideRemoteViewRequest(inFlight: boolean): "load" | "wait" {
  return inFlight ? "wait" : "load";
}

export function decideRemoteViewCommit(aborted: boolean): "commit" | "ignore" {
  return aborted ? "ignore" : "commit";
}

export function planRemoteViewLoadingState<T extends { status: string }>(
  current: T | undefined,
): T | { status: "loading" } {
  return current?.status === "ready" ? current : { status: "loading" };
}

export function decideEvidenceIntent(kind: "workspace-diff" | "run-output"):
  "workspace-diff" | "run-output" {
  return kind;
}

export function planWorkspaceEvidenceContent(options: {
  fileCount: number;
  emptyText: string;
  changedText: string;
}): string {
  return options.fileCount === 0 ? options.emptyText : options.changedText;
}

export function planEvidenceResponse<T extends { error?: string }>(
  ok: boolean,
  body: T,
): { kind: "accepted"; body: T } | { kind: "rejected"; message: string } {
  return ok
    ? { kind: "accepted", body }
    : { kind: "rejected", message: body.error ?? "complete output request failed" };
}

export function planLabeledEvidenceOutput(
  label: string,
  value: string | null | undefined,
): string | null {
  const text = value?.trim();
  return text ? `${label}\n${text}` : null;
}

export function planEvidenceMember(role: string | null):
  | { kind: "translated"; key: string }
  | { kind: "literal"; value: string } {
  if (role === null || role.trim() === "") {
    return { kind: "translated", key: "console.common.collaborator" };
  }
  const keys: Readonly<Record<string, string>> = {
    ceo: "console.role.ceo",
    dev: "console.role.dev",
    "dev-manager": "console.role.devManager",
    "product-manager": "console.role.product",
    qa: "console.role.qa",
    secretary: "console.role.secretary",
    "hermes-user": "console.role.user",
    user: "console.role.user",
  };
  const key = keys[role];
  return key === undefined
    ? { kind: "literal", value: `@${role}` }
    : { kind: "translated", key };
}

export function planEvidenceContent(options: {
  stdout: string | null;
  stderr: string | null;
  record: string | null;
  emptyText: string;
}): string {
  return [options.stdout, options.stderr, options.record]
    .filter((value): value is string => value !== null)
    .join("\n\n") || options.emptyText;
}

export function planEvidenceRecord(
  recorded: string | null | undefined,
  fallback: string | null | undefined,
): string | null | undefined {
  return recorded ?? fallback;
}

export function planSidebarAnalysisParent(options: {
  explicitParentId?: string | null;
  entryTemplate: "session-analysis" | null;
  originSessionId: string | null;
}): string | null {
  return options.explicitParentId
    ?? (options.entryTemplate === "session-analysis" ? options.originSessionId : null);
}

export function decideConsoleApiBase(apiBase: string | null, unavailableMessage: string):
  | { kind: "unavailable"; message: string }
  | { kind: "available"; apiBase: string } {
  return apiBase === null
    ? { kind: "unavailable", message: unavailableMessage }
    : { kind: "available", apiBase };
}

export function planSessionCreation(options: {
  initialMessage: string;
  attachmentIds: readonly string[];
  agentTeam?: { ownership: "system" | "user"; id: string };
  workspaceMode?: "direct" | "worktree";
}): { kind: "skip" } | { kind: "submit"; payload: Record<string, unknown> } {
  const initialMessage = options.initialMessage.trim();
  if (initialMessage === "" && options.attachmentIds.length === 0) return { kind: "skip" };
  return {
    kind: "submit",
    payload: {
      initialMessage,
      ...(options.attachmentIds.length === 0 ? {} : { attachmentIds: options.attachmentIds }),
      ...(options.agentTeam === undefined
        ? {}
        : {
            agentTeamOwnership: options.agentTeam.ownership,
            agentTeamId: options.agentTeam.id,
          }),
      ...(options.workspaceMode === undefined ? {} : { workspaceMode: options.workspaceMode }),
    },
  };
}

export function decideMutationToken<T>(token: T | null):
  | { kind: "busy" }
  | { kind: "acquired"; token: T } {
  return token === null ? { kind: "busy" } : { kind: "acquired", token };
}

export function decideMutationFinished(finished: boolean): "clear" | "stale" {
  return finished ? "clear" : "stale";
}

export function decideFolderPicker<T>(picker: T | undefined, unavailableMessage: string):
  | { kind: "unavailable"; message: string }
  | { kind: "available"; picker: T } {
  return picker === undefined
    ? { kind: "unavailable", message: unavailableMessage }
    : { kind: "available", picker };
}

export function decideSelectedFolder(folderPath: string | null):
  | { kind: "cancelled" }
  | { kind: "selected"; folderPath: string } {
  return folderPath === null ? { kind: "cancelled" } : { kind: "selected", folderPath };
}

export function decideAddedProject(
  projectId: string,
  existingProjectIds: readonly string[],
  duplicateMessage: string,
): { kind: "duplicate"; message: string } | { kind: "accepted"; projectId: string } {
  return existingProjectIds.includes(projectId)
    ? { kind: "duplicate", message: duplicateMessage }
    : { kind: "accepted", projectId };
}

export function planOpenedProjectSelection(options: {
  projectId: string;
  sessions: readonly { sessionId: string; parentSessionId?: string | null }[];
  fallbackSessionId: string;
}): { projectId: string; sessionId: string } {
  return {
    projectId: options.projectId,
    sessionId: options.sessions.find((session) => session.parentSessionId == null)?.sessionId
      ?? options.fallbackSessionId,
  };
}

export function decideSessionSelection(pending: boolean): "blocked" | "select" {
  return pending ? "blocked" : "select";
}

export function planNavigationSceneSource(
  explicit: ConsoleNavigationScene | undefined,
  captured: ConsoleNavigationScene | undefined,
): ConsoleNavigationScene | undefined {
  return explicit ?? captured;
}

export function planNavigationSceneHostSessionId(
  route: ConsolePresentationRoute | null,
  selection: ConsoleSelection,
): string {
  return route?.hostSessionId ?? selection.sessionId;
}

export function planPresentationRouteCommit(
  route: ConsolePresentationRoute | null,
): { kind: "clear" } | { kind: "write"; route: ConsolePresentationRoute } {
  return route === null ? { kind: "clear" } : { kind: "write", route };
}

export function planNavigationSceneArgument(
  scene: ConsoleNavigationScene | undefined,
): [] | [ConsoleNavigationScene] {
  return scene === undefined ? [] : [scene];
}

export function planNavigationSceneSnapshot(input: {
  selection: ConsoleSelection;
  presentationRoute: ConsolePresentationRoute | null;
  hostSessionId: string;
  tabs: RightSidebarTabsState;
  visibilityPreference: RightSidebarVisibilityPreference;
  tabsStore?: RightSidebarTabsStoreSnapshot;
  composer: ConsoleNavigationScene["composer"];
  readingPosition: ConsoleNavigationScene["readingPosition"];
}): ConsoleNavigationScene {
  return {
    selection: input.selection,
    presentationRoute: input.presentationRoute,
    rightSidebar: {
      hostSessionId: input.hostSessionId,
      tabs: input.tabs,
      visibilityPreference: input.visibilityPreference,
      tabsStore: input.tabsStore,
    },
    composer: input.composer,
    readingPosition: input.readingPosition,
  };
}

export function planNavigationSceneRestore(
  scene: ConsoleNavigationScene,
  canRestoreTabsDocument: boolean,
): {
  sidebar:
    | { kind: "snapshot"; snapshot: RightSidebarTabsStoreSnapshot }
    | { kind: "host"; hostSessionId: string; tabs: RightSidebarTabsState };
  readingPosition:
    | { kind: "remove"; sessionId: string }
    | { kind: "write"; sessionId: string; messageId: number };
} {
  const sidebar = scene.rightSidebar.tabsStore !== undefined && canRestoreTabsDocument
    ? { kind: "snapshot" as const, snapshot: scene.rightSidebar.tabsStore }
    : {
        kind: "host" as const,
        hostSessionId: scene.rightSidebar.hostSessionId,
        tabs: scene.rightSidebar.tabs,
      };
  const readingPosition = scene.readingPosition.messageId === null
    ? { kind: "remove" as const, sessionId: scene.readingPosition.sessionId }
    : {
        kind: "write" as const,
        sessionId: scene.readingPosition.sessionId,
        messageId: scene.readingPosition.messageId,
      };
  return { sidebar, readingPosition };
}

export function planSessionSelectionRollback(options: {
  loaded: boolean;
  currentSelection: ConsoleSelection;
  targetSelection: ConsoleSelection;
  previousSelection: ConsoleSelection;
  previousPresentationRoute: ConsolePresentationRoute | null;
  previousNavigationScene?: ConsoleNavigationScene;
  canRestoreNavigationScene: boolean;
}):
  | { kind: "keep" }
  | { kind: "restore-scene"; scene: ConsoleNavigationScene }
  | {
      kind: "restore";
      selection: ConsoleSelection;
      presentationRoute: ConsolePresentationRoute;
    } {
  const sameSelection = options.currentSelection.projectId === options.targetSelection.projectId
    && options.currentSelection.sessionId === options.targetSelection.sessionId;
  if (options.loaded || !sameSelection) return { kind: "keep" };
  if (options.previousNavigationScene !== undefined && options.canRestoreNavigationScene) {
    return { kind: "restore-scene", scene: options.previousNavigationScene };
  }
  return {
    kind: "restore",
    selection: options.previousSelection,
    presentationRoute: options.previousPresentationRoute ?? {
      version: 1,
      projectId: options.previousSelection.projectId,
      selectedSessionId: options.previousSelection.sessionId,
      mainSessionId: options.previousSelection.sessionId,
      rightConversationSessionId: null,
      hostSessionId: options.previousSelection.sessionId,
      notice: null,
    },
  };
}

export function decideSessionProjectRebind(options: {
  apiBase: string | null;
  currentProjectId: string;
  targetProjectId: string;
  unavailableMessage: string;
}):
  | { kind: "skip" }
  | { kind: "unavailable"; message: string }
  | { kind: "rebind"; apiBase: string } {
  if (options.apiBase === null) return { kind: "unavailable", message: options.unavailableMessage };
  return options.currentProjectId === options.targetProjectId
    ? { kind: "skip" }
    : { kind: "rebind", apiBase: options.apiBase };
}

export function decideProjectReorder(options: {
  apiBase: string | null;
  mutationPending: boolean;
  unavailableMessage: string;
}):
  | { kind: "blocked" }
  | { kind: "unavailable"; message: string }
  | { kind: "reorder"; apiBase: string } {
  if (options.apiBase === null) return { kind: "unavailable", message: options.unavailableMessage };
  return options.mutationPending
    ? { kind: "blocked" }
    : { kind: "reorder", apiBase: options.apiBase };
}

export function planArchivedSession(options: {
  requestedSessionId: string;
  requestedProjectId: string;
  response: {
    sessionId?: string;
    projectId?: string;
    selectedSessionId?: string | null;
    archivedSessionIds?: string[];
    error?: string;
  };
  currentSelection: { projectId: string; sessionId: string };
}):
  | { kind: "rejected"; message: string }
  | { kind: "accepted"; selection: { projectId: string; sessionId: string }; archivedIds: string[] } {
  if (
    options.response.sessionId !== options.requestedSessionId
    || options.response.projectId !== options.requestedProjectId
  ) {
    return { kind: "rejected", message: options.response.error ?? "archive session failed" };
  }
  const selection = options.currentSelection.sessionId === options.requestedSessionId
    ? {
        projectId: options.requestedProjectId,
        sessionId: options.response.selectedSessionId ?? options.requestedSessionId,
      }
    : options.currentSelection;
  return {
    kind: "accepted",
    selection,
    archivedIds: options.response.archivedSessionIds ?? [options.requestedSessionId],
  };
}

export function planSessionReadPayload(
  session: {
    id: string;
    titleRevision?: number;
    attentionRevision?: number;
    readStateRevision?: number;
  },
  action: "mark-read-attention" | "mark-read-unread" | "mark-unread",
  currentSessionId: string,
): Record<string, unknown> {
  return {
    action,
    expectedAttentionRevision: session.attentionRevision ?? 0,
    expectedReadStateRevision: session.readStateRevision ?? 0,
    expectedTitleRevision: session.titleRevision ?? 0,
    isCurrent: currentSessionId === session.id,
  };
}

export function planSessionPinPayload(
  pinned: boolean,
  pinnedAt: string | null | undefined,
): Record<string, unknown> {
  return { pinned, expectedPinnedAt: pinnedAt ?? null };
}

export function planSessionTitlePayload(
  title: string,
  titleRevision: number | undefined,
): Record<string, unknown> {
  return { title, expectedTitleRevision: titleRevision ?? 0 };
}

export function planMutationErrorMessage(error: unknown, fallbackError: string): string {
  const message = planConsoleErrorMessage(error);
  return message === "" ? fallbackError : message;
}

export function decideSessionViewTransition(options: {
  apiBase: string | null;
  previousSessionId: string;
  nextSessionId: string;
}): { kind: "skip" } | { kind: "transition"; apiBase: string } {
  return options.apiBase === null || options.previousSessionId === options.nextSessionId
    ? { kind: "skip" }
    : { kind: "transition", apiBase: options.apiBase };
}

export function planMessageSubmission(options: {
  apiBase: string | null;
  body: string;
  attachmentIds: readonly string[];
  resumeRunId: string | null;
}): { kind: "skip" } | { kind: "submit"; apiBase: string; payload: Record<string, unknown> } {
  if (options.apiBase === null || (options.body.trim() === "" && options.attachmentIds.length === 0)) {
    return { kind: "skip" };
  }
  return {
    kind: "submit",
    apiBase: options.apiBase,
    payload: {
      body: options.body,
      ...(options.attachmentIds.length === 0 ? {} : { attachmentIds: options.attachmentIds }),
      ...(options.resumeRunId === null ? {} : { resumeRunId: options.resumeRunId }),
    },
  };
}

export function decideSendStarted(started: boolean): "started" | "blocked" {
  return started ? "started" : "blocked";
}
