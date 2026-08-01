import type {
  ArchiveSessionResult,
  ConsoleCommandPort,
  ConsoleProjectResult,
  CreatedSession,
} from "./console-state-action-contract.js";
import { fetchFromBrowser } from "./browser-fetch.js";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function createConsoleCommandPort(fetch: FetchLike): ConsoleCommandPort {
  return {
    async createSession(apiBase, payload) {
      return await requestJson<CreatedSession>(fetch, endpoint(apiBase, "/api/local-console/sessions"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }, "create session failed", "session");
    },
    async openProject(apiBase, folderPath) {
      return await requestJson<ConsoleProjectResult>(fetch, endpoint(apiBase, "/api/local-console/projects"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderPath, worktreeMode: false }),
      }, "open project failed", "project");
    },
    async rebindSessionProject(apiBase, sessionId, projectId) {
      return await requestJson<CreatedSession>(
        fetch,
        endpoint(apiBase, `/api/local-console/sessions/${encodeURIComponent(sessionId)}/project`),
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId }),
        },
        "change session project failed",
        "session",
      );
    },
    async patchSessionContext(apiBase, sessionId, context, payload, fallbackError) {
      await requestJson<CreatedSession>(
        fetch,
        endpoint(apiBase, `/api/local-console/sessions/${encodeURIComponent(sessionId)}/${context}`),
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
        fallbackError,
        "session",
      );
    },
    async reorderProjects(apiBase, projectIds) {
      await requestJson<unknown>(fetch, endpoint(apiBase, "/api/local-console/projects/order"), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectIds }),
      }, "reorder projects failed", "projects");
    },
    async archiveSession(apiBase, sessionId) {
      return await requestBody<ArchiveSessionResult>(
        fetch,
        endpoint(apiBase, `/api/local-console/sessions/${encodeURIComponent(sessionId)}/archive`),
        { method: "POST" },
        "archive session failed",
      );
    },
    async mutateSession(apiBase, sessionId, action, payload) {
      return await requestJson(
        fetch,
        endpoint(apiBase, `/api/local-console/sessions/${encodeURIComponent(sessionId)}/${action}`),
        {
          method: "POST",
          ...(payload === undefined
            ? {}
            : {
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload),
              }),
        },
        "conversation mutation failed",
        "session",
      );
    },
    async sendMessage(apiBase, sessionId, payload) {
      await requestBody(
        fetch,
        endpoint(apiBase, `/api/local-console/sessions/${encodeURIComponent(sessionId)}/messages`),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
        "send failed",
      );
    },
  };
}

export const browserConsoleCommandPort = createConsoleCommandPort(fetchFromBrowser);

async function requestJson<T>(
  fetch: FetchLike,
  url: URL,
  init: RequestInit,
  fallbackError: string,
  key: string,
): Promise<T> {
  const body = await requestBody<Record<string, unknown>>(fetch, url, init, fallbackError);
  const value = body[key];
  if (value === undefined) throw new Error(fallbackError);
  return value as T;
}

async function requestBody<T>(
  fetch: FetchLike,
  url: URL,
  init: RequestInit,
  fallbackError: string,
): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? fallbackError);
  return body;
}

function endpoint(base: string, path: string): URL {
  return new URL(path.replace(/^\//u, ""), base.endsWith("/") ? base : `${base}/`);
}
