import {
  buildGithubRepositorySearchQuery,
  GithubTeamContractError,
  normalizeGithubRepository,
  parseGithubAuthStatus,
  parseGithubRepositoryContent,
  parseGithubRepositoryMetadata,
  parseGithubSearchResponse,
  type GithubApiEnvelope,
  type GithubAuthStatus,
  type GithubCommandRunner,
  type GithubRepositoryContent,
  type GithubRepositoryMetadata,
  type GithubRateLimitSnapshot,
  type GithubTeamSearchRequest,
  type GithubTeamSearchResponse,
  type GithubTeamTransportErrorCode,
} from "./github-team-contract.js";
import { GITHUB_TEAM_GH_MAX_OUTPUT_BYTES, GITHUB_TEAM_GH_TIMEOUT_MS } from "../../src/config.js";
import { runCommand, type CommandRunner } from "./shell-path.js";

const DEFAULT_GITHUB_HOSTNAME = "github.com";
const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_ACCEPT_HEADER = "application/vnd.github+json";
const DEFAULT_GH_TIMEOUT_MS = GITHUB_TEAM_GH_TIMEOUT_MS;
const DEFAULT_GH_MAX_OUTPUT_BYTES = GITHUB_TEAM_GH_MAX_OUTPUT_BYTES;

export interface GithubTeamTransport {
  readAuthStatus(): Promise<GithubAuthStatus>;
  searchRepositories(input: GithubTeamSearchRequest): Promise<GithubApiEnvelope<GithubTeamSearchResponse>>;
  readRepository(repository: string): Promise<GithubApiEnvelope<GithubRepositoryMetadata>>;
  readRepositoryContent(input: {
    repository: string;
    path: string;
    ref?: string;
  }): Promise<GithubApiEnvelope<GithubRepositoryContent>>;
}

export interface GithubTeamTransportOptions {
  command?: string;
  hostname?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  runCommand?: GithubCommandRunner;
  now?: () => number;
}

export class GithubTeamTransportError extends Error {
  constructor(
    readonly code: GithubTeamTransportErrorCode,
    message: string,
    readonly details: {
      statusCode?: number;
      rateLimit?: GithubRateLimitSnapshot | null;
      stderr?: string;
    } = {},
  ) {
    super(message);
    this.name = "GithubTeamTransportError";
  }
}

export function createGithubTeamTransport(options: GithubTeamTransportOptions = {}): GithubTeamTransport {
  const command = options.command ?? "gh";
  const hostname = options.hostname ?? DEFAULT_GITHUB_HOSTNAME;
  const timeoutMs = options.timeoutMs ?? DEFAULT_GH_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_GH_MAX_OUTPUT_BYTES;
  const run: GithubCommandRunner = options.runCommand ?? adaptCommandRunner(runCommand);
  const now = options.now ?? (() => Date.now());

  return {
    async readAuthStatus(): Promise<GithubAuthStatus> {
      try {
        const result = await run(command, ["auth", "status", "--hostname", hostname, "--json", "hosts"], {
          timeoutMs,
          maxOutputBytes,
        });
        if (result.stdout.trim().length > 0) {
          try {
            const status = parseGithubAuthStatus(JSON.parse(result.stdout) as unknown);
            return { ...status, cliAvailable: true };
          } catch {
            if (result.exitCode === 0) {
              throw new GithubTeamTransportError("INVALID_RESPONSE", "gh auth status returned invalid JSON", {
                stderr: result.stderr,
              });
            }
          }
        }
        return { authenticated: false, cliAvailable: true, login: null };
      } catch (error) {
        if (error instanceof GithubTeamTransportError) throw error;
        if (isMissingCommandError(error)) {
          return { authenticated: false, cliAvailable: false, login: null };
        }
        return { authenticated: false, cliAvailable: true, login: null };
      }
    },

    async searchRepositories(input): Promise<GithubApiEnvelope<GithubTeamSearchResponse>> {
      const perPage = normalizePerPage(input.perPage);
      const response = await request({
        endpoint: "search/repositories",
        fields: [
          ["q", buildGithubRepositorySearchQuery(input)],
          ["per_page", String(perPage)],
        ],
      });
      return {
        data: parseResponseJson(response, parseGithubSearchResponse),
        rateLimit: response.rateLimit,
      };
    },

    async readRepository(repository): Promise<GithubApiEnvelope<GithubRepositoryMetadata>> {
      const normalized = requireRepository(repository);
      const response = await request({ endpoint: `repos/${normalized}` });
      return {
        data: parseResponseJson(response, parseGithubRepositoryMetadata),
        rateLimit: response.rateLimit,
      };
    },

    async readRepositoryContent(input): Promise<GithubApiEnvelope<GithubRepositoryContent>> {
      const repository = requireRepository(input.repository);
      const normalizedPath = input.path.trim().length === 0
        ? ""
        : normalizeRepositoryPath(input.path);
      const response = await request({
        endpoint: normalizedPath.length === 0
          ? `repos/${repository}/contents`
          : `repos/${repository}/contents/${normalizedPath}`,
        fields: input.ref === undefined ? [] : [["ref", input.ref]],
      });
      return {
        data: parseResponseJson(response, parseGithubRepositoryContent),
        rateLimit: response.rateLimit,
      };
    },
  };

  async function request(input: {
    endpoint: string;
    fields?: readonly (readonly [string, string])[];
    headers?: readonly string[];
  }): Promise<ParsedGithubResponse> {
    const args = [
      "api",
      "--hostname",
      hostname,
      input.endpoint,
      "--method",
      "GET",
      "--include",
      "--header",
      `Accept: ${GITHUB_ACCEPT_HEADER}`,
      "--header",
      `X-GitHub-Api-Version: ${GITHUB_API_VERSION}`,
      ...(input.headers ?? []).flatMap((header) => ["--header", header]),
      ...(input.fields ?? []).flatMap(([key, value]) => ["--raw-field", `${key}=${value}`]),
    ];
    let result;
    try {
      result = await run(command, args, { timeoutMs, maxOutputBytes });
    } catch (error) {
      throw classifyCommandError(error);
    }

    const response = parseIncludedResponse(result.stdout, result.stderr, now);
    if (response === null) {
      throw classifyCommandResultError(result);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw classifyHttpError(response);
    }
    if (result.exitCode !== 0) {
      throw new GithubTeamTransportError("CLI_UNAVAILABLE", "gh api exited unsuccessfully", {
        statusCode: response.statusCode,
        rateLimit: response.rateLimit,
        stderr: result.stderr,
      });
    }
    return response;
  }
}

