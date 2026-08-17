import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { TMP_ROOT } from "../config.js";
import { TRUSTED_EXECUTION_REGISTRY } from "../execution-profile-registry.js";
import { log } from "../log.js";
import {
  LOCAL_ATTACHMENT_PREVIEW_LARGE_MAX_BYTES,
  LOCAL_ATTACHMENT_PREVIEW_MAX_BYTES,
  LocalAttachmentManager,
} from "./attachments.js";
import { listLocalT5Facts } from "./t5-store.js";
import { ProcessCursorError } from "./process-history-contracts.js";
import { formatLocalError } from "./runtime-domain.js";
import {
  LocalConsoleBusyError,
  LocalConsoleProjectFolderError,
  LocalConsoleProjectRunningError,
  LocalConsoleSessionProjectError,
  LocalConsoleSessionRunningError,
  LocalConsoleSessionWorkspaceLockedError,
} from "./types.js";
import type { LocalConsoleRuntime, LocalConsoleAgentFile } from "./runtime.js";
import { ManagedProcessAdmissionError, managedProcessArchiveScopeSessionIds, projectManagedProcessRunningCounts } from "./managed-process-contract.js";
import type { ManagedProcessSupervisor } from "./managed-process-supervisor.js";

let localRunDirSequence = 0;

export function makeLocalConsoleRunDir(count: number, now = new Date()): string {
  localRunDirSequence += 1;
  return path.join(TMP_ROOT, `moebius-local-${now.toISOString()}-c${count}-r${localRunDirSequence}`);
}

export function createLocalConsoleHttpServer(
  runtime: LocalConsoleRuntime,
  attachmentManager?: LocalAttachmentManager,
  attachmentCapability?: string,
  managedProcessSupervisor?: ManagedProcessSupervisor,
): http.Server {
  return http.createServer((request, response) => {
    void handleRequest(runtime, request, response, attachmentManager, attachmentCapability, managedProcessSupervisor);
  });
}

