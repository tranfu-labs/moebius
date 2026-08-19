export type GithubTeamLanguage = "zh" | "en" | "all";

export const GITHUB_TEAM_TOPIC = "moebius-team";
export const GITHUB_TEAM_LANGUAGE_TOPICS = {
  zh: "moebius-team-zh",
  en: "moebius-team-en",
} as const;

export interface GithubTeamSearchRequest {
  query: string;
  language: GithubTeamLanguage;
  perPage?: number;
}

export interface GithubTeamSearchResult {
  repository: string;
  name: string;
  description: string;
  stars: number;
  updatedAt: string;
  language: Exclude<GithubTeamLanguage, "all"> | null;
  private: boolean;
  topics: string[];
}

export interface GithubTeamSearchResponse {
  totalCount: number;
  incompleteResults: boolean;
  items: GithubTeamSearchResult[];
}

export interface GithubRepositoryMetadata {
  repository: string;
  name: string;
  description: string;
  stars: number;
  updatedAt: string;
  private: boolean;
  topics: string[];
  defaultBranch: string;
  htmlUrl: string | null;
}

export interface GithubRepositoryFile {
  type: "file";
  path: string;
  sha: string;
  size: number;
  content: string;
}

export interface GithubRepositoryDirectoryEntry {
  type: "file" | "dir" | "symlink" | "submodule";
  path: string;
  sha: string;
  size: number | null;
}

export type GithubRepositoryContent = GithubRepositoryFile | GithubRepositoryDirectoryEntry[];

export interface GithubApiEnvelope<T> {
  data: T;
  rateLimit: GithubRateLimitSnapshot | null;
}

export interface GithubRateLimitSnapshot {
  limit: number | null;
  remaining: number | null;
  resetAt: number | null;
  retryAfterSeconds: number | null;
  resource: string | null;
}

export interface GithubAuthStatus {
  authenticated: boolean;
  cliAvailable: boolean;
  login: string | null;
}

export type GithubTeamTransportErrorCode =
  | "CLI_MISSING"
  | "CLI_UNAVAILABLE"
  | "NETWORK_UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "INVALID_RESPONSE"
  | "HTTP_ERROR";

export interface GithubCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface GithubCommandOptions {
  timeoutMs: number;
  maxOutputBytes: number;
}

export type GithubCommandRunner = (
  command: string,
  args: readonly string[],
  options: GithubCommandOptions,
) => Promise<GithubCommandResult>;

export function normalizeGithubRepository(value: string): string | null {
  const trimmed = value.trim();
  const match = /^([^/]+)\/([^/]+)$/u.exec(trimmed);
  if (match === null) return null;
  const owner = match[1]!.trim();
  const repository = match[2]!.trim();
  if (owner.length === 0 || repository.length === 0 || owner === "." || owner === ".." || repository === "." || repository === "..") {
    return null;
  }
  if (!/^[A-Za-z0-9_.-]+$/u.test(owner) || !/^[A-Za-z0-9_.-]+$/u.test(repository)) {
    return null;
  }
  return `${owner}/${repository}`;
}

export function buildGithubRepositorySearchQuery(input: Pick<GithubTeamSearchRequest, "query" | "language">): string {
  const query = input.query.trim().replaceAll('"', "\\\"");
  const clauses = [`topic:${GITHUB_TEAM_TOPIC}`];
  if (input.language !== "all") {
    clauses.push(`topic:${GITHUB_TEAM_LANGUAGE_TOPICS[input.language]}`);
  }
  if (query.length === 0) return clauses.join(" ");
  return [`${query} in:name,description`, ...clauses].join(" ");
}

export function parseGithubAuthStatus(value: unknown): GithubAuthStatus {
  if (!isRecord(value)) {
    throw new GithubTeamContractError("gh auth status returned a non-object payload");
  }
  const hosts = value.hosts;
  if (!isRecord(hosts)) {
    return { authenticated: false, cliAvailable: true, login: null };
  }
  const entries = hosts.github_com ?? hosts["github.com"];
  if (!Array.isArray(entries)) {
    return { authenticated: false, cliAvailable: true, login: null };
  }
  const active = entries.find((entry) => isRecord(entry) && entry.active === true && entry.state === "success");
  return {
    authenticated: active !== undefined,
    cliAvailable: true,
    login: isRecord(active) && typeof active.login === "string" ? active.login : null,
  };
}

