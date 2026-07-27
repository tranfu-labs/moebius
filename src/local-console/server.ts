import http from "node:http";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  CODEX_RUN_IDLE_TIMEOUT_MS,
  CODEX_RUN_MAX_DURATION_MS,
  LOCAL_CONSOLE_HOST,
  LOCAL_CONSOLE_PORT,
  LOCAL_CONSOLE_SQLITE_BUSY_TIMEOUT_MS,
  LOCAL_CONSOLE_SQLITE_PATH,
  LOCAL_CONSOLE_SESSION_LOG_ROOT,
  LOCAL_CONSOLE_STORE_TIMEOUT_MS,
  PROJECT_ROOT,
  TMP_ROOT,
} from "../config.js";
import { run as runCodex } from "../codex.js";
import { log } from "../log.js";
import { createSqliteLocalConsoleStore } from "./store.js";
import {
  LOCAL_ATTACHMENT_PREVIEW_MAX_BYTES,
  LocalAttachmentManager,
  supportsManagedAttachments,
} from "./attachments.js";
import { listLocalT5Facts } from "./t5-store.js";
import type { LocalRouteJudgment } from "./route-bus.js";
import { ProcessCursorError } from "./process-history.js";
import {
  LocalConsoleBusyError,
  LocalConsoleProjectFolderError,
  LocalConsoleProjectRunningError,
  LocalConsoleSessionProjectError,
  LocalConsoleSessionRunningError,
  LocalConsoleSessionWorkspaceLockedError,
  type LocalConsoleStore,
} from "./types.js";
import {
  formatLocalError,
  LocalConsoleRuntime,
  type LocalConsoleAgentFile,
  type LocalConsoleRuntimeOptions,
} from "./runtime.js";

export interface LocalConsoleServerOptions {
  host?: string;
  port?: number;
  projectRoot?: string;
  workdirRoot?: string;
  store?: LocalConsoleStore;
  sqlitePath?: string;
  sessionLogRoot?: string;
  listAgentFiles?: (sessionId: string) => Promise<LocalConsoleAgentFile[]>;
  loadAgentTeamSnapshot?: LocalConsoleRuntimeOptions["loadAgentTeamSnapshot"];
  resolveAgentTeamHealth?: LocalConsoleRuntimeOptions["resolveAgentTeamHealth"];
  runCodex?: typeof runCodex;
  runExecution?: LocalConsoleRuntimeOptions["runExecution"];
  makeRunDir?: (count: number, now?: Date) => string;
  storeTimeoutMs?: number;
  sqliteBusyTimeoutMs?: number;
  codexIdleTimeoutMs?: number;
  codexMaxDurationMs?: number;
  workspaceGitTimeoutMs?: number;
  routeJudgment?: LocalRouteJudgment;
  routeTimeoutMs?: number;
  failureRetryLimit?: number;
  isCodexThreadAvailable?: LocalConsoleRuntimeOptions["isCodexThreadAvailable"];
  attachmentRoot?: string;
  attachmentCapability?: string;
}

export interface StartedLocalConsoleServer {
  server: http.Server;
  runtime: LocalConsoleRuntime;
  url: string;
  sqlitePath: string;
  close(): Promise<void>;
}

