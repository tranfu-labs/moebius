import type {
  Translate,
  TranslationKey,
  OperatorEvidenceOpenIntent,
  OperatorEvidenceView,
  OperatorProcessAppendOutput,
  OperatorProcessDebugInvocation,
  OperatorProcessOutput,
  OperatorSession,
  OperatorSubSessionView,
  ExecutionModelRegistry,
  FileReferenceContent,
  ProjectFilesData,
  WorkspaceDiffData,
  WorkspaceFileContent,
} from "@moebius/console-ui";
import {
  ConsoleStateCoordinator,
  type ConsoleSelection,
  type SelectionMutationKind,
  type SelectionMutationToken,
} from "./console-state-coordinator.js";
import {
  ProcessOutputRequestError,
  type ProcessOutputUpdate,
} from "./console-process-model.js";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RefreshConsoleStateOptions<TState> {
  apiBase: string;
  selection: ConsoleSelection;
  coordinator: ConsoleStateCoordinator;
  fetch: FetchLike;
  readSelection(state: TState): ConsoleSelection;
  commitState(state: TState): void;
  commitSelection(selection: ConsoleSelection): void;
  setError(error: string | null): void;
  mutationOwner?: SelectionMutationToken;
}

export async function refreshConsoleState<TState>(options: RefreshConsoleStateOptions<TState>): Promise<boolean> {
  const lease = options.coordinator.beginRefresh(options.mutationOwner);
  if (lease === null) {
    return false;
  }
  try {
    const url = endpoint(options.apiBase, "/api/local-console/state");
    url.searchParams.set("sessionId", options.selection.sessionId);
    url.searchParams.set("projectId", options.selection.projectId);
    const fetch = options.fetch;
    const response = await fetch(url, { signal: lease.controller.signal });
    const body = await response.json() as TState | { error?: string };
    if (!response.ok) {
      const error = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : "state request failed";
      throw new Error(error);
    }
    if (!options.coordinator.canCommitRefresh(lease)) {
      return false;
    }
    const nextState = body as TState;
    options.commitState(nextState);
    options.commitSelection(options.readSelection(nextState));
    options.setError(null);
    return true;
  } catch (error) {
    if (options.coordinator.canCommitRefresh(lease)) {
      options.setError(formatError(error));
    }
    return false;
  } finally {
    options.coordinator.completeRefresh(lease);
  }
}

export async function acknowledgeDisplayedResult(options: {
  apiBase: string;
  sessionId: string;
  unreadSince: string;
  fetch: FetchLike;
}): Promise<boolean> {
  const fetch = options.fetch;
  const response = await fetch(
    endpoint(options.apiBase, `/api/local-console/sessions/${encodeURIComponent(options.sessionId)}/read`),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unreadSince: options.unreadSince }),
    },
  );
  const body = await response.json() as { cleared?: boolean; error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? "mark result read failed");
  }
  return body.cleared === true;
}

export async function loadEvidenceView(options: {
  apiBase: string;
  intent: OperatorEvidenceOpenIntent;
  fetch: FetchLike;
  t: Translate;
}): Promise<OperatorEvidenceView> {
  if (options.intent.kind === "workspace-diff") {
    return {
      kind: "workspace-diff",
      title: options.t("desktop.evidence.workspaceDiffTitle"),
      content: options.intent.fileCount === 0
        ? options.t("desktop.evidence.noWorkspaceChanges")
        : options.t("desktop.evidence.workspaceChangeCount", { count: options.intent.fileCount }),
    };
  }

  const fetch = options.fetch;
  const response = await fetch(endpoint(
    options.apiBase,
    `/api/local-console/sessions/${encodeURIComponent(options.intent.sessionId)}/runs/${encodeURIComponent(options.intent.runId)}/output`,
  ));
  const body = await response.json() as {
    stdout?: string | null;
    stderr?: string | null;
    fallback?: string | null;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body.error ?? "complete output request failed");
  }
  const content = [
    labeledOutput(options.t("desktop.evidence.stdout"), body.stdout),
    labeledOutput(options.t("desktop.evidence.stderr"), body.stderr),
    labeledOutput(options.t("desktop.evidence.record"), body.fallback ?? options.intent.fallbackOutput),
  ].filter((value): value is string => value !== null).join("\n\n");
  return {
    kind: "run-output",
    title: options.t("desktop.evidence.fullOutputTitle", {
      member: translatedEvidenceMemberName(options.intent.role, options.t),
    }),
    content: content || options.t("desktop.evidence.noOutput"),
  };
}