export function parseGithubSearchResponse(value: unknown): GithubTeamSearchResponse {
  const totalCount = isRecord(value) ? value.total_count : undefined;
  const items = isRecord(value) ? value.items : undefined;
  if (!Number.isInteger(totalCount) || (totalCount as number) < 0 || !Array.isArray(items)) {
    throw new GithubTeamContractError("GitHub repository search returned an invalid payload");
  }
  return {
    totalCount: totalCount as number,
    incompleteResults: isRecord(value) && value.incomplete_results === true,
    items: (items as unknown[]).map(parseGithubSearchResult),
  };
}

export function parseGithubRepositoryMetadata(value: unknown): GithubRepositoryMetadata {
  if (!isRecord(value)) {
    throw new GithubTeamContractError("GitHub repository metadata returned an invalid payload");
  }
  const repository = requiredRepository(value.full_name);
  const defaultBranch = requiredString(value.default_branch, "default_branch");
  return {
    repository,
    name: requiredString(value.name, "name"),
    description: typeof value.description === "string" ? value.description : "",
    stars: nonNegativeInteger(value.stargazers_count, "stargazers_count"),
    updatedAt: requiredString(value.updated_at, "updated_at"),
    private: value.private === true,
    topics: parseTopics(value.topics),
    defaultBranch,
    htmlUrl: typeof value.html_url === "string" ? value.html_url : null,
  };
}

export function parseGithubRepositoryContent(value: unknown): GithubRepositoryContent {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (!isRecord(entry)) {
        throw new GithubTeamContractError("GitHub repository directory returned an invalid entry");
      }
      const type = entry.type;
      if (type !== "file" && type !== "dir" && type !== "symlink" && type !== "submodule") {
        throw new GithubTeamContractError("GitHub repository directory returned an unknown entry type");
      }
      return {
        type,
        path: requiredString(entry.path, "path"),
        sha: requiredString(entry.sha, "sha"),
        size: typeof entry.size === "number" && Number.isInteger(entry.size) ? entry.size : null,
      };
    });
  }
  if (!isRecord(value) || value.type !== "file") {
    throw new GithubTeamContractError("GitHub repository content is not a file or directory");
  }
  const encodedContent = requiredString(value.content, "content").replaceAll(/\s/gu, "");
  let content: string;
  try {
    content = Buffer.from(encodedContent, "base64").toString("utf8");
  } catch {
    throw new GithubTeamContractError("GitHub repository file content is not valid base64");
  }
  return {
    type: "file",
    path: requiredString(value.path, "path"),
    sha: requiredString(value.sha, "sha"),
    size: nonNegativeInteger(value.size, "size"),
    content,
  };
}

export class GithubTeamContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GithubTeamContractError";
  }
}

function parseGithubSearchResult(value: unknown): GithubTeamSearchResult {
  if (!isRecord(value)) {
    throw new GithubTeamContractError("GitHub repository search returned an invalid item");
  }
  return {
    repository: requiredRepository(value.full_name),
    name: requiredString(value.name, "name"),
    description: typeof value.description === "string" ? value.description : "",
    stars: nonNegativeInteger(value.stargazers_count, "stargazers_count"),
    updatedAt: requiredString(value.updated_at, "updated_at"),
    language: languageFromTopics(parseTopics(value.topics)),
    private: value.private === true,
    topics: parseTopics(value.topics),
  };
}

function languageFromTopics(topics: readonly string[]): Exclude<GithubTeamLanguage, "all"> | null {
  if (topics.includes(GITHUB_TEAM_LANGUAGE_TOPICS.zh)) return "zh";
  if (topics.includes(GITHUB_TEAM_LANGUAGE_TOPICS.en)) return "en";
  return null;
}

function parseTopics(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((topic): topic is string => typeof topic === "string");
}

function requiredRepository(value: unknown): string {
  if (typeof value !== "string") {
    throw new GithubTeamContractError("GitHub repository payload is missing full_name");
  }
  const repository = normalizeGithubRepository(value);
  if (repository === null) {
    throw new GithubTeamContractError("GitHub repository payload contains an invalid full_name");
  }
  return repository;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GithubTeamContractError(`GitHub repository payload is missing ${field}`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new GithubTeamContractError(`GitHub repository payload contains an invalid ${field}`);
  }
  return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
