import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMergedLocalConfig } from "./local-config.js";

// 尽早把项目根 .env 加载到 process.env，供 CODEX_PROVIDER_CONFIG 与任何
// LOCAL_CONSOLE_* 环境读取使用。process.loadEnvFile 不覆盖已有变量，且文件不
// 存在时抛错——一律吞掉，让缺省 .env 场景静默通过。
try {
  const projectRootForEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  process.loadEnvFile(path.join(projectRootForEnv, ".env"));
} catch {
  // ignore：.env 不存在或 Node 版本过老（无 loadEnvFile）时保持原有 process.env
}

export const MOEBIUS_DATA_ROOT_ENV = "MOEBIUS_DATA_ROOT";
export const MOEBIUS_WORKDIR_ROOT_ENV = "MOEBIUS_WORKDIR_ROOT";

export interface RuntimePathResolutionInput {
  env?: NodeJS.ProcessEnv;
  projectRoot?: string;
}

export interface RuntimePaths {
  projectRoot: string;
  dataRoot: string;
  configPath: string;
  localConfigPath: string;
  agentsDir: string;
  workdirRoot: string;
}

export function resolveRuntimePaths(input: RuntimePathResolutionInput = {}): RuntimePaths {
  const projectRoot = path.resolve(input.projectRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const dataRootOverride = input.env?.[MOEBIUS_DATA_ROOT_ENV]?.trim();
  const dataRoot = path.resolve(dataRootOverride && dataRootOverride.length > 0 ? dataRootOverride : projectRoot);

  // workdir（git worktree 根）默认派生自数据根，绝不以源码/应用包为基准；
  // MOEBIUS_WORKDIR_ROOT 仅作显式覆盖。
  const workdirOverride = input.env?.[MOEBIUS_WORKDIR_ROOT_ENV]?.trim();
  const workdirRoot = path.resolve(
    workdirOverride && workdirOverride.length > 0 ? workdirOverride : path.join(dataRoot, "workdir"),
  );

  return {
    projectRoot,
    dataRoot,
    configPath: path.join(dataRoot, "config.toml"),
    localConfigPath: path.join(dataRoot, "config.local.toml"),
    agentsDir: path.join(dataRoot, "agents"),
    workdirRoot,
  };
}

const RUNTIME_PATHS = resolveRuntimePaths({ env: process.env });
export const PROJECT_ROOT = RUNTIME_PATHS.projectRoot;
export const DATA_ROOT = RUNTIME_PATHS.dataRoot;
export const CONFIG_PATH = RUNTIME_PATHS.configPath;
export const LOCAL_CONFIG_PATH = RUNTIME_PATHS.localConfigPath;
const LOCAL_CONFIG = loadMergedLocalConfig({ configPath: CONFIG_PATH, localConfigPath: LOCAL_CONFIG_PATH });

export const WATCH_REPOSITORIES = LOCAL_CONFIG.watchRepositories;

export const TICK_INTERVAL_MS = 1 * 60 * 1000;
export const IDLE_REPOSITORY_SCAN_INTERVAL_MS = 5 * 60 * 1000;
export const ACTIVE_ISSUE_POLL_INTERVAL_MS = 1 * 60 * 1000;
export const RUNNING_AGENT_INTERRUPT_POLL_INTERVAL_MS = 15 * 1000;
export const ACTIVE_ISSUE_NO_CHANGE_LIMIT = 5;
export const FAILURE_RETRY_LIMIT = 5;
export const ISSUE_DISCOVERY_LIMIT = 20;
export const MAX_ACTIVE_ISSUES = 3;
export const CODEX_DRIVER_POOL_MAX_CONCURRENT = 5;
export const GITHUB_CLI_RETRY_POLICY = {
  retries: 4,
  minTimeoutMs: 500,
  maxTimeoutMs: 8_000,
  factor: 2,
} as const;
export const CODEX_RUN_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const CODEX_RUN_MAX_DURATION_MS = 120 * 60 * 1000;
export const AI_TEAM_BUILDER_CODEX_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
export const AI_TEAM_BUILDER_CODEX_MAX_DURATION_MS = 10 * 60 * 1000;
export const CEO_ORCHESTRATION_ACTION_TIMEOUT_MS = 2 * 60 * 1000;
export const WORKTREE_GIT_TIMEOUT_MS = 2 * 60 * 1000;
export const ISSUE_MEDIA_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const ISSUE_MEDIA_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const OUTPUT_ARTIFACT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const OUTPUT_ARTIFACT_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const OUTPUT_ARTIFACT_RELEASE_TAG = "moebius-artifacts";
export const LOCAL_CONSOLE_HOST = process.env.LOCAL_CONSOLE_HOST?.trim() || "127.0.0.1";
export const LOCAL_CONSOLE_PORT = parseOptionalPort(process.env.LOCAL_CONSOLE_PORT) ?? 8788;
export const LOCAL_CONSOLE_SQLITE_PATH = path.join(DATA_ROOT, ".state", "local-console.sqlite");
export const LOCAL_CONSOLE_ATTACHMENTS_ROOT = path.join(DATA_ROOT, ".state", "local-console-attachments");
export const LOCAL_CONSOLE_ATTACHMENT_MAX_BYTES = 1024 * 1024 * 1024;
export const LOCAL_CONSOLE_ATTACHMENT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
export const LOCAL_CONSOLE_ATTACHMENT_PREVIEW_MAX_EDGE = 512;
export const LOCAL_CONSOLE_ATTACHMENT_STAGING_TTL_MS = 24 * 60 * 60 * 1000;
export const LOCAL_CONSOLE_SESSION_LOG_ROOT = path.join(DATA_ROOT, "sessions");
export const GITHUB_RUNNER_SQLITE_PATH = path.join(DATA_ROOT, ".state", "github-runner.sqlite");
export const LOCAL_CONSOLE_STORE_TIMEOUT_MS = parseOptionalPositiveInteger(process.env.LOCAL_CONSOLE_STORE_TIMEOUT_MS) ?? 2_000;
export const LOCAL_CONSOLE_SQLITE_BUSY_TIMEOUT_MS = parseOptionalPositiveInteger(process.env.LOCAL_CONSOLE_SQLITE_BUSY_TIMEOUT_MS) ?? 2_000;
export const LOCAL_CONSOLE_FAILURE_RETRY_LIMIT = parseOptionalPositiveInteger(process.env.LOCAL_CONSOLE_FAILURE_RETRY_LIMIT) ?? FAILURE_RETRY_LIMIT;
export const AGENTS_DIR = RUNTIME_PATHS.agentsDir;
export const TMP_ROOT = "/tmp";
export const ROLE_THREADS_STATE_PATH = path.join(DATA_ROOT, ".state", "role-threads.json");
export const AGENT_CONTEXTS_STATE_PATH = path.join(DATA_ROOT, ".state", "agent-contexts.json");
export const GITHUB_RESPONSE_INTAKE_STATE_PATH = path.join(DATA_ROOT, ".state", "github-response-intake.json");
export const GOAL_LEDGER_STATE_PATH = path.join(DATA_ROOT, ".state", "goal-ledger.json");
export const WORKDIR_ROOT = RUNTIME_PATHS.workdirRoot;

export const DEFAULT_CODEX_MODEL = "gpt-5.6-sol";

export function buildCodexExecOptionsBase(model: string): string[] {
  return [
    "--yolo",
    "--json",
    "-m",
    model,
    "-c",
    'service_tier="fast"',
    "-c",
    "features.fast_mode=true",
    "-c",
    'model_reasoning_effort="high"',
  ];
}

export interface CodexProviderConfig {
  provider: string;
  baseUrl: string;
}

export function resolveCodexProviderConfig(
  local: { codex?: { provider?: string; model?: string } },
  env: NodeJS.ProcessEnv = process.env,
): CodexProviderConfig | null {
  const rawProvider = local.codex?.provider;
  const provider = typeof rawProvider === "string" ? rawProvider.trim() : "";
  if (provider.length === 0) {
    return null;
  }

  const upper = provider.toUpperCase();
  const apiKeyName = `${upper}_API_KEY`;
  const baseUrlName = `${upper}_BASE_URL`;
  const apiKey = env[apiKeyName]?.trim();
  const baseUrl = env[baseUrlName]?.trim();
  const missing: string[] = [];
  if (!apiKey) missing.push(apiKeyName);
  if (!baseUrl) missing.push(baseUrlName);
  if (missing.length > 0) {
    throw new Error(
      `[codex] provider="${provider}" requires environment variables ${missing.join(", ")}; ` +
        "set them in the project root .env or export them before starting.",
    );
  }

  return { provider, baseUrl: baseUrl! };
}

export function resolveCodexModel(local: { codex?: { provider?: string; model?: string } }): string {
  const raw = local.codex?.model;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : DEFAULT_CODEX_MODEL;
}

export function buildCodexExecOptions(
  cfg: CodexProviderConfig | null,
  model: string,
): string[] {
  const base = buildCodexExecOptionsBase(model);
  if (cfg === null) {
    return base;
  }
  const { provider, baseUrl } = cfg;
  const upper = provider.toUpperCase();
  return [
    ...base,
    "-c",
    `model_provider=${provider}`,
    "-c",
    `model_providers.${provider}.name=${provider}`,
    "-c",
    `model_providers.${provider}.base_url=${baseUrl}`,
    "-c",
    `model_providers.${provider}.env_key=${upper}_API_KEY`,
    "-c",
    `model_providers.${provider}.wire_api=responses`,
  ];
}

export interface TeamBuilderExecOptionsInput {
  mode: "full" | "resume";
  schemaPath: string;
  isolatedCwd: string;
  developerInstructions: string;
  providerConfig: CodexProviderConfig | null;
  model: string;
}

export function buildTeamBuilderExecOptions(input: TeamBuilderExecOptionsInput): string[] {
  const common = [
    "--json",
    "--ignore-user-config",
    "--ignore-rules",
    "--output-schema",
    input.schemaPath,
    "-m",
    input.model,
    "-c",
    'service_tier="fast"',
    "-c",
    "features.fast_mode=true",
    "-c",
    'model_reasoning_effort="high"',
    "-c",
    `developer_instructions=${JSON.stringify(input.developerInstructions)}`,
    "--sandbox",
    "read-only",
    "--cd",
    input.isolatedCwd,
    "--skip-git-repo-check",
  ];
  const provider = input.providerConfig === null
    ? []
    : buildCodexProviderOptions(input.providerConfig);
  return [...common, ...provider];
}

export const CODEX_PROVIDER_CONFIG = resolveCodexProviderConfig(LOCAL_CONFIG);
export const CODEX_MODEL = resolveCodexModel(LOCAL_CONFIG);
export const CODEX_EXEC_OPTIONS = buildCodexExecOptions(CODEX_PROVIDER_CONFIG, CODEX_MODEL);

function buildCodexProviderOptions(config: CodexProviderConfig): string[] {
  const { provider, baseUrl } = config;
  const upper = provider.toUpperCase();
  return [
    "-c",
    `model_provider=${provider}`,
    "-c",
    `model_providers.${provider}.name=${provider}`,
    "-c",
    `model_providers.${provider}.base_url=${baseUrl}`,
    "-c",
    `model_providers.${provider}.env_key=${upper}_API_KEY`,
    "-c",
    `model_providers.${provider}.wire_api=responses`,
  ];
}

export const CONFIG_LOG_FIELDS = {
  configPath: CONFIG_PATH,
  localConfigPath: LOCAL_CONFIG_PATH,
  dataRoot: DATA_ROOT,
  watchedRepositories: WATCH_REPOSITORIES,
  tickIntervalMs: TICK_INTERVAL_MS,
  idleRepositoryScanIntervalMs: IDLE_REPOSITORY_SCAN_INTERVAL_MS,
  activeIssuePollIntervalMs: ACTIVE_ISSUE_POLL_INTERVAL_MS,
  runningAgentInterruptPollIntervalMs: RUNNING_AGENT_INTERRUPT_POLL_INTERVAL_MS,
  activeIssueNoChangeLimit: ACTIVE_ISSUE_NO_CHANGE_LIMIT,
  failureRetryLimit: FAILURE_RETRY_LIMIT,
  issueDiscoveryLimit: ISSUE_DISCOVERY_LIMIT,
  maxActiveIssues: MAX_ACTIVE_ISSUES,
  codexDriverPoolMaxConcurrent: CODEX_DRIVER_POOL_MAX_CONCURRENT,
  githubCliRetry: GITHUB_CLI_RETRY_POLICY,
  codexRunIdleTimeoutMs: CODEX_RUN_IDLE_TIMEOUT_MS,
  codexRunMaxDurationMs: CODEX_RUN_MAX_DURATION_MS,
  ceoOrchestrationActionTimeoutMs: CEO_ORCHESTRATION_ACTION_TIMEOUT_MS,
  worktreeGitTimeoutMs: WORKTREE_GIT_TIMEOUT_MS,
  issueMediaImageMaxBytes: ISSUE_MEDIA_IMAGE_MAX_BYTES,
  issueMediaVideoMaxBytes: ISSUE_MEDIA_VIDEO_MAX_BYTES,
  outputArtifactImageMaxBytes: OUTPUT_ARTIFACT_IMAGE_MAX_BYTES,
  outputArtifactVideoMaxBytes: OUTPUT_ARTIFACT_VIDEO_MAX_BYTES,
  outputArtifactReleaseTag: OUTPUT_ARTIFACT_RELEASE_TAG,
  localConsoleHost: LOCAL_CONSOLE_HOST,
  localConsolePort: LOCAL_CONSOLE_PORT,
  localConsoleSqlitePath: LOCAL_CONSOLE_SQLITE_PATH,
  localConsoleAttachmentMaxBytes: LOCAL_CONSOLE_ATTACHMENT_MAX_BYTES,
  localConsoleAttachmentPreviewMaxBytes: LOCAL_CONSOLE_ATTACHMENT_PREVIEW_MAX_BYTES,
  localConsoleAttachmentPreviewMaxEdge: LOCAL_CONSOLE_ATTACHMENT_PREVIEW_MAX_EDGE,
  localConsoleAttachmentStagingTtlMs: LOCAL_CONSOLE_ATTACHMENT_STAGING_TTL_MS,
  localConsoleSessionLogRoot: LOCAL_CONSOLE_SESSION_LOG_ROOT,
  githubRunnerSqlitePath: GITHUB_RUNNER_SQLITE_PATH,
  localConsoleStoreTimeoutMs: LOCAL_CONSOLE_STORE_TIMEOUT_MS,
  localConsoleSqliteBusyTimeoutMs: LOCAL_CONSOLE_SQLITE_BUSY_TIMEOUT_MS,
  localConsoleFailureRetryLimit: LOCAL_CONSOLE_FAILURE_RETRY_LIMIT,
  agentsDir: AGENTS_DIR,
  tmpRoot: TMP_ROOT,
  roleThreadsStatePath: ROLE_THREADS_STATE_PATH,
  agentContextsStatePath: AGENT_CONTEXTS_STATE_PATH,
  githubResponseIntakeStatePath: GITHUB_RESPONSE_INTAKE_STATE_PATH,
  goalLedgerStatePath: GOAL_LEDGER_STATE_PATH,
  workdirRoot: WORKDIR_ROOT,
};

function parseOptionalPort(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`Invalid LOCAL_CONSOLE_PORT: ${value}`);
  }
  return parsed;
}

function parseOptionalPositiveInteger(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer config value: ${value}`);
  }
  return parsed;
}