export async function loadProcessOutput(options: {
  apiBase: string;
  sessionId: string;
  runId: string;
  fetch: FetchLike;
  cursor?: string;
  signal?: AbortSignal;
}): Promise<OperatorProcessOutput> {
  const url = endpoint(
    options.apiBase,
    `/api/local-console/sessions/${encodeURIComponent(options.sessionId)}/runs/${encodeURIComponent(options.runId)}/process-output`,
  );
  if (options.cursor !== undefined) {
    url.searchParams.set("cursor", options.cursor);
  }
  const fetch = options.fetch;
  const response = await fetch(
    url,
    options.signal === undefined ? undefined : { signal: options.signal },
  );
  const body = await response.json() as OperatorProcessOutput | { code?: string; error?: string };
  if (!response.ok) {
    throw new ProcessOutputRequestError(
      "error" in body && typeof body.error === "string" ? body.error : "process output request failed",
      response.status,
      "code" in body && typeof body.code === "string" ? body.code : null,
    );
  }
  return body as OperatorProcessOutput;
}

export async function loadProcessDebugInvocation(options: {
  apiBase: string;
  sessionId: string;
  runId: string;
  fetch: FetchLike;
  signal?: AbortSignal;
}): Promise<OperatorProcessDebugInvocation> {
  const url = endpoint(
    options.apiBase,
    `/api/local-console/sessions/${encodeURIComponent(options.sessionId)}/runs/${encodeURIComponent(options.runId)}/process-debug-invocation`,
  );
  const fetch = options.fetch;
  const response = await fetch(
    url,
    options.signal === undefined ? undefined : { signal: options.signal },
  );
  const body = await response.json() as OperatorProcessDebugInvocation | { error?: string };
  if (!response.ok) {
    throw new Error(
      "error" in body && typeof body.error === "string"
        ? body.error
        : "process debug invocation request failed",
    );
  }
  return body as OperatorProcessDebugInvocation;
}

export async function loadProcessOutputAppend(options: {
  apiBase: string;
  sessionId: string;
  runId: string;
  appendCursor: string;
  fetch: FetchLike;
  signal?: AbortSignal;
}): Promise<OperatorProcessAppendOutput> {
  const url = endpoint(
    options.apiBase,
    `/api/local-console/sessions/${encodeURIComponent(options.sessionId)}/runs/${encodeURIComponent(options.runId)}/process-output`,
  );
  url.searchParams.set("appendCursor", options.appendCursor);
  const fetch = options.fetch;
  const response = await fetch(
    url,
    options.signal === undefined ? undefined : { signal: options.signal },
  );
  const body = await response.json() as OperatorProcessAppendOutput | { code?: string; error?: string };
  if (!response.ok) {
    throw new ProcessOutputRequestError(
      "error" in body && typeof body.error === "string" ? body.error : "process output append request failed",
      response.status,
      "code" in body && typeof body.code === "string" ? body.code : null,
    );
  }
  return body as OperatorProcessAppendOutput;
}

export async function loadProcessOutputUpdate(options: {
  apiBase: string;
  sessionId: string;
  runId: string;
  appendCursor: string;
  currentStatus: "running" | "settled";
  fetch: FetchLike;
  signal?: AbortSignal;
}): Promise<ProcessOutputUpdate> {
  try {
    const append = await loadProcessOutputAppend(options);
    if (append.status === "running" || options.currentStatus === "settled") {
      return { kind: "append", append };
    }
    return {
      kind: "reload",
      reason: "settled",
      output: await loadProcessOutput(options),
    };
  } catch (error) {
    if (
      !(error instanceof ProcessOutputRequestError)
      || error.code !== "PROCESS_CURSOR_INVALID"
    ) {
      throw error;
    }
    return {
      kind: "reload",
      reason: "cursor-invalid",
      output: await loadProcessOutput(options),
    };
  }
}

export async function loadSubSessionView(options: {
  apiBase: string;
  sessionId: string;
  fetch: FetchLike;
  signal?: AbortSignal;
}): Promise<OperatorSubSessionView> {
  const fetch = options.fetch;
  const response = await fetch(
    endpoint(
      options.apiBase,
      `/api/local-console/sessions/${encodeURIComponent(options.sessionId)}/view`,
    ),
    options.signal === undefined ? undefined : { signal: options.signal },
  );
  const body = await response.json() as OperatorSubSessionView | { error?: string };
  if (!response.ok) {
    throw new Error("error" in body && typeof body.error === "string"
      ? body.error
      : "sub-session view request failed");
  }
  return body as OperatorSubSessionView;
}

