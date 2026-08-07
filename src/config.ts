import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMergedLocalConfig } from "./local-config.js";

const SOURCE_PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 尽早把项目根 .env 加载到 process.env，供 CODEX_PROVIDER_CONFIG 与任何
// LOCAL_CONSOLE_* 环境读取使用。process.loadEnvFile 不覆盖已有变量，且文件不
// 存在时抛错——一律吞掉，让缺省 .env 场景静默通过。
try {
  process.loadEnvFile(path.join(SOURCE_PROJECT_ROOT, ".env"));
} catch {
  // ignore：.env 不存在或 Node 版本过老（无 loadEnvFile）时保持原有 process.env
}

export const MOEBIUS_DATA_ROOT_ENV = "MOEBIUS_DATA_ROOT";
export const MOEBIUS_WORKDIR_ROOT_ENV = "MOEBIUS_WORKDIR_ROOT";

export interface RuntimePathResolutionInput {
  env?: NodeJS.ProcessEnv;
  projectRoot: string;
}

export interface RuntimePaths {
  projectRoot: string;
  dataRoot: string;
  configPath: string;
  localConfigPath: string;
  agentsDir: string;
  workdirRoot: string;
}

export function resolveRuntimePaths(input: RuntimePathResolutionInput): RuntimePaths {
  const projectRoot = path.resolve(input.projectRoot);
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

const RUNTIME_PATHS = resolveRuntimePaths({ env: process.env, projectRoot: SOURCE_PROJECT_ROOT });
export const PROJECT_ROOT = RUNTIME_PATHS.projectRoot;
export const DATA_ROOT = RUNTIME_PATHS.dataRoot;
export const CONFIG_PATH = RUNTIME_PATHS.configPath;
export const LOCAL_CONFIG_PATH = RUNTIME_PATHS.localConfigPath;
const LOCAL_CONFIG = loadMergedLocalConfig({ configPath: CONFIG_PATH, localConfigPath: LOCAL_CONFIG_PATH });

export const LOCAL_RUN_IDLE_TIMEOUT_MS = parseOptionalPositiveInteger(
  process.env.MOEBIUS_LOCAL_RUN_IDLE_TIMEOUT_MS,
) ?? 10 * 60 * 1000;
export const LOCAL_TOOL_IN_FLIGHT_TIMEOUT_MS = parseOptionalPositiveInteger(
  process.env.MOEBIUS_LOCAL_TOOL_IN_FLIGHT_TIMEOUT_MS,
) ?? 2 * 60 * 60 * 1000;
export const LOCAL_PROVIDER_BUSY_TIMEOUT_MS = parseOptionalPositiveInteger(
  process.env.MOEBIUS_LOCAL_PROVIDER_BUSY_TIMEOUT_MS,
) ?? 5 * 60 * 1000;
export const LOCAL_LONG_RUN_REPORT_MS = parseOptionalPositiveInteger(
  process.env.MOEBIUS_LOCAL_LONG_RUN_REPORT_MS,
) ?? 15 * 60 * 1000;
export const KIMI_CLI_SPAWN_TIMEOUT_MS = 5_000;
export const DESKTOP_SHELL_PATH_TIMEOUT_MS = 5_000;
export const DESKTOP_SHELL_PATH_MAX_OUTPUT_BYTES = 64 * 1024;
export const DESKTOP_SHELL_PATH_TERMINATE_GRACE_MS = 500;
export const AI_TEAM_BUILDER_CODEX_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
export const AI_TEAM_BUILDER_CODEX_MAX_DURATION_MS = 10 * 60 * 1000;
export const WORKTREE_GIT_TIMEOUT_MS = 2 * 60 * 1000;
export {
  PI_HOST_COMMAND_TERMINATE_GRACE_MS,
  PI_HOST_MAX_FILE_BYTES,
  PI_HOST_MAX_FOREGROUND_SUBAGENTS,
  PI_HOST_MAX_FRAME_BYTES,
  PI_HOST_MAX_TOOL_OUTPUT_BYTES,
  PI_HOST_TERMINATE_GRACE_MS,
  PI_HOST_WEB_FETCH_TIMEOUT_MS,
} from "./pi-host-protocol.js";
export const LOCAL_CONSOLE_HOST = process.env.LOCAL_CONSOLE_HOST?.trim() || "127.0.0.1";
export const LOCAL_CONSOLE_PORT = parseOptionalPort(process.env.LOCAL_CONSOLE_PORT) ?? 8788;
export const LOCAL_CONSOLE_SQLITE_PATH = path.join(DATA_ROOT, ".state", "local-console.sqlite");
export const LOCAL_CONSOLE_ATTACHMENTS_ROOT = path.join(DATA_ROOT, ".state", "local-console-attachments");
export const LOCAL_CONSOLE_ATTACHMENT_MAX_BYTES = 1024 * 1024 * 1024;
export const LOCAL_CONSOLE_ATTACHMENT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
export const LOCAL_CONSOLE_ATTACHMENT_PREVIEW_MAX_EDGE = 512;
export const LOCAL_CONSOLE_ATTACHMENT_STAGING_TTL_MS = 24 * 60 * 60 * 1000;
export const LOCAL_CONSOLE_SESSION_LOG_ROOT = path.join(DATA_ROOT, "sessions");
export const LOCAL_CONSOLE_STORE_TIMEOUT_MS = parseOptionalPositiveInteger(process.env.LOCAL_CONSOLE_STORE_TIMEOUT_MS) ?? 2_000;
export const LOCAL_CONSOLE_SQLITE_BUSY_TIMEOUT_MS = parseOptionalPositiveInteger(process.env.LOCAL_CONSOLE_SQLITE_BUSY_TIMEOUT_MS) ?? 2_000;
export const LOCAL_CONSOLE_FAILURE_RETRY_LIMIT = parseOptionalPositiveInteger(process.env.LOCAL_CONSOLE_FAILURE_RETRY_LIMIT) ?? 5;
export const AGENTS_DIR = RUNTIME_PATHS.agentsDir;
export const TMP_ROOT = "/tmp";
export const WORKDIR_ROOT = RUNTIME_PATHS.workdirRoot;

export const DEFAULT_CODEX_MODEL = "gpt-5.6-sol";

export function buildCodexExecOptionsBase(model: string): string[] {
  return buildCodexExecOptionsForProfile(model, "high");
}

export function buildCodexExecOptionsForProfile(model: string, effort: string): string[] {
  return [
    "--yolo",
    "--json",
    "-c",
    "agents.enabled=false",
    "-m",
    model,
    "-c",
    'service_tier="fast"',
    "-c",
    "features.fast_mode=true",
    "-c",
    `model_reasoning_effort=${JSON.stringify(effort)}`,
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
  return buildCodexExecOptionsForRuntimeProfile(cfg, model, "high");
}

export function buildCodexExecOptionsForRuntimeProfile(
  cfg: CodexProviderConfig | null,
  model: string,
  effort: string,
): string[] {
  const base = buildCodexExecOptionsForProfile(model, effort);
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
  effort: string;
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
    `model_reasoning_effort=${JSON.stringify(input.effort)}`,
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

export const MANAGED_PROCESS_MAX_ITEMS_PER_SESSION = 8;
export const MANAGED_PROCESS_MAX_LOG_BYTES = 2 * 1024 * 1024;
export const MANAGED_PROCESS_MAX_LOG_READ_BYTES = 256 * 1024;
export const MANAGED_PROCESS_READINESS_INTERVAL_MS = 250;
export const MANAGED_PROCESS_READINESS_TIMEOUT_MS = 30_000;
export const MANAGED_PROCESS_READINESS_FAILURE_THRESHOLD = 3;
export const MANAGED_PROCESS_STOP_GRACE_MS = 5_000;
export const MANAGED_PROCESS_MCP_PREFLIGHT_TIMEOUT_MS = 5_000;
export const KIMI_MANAGED_TOOL_SETTLE_TIMEOUT_MS = 15_000;

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
