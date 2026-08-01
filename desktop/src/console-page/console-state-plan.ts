export function planConsoleEndpoint(base: string, path: string): URL {
  return new URL(path.replace(/^\//u, ""), base.endsWith("/") ? base : `${base}/`);
}

export function planConsoleErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