export async function loadExecutionProfileRegistry(options: {
  apiBase: string;
  fetch: FetchLike;
  signal?: AbortSignal;
}): Promise<ExecutionModelRegistry> {
  const response = await options.fetch(
    endpoint(options.apiBase, "/api/local-console/execution-profiles"),
    options.signal === undefined ? undefined : { signal: options.signal },
  );
  const body = await response.json() as {
    registry?: ExecutionModelRegistry;
    error?: string;
  };
  if (!response.ok || body.registry === undefined) {
    throw new Error(body.error ?? "execution profile registry request failed");
  }
  return body.registry;
}

export async function submitSessionMessage(options: {
  apiBase: string;
  sessionId: string;
  body: string;
  attachmentIds?: readonly string[];
  resumeRunId?: string | null;
  fetch: FetchLike;
}): Promise<void> {
  const attachmentIds = options.attachmentIds ?? [];
  const fetch = options.fetch;
  const response = await fetch(
    endpoint(
      options.apiBase,
      `/api/local-console/sessions/${encodeURIComponent(options.sessionId)}/messages`,
    ),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: options.body,
        ...(attachmentIds.length === 0 ? {} : { attachmentIds }),
        ...(options.resumeRunId == null ? {} : { resumeRunId: options.resumeRunId }),
      }),
    },
  );
  const responseBody = await response.json() as { error?: string };
  if (!response.ok) {
    throw new Error(responseBody.error ?? "send failed");
  }
}

export async function retryPendingSessionMessage(options: {
  apiBase: string;
  sessionId: string;
  messageId: number;
  fetch: FetchLike;
}): Promise<void> {
  await mutatePendingSessionMessage({ ...options, method: "POST" });
}

export async function updatePendingSessionMessage(options: {
  apiBase: string;
  sessionId: string;
  messageId: number;
  body: string;
  fetch: FetchLike;
}): Promise<void> {
  await mutatePendingSessionMessage({ ...options, method: "PATCH" });
}

export async function removePendingSessionMessage(options: {
  apiBase: string;
  sessionId: string;
  messageId: number;
  fetch: FetchLike;
}): Promise<void> {
  await mutatePendingSessionMessage({ ...options, method: "DELETE" });
}

async function mutatePendingSessionMessage(options: {
  apiBase: string;
  sessionId: string;
  messageId: number;
  method: "POST" | "PATCH" | "DELETE";
  body?: string;
  fetch: FetchLike;
}): Promise<void> {
  const fetch = options.fetch;
  const response = await fetch(
    endpoint(
      options.apiBase,
      `/api/local-console/sessions/${encodeURIComponent(options.sessionId)}/messages/${String(options.messageId)}/pending`,
    ),
    {
      method: options.method,
      ...(options.method === "PATCH"
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ body: options.body ?? "" }),
          }
        : {}),
    },
  );
  const responseBody = await response.json() as { error?: string };
  if (!response.ok) {
    throw new Error(responseBody.error ?? "pending message mutation failed");
  }
}

export async function retrySessionRun(options: {
  apiBase: string;
  sessionId: string;
  runId: string;
  executionOverride?: {
    cli: "codex" | "claude" | "kimi";
    model: string;
    effort: string;
  };
  fetch: FetchLike;
}): Promise<void> {
  const fetch = options.fetch;
  const response = await fetch(
    endpoint(
      options.apiBase,
      `/api/local-console/sessions/${encodeURIComponent(options.sessionId)}/runs/${encodeURIComponent(options.runId)}/retry`,
    ),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options.executionOverride === undefined
        ? {}
        : {
            executionOverride: {
              overrideId: [
                "single-run",
                options.runId,
                crypto.randomUUID(),
              ].join(":"),
              profile: options.executionOverride,
              scope: "single-run",
            },
          }),
    },
  );
  const responseBody = await response.json() as { error?: string };
  if (!response.ok) {
    throw new Error(responseBody.error ?? "retry failed");
  }
}

export async function loadWorkspaceDiff(options: {
  apiBase: string;
  sessionId: string;
  fetch: FetchLike;
}): Promise<WorkspaceDiffData> {
  return await loadWorkspaceJson<WorkspaceDiffData>(
    options,
    `/api/local-console/sessions/${encodeURIComponent(options.sessionId)}/workspace-diff`,
    "workspace diff request failed",
  );
}

export async function loadProjectFiles(options: {
  apiBase: string;
  sessionId: string;
  fetch: FetchLike;
}): Promise<ProjectFilesData> {
  return await loadWorkspaceJson<ProjectFilesData>(
    options,
    `/api/local-console/sessions/${encodeURIComponent(options.sessionId)}/files`,
    "project files request failed",
  );
}