export async function startLocalConsoleServer(options: LocalConsoleServerOptions = {}): Promise<StartedLocalConsoleServer> {
  const host = options.host ?? LOCAL_CONSOLE_HOST;
  const requestedPort = options.port ?? LOCAL_CONSOLE_PORT;
  const projectRoot = options.projectRoot ?? PROJECT_ROOT;
  const workdirRoot = options.workdirRoot ?? path.join(projectRoot, "workdir");
  const sqlitePath = options.sqlitePath ?? (options.projectRoot === undefined ? LOCAL_CONSOLE_SQLITE_PATH : path.join(projectRoot, ".state", "local-console.sqlite"));
  const store =
    options.store ??
    (await createSqliteLocalConsoleStore({
      sqlitePath,
      sessionLogRoot: options.sessionLogRoot
        ?? (options.projectRoot === undefined ? LOCAL_CONSOLE_SESSION_LOG_ROOT : path.join(projectRoot, "sessions")),
      busyTimeoutMs: options.sqliteBusyTimeoutMs ?? LOCAL_CONSOLE_SQLITE_BUSY_TIMEOUT_MS,
      timeoutMs: options.storeTimeoutMs ?? LOCAL_CONSOLE_STORE_TIMEOUT_MS,
    }));
  const attachmentManager = supportsManagedAttachments(store)
    ? new LocalAttachmentManager(
        options.attachmentRoot ?? path.join(path.dirname(sqlitePath), "local-console-attachments"),
        store,
      )
    : undefined;
  await attachmentManager?.init();
  const attachmentCapability = options.attachmentCapability ?? randomBytes(32).toString("base64url");
  const runtime = new LocalConsoleRuntime({
    store,
    listAgentFiles: options.listAgentFiles ?? (() => listLocalAgentFiles(path.join(projectRoot, "agents"))),
    loadAgentTeamSnapshot: options.loadAgentTeamSnapshot,
    resolveAgentTeamHealth: options.resolveAgentTeamHealth,
    runCodex: options.runCodex ?? runCodex,
    runExecution: options.runExecution,
    makeRunDir: options.makeRunDir ?? makeLocalConsoleRunDir,
    projectRoot,
    workdirRoot,
    storeTimeoutMs: options.storeTimeoutMs ?? LOCAL_CONSOLE_STORE_TIMEOUT_MS,
    codexIdleTimeoutMs: options.codexIdleTimeoutMs ?? CODEX_RUN_IDLE_TIMEOUT_MS,
    codexMaxDurationMs: options.codexMaxDurationMs ?? CODEX_RUN_MAX_DURATION_MS,
    workspaceGitTimeoutMs: options.workspaceGitTimeoutMs,
    routeJudgment: options.routeJudgment,
    routeTimeoutMs: options.routeTimeoutMs,
    failureRetryLimit: options.failureRetryLimit,
    isCodexThreadAvailable: options.isCodexThreadAvailable,
    attachmentManager,
  });
  await runtime.init();

  const server = createLocalConsoleHttpServer(runtime, attachmentManager, attachmentCapability);
  const { port } = await listenWithFallback(server, host, requestedPort);
  void runtime.processAllPending().catch((error) => {
    log({ event: "local-console-startup-catch-up-failed", error: formatLocalError(error) });
  });

  const url = `http://${host}:${String(port)}/`;
  log({ event: "local-console-started", url, sqlitePath: store.sqlitePath });

  return {
    server,
    runtime,
    url,
    sqlitePath: store.sqlitePath,
    async close() {
      await closeServer(server);
      await runtime.close();
    },
  };
}

let localRunDirSequence = 0;

export function makeLocalConsoleRunDir(count: number, now = new Date()): string {
  localRunDirSequence += 1;
  return path.join(TMP_ROOT, `moebius-local-${now.toISOString()}-c${count}-r${localRunDirSequence}`);
}

export function createLocalConsoleHttpServer(
  runtime: LocalConsoleRuntime,
  attachmentManager?: LocalAttachmentManager,
  attachmentCapability?: string,
): http.Server {
  return http.createServer((request, response) => {
    void handleRequest(runtime, request, response, attachmentManager, attachmentCapability);
  });
}

