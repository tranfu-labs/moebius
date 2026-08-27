import {
  GithubTeamTransportError,
  type GithubTeamTransport,
} from "./github-team-transport.js";
import {
  GITHUB_TEAM_LANGUAGE_TOPICS,
  normalizeGithubRepository,
  type GithubTeamLanguage,
} from "./github-team-contract.js";
import type { GithubTeamSnapshot } from "./github-team-snapshot.js";
import {
  installGithubTeam,
  type GithubTeamInstallationResult,
} from "./github-team-installation.js";
import { loadGithubTeamSnapshot } from "./github-team-remote.js";
import type { ExecutionProfile } from "./team-execution-profile.js";
import {
  GITHUB_TEAM_IPC_CHANNELS,
  type GithubTeamAuthIpcResponse,
  type GithubTeamInstallIpcRequest,
  type GithubTeamInstallIpcResponse,
  type GithubTeamPreviewIpcData,
  type GithubTeamPreviewIpcRequest,
  type GithubTeamPreviewIpcResponse,
  type GithubTeamSearchIpcRequest,
  type GithubTeamSearchIpcResponse,
} from "./github-team-ipc-contract.js";

export * from "./github-team-ipc-contract.js";

export interface GithubTeamIpcMain {
  handle(
    channel: string,
    listener: (event: unknown, request: unknown) => Promise<unknown>,
  ): void;
}

export interface GithubTeamIpcService {
  readAuthStatus(): Promise<GithubTeamAuthIpcResponse>;
  search(request: GithubTeamSearchIpcRequest): Promise<GithubTeamSearchIpcResponse>;
  preview(request: GithubTeamPreviewIpcRequest): Promise<GithubTeamPreviewIpcResponse>;
  install(request: GithubTeamInstallIpcRequest): Promise<GithubTeamInstallIpcResponse>;
}

export function createGithubTeamIpcService(input: {
  dataRoot: string;
  transport: GithubTeamTransport;
}): GithubTeamIpcService {
  return {
    async readAuthStatus(): Promise<GithubTeamAuthIpcResponse> {
      try {
        const status = await input.transport.readAuthStatus();
        return {
          authenticated: status.authenticated,
          cliAvailable: status.cliAvailable,
        };
      } catch {
        return { authenticated: false, cliAvailable: false };
      }
    },

    async search(request): Promise<GithubTeamSearchIpcResponse> {
      const normalizedQuery = request.query.trim();
      const auth = await readAuth(input.transport);
      if (normalizedQuery.length === 0) {
        return { status: "ready", authenticated: auth.authenticated, results: [] };
      }
      try {
        const response = await input.transport.searchRepositories({
          query: normalizedQuery,
          language: request.language,
        });
        return {
          status: "ready",
          authenticated: auth.authenticated,
          results: response.data.items.map((item) => ({
            repository: item.repository,
            name: item.name,
            description: item.description,
            stars: item.stars,
            updatedAt: item.updatedAt,
            language: item.language,
            private: item.private,
          })),
        };
      } catch (error) {
        return mapSearchError(error, auth.authenticated);
      }
    },

    async preview(request): Promise<GithubTeamPreviewIpcResponse> {
      const repository = normalizeGithubRepository(request.repository);
      if (repository === null) {
        return {
          status: "error",
          repository: request.repository,
          message: "仓库地址无效。",
        };
      }
      try {
        const result = await loadGithubTeamSnapshot(input.transport, repository);
        if (result.status === "invalid") {
          return {
            status: "invalid-repository",
            repository,
            issues: result.issues.map((issue) => ({ path: issue.path, message: issue.message })),
          };
        }
        return { status: "ready", team: toPreviewData(result.snapshot) };
      } catch (error) {
        return mapPreviewError(error, repository);
      }
    },

    async install(request): Promise<GithubTeamInstallIpcResponse> {
      const repository = normalizeGithubRepository(request.repository);
      if (repository === null) {
        return { status: "failed", message: "仓库地址无效。" };
      }
      try {
        const snapshot = await loadGithubTeamSnapshot(input.transport, repository);
        if (snapshot.status === "invalid") {
          return { status: "failed", message: "这个仓库不符合团队格式，不能安装。" };
        }
        const result = await installGithubTeam({ dataRoot: input.dataRoot, snapshot: snapshot.snapshot });
        return mapInstallationResult(result);
      } catch (error) {
        return mapInstallError(error);
      }
    },

  };
}