async function handleRequest(
  runtime: LocalConsoleRuntime,
  request: http.IncomingMessage,
  response: http.ServerResponse,
  attachmentManager?: LocalAttachmentManager,
  attachmentCapability?: string,
  managedProcessSupervisor?: ManagedProcessSupervisor,
): Promise<void> {
  try {
    if (request.method === "OPTIONS") {
      sendNoContent(response);
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const managedRoute = matchManagedProcessRoute(url.pathname);
    if (managedRoute !== null) {
      if (managedProcessSupervisor === undefined) {
        sendJson(response, 503, { error: "Managed processes are unavailable", code: "managed-process-unavailable" });
        return;
      }
      if (request.method === "GET" && managedRoute.action === "list") {
        sendJson(response, 200, { processes: await managedProcessSupervisor.list(managedRoute.sessionId) });
        return;
      }
      if (request.method === "GET" && managedRoute.action === "inspect") {
        sendJson(response, 200, { process: await managedProcessSupervisor.inspect(managedRoute.sessionId, managedRoute.processId) });
        return;
      }
      if (request.method === "GET" && managedRoute.action === "logs") {
        sendJson(response, 200, await managedProcessSupervisor.readLogs(
          managedRoute.sessionId,
          managedRoute.processId,
          readOptionalString(url.searchParams.get("cursor")),
        ));
        return;
      }
      if (request.method === "POST" && managedRoute.action === "stop") {
        sendJson(response, 200, { process: await managedProcessSupervisor.stop(managedRoute.sessionId, managedRoute.processId) });
        return;
      }
      if (request.method === "POST" && managedRoute.action === "acknowledge-exited") {
        await managedProcessSupervisor.acknowledgeExited(managedRoute.sessionId);
        sendNoContent(response);
        return;
      }
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
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
        const result = await attachmentManager.finalizeImagePreview({
          uploadId: decodeURIComponent(previewFinalizeMatch[1] ?? ""),
          draftKey: readRequiredQuery(url, "draftKey"),
          preview: await readBoundedBody(request, LOCAL_ATTACHMENT_PREVIEW_MAX_BYTES),
        });
        if (result.status === "ready") {
          sendJson(response, 201, { attachment: result.attachment });
        } else {
          sendJson(response, 202, { status: "staged" });
        }
        return;
      }
      const previewLargeFinalizeMatch = /^\/api\/local-console\/attachments\/uploads\/([^/]+)\/preview-large$/u.exec(url.pathname);
      if (request.method === "POST" && previewLargeFinalizeMatch !== null) {
        const result = await attachmentManager.finalizeImagePreviewLarge({
          uploadId: decodeURIComponent(previewLargeFinalizeMatch[1] ?? ""),
          draftKey: readRequiredQuery(url, "draftKey"),
          preview: await readBoundedBody(request, LOCAL_ATTACHMENT_PREVIEW_LARGE_MAX_BYTES),
        });
        if (result.status === "ready") {
          sendJson(response, 201, { attachment: result.attachment });
        } else {
          sendJson(response, 202, { status: "staged" });
        }
        return;
      }
      const svgFallbackMatch = /^\/api\/local-console\/attachments\/uploads\/([^/]+)\/fallback$/u.exec(url.pathname);
      if (request.method === "POST" && svgFallbackMatch !== null) {
        const attachment = await attachmentManager.fallbackSvgToFile({
          uploadId: decodeURIComponent(svgFallbackMatch[1] ?? ""),
          draftKey: readRequiredQuery(url, "draftKey"),
        });
        sendJson(response, 200, { attachment });
        return;
      }
      const attachmentPreviewMatch = /^\/api\/local-console\/attachments\/([^/]+)\/preview$/u.exec(url.pathname);
      if (request.method === "GET" && attachmentPreviewMatch !== null) {
        const draftKey = readOptionalString(url.searchParams.get("draftKey"));
        const sessionId = readOptionalString(url.searchParams.get("sessionId"));
        const tier = readOptionalString(url.searchParams.get("tier"));
        if ((draftKey === undefined) === (sessionId === undefined)) {
          sendJson(response, 400, { error: "Exactly one preview scope is required" });
          return;
        }
        if (tier !== undefined && tier !== "thumbnail" && tier !== "large") {
          sendJson(response, 400, { error: "Expected tier to be thumbnail or large" });
          return;
        }
        const previewPath = await attachmentManager.previewPath({
          attachmentId: decodeURIComponent(attachmentPreviewMatch[1] ?? ""),
          ...(draftKey === undefined ? {} : { draftKey }),
          ...(sessionId === undefined ? {} : { sessionId }),
          ...(tier === undefined ? {} : { tier }),
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
      const runtimeSnapshot = await runtime.state({
        sessionId: readOptionalString(url.searchParams.get("sessionId")),
        projectId: readOptionalString(url.searchParams.get("projectId")),
      });
      const snapshot = managedProcessSupervisor === undefined
        ? runtimeSnapshot
        : projectManagedProcessRunningCounts(
            runtimeSnapshot,
            managedProcessSupervisor.getRunningCountsBySession(),
          );
      const serialized = JSON.stringify(snapshot);
      const etag = `"${createHash("sha256").update(serialized).digest("base64url")}"`;
      if (request.headers["if-none-match"] === etag) {
        sendNotModified(response, etag);
      } else {
        sendJson(response, 200, snapshot, { etag });
      }
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
        if (managedProcessSupervisor !== undefined) {
          const projectState = await runtime.state({ projectId: projectMatch.projectId });
          const managed = (await Promise.all(projectState.project.sessions.map(async (session) =>
            await managedProcessSupervisor.list(session.sessionId))))
            .flat()
            .filter((item) => item.state !== "exited");
          if (managed.length > 0 && payload.force !== true) {
            throw new ManagedProcessAdmissionError("managed-process-running", "项目仍有运行项；强制移除会先停止全部运行项。");
          }
          if (payload.force === true) {
            for (const item of managed) await managedProcessSupervisor.stop(item.sessionId, item.id);
          }
        }
        const result = await runtime.removeProject({
          projectId: projectMatch.projectId,
          force: payload.force === true,
        });
        sendJson(response, 200, result);
      } catch (error) {
        if (error instanceof ManagedProcessAdmissionError && error.code === "managed-process-running") {
          sendJson(response, 409, { error: error.message, code: error.code });
          return;
        }
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
        isRecord(payload)
          ? {
              originSessionId: readOptionalNullableString(payload.originSessionId),
              analysisParentSessionId: readOptionalNullableString(payload.analysisParentSessionId),
              entryTemplate: readOptionalEntryTemplate(payload.entryTemplate),
              writePolicy: readOptionalWritePolicy(payload.writePolicy),
              textFragments: readOptionalTextFragments(payload.textFragments),
              attachmentDraftKey: readOptionalString(payload.attachmentDraftKey),
            }
          : undefined,
      );
      sendJson(response, 201, { session });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/local-console/sessions/search") {
      sendJson(response, 200, {
        results: await runtime.searchSessions({
          query: url.searchParams.get("query") ?? "",
          includeArchived: url.searchParams.get("includeArchived") === "true",
        }),
      });
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

    const sessionReferenceMatch = matchSessionRoute(url.pathname, "reference-text");
    if (request.method === "GET" && sessionReferenceMatch !== null) {
      sendJson(response, 200, await runtime.sessionReferenceText({
        sessionId: sessionReferenceMatch.sessionId,
        scope: readSessionReferenceScope(url.searchParams.get("scope")),
        runId: url.searchParams.get("runId"),
        messageId: readOptionalPositiveInteger(url.searchParams.get("messageId")),
      }));
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

    const sessionWorkspaceDiffContentMatch = matchSessionRoute(url.pathname, "workspace-diff/content");
    if (request.method === "GET" && sessionWorkspaceDiffContentMatch !== null) {
      const filePath = url.searchParams.get("path");
      if (filePath === null || filePath.trim() === "") {
        sendJson(response, 400, { error: "Expected a non-empty path query parameter" });
        return;
      }
      sendJson(response, 200, await runtime.workspaceDiffFile(
        sessionWorkspaceDiffContentMatch.sessionId,
        filePath,
      ));
      return;
    }

    const sessionFileReferenceMatch = matchSessionRoute(url.pathname, "file-reference");
    if (request.method === "GET" && sessionFileReferenceMatch !== null) {
      const filePath = url.searchParams.get("path");
      const line = readPositiveQueryInteger(url.searchParams.get("line"));
      const rawColumn = url.searchParams.get("column");
      const column = rawColumn === null ? null : readPositiveQueryInteger(rawColumn);
      const explicitLine = url.searchParams.get("explicitLine");
      if (
        filePath === null
        || !filePath.startsWith("/")
        || line === null
        || (rawColumn !== null && column === null)
        || (explicitLine !== null && explicitLine !== "0" && explicitLine !== "1")
      ) {
        sendJson(response, 400, {
          error: "Expected an absolute path, a positive line, and an optional positive column",
        });
        return;
      }
      sendJson(response, 200, await runtime.fileReference(sessionFileReferenceMatch.sessionId, {
        filePath,
        line,
        column,
        hasExplicitLine: explicitLine === "1",
      }));
      return;
    }

    const sessionAgentImageSourceMatch = matchSessionRoute(url.pathname, "agent-image-source");
    if (request.method === "GET" && sessionAgentImageSourceMatch !== null) {
      if (attachmentCapability === undefined) {
        sendJson(response, 404, { error: "Agent image previews are unavailable" });
        return;
      }
      if (!hasAttachmentCapability(request, attachmentCapability)) {
        sendJson(response, 403, { error: "Attachment capability required" });
        return;
      }
      const filePath = url.searchParams.get("path");
      if (filePath === null || filePath.trim() === "") {
        sendJson(response, 400, { error: "Expected a non-empty path query parameter" });
        return;
      }
      const result = await runtime.agentImageSource(sessionAgentImageSourceMatch.sessionId, filePath);
      if (!result.available) {
        sendJson(response, 404, {
          error: "Agent image source unavailable",
          code: "agent-image-source-unavailable",
          reason: result.reason,
        });
        return;
      }
      sendAgentImageSource(response, result.mediaType, result.bytes);
      return;
    }

    const runOutputMatch = matchRunOutputRoute(url.pathname);
    if (request.method === "GET" && runOutputMatch !== null) {
      sendJson(response, 200, await runtime.runOutput(runOutputMatch.sessionId, runOutputMatch.runId));
      return;
    }

    const runAgentInfoMatch = matchRunAgentAuditRoute(url.pathname, "agent-info");
    if (request.method === "GET" && runAgentInfoMatch !== null) {
      if (url.searchParams.size > 0) {
        sendJson(response, 400, { code: "RUN_AGENT_AUDIT_INVALID_REQUEST", error: "Agent 历史信息只接受会话与运行标识。" });
        return;
      }
      try {
        sendJson(response, 200, await runtime.getRunAgentInfo(runAgentInfoMatch));
      } catch (error) {
        const formatted = formatLocalError(error);
        if (formatted.includes("RUN_AGENT_AUDIT_NOT_FOUND") || formatted.includes("RUN_AGENT_NOT_FOUND")) {
          sendJson(response, 404, { code: "RUN_AGENT_AUDIT_NOT_FOUND", error: "找不到这次运行的 Agent 历史信息。" });
          return;
        }
        throw error;
      }
      return;
    }
    const runAgentMarkdownMatch = matchRunAgentAuditRoute(url.pathname, "agent-markdown");
    if (request.method === "GET" && runAgentMarkdownMatch !== null) {
      if (url.searchParams.size > 0) {
        sendJson(response, 400, { code: "RUN_AGENT_AUDIT_INVALID_REQUEST", error: "AGENT.md 历史读取只接受会话与运行标识。" });
        return;
      }
      try {
        sendJson(response, 200, await runtime.getRunAgentMarkdown(runAgentMarkdownMatch));
      } catch (error) {
        const formatted = formatLocalError(error);
        if (formatted.includes("RUN_AGENT_AUDIT_NOT_FOUND") || formatted.includes("RUN_AGENT_NOT_FOUND")) {
          sendJson(response, 404, { code: "RUN_AGENT_AUDIT_NOT_FOUND", error: "找不到这次运行的 AGENT.md。" });
          return;
        }
        throw error;
      }
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

    const sessionTeamUpdateMatch = matchSessionRoute(url.pathname, "team-update");
    if (request.method === "GET" && sessionTeamUpdateMatch !== null) {
      const update = await runtime.inspectSessionTeamUpdate(sessionTeamUpdateMatch.sessionId);
      sendJson(response, 200, { update });
      return;
    }
    const sessionTeamUpdateApplyMatch = matchSessionRoute(url.pathname, "team-update/apply");
    if (request.method === "POST" && sessionTeamUpdateApplyMatch !== null) {
      try {
        const update = await runtime.applySessionTeamUpdate(
          sessionTeamUpdateApplyMatch.sessionId,
          readHeader(request.headers["x-moebius-update-token"]) ?? null,
        );
        sendJson(response, 200, { update });
      } catch (error) {
        if (/SESSION_TEAM_UPDATE_(?:CANDIDATE_MISSING|STALE)/u.test(formatLocalError(error))) {
          sendJson(response, 409, { code: "SESSION_TEAM_UPDATE_STALE", error: "团队更新已变化，请重新检查。" });
          return;
        }
        throw error;
      }
      return;
    }
    const sessionTeamUpdateRetryMatch = matchSessionRoute(url.pathname, "team-update/retry");
    if (request.method === "POST" && sessionTeamUpdateRetryMatch !== null) {
      try {
        const update = await runtime.retrySessionTeamUpdate(
          sessionTeamUpdateRetryMatch.sessionId,
          readHeader(request.headers["x-moebius-update-token"]) ?? null,
        );
        sendJson(response, 200, { update });
      } catch (error) {
        if (formatLocalError(error).includes("SESSION_TEAM_UPDATE_STALE")) {
          sendJson(response, 409, { code: "SESSION_TEAM_UPDATE_STALE", error: "团队更新已变化，请重新检查。" });
          return;
        }
        throw error;
      }
      return;
    }
    const sessionTeamUpdateCancelMatch = matchSessionRoute(url.pathname, "team-update/cancel");
    if (request.method === "POST" && sessionTeamUpdateCancelMatch !== null) {
      try {
        const update = await runtime.cancelSessionTeamUpdate(
          sessionTeamUpdateCancelMatch.sessionId,
          readHeader(request.headers["x-moebius-update-token"]) ?? null,
        );
        sendJson(response, 200, { update });
      } catch (error) {
        if (formatLocalError(error).includes("SESSION_TEAM_UPDATE_STALE")) {
          sendJson(response, 409, { code: "SESSION_TEAM_UPDATE_STALE", error: "团队更新已变化，请重新检查。" });
          return;
        }
        throw error;
      }
      return;
    }

    const memberExecutionMatch = matchSessionMemberExecutionRoute(url.pathname);
    if (request.method === "PATCH" && memberExecutionMatch !== null) {
      const payload = await readJsonBody(request);
      if (!isRecord(payload) || (payload.action !== "migrate" && payload.action !== "end")) {
        sendJson(response, 400, { error: "Expected action to be migrate or end" });
        return;
      }
      const profile = payload.action === "migrate"
        ? readExecutionOverride({
            executionOverride: {
              overrideId: "session-migration",
              scope: "single-run",
              profile: payload.executionProfile,
            },
          })?.profile
        : undefined;
      try {
        const snapshot = await runtime.updateSessionMemberExecution({
          ...memberExecutionMatch,
          action: payload.action,
          ...(profile === undefined ? {} : { executionProfile: profile }),
        });
        sendJson(response, 200, { snapshot });
      } catch (error) {
        if (error instanceof LocalConsoleSessionRunningError) {
          sendJson(response, 409, { code: "SESSION_RUNNING", error: error.message });
          return;
        }
        throw error;
      }
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
        readOptionalTextFragments(payload.textFragments),
      );
      return;
    }

    const pendingMessageMatch = matchPendingMessageRoute(url.pathname);
    if (pendingMessageMatch !== null && request.method === "POST") {
      await runtime.retryPendingUserMessage(pendingMessageMatch);
      sendJson(response, 202, { retried: true });
      return;
    }
    if (pendingMessageMatch !== null && request.method === "PATCH") {
      const payload = await readJsonBody(request);
      if (!isRecord(payload) || typeof payload.body !== "string") {
        sendJson(response, 400, { error: "Expected JSON body with a string body field" });
        return;
      }
      const message = await runtime.updatePendingUserMessage({
        ...pendingMessageMatch,
        body: payload.body,
      });
      sendJson(response, 200, { message });
      return;
    }
    if (pendingMessageMatch !== null && request.method === "DELETE") {
      await runtime.removePendingUserMessage(pendingMessageMatch);
      sendJson(response, 200, { removed: true });
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

    const sessionAttentionMatch = matchSessionRoute(url.pathname, "attention");
    if (request.method === "POST" && sessionAttentionMatch !== null) {
      const payload = await readJsonBody(request);
      if (
        !isRecord(payload)
        || (
          payload.action !== "mark-read-attention"
          && payload.action !== "mark-read-unread"
          && payload.action !== "mark-unread"
        )
        || typeof payload.expectedAttentionRevision !== "number"
        || typeof payload.expectedReadStateRevision !== "number"
        || typeof payload.expectedTitleRevision !== "number"
        || typeof payload.isCurrent !== "boolean"
      ) {
        sendJson(response, 400, { error: "Expected a valid session attention mutation" });
        return;
      }
      try {
        const session = await runtime.updateSessionReadState({
          sessionId: sessionAttentionMatch.sessionId,
          action: payload.action,
          expectedAttentionRevision: payload.expectedAttentionRevision,
          expectedReadStateRevision: payload.expectedReadStateRevision,
          expectedTitleRevision: payload.expectedTitleRevision,
          isCurrent: payload.isCurrent,
        });
        sendJson(response, 200, { session });
      } catch (error) {
        if (error instanceof Error && error.message.includes("SESSION_SIDEBAR_STATE_STALE")) {
          sendJson(response, 409, { error: "会话状态已经变化，请重新打开菜单", code: "SESSION_SIDEBAR_STATE_STALE" });
          return;
        }
        throw error;
      }
      return;
    }

    const sessionPinMatch = matchSessionRoute(url.pathname, "pin");
    if (request.method === "POST" && sessionPinMatch !== null) {
      const payload = await readJsonBody(request);
      if (
        !isRecord(payload)
        || typeof payload.pinned !== "boolean"
        || !(typeof payload.expectedPinnedAt === "string" || payload.expectedPinnedAt === null)
      ) {
        sendJson(response, 400, { error: "Expected pinned and expectedPinnedAt fields" });
        return;
      }
      try {
        const session = await runtime.setSessionPinned({
          sessionId: sessionPinMatch.sessionId,
          pinned: payload.pinned,
          expectedPinnedAt: payload.expectedPinnedAt,
        });
        sendJson(response, 200, { session });
      } catch (error) {
        if (error instanceof Error && error.message.includes("SESSION_SIDEBAR_STATE_STALE")) {
          sendJson(response, 409, { error: "置顶状态已经变化，请重试", code: "SESSION_SIDEBAR_STATE_STALE" });
          return;
        }
        throw error;
      }
      return;
    }

    const sessionTitleMatch = matchSessionRoute(url.pathname, "title");
    if (request.method === "POST" && sessionTitleMatch !== null) {
      const payload = await readJsonBody(request);
      if (
        !isRecord(payload)
        || typeof payload.title !== "string"
        || typeof payload.expectedTitleRevision !== "number"
      ) {
        sendJson(response, 400, { error: "Expected title and expectedTitleRevision fields" });
        return;
      }
      try {
        const session = await runtime.renameSession({
          sessionId: sessionTitleMatch.sessionId,
          title: payload.title,
          expectedTitleRevision: payload.expectedTitleRevision,
        });
        sendJson(response, 200, { session });
      } catch (error) {
        if (error instanceof Error && error.message.includes("SESSION_TITLE_EMPTY")) {
          sendJson(response, 400, { error: "对话名称不能为空", code: "SESSION_TITLE_EMPTY" });
          return;
        }
        if (error instanceof Error && error.message.includes("SESSION_SIDEBAR_STATE_STALE")) {
          sendJson(response, 409, { error: "对话名称已经变化，请重新打开重命名", code: "SESSION_SIDEBAR_STATE_STALE" });
          return;
        }
        throw error;
      }
      return;
    }

    const sessionArmUnreadMatch = matchSessionRoute(url.pathname, "arm-manual-unread");
    if (request.method === "POST" && sessionArmUnreadMatch !== null) {
      sendJson(response, 200, {
        session: await runtime.armSessionManualUnread(sessionArmUnreadMatch.sessionId),
      });
      return;
    }

    const sessionViewedMatch = matchSessionRoute(url.pathname, "viewed");
    if (request.method === "POST" && sessionViewedMatch !== null) {
      sendJson(response, 200, {
        session: await runtime.markSessionViewed(sessionViewedMatch.sessionId),
      });
      return;
    }

    const sessionArchiveMatch = matchSessionRoute(url.pathname, "archive");
    if (request.method === "POST" && sessionArchiveMatch !== null) {
      try {
        if (managedProcessSupervisor !== undefined) {
          const archiveState = await runtime.state({ sessionId: sessionArchiveMatch.sessionId });
          const scope = managedProcessArchiveScopeSessionIds(archiveState.project.sessions, sessionArchiveMatch.sessionId);
          const activeManaged = (await Promise.all(scope.map(async (sessionId) => await managedProcessSupervisor.list(sessionId))))
            .flat()
            .some((item) => item.state !== "exited");
          if (activeManaged) throw new ManagedProcessAdmissionError("managed-process-running", "当前对话仍有运行项，请先停止后再归档。");
        }
        sendJson(response, 200, await runtime.archiveSession(sessionArchiveMatch.sessionId));
      } catch (error) {
        if (error instanceof ManagedProcessAdmissionError && error.code === "managed-process-running") {
          sendJson(response, 409, { error: error.message, code: error.code });
          return;
        }
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
      const payload = await readJsonBody(request);
      const executionOverride = readExecutionOverride(payload);
      const retried = await runtime.retryRun({
        ...retryRunMatch,
        ...(executionOverride === undefined ? {} : { executionOverride }),
      });
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

    if (request.method === "GET" && url.pathname === "/api/local-console/execution-profiles") {
      sendJson(response, 200, { registry: TRUSTED_EXECUTION_REGISTRY });
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
    if (error instanceof ManagedProcessAdmissionError) {
      sendJson(response, error.code === "process-not-found" ? 404 : 409, {
        error: error.message,
        code: error.code,
      });
      return;
    }
    sendJson(response, 500, { error: formatLocalError(error) });
  }
}

function matchManagedProcessRoute(pathname: string):
  | { sessionId: string; action: "list" | "acknowledge-exited" }
  | { sessionId: string; processId: string; action: "inspect" | "logs" | "stop" }
  | null {
  const match = /^\/api\/local-console\/sessions\/([^/]+)\/managed-processes(?:\/(acknowledge-exited)|\/([^/]+)(?:\/(logs|stop))?)?$/u.exec(pathname);
  if (match === null) return null;
  const sessionId = decodeURIComponent(match[1]!);
  if (match[2] === "acknowledge-exited") return { sessionId, action: "acknowledge-exited" };
  const processId = match[3] === undefined ? undefined : decodeURIComponent(match[3]);
  if (processId === undefined) return { sessionId, action: "list" };
  const suffix = match[4];
  return { sessionId, processId, action: suffix === undefined ? "inspect" : suffix as "logs" | "stop" };
}

export function readExecutionOverride(value: unknown): {
  overrideId: string;
  profile: import("./types.js").LocalConsoleExecutionProfile;
  scope: "single-run";
} | undefined {
  if (!isRecord(value) || value.executionOverride === undefined) return undefined;
  const override = value.executionOverride;
  if (
    !isRecord(override)
    || override.scope !== "single-run"
    || typeof override.overrideId !== "string"
    || override.overrideId.trim() === ""
    || !isRecord(override.profile)
  ) {
    throw new Error("Expected a valid single-run executionOverride");
  }
  const { cli, model, effort } = override.profile;
  if (
    (cli !== "codex" && cli !== "claude" && cli !== "kimi" && cli !== "pi")
    || typeof model !== "string"
    || model.trim() === ""
    || typeof effort !== "string"
    || effort.trim() === ""
  ) {
    throw new Error("Expected executionOverride.profile to contain cli/model/effort");
  }
  const profile: import("./types.js").LocalConsoleExecutionProfile = cli === "pi"
    ? {
        cli,
        providerId: override.profile.providerId === "deepseek"
          ? "deepseek"
          : failExecutionOverride("Expected Pi executionOverride.profile.providerId to be deepseek"),
        providerProfileId: readExecutionOverrideString(
          override.profile.providerProfileId,
          "providerProfileId",
        ),
        model: model.trim(),
        effort: effort.trim(),
      }
    : { cli, model: model.trim(), effort: effort.trim() };
  return {
    overrideId: override.overrideId,
    profile,
    scope: "single-run",
  };
}

function readExecutionOverrideString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Expected Pi executionOverride.profile.${field}`);
  }
  return value.trim();
}

function failExecutionOverride(message: string): never {
  throw new Error(message);
}

async function submitMessage(
  response: http.ServerResponse,
  runtime: LocalConsoleRuntime,
  body: string,
  sessionId?: string,
  attachmentIds?: string[],
  resumeRunId?: string,
  textFragments?: import("./types.js").LocalConsoleTextFragment[],
): Promise<void> {
  try {
    const message = await runtime.submitUserMessage(body, sessionId, attachmentIds, resumeRunId, textFragments);
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
    "access-control-allow-headers": "content-type, if-none-match, x-moebius-attachment-capability",
    "content-type": "text/html; charset=utf-8",
  });
  response.end(body);
}

function sendJson(
  response: http.ServerResponse,
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(statusCode, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, if-none-match, x-moebius-attachment-capability",
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function sendNotModified(response: http.ServerResponse, etag: string): void {
  response.writeHead(304, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, if-none-match, x-moebius-attachment-capability",
    etag,
  });
  response.end();
}

function sendNoContent(response: http.ServerResponse): void {
  response.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, if-none-match, x-moebius-attachment-capability",
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

function sendAgentImageSource(response: http.ServerResponse, mediaType: string, body: Buffer): void {
  response.writeHead(200, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, x-moebius-attachment-capability",
    "content-type": mediaType,
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

export async function listenWithFallback(
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

export async function closeLocalConsoleHttpServer(server: http.Server): Promise<void> {
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

export async function listLocalAgentFiles(dir: string): Promise<LocalConsoleAgentFile[]> {
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

function readOptionalNullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string" && value.trim() !== "") return value;
  throw new Error("Expected a non-empty string or null");
}

function readOptionalEntryTemplate(value: unknown): "session-analysis" | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "session-analysis") return value;
  throw new Error("Expected entryTemplate to be session-analysis or null");
}

function readSessionReferenceScope(value: unknown): "message" | "conversation" {
  if (value === "message" || value === "conversation") return value;
  throw new Error("Expected reference-text scope to be message or conversation");
}

function readOptionalPositiveInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) {
    throw new Error("Expected a positive integer");
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Expected a safe positive integer");
  }
  return parsed;
}

function readOptionalWritePolicy(
  value: unknown,
): "normal" | "confirm-current-plan-before-write" | undefined {
  if (value === undefined) return undefined;
  if (value === "normal" || value === "confirm-current-plan-before-write") return value;
  throw new Error("Expected a supported writePolicy");
}

function readOptionalTextFragments(
  value: unknown,
): import("./types.js").LocalConsoleTextFragment[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error("Expected textFragments to be an array");
  }
  return value.map((fragment) => {
    if (
      !isRecord(fragment)
      || typeof fragment.id !== "string"
      || typeof fragment.label !== "string"
      || typeof fragment.text !== "string"
    ) {
      throw new Error("Expected each text fragment to contain string id, label, and text");
    }
    return { id: fragment.id, label: fragment.label, text: fragment.text };
  });
}

function readPositiveQueryInteger(value: string | null): number | null {
  if (value === null || !/^[1-9]\d*$/u.test(value)) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
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
    | "workspace-diff/content"
    | "files"
    | "files/content"
    | "file-reference"
    | "agent-image-source"
    | "team"
    | "team-update"
    | "team-update/apply"
    | "team-update/retry"
    | "team-update/cancel"
    | "archive"
    | "attention"
    | "pin"
    | "title"
    | "arm-manual-unread"
    | "viewed"
    | "reference-text"
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

function matchRunAgentAuditRoute(
  pathname: string,
  action: "agent-info" | "agent-markdown",
): { sessionId: string; runId: string } | null {
  const match = new RegExp(`^/api/local-console/sessions/([^/]+)/runs/([^/]+)/${action}$`, "u").exec(pathname);
  if (match === null) return null;
  return {
    sessionId: decodeURIComponent(match[1] ?? ""),
    runId: decodeURIComponent(match[2] ?? ""),
  };
}

function matchPendingMessageRoute(pathname: string): { sessionId: string; messageId: number } | null {
  const match = pathname.match(/^\/api\/local-console\/sessions\/([^/]+)\/messages\/([1-9]\d*)\/pending$/u);
  if (match === null) return null;
  const messageId = Number.parseInt(match[2]!, 10);
  if (!Number.isSafeInteger(messageId)) return null;
  return {
    sessionId: decodeURIComponent(match[1]!),
    messageId,
  };
}

function matchSessionMemberExecutionRoute(
  pathname: string,
): { sessionId: string; memberName: string } | null {
  const match = /^\/api\/local-console\/sessions\/([^/]+)\/members\/([^/]+)\/execution$/u.exec(pathname);
  return match === null ? null : {
    sessionId: decodeURIComponent(match[1]!),
    memberName: decodeURIComponent(match[2]!),
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