function adaptCommandRunner(runner: CommandRunner): GithubCommandRunner {
  return async (command, args, options) => runner(command, args, options);
}

interface ParsedGithubResponse {
  statusCode: number;
  headers: ReadonlyMap<string, string>;
  body: string;
  rateLimit: GithubRateLimitSnapshot | null;
}

function parseIncludedResponse(stdout: string, stderr: string, now: () => number): ParsedGithubResponse | null {
  const statusMatches = [...stdout.matchAll(/^HTTP\/\d(?:\.\d)?\s+(\d{3})[^\r\n]*$/gim)];
  const statusMatch = statusMatches.at(-1);
  if (statusMatch === undefined || statusMatch.index === undefined) return null;
  const headerStart = statusMatch.index;
  const headerEnd = findHeaderEnd(stdout, headerStart);
  if (headerEnd === null) return null;
  const headerText = stdout.slice(headerStart, headerEnd.start);
  const body = stdout.slice(headerEnd.end);
  const headers = parseHeaders(headerText);
  return {
    statusCode: Number(statusMatch[1]),
    headers,
    body,
    rateLimit: parseRateLimit(headers, now()),
  };
}

function findHeaderEnd(value: string, start: number): { start: number; end: number } | null {
  const crlf = value.indexOf("\r\n\r\n", start);
  const lf = value.indexOf("\n\n", start);
  if (crlf < 0 && lf < 0) return null;
  if (crlf >= 0 && (lf < 0 || crlf <= lf)) return { start: crlf, end: crlf + 4 };
  return { start: lf, end: lf + 2 };
}

function parseHeaders(value: string): ReadonlyMap<string, string> {
  const headers = new Map<string, string>();
  for (const line of value.split(/\r?\n/u).slice(1)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }
  return headers;
}

function parseRateLimit(headers: ReadonlyMap<string, string>, now: number): GithubRateLimitSnapshot | null {
  const limit = parseIntegerHeader(headers.get("x-ratelimit-limit"));
  const remaining = parseIntegerHeader(headers.get("x-ratelimit-remaining"));
  const resetSeconds = parseIntegerHeader(headers.get("x-ratelimit-reset"));
  const retryAfterSeconds = parseRetryAfter(headers.get("retry-after"), now);
  if (limit === null && remaining === null && resetSeconds === null && retryAfterSeconds === null) return null;
  return {
    limit,
    remaining,
    resetAt: resetSeconds === null ? null : resetSeconds * 1000,
    retryAfterSeconds,
    resource: headers.get("x-ratelimit-resource") ?? null,
  };
}