export function registerGithubTeamIpc(input: {
  ipcMain: GithubTeamIpcMain;
  service: GithubTeamIpcService;
}): void {
  input.ipcMain.handle(GITHUB_TEAM_IPC_CHANNELS.authStatus, async () =>
    input.service.readAuthStatus());
  input.ipcMain.handle(GITHUB_TEAM_IPC_CHANNELS.search, async (_event, rawRequest) => {
    try {
      return await input.service.search(parseSearchRequest(rawRequest));
    } catch {
      return { status: "error", authenticated: false, message: "请求无效。" } satisfies GithubTeamSearchIpcResponse;
    }
  });
  input.ipcMain.handle(GITHUB_TEAM_IPC_CHANNELS.preview, async (_event, rawRequest) => {
    try {
      return await input.service.preview(parsePreviewRequest(rawRequest));
    } catch {
      return {
        status: "error",
        repository: rawRepository(rawRequest),
        message: "请求无效。",
      } satisfies GithubTeamPreviewIpcResponse;
    }
  });
  input.ipcMain.handle(GITHUB_TEAM_IPC_CHANNELS.install, async (_event, rawRequest) => {
    try {
      return await input.service.install(parseInstallRequest(rawRequest));
    } catch {
      return { status: "failed", message: "请求无效。" } satisfies GithubTeamInstallIpcResponse;
    }
  });
}

function rawRepository(value: unknown): string {
  return isPlainObject(value) && typeof value.repository === "string" ? value.repository : "";
}

function toPreviewData(snapshot: GithubTeamSnapshot): GithubTeamPreviewIpcData {
  const primaryAgentSlug = snapshot.definition.primaryAgentSlug;
  if (primaryAgentSlug === null) {
    throw new Error("GitHub 团队缺少主 Agent。");
  }
  return {
    repository: snapshot.repository.repository,
    defaultBranch: snapshot.repository.defaultBranch,
    name: snapshot.repository.name,
    description: snapshot.repository.description,
    stars: snapshot.repository.stars,
    updatedAt: snapshot.repository.updatedAt,
    language: languageFromTopics(snapshot.repository.topics),
    private: snapshot.repository.private,
    primaryAgentSlug,
    members: snapshot.members.map((member) => ({
      slug: member.slug,
      displayName: member.identity?.displayName ?? member.slug,
      description: member.identity?.description ?? "",
      markdown: member.agentMarkdown ?? "",
      recommendedProfile: formatRecommendedProfile(member.recommendedProfile),
      readable: member.readable,
      readError: member.readError,
    })),
  };
}

function formatRecommendedProfile(profile: ExecutionProfile | null): string | null {
  if (profile === null) return null;
  if (profile.cli === "pi") {
    return `Pi API · ${profile.model} · ${profile.effort}`;
  }
  return `${profile.model} · ${profile.effort}`;
}

function languageFromTopics(topics: readonly string[]): Exclude<GithubTeamLanguage, "all"> | null {
  if (topics.includes(GITHUB_TEAM_LANGUAGE_TOPICS.zh)) return "zh";
  if (topics.includes(GITHUB_TEAM_LANGUAGE_TOPICS.en)) return "en";
  return null;
}

function mapInstallationResult(result: GithubTeamInstallationResult): GithubTeamInstallIpcResponse {
  return result.status === "duplicate"
    ? { status: "duplicate", existingTeamId: result.existingTeamId }
    : { status: "installed", teamId: result.teamId };
}