export async function loadProjectFile(options: {
  apiBase: string;
  sessionId: string;
  filePath: string;
  fetch: FetchLike;
}): Promise<WorkspaceFileContent> {
  const url = endpoint(
    options.apiBase,
    `/api/local-console/sessions/${encodeURIComponent(options.sessionId)}/files/content`,
  );
  url.searchParams.set("path", options.filePath);
  const fetch = options.fetch;
  const response = await fetch(url);
  const body = await response.json() as WorkspaceFileContent | { error?: string };
  if (!response.ok) {
    throw new Error("error" in body && body.error ? body.error : "project file request failed");
  }
  return body as WorkspaceFileContent;
}

export async function loadFileReference(options: {
  apiBase: string;
  sessionId: string;
  filePath: string;
  line: number;
  column: number | null;
  fetch: FetchLike;
}): Promise<FileReferenceContent> {
  const url = endpoint(
    options.apiBase,
    `/api/local-console/sessions/${encodeURIComponent(options.sessionId)}/file-reference`,
  );
  url.searchParams.set("path", options.filePath);
  url.searchParams.set("line", String(options.line));
  if (options.column !== null) {
    url.searchParams.set("column", String(options.column));
  }
  const fetch = options.fetch;
  const response = await fetch(url);
  const body = await response.json() as FileReferenceContent | { error?: string };
  if (!response.ok) {
    throw new Error("error" in body && body.error ? body.error : "file reference request failed");
  }
  return body as FileReferenceContent;
}

async function loadWorkspaceJson<T>(
  options: { apiBase: string; fetch: FetchLike },
  pathname: string,
  fallbackError: string,
): Promise<T> {
  const fetch = options.fetch;
  const response = await fetch(endpoint(options.apiBase, pathname));
  const body = await response.json() as T | { error?: string };
  if (!response.ok) {
    throw new Error(typeof body === "object" && body !== null && "error" in body && body.error
      ? body.error
      : fallbackError);
  }
  return body as T;
}

function labeledOutput(label: string, value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? `${label}\n${text}` : null;
}

const evidenceMemberKeys: Readonly<Record<string, TranslationKey>> = {
  ceo: "console.role.ceo",
  dev: "console.role.dev",
  "dev-manager": "console.role.devManager",
  "product-manager": "console.role.product",
  qa: "console.role.qa",
  secretary: "console.role.secretary",
  "hermes-user": "console.role.user",
  user: "console.role.user",
};

function translatedEvidenceMemberName(role: string | null, t: Translate): string {
  if (role === null || role.trim() === "") {
    return t("console.common.collaborator");
  }
  const key = evidenceMemberKeys[role];
  return key === undefined ? `@${role}` : t(key);
}

export interface CreatedSession {
  sessionId: string;
  title?: string;
  projectId?: string;
  analysisParentSessionId?: string | null;
  originSessionId?: string | null;
  entryTemplate?: "session-analysis" | null;
  writePolicy?: "normal" | "confirm-current-plan-before-write";
  agentTeamOwnership?: "system" | "user" | null;
  agentTeamId?: string | null;
}

export async function createSidebarConversationSession(options: {
  apiBase: string;
  projectId: string;
  initialMessage: string;
  agentTeam: { ownership: "system" | "user"; id: string };
  workspaceMode: "direct" | "worktree";
  attachmentIds?: readonly string[];
  attachmentDraftKey: string;
  originSessionId: string | null;
  analysisParentSessionId?: string | null;
  entryTemplate: "session-analysis" | null;
  writePolicy: "normal" | "confirm-current-plan-before-write";
  textFragments: readonly { id: string; label: string; text: string }[];
  fetch: FetchLike;
}): Promise<CreatedSession> {
  if (options.initialMessage.trim() === "") {
    throw new Error("Message body must not be empty");
  }
  const fetch = options.fetch;
  const response = await fetch(endpoint(options.apiBase, "/api/local-console/sessions"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId: options.projectId,
      initialMessage: options.initialMessage,
      agentTeamOwnership: options.agentTeam.ownership,
      agentTeamId: options.agentTeam.id,
      workspaceMode: options.workspaceMode,
      attachmentIds: options.attachmentIds ?? [],
      attachmentDraftKey: options.attachmentDraftKey,
      originSessionId: options.originSessionId,
      analysisParentSessionId: options.analysisParentSessionId
        ?? (options.entryTemplate === "session-analysis" ? options.originSessionId : null),
      entryTemplate: options.entryTemplate,
      writePolicy: options.writePolicy,
      textFragments: options.textFragments,
    }),
  });
  const body = await response.json() as SessionResponse;
  if (!response.ok || body.session === undefined) {
    throw new Error(body.error ?? "create sidebar conversation failed");
  }
  return body.session;
}

