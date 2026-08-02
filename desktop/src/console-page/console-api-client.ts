import type {
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
  ProcessOutputRequestError,
  type ProcessOutputUpdate,
} from "./console-process-model.js";
import { planSidebarAnalysisParent } from "./console-state-plan.js";
import type { CreatedSession } from "./console-state-action-contract.js";
import type { SessionSearchResult } from "./conversation-search-model.js";

export type { SessionSearchResult } from "./conversation-search-model.js";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

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
      analysisParentSessionId: planSidebarAnalysisParent({
        explicitParentId: options.analysisParentSessionId,
        entryTemplate: options.entryTemplate,
        originSessionId: options.originSessionId,
      }),
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

function endpoint(base: string, path: string): URL {
  return new URL(path.replace(/^\//u, ""), base.endsWith("/") ? base : `${base}/`);
}