function mapSearchError(error: unknown, authenticated: boolean): GithubTeamSearchIpcResponse {
  if (error instanceof GithubTeamTransportError) {
    if (error.code === "RATE_LIMITED") {
      return { status: "rate-limited", authenticated, seconds: rateLimitSeconds(error) };
    }
    if (error.code === "PERMISSION_DENIED" || error.code === "NOT_FOUND") {
      return { status: "permission-denied", authenticated };
    }
    if (isTransientError(error)) return { status: "offline", authenticated };
  }
  return { status: "error", authenticated, message: safeErrorMessage(error) };
}

function mapPreviewError(error: unknown, repository: string): GithubTeamPreviewIpcResponse {
  if (error instanceof GithubTeamTransportError) {
    if (error.code === "RATE_LIMITED") {
      return { status: "rate-limited", repository, seconds: rateLimitSeconds(error) };
    }
    if (error.code === "PERMISSION_DENIED" || error.code === "NOT_FOUND") {
      return { status: "permission-denied", repository };
    }
    if (isTransientError(error)) return { status: "offline", repository };
  }
  return { status: "error", repository, message: safeErrorMessage(error) };
}

function mapInstallError(error: unknown): GithubTeamInstallIpcResponse {
  if (error instanceof GithubTeamTransportError) {
    if (error.code === "RATE_LIMITED") return { status: "rate-limited", seconds: rateLimitSeconds(error) };
    if (error.code === "PERMISSION_DENIED" || error.code === "NOT_FOUND") return { status: "permission-denied" };
    if (isTransientError(error)) return { status: "offline" };
  }
  return { status: "failed", message: safeErrorMessage(error) };
}

function rateLimitSeconds(error: GithubTeamTransportError): number {
  const rateLimit = error.details.rateLimit;
  if (rateLimit?.retryAfterSeconds !== null && rateLimit?.retryAfterSeconds !== undefined) {
    return Math.max(0, rateLimit.retryAfterSeconds);
  }
  if (rateLimit?.resetAt !== null && rateLimit?.resetAt !== undefined) {
    return Math.max(0, Math.ceil((rateLimit.resetAt - Date.now()) / 1000));
  }
  return 60;
}

function isTransientError(error: unknown): boolean {
  return error instanceof GithubTeamTransportError
    && ["CLI_MISSING", "CLI_UNAVAILABLE", "NETWORK_UNAVAILABLE", "RATE_LIMITED", "PERMISSION_DENIED"].includes(error.code);
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof GithubTeamTransportError) {
    return error.message;
  }
  return "GitHub 团队数据读取失败。";
}

async function readAuth(transport: GithubTeamTransport): Promise<GithubTeamAuthIpcResponse> {
  try {
    const status = await transport.readAuthStatus();
    return { authenticated: status.authenticated, cliAvailable: status.cliAvailable };
  } catch {
    return { authenticated: false, cliAvailable: false };
  }
}

function parseSearchRequest(value: unknown): GithubTeamSearchIpcRequest {
  if (!isPlainObject(value)
    || typeof value.query !== "string"
    || (value.language !== "zh" && value.language !== "en" && value.language !== "all")) {
    throw new GithubTeamIpcRequestError();
  }
  return { query: value.query, language: value.language };
}

function parsePreviewRequest(value: unknown): GithubTeamPreviewIpcRequest {
  if (!isPlainObject(value) || typeof value.repository !== "string") {
    throw new GithubTeamIpcRequestError();
  }
  return { repository: value.repository };
}

function parseInstallRequest(value: unknown): GithubTeamInstallIpcRequest {
  if (!isPlainObject(value) || typeof value.repository !== "string") {
    throw new GithubTeamIpcRequestError();
  }
  return { repository: value.repository };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class GithubTeamIpcRequestError extends Error {
  constructor() {
    super("GitHub team request is invalid.");
    this.name = "GithubTeamIpcRequestError";
  }
}