export async function loadSessionReferenceText(options: {
  apiBase: string;
  sessionId: string;
  scope: "message" | "conversation";
  runId?: string | null;
  messageId?: number | null;
  fetch: FetchLike;
}): Promise<{ fragment: { id: string; label: string; text: string } }> {
  const url = endpoint(
    options.apiBase,
    `/api/local-console/sessions/${encodeURIComponent(options.sessionId)}/reference-text`,
  );
  url.searchParams.set("scope", options.scope);
  if (options.runId != null) url.searchParams.set("runId", options.runId);
  if (options.messageId != null) url.searchParams.set("messageId", String(options.messageId));
  const fetch = options.fetch;
  const response = await fetch(url);
  const body = await response.json() as { fragment?: { id: string; label: string; text: string }; error?: string };
  if (!response.ok || body.fragment === undefined) {
    throw new Error(body.error ?? "session reference request failed");
  }
  return { fragment: body.fragment };
}

export interface SessionSearchResult {
  session: import("@moebius/console-ui").OperatorSession;
  project: { projectId: string; title: string };
  archived: boolean;
  originAvailable: boolean;
}

export async function searchConsoleSessions(options: {
  apiBase: string;
  query: string;
  includeArchived: boolean;
  fetch: FetchLike;
  signal?: AbortSignal;
}): Promise<SessionSearchResult[]> {
  const url = endpoint(options.apiBase, "/api/local-console/sessions/search");
  url.searchParams.set("query", options.query);
  url.searchParams.set("includeArchived", String(options.includeArchived));
  const fetch = options.fetch;
  const response = await fetch(
    url,
    options.signal === undefined ? undefined : { signal: options.signal },
  );
  const body = await response.json() as { results?: SessionSearchResult[]; error?: string };
  if (!response.ok || body.results === undefined) {
    throw new Error(body.error ?? "session search failed");
  }
  return body.results;
}

export async function restoreConsoleSession(options: {
  apiBase: string;
  sessionId: string;
  fetch: FetchLike;
}): Promise<import("@moebius/console-ui").OperatorSession> {
  const fetch = options.fetch;
  const response = await fetch(endpoint(
    options.apiBase,
    `/api/local-console/sessions/${encodeURIComponent(options.sessionId)}/restore`,
  ), { method: "POST" });
  const body = await response.json() as {
    session?: import("@moebius/console-ui").OperatorSession;
    error?: string;
  };
  if (!response.ok || body.session === undefined) {
    throw new Error(body.error ?? "restore session failed");
  }
  return body.session;
}

interface SessionResponse {
  session?: CreatedSession;
  error?: string;
}

interface ProjectResponse {
  project?: {
    projectId: string;
    sessions: Array<{ sessionId: string; parentSessionId?: string | null }>;
  };
  error?: string;
}

interface ProjectOrderResponse {
  projects?: Array<{ projectId: string }>;
  error?: string;
}

interface ArchiveSessionResponse {
  sessionId?: string;
  projectId?: string;
  selectedSessionId?: string | null;
  archivedSessionIds?: string[];
  error?: string;
}

export interface ConsoleStateActionsOptions {
  apiBase: string | null;
  coordinator: ConsoleStateCoordinator;
  fetch: FetchLike;
  t: Translate;
  getSelection(): ConsoleSelection;
  commitSelection(selection: ConsoleSelection): void;
  refresh(selection: ConsoleSelection, mutationOwner?: SelectionMutationToken): Promise<boolean>;
  composerValue: string;
  clearComposer(sessionId?: string): void;
  getAttachmentIds?(): readonly string[];
  getResumeRunId?(sessionId: string): string | null;
  clearAttachments?(sessionId: string): void;
  clearResumeRunId?(sessionId: string): void;
  setMutationKind(kind: SelectionMutationKind | null): void;
  setSending(sending: boolean): void;
  setError(error: string): void;
  commitSessionMetadata?(session: OperatorSession): void;
  selectProjectFolder?: () => Promise<string | null>;
}

export class ConsoleStateActions {
  constructor(private readonly options: ConsoleStateActionsOptions) {}