function parseRetryAfter(value: string | undefined, now: number): number | null {
  if (value === undefined || value.trim().length === 0) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return Math.ceil(numeric);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.ceil((timestamp - now) / 1000));
}

function parseIntegerHeader(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/u.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseResponseJson<T>(response: ParsedGithubResponse, parser: (value: unknown) => T): T {
  try {
    return parser(JSON.parse(response.body) as unknown);
  } catch (error) {
    if (error instanceof GithubTeamTransportError) throw error;
    throw new GithubTeamTransportError("INVALID_RESPONSE", "GitHub returned invalid JSON", {
      statusCode: response.statusCode,
      rateLimit: response.rateLimit,
    });
  }
}

function classifyHttpError(response: ParsedGithubResponse): GithubTeamTransportError {
  const body = response.body.toLowerCase();
  if (response.statusCode === 404) {
    return new GithubTeamTransportError("NOT_FOUND", "GitHub repository or resource was not found", {
      statusCode: response.statusCode,
      rateLimit: response.rateLimit,
    });
  }
  if (response.statusCode === 401 || (response.statusCode === 403 && !isRateLimited(response, body))) {
    return new GithubTeamTransportError("PERMISSION_DENIED", "GitHub denied access to the requested resource", {
      statusCode: response.statusCode,
      rateLimit: response.rateLimit,
    });
  }
  if (response.statusCode === 429 || (response.statusCode === 403 && isRateLimited(response, body))) {
    return new GithubTeamTransportError("RATE_LIMITED", "GitHub rate limit is active", {
      statusCode: response.statusCode,
      rateLimit: response.rateLimit,
    });
  }
  if (response.statusCode === 408 || response.statusCode >= 500) {
    return new GithubTeamTransportError("NETWORK_UNAVAILABLE", "GitHub is temporarily unavailable", {
      statusCode: response.statusCode,
      rateLimit: response.rateLimit,
    });
  }
  return new GithubTeamTransportError("HTTP_ERROR", `GitHub returned HTTP ${String(response.statusCode)}`, {
    statusCode: response.statusCode,
    rateLimit: response.rateLimit,
  });
}

function isRateLimited(response: ParsedGithubResponse, body: string): boolean {
  return response.rateLimit?.remaining === 0
    || response.rateLimit?.retryAfterSeconds !== null && response.rateLimit?.retryAfterSeconds !== undefined
    || body.includes("rate limit")
    || body.includes("secondary rate");
}

function classifyCommandResultError(result: { exitCode: number; stderr: string }): GithubTeamTransportError {
  const stderr = result.stderr.toLowerCase();
  if (stderr.includes("could not resolve") || stderr.includes("network") || stderr.includes("timed out") || stderr.includes("connection")) {
    return new GithubTeamTransportError("NETWORK_UNAVAILABLE", "Unable to reach GitHub", { stderr: result.stderr });
  }
  return new GithubTeamTransportError("CLI_UNAVAILABLE", `gh api failed with exit code ${String(result.exitCode)}`, {
    stderr: result.stderr,
  });
}

function classifyCommandError(error: unknown): GithubTeamTransportError {
  if (isMissingCommandError(error)) {
    return new GithubTeamTransportError("CLI_MISSING", "gh CLI was not found on PATH");
  }
  const message = error instanceof Error ? error.message : "Unable to start gh CLI";
  return new GithubTeamTransportError("CLI_UNAVAILABLE", message);
}

function isMissingCommandError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { code?: unknown }).code === "ENOENT" || (error as { code?: unknown }).code === "ENOTDIR");
}

function requireRepository(value: string): string {
  const repository = normalizeGithubRepository(value);
  if (repository === null) throw new GithubTeamTransportError("HTTP_ERROR", "Invalid GitHub repository name");
  return repository;
}

function normalizeRepositoryPath(value: string): string {
  const trimmed = value.trim();
  const segments = trimmed.split("/");
  if (trimmed.length === 0 || segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new GithubTeamTransportError("HTTP_ERROR", "Invalid GitHub repository path");
  }
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

function normalizePerPage(value: number | undefined): number {
  if (value === undefined) return 30;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new GithubTeamTransportError("HTTP_ERROR", "GitHub search page size must be between 1 and 100");
  }
  return value;
}