async function handleRequest(
  runtime: LocalConsoleRuntime,
  request: http.IncomingMessage,
  response: http.ServerResponse,
  attachmentManager?: LocalAttachmentManager,
  attachmentCapability?: string,
): Promise<void> {
  try {
    if (request.method === "OPTIONS") {
      sendNoContent(response);
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/api/local-console/attachments")) {
      if (attachmentManager === undefined || attachmentCapability === undefined) {
        sendJson(response, 404, { error: "Managed attachments are unavailable" });
        return;
      }
      if (!hasAttachmentCapability(request, attachmentCapability)) {
        sendJson(response, 403, { error: "Attachment capability required" });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/local-console/attachments") {
        const draftKey = readRequiredQuery(url, "draftKey");
        const displayName = readRequiredQuery(url, "displayName");
        const contentLength = readOptionalContentLength(request.headers["content-length"]);
        const result = await attachmentManager.upload({
          draftKey,
          displayName,
          mediaTypeHint: readHeader(request.headers["content-type"]),
          contentLength,
          stream: request,
          isCancelled: () => request.aborted,
        });
        if (request.aborted) {
          if (result.status === "ready") {
            await attachmentManager.removeDraftAttachment({
              attachmentId: result.attachment.attachmentId,
              draftKey,
            });
          }
          return;
        }
        sendJson(response, result.status === "ready" ? 201 : 202, result);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/local-console/attachments") {
        sendJson(response, 200, { attachments: await attachmentManager.listDraft(readRequiredQuery(url, "draftKey")) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/local-console/attachments/clone") {
        const payload = await readJsonBody(request);
        if (!isRecord(payload)
          || typeof payload.sessionId !== "string"
          || typeof payload.sourceMessageId !== "number"
          || !Number.isInteger(payload.sourceMessageId)
          || typeof payload.targetDraftKey !== "string") {
          sendJson(response, 400, { error: "Expected sessionId, sourceMessageId, and targetDraftKey" });
          return;
        }
        const attachments = await attachmentManager.cloneMessageAttachments({
          sessionId: payload.sessionId,
          sourceMessageId: payload.sourceMessageId,
          targetDraftKey: payload.targetDraftKey,
        });
        sendJson(response, 201, { attachments });
        return;
      }
      const previewFinalizeMatch = /^\/api\/local-console\/attachments\/uploads\/([^/]+)\/preview$/u.exec(url.pathname);
      if (request.method === "POST" && previewFinalizeMatch !== null) {
        const preview = await readBoundedBody(request, LOCAL_ATTACHMENT_PREVIEW_MAX_BYTES);
        const attachment = await attachmentManager.finalizeImagePreview({
          uploadId: decodeURIComponent(previewFinalizeMatch[1] ?? ""),
          draftKey: readRequiredQuery(url, "draftKey"),
          preview,
        });
        sendJson(response, 201, { attachment });
        return;
      }
      const attachmentPreviewMatch = /^\/api\/local-console\/attachments\/([^/]+)\/preview$/u.exec(url.pathname);
      if (request.method === "GET" && attachmentPreviewMatch !== null) {
        const draftKey = readOptionalString(url.searchParams.get("draftKey"));
        const sessionId = readOptionalString(url.searchParams.get("sessionId"));
        if ((draftKey === undefined) === (sessionId === undefined)) {
          sendJson(response, 400, { error: "Exactly one preview scope is required" });
          return;
        }
        const previewPath = await attachmentManager.previewPath({
          attachmentId: decodeURIComponent(attachmentPreviewMatch[1] ?? ""),
          ...(draftKey === undefined ? {} : { draftKey }),
          ...(sessionId === undefined ? {} : { sessionId }),
        });
        if (previewPath === null) {
          sendJson(response, 404, { error: "Attachment preview not found" });
          return;
        }
        const preview = await fs.readFile(previewPath).catch(() => null);
        if (preview === null) {
          sendJson(response, 404, { error: "Attachment preview not found" });
          return;
        }
        sendPng(response, preview);
        return;
      }
      const attachmentMatch = /^\/api\/local-console\/attachments\/([^/]+)$/u.exec(url.pathname);
      if (request.method === "DELETE" && attachmentMatch !== null) {
        const removed = await attachmentManager.removeDraftAttachment({
          attachmentId: decodeURIComponent(attachmentMatch[1] ?? ""),
          draftKey: readRequiredQuery(url, "draftKey"),
        });
        sendJson(response, removed ? 200 : 404, { removed });
        return;
      }
      sendJson(response, 404, { error: "Attachment endpoint not found" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/") {
      sendHtml(response, renderLocalConsolePage());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/local-console/state") {
      sendJson(response, 200, await runtime.state({
        sessionId: readOptionalString(url.searchParams.get("sessionId")),
        projectId: readOptionalString(url.searchParams.get("projectId")),
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/local-console/t5-facts") {
      sendJson(response, 200, await listLocalT5Facts({ sqlitePath: runtime.sqlitePath }, readOptionalString(url.searchParams.get("sessionId")) ?? null));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/local-console/projects") {
      const payload = await readJsonBody(request);
      if (!isRecord(payload) || typeof payload.folderPath !== "string") {
        sendJson(response, 400, { error: "Expected JSON body with a string folderPath field" });
        return;
      }
      const project = await runtime.createProject({
        folderPath: payload.folderPath,
        worktreeMode: readOptionalBoolean(payload.worktreeMode) ?? false,
      });
      sendJson(response, 201, { project });
      return;
    }

    if (request.method === "PUT" && url.pathname === "/api/local-console/projects/order") {
      const payload = await readJsonBody(request);
      if (!isRecord(payload) || !isStringArray(payload.projectIds)) {
        sendJson(response, 400, { error: "Expected JSON body with a projectIds string array" });
        return;
      }
      const projects = await runtime.reorderProjects(payload.projectIds);
      sendJson(response, 200, { projects });
      return;
    }

    const projectMatch = matchProjectRoute(url.pathname);
    if (request.method === "PATCH" && projectMatch !== null) {
      const payload = await readJsonBody(request);
      if (!isRecord(payload)) {
        sendJson(response, 400, { error: "Expected JSON object body" });
        return;
      }
      const project = typeof payload.title === "string"
        ? await runtime.renameProject({ projectId: projectMatch.projectId, title: payload.title })
        : typeof payload.folderPath === "string"
          ? await runtime.repairProjectFolder({ projectId: projectMatch.projectId, folderPath: payload.folderPath })
        : typeof payload.worktreeMode === "boolean"
          ? await runtime.updateProject({ projectId: projectMatch.projectId, worktreeMode: payload.worktreeMode })
          : null;
      if (project === null) {
        sendJson(response, 400, { error: "Expected a string title or boolean worktreeMode field" });
        return;
      }
      sendJson(response, 200, { project });
      return;
    }

    if (request.method === "DELETE" && projectMatch !== null) {
      const payload = await readJsonBody(request);
      if (!isRecord(payload) || (payload.force !== undefined && typeof payload.force !== "boolean")) {
        sendJson(response, 400, { error: "Expected JSON body with an optional boolean force field" });
        return;
      }
      try {
        const result = await runtime.removeProject({
          projectId: projectMatch.projectId,
          force: payload.force === true,
        });
        sendJson(response, 200, result);
      } catch (error) {
        if (error instanceof LocalConsoleProjectRunningError) {
          sendJson(response, 409, { error: error.message, code: error.code });
          return;
        }
        throw error;
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/local-console/sessions") {
      const payload = await readJsonBody(request);
      if (!isRecord(payload) && payload !== undefined) {
        sendJson(response, 400, { error: "Expected JSON object body" });
        return;
      }
      const session = await runtime.createSession(
        isRecord(payload) ? readOptionalString(payload.title) : undefined,
        isRecord(payload) ? readOptionalString(payload.projectId) : undefined,
        isRecord(payload) ? readOptionalAgentTeam(payload) : undefined,
        isRecord(payload) ? readOptionalMessageBody(payload.initialMessage) : undefined,
        isRecord(payload) ? readOptionalWorkspaceMode(payload.workspaceMode) : undefined,
        isRecord(payload) ? readOptionalStringArray(payload.attachmentIds) : undefined,
      );
      sendJson(response, 201, { session });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/local-console/child-sessions") {
      const payload = await readJsonBody(request);
      if (
        !isRecord(payload) ||
        typeof payload.parentSessionId !== "string" ||
        typeof payload.childSessionId !== "string" ||
        typeof payload.projectId !== "string" ||
        typeof payload.title !== "string" ||
        typeof payload.hiddenKey !== "string" ||
        typeof payload.initialBody !== "string"
      ) {
        sendJson(response, 400, {
          error: "Expected JSON body with parentSessionId, childSessionId, projectId, title, hiddenKey, and initialBody",
        });
        return;
      }
      const session = await runtime.createChildSession({
        parentSessionId: payload.parentSessionId,
        childSessionId: payload.childSessionId,
        projectId: payload.projectId,
        title: payload.title,
        relation: readOptionalString(payload.relation) ?? "task",
        hiddenKey: payload.hiddenKey,
        initialBody: payload.initialBody,
        initialRole: readOptionalString(payload.initialRole),
      });
      sendJson(response, 201, { session });
      return;
    }

    const sessionChildrenMatch = matchSessionRoute(url.pathname, "children");
    if (request.method === "GET" && sessionChildrenMatch !== null) {
      sendJson(response, 200, {
        childSessions: await runtime.childSessionSummaries(sessionChildrenMatch.sessionId),
      });
      return;
    }

    const sessionViewMatch = matchSessionRoute(url.pathname, "view");
    if (request.method === "GET" && sessionViewMatch !== null) {
      sendJson(response, 200, await runtime.sessionView(sessionViewMatch.sessionId));
      return;
    }

    const sessionWorkspaceDiffMatch = matchSessionRoute(url.pathname, "workspace-diff");
    if (request.method === "GET" && sessionWorkspaceDiffMatch !== null) {
      sendJson(response, 200, await runtime.workspaceDiffDetail(sessionWorkspaceDiffMatch.sessionId));
      return;
    }

    const sessionFilesMatch = matchSessionRoute(url.pathname, "files");
    if (request.method === "GET" && sessionFilesMatch !== null) {
      sendJson(response, 200, await runtime.projectFiles(sessionFilesMatch.sessionId));
      return;
    }

    const sessionFileContentMatch = matchSessionRoute(url.pathname, "files/content");
    if (request.method === "GET" && sessionFileContentMatch !== null) {
      const filePath = url.searchParams.get("path");
      if (filePath === null || filePath.trim() === "") {
        sendJson(response, 400, { error: "Expected a non-empty path query parameter" });
        return;
      }
      sendJson(response, 200, await runtime.projectFile(sessionFileContentMatch.sessionId, filePath));
      return;
    }

    const runOutputMatch = matchRunOutputRoute(url.pathname);
    if (request.method === "GET" && runOutputMatch !== null) {
      sendJson(response, 200, await runtime.runOutput(runOutputMatch.sessionId, runOutputMatch.runId));
      return;
    }

    const processOutputMatch = matchProcessOutputRoute(url.pathname);
    if (request.method === "GET" && processOutputMatch !== null) {
      try {
        const cursor = url.searchParams.get("cursor") ?? undefined;
        const appendCursor = url.searchParams.get("appendCursor") ?? undefined;
        if (cursor !== undefined && appendCursor !== undefined) {
          sendJson(response, 400, { error: "Expected only one process output cursor" });
          return;
        }
        const output = appendCursor === undefined
          ? await runtime.processOutput(processOutputMatch.sessionId, processOutputMatch.runId, cursor)
          : await runtime.processOutputAppend(
              processOutputMatch.sessionId,
              processOutputMatch.runId,
              appendCursor,
            );
        sendJson(response, 200, output);
      } catch (error) {
        if (error instanceof ProcessCursorError) {
          sendJson(response, 409, {
            error: error.message,
            code: "PROCESS_CURSOR_INVALID",
          });
          return;
        }
        throw error;
      }
      return;
    }

    const processInvocationMatch = matchProcessDebugInvocationRoute(url.pathname);
    if (request.method === "GET" && processInvocationMatch !== null) {
      sendJson(
        response,
        200,
        await runtime.processDebugInvocation(
          processInvocationMatch.sessionId,
          processInvocationMatch.runId,
        ),
      );
      return;
    }

    const sessionProjectMatch = matchSessionRoute(url.pathname, "project");
    if (request.method === "PATCH" && sessionProjectMatch !== null) {
      let payload: unknown;
      try {
        payload = await readJsonBody(request);
      } catch (error) {
        if (error instanceof SyntaxError) {
          sendJson(response, 400, {
            error: "Expected valid JSON body with a non-empty string projectId field",
            code: "INVALID_SESSION_PROJECT_REQUEST",
          });
          return;
        }
        throw error;
      }
      if (!isRecord(payload) || typeof payload.projectId !== "string" || payload.projectId.trim() === "") {
        sendJson(response, 400, {
          error: "Expected valid JSON body with a non-empty string projectId field",
          code: "INVALID_SESSION_PROJECT_REQUEST",
        });
        return;
      }
      try {
        const session = await runtime.moveEmptySessionToProject({
          sessionId: sessionProjectMatch.sessionId,
          projectId: payload.projectId,
        });
        sendJson(response, 200, { session });
      } catch (error) {
        if (error instanceof LocalConsoleSessionProjectError) {
          const statusCode = error.code === "SESSION_PROJECT_LOCKED" ? 409 : 404;
          sendJson(response, statusCode, { error: error.message, code: error.code });
          return;
        }
        throw error;
      }
      return;
    }

    const sessionWorkspaceMatch = matchSessionRoute(url.pathname, "workspace");
    if (request.method === "PATCH" && sessionWorkspaceMatch !== null) {
      const payload = await readJsonBody(request);
      if (!isRecord(payload) || (payload.workspaceMode !== "direct" && payload.workspaceMode !== "worktree")) {
        sendJson(response, 400, { error: "Expected workspaceMode to be direct or worktree" });
        return;
      }
      try {
        const session = await runtime.switchSessionWorkspace({
          sessionId: sessionWorkspaceMatch.sessionId,
          workspaceMode: payload.workspaceMode,
        });
        sendJson(response, 200, { session });
      } catch (error) {
        if (error instanceof LocalConsoleSessionWorkspaceLockedError) {
          sendJson(response, 409, { error: error.message });
          return;
        }
        if (formatLocalError(error) === "not-git-repository") {
          sendJson(response, 409, { error: "这个项目文件夹不是 git 仓库，无法隔离改动", code: "NOT_GIT_REPOSITORY" });
          return;
        }
        throw error;
      }
      return;
    }

    const sessionTeamMatch = matchSessionRoute(url.pathname, "team");
    if (request.method === "PATCH" && sessionTeamMatch !== null) {
      const payload = await readJsonBody(request);
      if (!isRecord(payload)
        || (payload.agentTeamOwnership !== "system" && payload.agentTeamOwnership !== "user")
        || typeof payload.agentTeamId !== "string"
        || payload.agentTeamId.trim() === "") {
        sendJson(response, 400, { error: "Expected agentTeamOwnership and a non-empty agentTeamId" });
        return;
      }
      const session = await runtime.switchSessionTeam({
        sessionId: sessionTeamMatch.sessionId,
        agentTeamOwnership: payload.agentTeamOwnership,
        agentTeamId: payload.agentTeamId,
      });
      sendJson(response, 200, { session });
      return;
    }

    const sessionMessagesMatch = matchSessionRoute(url.pathname, "messages");
    if (request.method === "POST" && sessionMessagesMatch !== null) {
      const payload = await readJsonBody(request);
      if (!isRecord(payload) || typeof payload.body !== "string") {
        sendJson(response, 400, { error: "Expected JSON body with a string body field" });
        return;
      }
      await submitMessage(
        response,
        runtime,
        payload.body,
        sessionMessagesMatch.sessionId,
        readOptionalStringArray(payload.attachmentIds),
        readOptionalString(payload.resumeRunId),
      );
      return;
    }

    const sessionReadMatch = matchSessionRoute(url.pathname, "read");
    if (request.method === "POST" && sessionReadMatch !== null) {
      const payload = await readJsonBody(request);
      if (!isRecord(payload) || typeof payload.unreadSince !== "string" || payload.unreadSince.trim() === "") {
        sendJson(response, 400, { error: "Expected JSON body with a string unreadSince field" });
        return;
      }
      const cleared = await runtime.markSessionResultRead({
        sessionId: sessionReadMatch.sessionId,
        unreadSince: payload.unreadSince,
      });
      sendJson(response, 200, { cleared });
      return;
    }

    const sessionArchiveMatch = matchSessionRoute(url.pathname, "archive");
    if (request.method === "POST" && sessionArchiveMatch !== null) {
      try {
        sendJson(response, 200, await runtime.archiveSession(sessionArchiveMatch.sessionId));
      } catch (error) {
        if (error instanceof LocalConsoleSessionRunningError) {
          sendJson(response, 409, { error: error.message, code: error.code });
          return;
        }
        throw error;
      }
      return;
    }

    const sessionRestoreMatch = matchSessionRoute(url.pathname, "restore");
    if (request.method === "POST" && sessionRestoreMatch !== null) {
      const session = await runtime.restoreSession(sessionRestoreMatch.sessionId);
      sendJson(response, 200, { session });
      return;
    }

    const interruptMatch = matchSessionRoute(url.pathname, "interrupt");
    if (request.method === "POST" && interruptMatch !== null) {
      const payload = await readJsonBody(request);
      if (!isRecord(payload) || typeof payload.runId !== "string" || payload.runId.trim() === "") {
        sendJson(response, 400, { error: "Expected JSON body with a string runId field" });
        return;
      }
      const interrupted = await runtime.interruptRun({
        sessionId: interruptMatch.sessionId,
        runId: payload.runId,
      });
      sendJson(response, interrupted ? 202 : 409, {
        interrupted,
        ...(interrupted
          ? {}
          : {
              code: "RUN_NOT_ACTIVE",
              error: "No active run matched the requested sessionId/runId",
            }),
      });
      return;
    }

    const retryRunMatch = matchRunRetryRoute(url.pathname);
    if (request.method === "POST" && retryRunMatch !== null) {
      const retried = await runtime.retryRun(retryRunMatch);
      sendJson(response, retried ? 202 : 404, {
        retried,
        ...(retried ? {} : { error: "No retryable run matched the requested sessionId/runId" }),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/local-console/messages") {
      sendJson(response, 200, await runtime.snapshot());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/local-console/messages") {
      const payload = await readJsonBody(request);
      if (!isRecord(payload) || typeof payload.body !== "string") {
        sendJson(response, 400, { error: "Expected JSON body with a string body field" });
        return;
      }

      await submitMessage(response, runtime, payload.body, undefined, readOptionalStringArray(payload.attachmentIds));
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    const failedPath = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (failedPath.startsWith("/api/local-console/attachments")) {
      sendJson(response, 400, { error: formatLocalError(error) });
      return;
    }
    if (error instanceof LocalConsoleProjectFolderError) {
      sendJson(response, error.code === "LOCAL_PROJECT_NOT_FOUND" ? 404 : 409, {
        error: error.message,
        code: error.code,
      });
      return;
    }
    sendJson(response, 500, { error: formatLocalError(error) });
  }
}

async function submitMessage(
  response: http.ServerResponse,
  runtime: LocalConsoleRuntime,
  body: string,
  sessionId?: string,
  attachmentIds?: string[],
  resumeRunId?: string,
): Promise<void> {
  try {
    const message = await runtime.submitUserMessage(body, sessionId, attachmentIds, resumeRunId);
    sendJson(response, 202, { message });
  } catch (error) {
    if (error instanceof LocalConsoleBusyError) {
      sendJson(response, 409, { error: error.message });
      return;
    }
    if (error instanceof LocalConsoleProjectFolderError) {
      sendJson(response, 409, { error: error.message, code: error.code });
      return;
    }
    sendJson(response, 503, { error: formatLocalError(error) });
  }
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw === "") {
    return {};
  }
  return JSON.parse(raw) as unknown;
}

function sendHtml(response: http.ServerResponse, body: string): void {
  response.writeHead(200, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, x-moebius-attachment-capability",
    "content-type": "text/html; charset=utf-8",
  });
  response.end(body);
}

function sendJson(response: http.ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, x-moebius-attachment-capability",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function sendNoContent(response: http.ServerResponse): void {
  response.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, x-moebius-attachment-capability",
  });
  response.end();
}

function sendPng(response: http.ServerResponse, body: Buffer): void {
  response.writeHead(200, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, x-moebius-attachment-capability",
    "content-type": "image/png",
    "content-length": String(body.byteLength),
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function renderLocalConsolePage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Moebius Local Spike</title>
  <style>
    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f6f5; color: #171717; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: stretch; }
    main { max-width: 920px; width: min(920px, calc(100vw - 32px)); margin: 24px auto; border: 1px solid #d4d4d4; background: #ffffff; }
    header, footer, .meta { padding: 14px 16px; border-bottom: 1px solid #e4e4e4; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; }
    h1 { font-size: 18px; margin: 0; font-weight: 650; }
    .status { font-size: 13px; color: #525252; }
    .meta { font-size: 13px; color: #525252; display: grid; gap: 6px; }
    .messages { min-height: 360px; padding: 16px; display: grid; gap: 12px; align-content: start; }
    .message { border: 1px solid #e5e5e5; padding: 12px; background: #fafafa; }
    .message.agent { border-color: #c7d2fe; background: #f8f9ff; }
    .message.system, .message.failed { border-color: #fecaca; background: #fff7f7; }
    .message-title { font-size: 12px; color: #525252; margin-bottom: 8px; display: flex; gap: 8px; flex-wrap: wrap; }
    pre { white-space: pre-wrap; word-break: break-word; margin: 0; font: inherit; }
    footer { border-top: 1px solid #e4e4e4; border-bottom: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; }
    input { min-width: 0; font: inherit; padding: 10px 12px; border: 1px solid #cfcfcf; }
    button { font: inherit; padding: 10px 14px; border: 1px solid #1f2937; background: #1f2937; color: #fff; cursor: pointer; }
    button:disabled, input:disabled { opacity: 0.55; cursor: not-allowed; }
    .error { color: #b91c1c; font-size: 13px; padding: 0 16px 12px; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Moebius Local Spike</h1>
      <div class="status" id="status">loading</div>
    </header>
    <section class="meta">
      <div>SQLite: <span id="sqlite">loading</span></div>
      <div>Session: <span id="session">default</span></div>
    </section>
    <section class="messages" id="messages"></section>
    <div class="error" id="error"></div>
    <footer>
      <input id="body" type="text" value="@dev 帮我写个 hello" />
      <button id="send" type="button">Send</button>
    </footer>
  </main>
  <script>
    const statusEl = document.getElementById("status");
    const sqliteEl = document.getElementById("sqlite");
    const sessionEl = document.getElementById("session");
    const messagesEl = document.getElementById("messages");
    const errorEl = document.getElementById("error");
    const inputEl = document.getElementById("body");
    const sendEl = document.getElementById("send");

    async function refresh() {
      try {
        const response = await fetch("/api/local-console/messages");
        const snapshot = await response.json();
        if (!response.ok) throw new Error(snapshot.error || "snapshot failed");
        render(snapshot);
      } catch (error) {
        errorEl.textContent = String(error.message || error);
      }
    }

    function render(snapshot) {
      statusEl.textContent = snapshot.status;
      sqliteEl.textContent = snapshot.sqlitePath;
      sessionEl.textContent = snapshot.sessionId;
      errorEl.textContent = snapshot.lastError || "";
      inputEl.disabled = snapshot.status === "running";
      sendEl.disabled = snapshot.status === "running";
      messagesEl.innerHTML = "";
      for (const message of snapshot.messages) {
        const node = document.createElement("article");
        node.className = "message " + message.speaker + (message.status === "failed" ? " failed" : "");
        const title = document.createElement("div");
        title.className = "message-title";
        title.textContent = [message.role || message.speaker, message.status, message.runDir || ""].filter(Boolean).join(" · ");
        const body = document.createElement("pre");
        body.textContent = message.body;
        node.append(title, body);
        messagesEl.append(node);
      }
    }

    sendEl.addEventListener("click", async () => {
      errorEl.textContent = "";
      try {
        const response = await fetch("/api/local-console/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: inputEl.value }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "send failed");
        await refresh();
      } catch (error) {
        errorEl.textContent = String(error.message || error);
      }
    });

    void refresh();
    setInterval(refresh, 1000);
  </script>
</body>
</html>`;
}

async function listenWithFallback(
  server: http.Server,
  host: string,
  requestedPort: number,
): Promise<{ port: number }> {
  try {
    return await listen(server, host, requestedPort);
  } catch (error) {
    if (requestedPort !== 0 && isListenAddressInUse(error)) {
      log({ event: "local-console-port-in-use", requestedPort });
      return await listen(server, host, 0);
    }
    throw error;
  }
}

async function listen(server: http.Server, host: string, port: number): Promise<{ port: number }> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Local console server did not expose a TCP port");
  }
  return { port: address.port };
}

function isListenAddressInUse(error: unknown): boolean {
  return isRecord(error) && error.code === "EADDRINUSE";
}

async function closeServer(server: http.Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function listLocalAgentFiles(dir: string): Promise<LocalConsoleAgentFile[]> {
  const entries = await fsReaddir(dir);
  return entries
    .filter((entry) => entry.name.endsWith(".md"))
    .map((entry) => ({ name: path.basename(entry.name, ".md"), path: path.join(dir, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function fsReaddir(dir: string): Promise<Array<{ name: string }>> {
  const fs = await import("node:fs/promises");
  return await fs.readdir(dir, { withFileTypes: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readOptionalWorkspaceMode(value: unknown): "direct" | "worktree" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "direct" || value === "worktree") {
    return value;
  }
  throw new Error("Expected workspaceMode to be direct or worktree");
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readOptionalAgentTeam(value: Record<string, unknown>): { ownership: "system" | "user"; id: string } | undefined {
  const ownership = value.agentTeamOwnership;
  const id = value.agentTeamId;
  if (ownership === undefined && id === undefined) {
    return undefined;
  }
  if ((ownership !== "system" && ownership !== "user") || typeof id !== "string" || id.trim() === "") {
    throw new Error("Expected agentTeamOwnership and agentTeamId to identify a valid Agent team");
  }
  return { ownership, id };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.trim() !== "");
}

function readOptionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isStringArray(value)) {
    throw new Error("Expected attachmentIds to be an array of non-empty strings");
  }
  return value;
}

function readOptionalMessageBody(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("Expected initialMessage to be a string");
  }
  return value;
}

function hasAttachmentCapability(request: http.IncomingMessage, expected: string): boolean {
  const value = request.headers["x-moebius-attachment-capability"];
  return typeof value === "string" && value === expected;
}

function readRequiredQuery(url: URL, name: string): string {
  const value = url.searchParams.get(name)?.trim();
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function readHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

function readOptionalContentLength(value: string | string[] | undefined): number | undefined {
  const raw = readHeader(value);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Invalid Content-Length");
  }
  return parsed;
}

async function readBoundedBody(request: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let byteSize = 0;
  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    byteSize += chunk.byteLength;
    if (byteSize > maxBytes) {
      throw new Error("Attachment preview exceeds its byte limit");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function matchProjectRoute(pathname: string): { projectId: string } | null {
  const match = /^\/api\/local-console\/projects\/(.+)$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  return { projectId: decodeURIComponent(match[1] ?? "") };
}

function matchSessionRoute(
  pathname: string,
  action:
    | "messages"
    | "read"
    | "interrupt"
    | "project"
    | "workspace"
    | "workspace-diff"
    | "files"
    | "files/content"
    | "team"
    | "archive"
    | "restore"
    | "children"
    | "view",
): { sessionId: string } | null {
  const match = new RegExp(`^/api/local-console/sessions/(.+)/${action}$`, "u").exec(pathname);
  if (match === null) {
    return null;
  }
  return { sessionId: decodeURIComponent(match[1] ?? "") };
}

function matchRunOutputRoute(pathname: string): { sessionId: string; runId: string } | null {
  const match = /^\/api\/local-console\/sessions\/([^/]+)\/runs\/([^/]+)\/output$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  return {
    sessionId: decodeURIComponent(match[1] ?? ""),
    runId: decodeURIComponent(match[2] ?? ""),
  };
}

function matchRunRetryRoute(pathname: string): { sessionId: string; runId: string } | null {
  const match = /^\/api\/local-console\/sessions\/([^/]+)\/runs\/([^/]+)\/retry$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  return {
    sessionId: decodeURIComponent(match[1] ?? ""),
    runId: decodeURIComponent(match[2] ?? ""),
  };
}

function matchProcessOutputRoute(pathname: string): { sessionId: string; runId: string } | null {
  const match = /^\/api\/local-console\/sessions\/([^/]+)\/runs\/([^/]+)\/process-output$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  return {
    sessionId: decodeURIComponent(match[1] ?? ""),
    runId: decodeURIComponent(match[2] ?? ""),
  };
}

function matchProcessDebugInvocationRoute(
  pathname: string,
): { sessionId: string; runId: string } | null {
  const match = /^\/api\/local-console\/sessions\/([^/]+)\/runs\/([^/]+)\/process-debug-invocation$/u.exec(pathname);
  if (match === null) {
    return null;
  }
  return {
    sessionId: decodeURIComponent(match[1] ?? ""),
    runId: decodeURIComponent(match[2] ?? ""),
  };
}