  readonly createSessionWithFirstMessage = async (
    projectId: string,
    initialMessage: string,
    agentTeam?: { ownership: "system" | "user"; id: string },
    workspaceMode?: "direct" | "worktree",
    attachmentIds: readonly string[] = [],
  ): Promise<CreatedSession | null> => {
    if (this.options.apiBase === null) {
      this.options.setError(this.options.t("desktop.error.localConsoleUnavailable"));
      return null;
    }
    const normalizedMessage = initialMessage.trim();
    if (normalizedMessage === "" && attachmentIds.length === 0) {
      return null;
    }
    const token = this.beginMutation("create-session");
    if (token === null) {
      return null;
    }
    this.options.setSending(true);
    try {
      const fetch = this.options.fetch;
      const response = await fetch(endpoint(this.options.apiBase, "/api/local-console/sessions"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          initialMessage: normalizedMessage,
          ...(attachmentIds.length === 0 ? {} : { attachmentIds }),
          ...(agentTeam === undefined
            ? {}
            : { agentTeamOwnership: agentTeam.ownership, agentTeamId: agentTeam.id }),
          ...(workspaceMode === undefined ? {} : { workspaceMode }),
        }),
      });
      const body = await response.json() as SessionResponse;
      if (!response.ok || body.session === undefined) {
        throw new Error(body.error ?? "create session failed");
      }
      const nextSelection = { projectId, sessionId: body.session.sessionId };
      this.options.commitSelection(nextSelection);
      await this.options.refresh(nextSelection, token);
      return body.session;
    } catch (error) {
      this.options.setError(formatError(error));
      return null;
    } finally {
      this.options.setSending(false);
      this.finishMutation(token);
    }
  };

  readonly addProject = async (existingProjectIds: readonly string[]): Promise<{ projectId: string } | null> => {
    if (this.options.apiBase === null) {
      this.options.setError(this.options.t("desktop.error.localConsoleUnavailable"));
      return null;
    }
    if (this.options.selectProjectFolder === undefined) {
      this.options.setError(this.options.t("desktop.error.folderPickerUnavailable"));
      return null;
    }
    const token = this.beginMutation("open-project");
    if (token === null) {
      return null;
    }
    try {
      const folderPath = await this.options.selectProjectFolder();
      if (folderPath === null) {
        return null;
      }
      const fetch = this.options.fetch;
      const response = await fetch(endpoint(this.options.apiBase, "/api/local-console/projects"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderPath, worktreeMode: false }),
      });
      const body = await response.json() as ProjectResponse;
      if (!response.ok || body.project === undefined) {
        throw new Error(body.error ?? "open project failed");
      }
      if (existingProjectIds.includes(body.project.projectId)) {
        this.options.setError(this.options.t("desktop.error.folderAlreadyUsed"));
        return null;
      }
      await this.options.refresh(this.options.getSelection(), token);
      return { projectId: body.project.projectId };
    } catch (error) {
      this.options.setError(formatError(error));
      return null;
    } finally {
      this.finishMutation(token);
    }
  };

  readonly openProject = async (): Promise<void> => {
    if (this.options.apiBase === null) {
      this.options.setError(this.options.t("desktop.error.localConsoleUnavailable"));
      return;
    }
    if (this.options.selectProjectFolder === undefined) {
      this.options.setError(this.options.t("desktop.error.folderPickerUnavailable"));
      return;
    }
    const token = this.beginMutation("open-project");
    if (token === null) {
      return;
    }
    try {
      const folderPath = await this.options.selectProjectFolder();
      if (folderPath === null) {
        return;
      }
      const fetch = this.options.fetch;
      const response = await fetch(endpoint(this.options.apiBase, "/api/local-console/projects"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderPath, worktreeMode: false }),
      });
      const body = await response.json() as ProjectResponse;
      if (!response.ok || body.project === undefined) {
        throw new Error(body.error ?? "open project failed");
      }
      const nextSelection = {
        projectId: body.project.projectId,
        sessionId: body.project.sessions.find((session) => session.parentSessionId == null)?.sessionId
          ?? this.options.getSelection().sessionId,
      };
      this.options.commitSelection(nextSelection);
      await this.options.refresh(nextSelection, token);
    } catch (error) {
      this.options.setError(formatError(error));
    } finally {
      this.finishMutation(token);
    }
  };

  readonly selectSession = (nextSelection: ConsoleSelection): void => {
    if (this.options.coordinator.isSelectionMutationPending) {
      return;
    }
    this.options.coordinator.invalidateRefresh();
    this.options.commitSelection(nextSelection);
    void this.options.refresh(nextSelection);
  };

  readonly rebindSessionProject = async (sessionId: string, projectId: string): Promise<void> => {
    if (this.options.apiBase === null || projectId === this.options.getSelection().projectId) {
      return;
    }
    const token = this.beginMutation("rebind-session");
    if (token === null) {
      return;
    }
    try {
      const fetch = this.options.fetch;
      const response = await fetch(
        endpoint(this.options.apiBase, `/api/local-console/sessions/${encodeURIComponent(sessionId)}/project`),
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId }),
        },
      );
      const body = await response.json() as SessionResponse;
      if (!response.ok || body.session === undefined) {
        throw new Error(body.error ?? "change session project failed");
      }
      const nextSelection = { projectId, sessionId };
      this.options.commitSelection(nextSelection);
      await this.options.refresh(nextSelection, token);
    } catch (error) {
      this.options.setError(formatError(error));
    } finally {
      this.finishMutation(token);
    }
  };

  readonly changeSessionWorkspace = async (
    sessionId: string,
    workspaceMode: "direct" | "worktree",
  ): Promise<void> => {
    await this.patchSessionContext(
      sessionId,
      "workspace",
      { workspaceMode },
      "change session workspace failed",
    );
  };

  readonly changeSessionTeam = async (
    sessionId: string,
    team: { ownership: "system" | "user"; id: string },
  ): Promise<void> => {
    await this.patchSessionContext(
      sessionId,
      "team",
      { agentTeamOwnership: team.ownership, agentTeamId: team.id },
      "change session team failed",
    );
  };

  readonly reorderProjects = async (projectIds: string[]): Promise<boolean> => {
    if (this.options.apiBase === null || this.options.coordinator.isSelectionMutationPending) {
      if (this.options.apiBase === null) {
        this.options.setError(this.options.t("desktop.error.localConsoleUnavailable"));
      }
      return false;
    }
    try {
      const fetch = this.options.fetch;
      const response = await fetch(endpoint(this.options.apiBase, "/api/local-console/projects/order"), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectIds }),
      });
      const body = await response.json() as ProjectOrderResponse;
      if (!response.ok || body.projects === undefined) {
        throw new Error(body.error ?? "reorder projects failed");
      }
      await this.options.refresh(this.options.getSelection());
      return true;
    } catch (error) {
      this.options.setError(formatError(error));
      return false;
    }
  };

  readonly archiveSession = async (sessionId: string, projectId: string): Promise<string[] | null> => {
    if (this.options.apiBase === null) {
      this.options.setError(this.options.t("desktop.error.localConsoleUnavailable"));
      return null;
    }
    const token = this.beginMutation("archive-session");
    if (token === null) {
      return null;
    }
    try {
      const fetch = this.options.fetch;
      const response = await fetch(
        endpoint(this.options.apiBase, `/api/local-console/sessions/${encodeURIComponent(sessionId)}/archive`),
        { method: "POST" },
      );
      const body = await response.json() as ArchiveSessionResponse;
      if (!response.ok || body.sessionId !== sessionId || body.projectId !== projectId) {
        throw new Error(body.error ?? "archive session failed");
      }
      const currentSelection = this.options.getSelection();
      const nextSelection = currentSelection.sessionId === sessionId
        ? { projectId, sessionId: body.selectedSessionId ?? sessionId }
        : currentSelection;
      this.options.commitSelection(nextSelection);
      await this.options.refresh(nextSelection, token);
      return body.archivedSessionIds ?? [sessionId];
    } catch (error) {
      this.options.setError(formatError(error));
      return null;
    } finally {
      this.finishMutation(token);
    }
  };

  readonly updateSessionReadState = async (
    session: {
      id: string;
      titleRevision?: number;
      attentionRevision?: number;
      readStateRevision?: number;
    },
    action: "mark-read-attention" | "mark-read-unread" | "mark-unread",
  ): Promise<void> => {
    await this.mutateSidebarSession(
      session.id,
      "attention",
      {
        action,
        expectedAttentionRevision: session.attentionRevision ?? 0,
        expectedReadStateRevision: session.readStateRevision ?? 0,
        expectedTitleRevision: session.titleRevision ?? 0,
        isCurrent: this.options.getSelection().sessionId === session.id,
      },
      "update conversation read state failed",
    );
  };

  readonly setSessionPinned = async (
    session: { id: string; pinnedAt?: string | null },
    pinned: boolean,
  ): Promise<void> => {
    await this.mutateSidebarSession(
      session.id,
      "pin",
      { pinned, expectedPinnedAt: session.pinnedAt ?? null },
      "update conversation pin failed",
    );
  };

  readonly renameSession = async (
    session: { id: string; titleRevision?: number },
    title: string,
  ): Promise<void> => {
    await this.mutateSidebarSession(
      session.id,
      "title",
      { title, expectedTitleRevision: session.titleRevision ?? 0 },
      "rename conversation failed",
    );
  };

  readonly transitionSessionView = async (
    previousSessionId: string,
    nextSessionId: string,
  ): Promise<string | null> => {
    if (
      this.options.apiBase === null
      || previousSessionId === nextSessionId
    ) {
      return null;
    }
    try {
      await this.postSessionMutation(previousSessionId, "arm-manual-unread", undefined);
      await this.postSessionMutation(nextSessionId, "viewed", undefined);
      return null;
    } catch (error) {
      const message = formatError(error);
      this.options.setError(message);
      return message;
    }
  };

  readonly sendMessage = async (): Promise<void> => {
    const attachmentIds = this.options.getAttachmentIds?.() ?? [];
    if (
      this.options.apiBase === null
      || (this.options.composerValue.trim() === "" && attachmentIds.length === 0)
      || !this.options.coordinator.beginSend()
    ) {
      return;
    }
    this.options.setSending(true);
    try {
      const selection = this.options.getSelection();
      const fetch = this.options.fetch;
      const response = await fetch(
        endpoint(this.options.apiBase, `/api/local-console/sessions/${encodeURIComponent(selection.sessionId)}/messages`),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(attachmentIds.length === 0
            ? {
                body: this.options.composerValue,
                ...(this.options.getResumeRunId?.(selection.sessionId) == null
                  ? {}
                  : { resumeRunId: this.options.getResumeRunId?.(selection.sessionId) }),
              }
            : {
                body: this.options.composerValue,
                attachmentIds,
                ...(this.options.getResumeRunId?.(selection.sessionId) == null
                  ? {}
                  : { resumeRunId: this.options.getResumeRunId?.(selection.sessionId) }),
              }),
        },
      );
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "send failed");
      }
      this.options.clearComposer(selection.sessionId);
      this.options.clearAttachments?.(selection.sessionId);
      this.options.clearResumeRunId?.(selection.sessionId);
      await this.options.refresh(this.options.getSelection());
    } catch (error) {
      this.options.setError(formatError(error));
    } finally {
      this.options.coordinator.endSend();
      this.options.setSending(false);
    }
  };

  private async patchSessionContext(
    sessionId: string,
    context: "workspace" | "team",
    payload: Record<string, unknown>,
    fallbackError: string,
  ): Promise<void> {
    if (this.options.apiBase === null) {
      this.options.setError(this.options.t("desktop.error.localConsoleUnavailable"));
      return;
    }
    try {
      const fetch = this.options.fetch;
      const response = await fetch(
        endpoint(this.options.apiBase, `/api/local-console/sessions/${encodeURIComponent(sessionId)}/${context}`),
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = await response.json() as SessionResponse;
      if (!response.ok || body.session === undefined) {
        throw new Error(body.error ?? fallbackError);
      }
      await this.options.refresh(this.options.getSelection());
    } catch (error) {
      this.options.setError(formatError(error));
    }
  }

  private async mutateSidebarSession(
    sessionId: string,
    action: "attention" | "pin" | "title",
    payload: Record<string, unknown>,
    fallbackError: string,
  ): Promise<void> {
    if (this.options.apiBase === null) {
      const error = new Error(this.options.t("desktop.error.localConsoleUnavailable"));
      this.options.setError(error.message);
      throw error;
    }
    try {
      const session = await this.postSessionMutation(sessionId, action, payload);
      this.options.commitSessionMetadata?.(session);
      this.options.coordinator.invalidateRefresh();
      await this.options.refresh(this.options.getSelection());
    } catch (error) {
      const message = formatError(error) || fallbackError;
      this.options.setError(message);
      throw error;
    }
  }

  private async postSessionMutation(
    sessionId: string,
    action: "attention" | "pin" | "title" | "arm-manual-unread" | "viewed",
    payload: Record<string, unknown> | undefined,
  ): Promise<OperatorSession> {
    if (this.options.apiBase === null) {
      throw new Error(this.options.t("desktop.error.localConsoleUnavailable"));
    }
    const fetch = this.options.fetch;
    const response = await fetch(
      endpoint(
        this.options.apiBase,
        `/api/local-console/sessions/${encodeURIComponent(sessionId)}/${action}`,
      ),
      {
        method: "POST",
        ...(payload === undefined
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            }),
      },
    );
    const body = await response.json() as { session?: OperatorSession; error?: string };
    if (!response.ok || body.session === undefined) {
      throw new Error(body.error ?? "conversation mutation failed");
    }
    return body.session;
  }

  private beginMutation(kind: SelectionMutationKind): SelectionMutationToken | null {
    const token = this.options.coordinator.beginSelectionMutation(kind);
    if (token !== null) {
      this.options.setMutationKind(kind);
    }
    return token;
  }

  private finishMutation(token: SelectionMutationToken): void {
    if (this.options.coordinator.endSelectionMutation(token)) {
      this.options.setMutationKind(null);
    }
  }
}

function endpoint(base: string, path: string): URL {
  return new URL(path.replace(/^\//u, ""), base.endsWith("/") ? base : `${base}/`);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
