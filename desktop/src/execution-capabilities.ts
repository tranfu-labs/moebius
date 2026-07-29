import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import {
  isSupportedCodexCliVersion,
  MINIMUM_CODEX_CLI_VERSION,
} from "../../src/codex-cli-version.js";
import {
  isSupportedClaudeCliVersion,
  MINIMUM_CLAUDE_CLI_VERSION,
} from "../../src/claude-cli-version.js";
import {
  capabilitySnapshotId,
  type ExecutionCapabilityModel,
  type ExecutionCapabilitySnapshot,
} from "./team-execution-profile.js";

const DEFAULT_TIMEOUT_MS = 5_000;

export interface SafeCommandResult {
  stdout: string;
}

export type SafeCommandRunner = (
  command: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<SafeCommandResult>;

export async function probeExecutionCapabilities(input: {
  cli: "codex" | "claude" | "kimi";
  now?: () => Date;
  timeoutMs?: number;
  runCommand?: SafeCommandRunner;
  requestCodexModels?: (timeoutMs: number) => Promise<unknown>;
  knownCliVersion?: string;
}): Promise<ExecutionCapabilitySnapshot> {
  return input.cli === "codex"
    ? probeCodexCapabilities(input)
    : input.cli === "claude"
      ? probeClaudeCapabilities(input)
      : probeKimiCapabilities(input);
}

export async function probeClaudeCapabilities(input: {
  now?: () => Date;
  timeoutMs?: number;
  runCommand?: SafeCommandRunner;
  knownCliVersion?: string;
} = {}): Promise<ExecutionCapabilitySnapshot> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const run = input.runCommand ?? runCommandSafely;
  let version: string | null = null;
  try {
    version = input.knownCliVersion
      ?? ((await run("claude", ["--version"], timeoutMs)).stdout.trim() || null);
    if (version === null) {
      throw new CapabilityProbeError("CLI_UNAVAILABLE", "Claude Code 没有返回版本信息。");
    }
    if (!isSupportedClaudeCliVersion(version)) {
      throw new CapabilityProbeError(
        "CLI_VERSION_UNSUPPORTED",
        `Claude Code 版本过旧，需要 ${MINIMUM_CLAUDE_CLI_VERSION} 或更高版本。`,
      );
    }
    const auth = parseClaudeAuthStatus(
      JSON.parse((await run("claude", ["auth", "status", "--json"], timeoutMs)).stdout),
    );
    if (!auth.loggedIn) {
      throw new CapabilityProbeError(
        "AUTHENTICATION_REQUIRED",
        "Claude Code 尚未登录。",
      );
    }
    return makeSnapshot({
      cli: "claude",
      cliVersion: version,
      status: "available",
      models: claudeStaticModels(),
      checkedAt: (input.now ?? (() => new Date()))().toISOString(),
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return failedSnapshot(
        "claude",
        new CapabilityProbeError(
          "CAPABILITY_PROTOCOL_UNAVAILABLE",
          "Claude Code 返回了无法识别的登录状态。",
        ),
        input.now,
        version,
      );
    }
    return failedSnapshot("claude", error, input.now, version);
  }
}

export function parseClaudeAuthStatus(value: unknown): { loggedIn: boolean } {
  if (!isPlainObject(value) || typeof value.loggedIn !== "boolean") {
    throw new CapabilityProbeError(
      "CAPABILITY_PROTOCOL_UNAVAILABLE",
      "Claude Code 返回了无法识别的登录状态。",
    );
  }
  return { loggedIn: value.loggedIn };
}

export function claudeStaticModels(): ExecutionCapabilityModel[] {
  return [
    {
      id: "fable",
      displayName: "fable",
      efforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "high",
    },
    {
      id: "sonnet",
      displayName: "sonnet",
      efforts: ["low", "medium", "high", "max"],
      defaultEffort: "high",
    },
    {
      id: "opus",
      displayName: "opus",
      efforts: ["low", "medium", "high", "max"],
      defaultEffort: "high",
    },
  ];
}

export async function probeCodexCapabilities(input: {
  now?: () => Date;
  timeoutMs?: number;
  runCommand?: SafeCommandRunner;
  requestCodexModels?: (timeoutMs: number) => Promise<unknown>;
  knownCliVersion?: string;
} = {}): Promise<ExecutionCapabilitySnapshot> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const run = input.runCommand ?? runCommandSafely;
  let version: string | null = null;
  try {
    version = input.knownCliVersion
      ?? ((await run("codex", ["--version"], timeoutMs)).stdout.trim() || null);
    if (version === null) {
      throw new CapabilityProbeError("CLI_UNAVAILABLE", "Codex 没有返回版本信息。");
    }
    if (!isSupportedCodexCliVersion(version)) {
      throw new CapabilityProbeError(
        "CLI_VERSION_UNSUPPORTED",
        `Codex CLI 版本过旧，需要 ${MINIMUM_CODEX_CLI_VERSION} 或更高版本。`,
      );
    }
    const result = await (input.requestCodexModels ?? requestCodexModelList)(timeoutMs);
    return makeSnapshot({
      cli: "codex",
      cliVersion: version,
      status: "available",
      models: parseCodexModelList(result),
      checkedAt: (input.now ?? (() => new Date()))().toISOString(),
    });
  } catch (error) {
    return failedSnapshot("codex", error, input.now, version);
  }
}

export async function probeKimiCapabilities(input: {
  now?: () => Date;
  timeoutMs?: number;
  runCommand?: SafeCommandRunner;
  knownCliVersion?: string;
} = {}): Promise<ExecutionCapabilitySnapshot> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const run = input.runCommand ?? runCommandSafely;
  try {
    const version = input.knownCliVersion
      ?? ((await run("kimi", ["--version"], timeoutMs)).stdout.trim() || null);
    if (version === null) {
      throw new CapabilityProbeError("CLI_UNAVAILABLE", "Kimi 没有返回版本信息。");
    }
    const providerList = JSON.parse(
      (await run("kimi", ["provider", "list", "--json"], timeoutMs)).stdout,
    ) as unknown;
    return makeSnapshot({
      cli: "kimi",
      cliVersion: version,
      status: "available",
      models: parseKimiProviderList(providerList),
      checkedAt: (input.now ?? (() => new Date()))().toISOString(),
    });
  } catch (error) {
    return failedSnapshot("kimi", error, input.now);
  }
}

export function parseCodexModelList(value: unknown): ExecutionCapabilityModel[] {
  const result = isPlainObject(value) && isPlainObject(value.result) ? value.result : value;
  const candidates = isPlainObject(result)
    ? Array.isArray(result.data)
      ? result.data
      : Array.isArray(result.models)
        ? result.models
        : []
    : [];
  const models = candidates.flatMap((candidate): ExecutionCapabilityModel[] => {
    if (!isPlainObject(candidate)) {
      return [];
    }
    const id = firstString(candidate.id, candidate.model, candidate.slug);
    if (id === null) {
      return [];
    }
    const rawEfforts = Array.isArray(candidate.supportedReasoningEfforts)
      ? candidate.supportedReasoningEfforts
      : Array.isArray(candidate.supported_reasoning_efforts)
        ? candidate.supported_reasoning_efforts
        : [];
    const efforts = rawEfforts.flatMap((effort): string[] => {
      if (typeof effort === "string" && effort.trim().length > 0) {
        return [effort.trim()];
      }
      if (isPlainObject(effort)) {
        const name = firstString(effort.reasoningEffort, effort.reasoning_effort, effort.id);
        return name === null ? [] : [name];
      }
      return [];
    });
    const defaultEffort = firstString(
      candidate.defaultReasoningEffort,
      candidate.default_reasoning_effort,
    );
    if (defaultEffort !== null && !efforts.includes(defaultEffort)) {
      efforts.push(defaultEffort);
    }
    return [{
      id,
      displayName: firstString(candidate.displayName, candidate.display_name, candidate.name) ?? id,
      efforts: [...new Set(efforts)],
      defaultEffort,
    }];
  });
  if (models.length === 0) {
    throw new CapabilityProbeError("CAPABILITY_PROTOCOL_UNAVAILABLE", "Codex 没有返回可用模型。");
  }
  return models;
}

export function parseKimiProviderList(value: unknown): ExecutionCapabilityModel[] {
  const candidates = collectKimiModelCandidates(value);
  const models = candidates.map(({ id, model }): ExecutionCapabilityModel => {
    const candidate = model;
    const rawEfforts = Array.isArray(candidate.support_efforts)
      ? candidate.support_efforts
      : Array.isArray(candidate.supportEfforts)
        ? candidate.supportEfforts
        : [];
    const efforts = rawEfforts
      .filter((effort): effort is string => typeof effort === "string" && effort.trim().length > 0)
      .map((effort) => effort.trim());
    const offEffort = firstString(candidate.off_effort, candidate.offEffort);
    if (offEffort !== null && !efforts.includes(offEffort)) {
      efforts.push(offEffort);
    }
    const defaultEffort = firstString(candidate.default_effort, candidate.defaultEffort);
    if (defaultEffort !== null && !efforts.includes(defaultEffort)) {
      efforts.push(defaultEffort);
    }
    if (efforts.length === 0 && kimiModelSupportsThinking(candidate)) {
      efforts.push(...(kimiModelAlwaysThinks(candidate) ? ["on"] : ["off", "on"]));
    }
    const effectiveDefaultEffort = defaultEffort
      ?? (efforts.includes("on") ? "on" : null);
    return {
      id,
      displayName: firstString(candidate.display_name, candidate.displayName, candidate.name) ?? id,
      efforts: [...new Set(efforts)],
      defaultEffort: effectiveDefaultEffort,
    };
  });
  if (models.length === 0) {
    if (hasExplicitlyEmptyKimiProviders(value)) {
      throw new CapabilityProbeError("AUTHENTICATION_REQUIRED", "Kimi 尚未配置可用 provider。");
    }
    throw new CapabilityProbeError("CAPABILITY_PROTOCOL_UNAVAILABLE", "Kimi 没有返回可用模型。");
  }
  return models;
}

export async function runCommandSafely(
  command: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<SafeCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new CapabilityProbeError("CAPABILITY_TIMEOUT", "执行引擎能力检查超时。"));
    }, timeoutMs);
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error !== undefined) {
        reject(error);
      } else {
        resolve({ stdout });
      }
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4_096) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      finish(new CapabilityProbeError(
        isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")
          ? "CLI_MISSING"
          : "CLI_UNAVAILABLE",
        isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")
          ? "本机没有找到这套 CLI。"
          : "暂时无法启动这套 CLI。",
      ));
    });
    child.on("exit", (code, signal) => {
      if (code !== 0) {
        finish(new CapabilityProbeError(
          "CLI_UNAVAILABLE",
          signal === null
            ? `CLI 能力检查失败（退出码 ${code ?? "unknown"}）。`
            : "CLI 能力检查被中断。",
        ));
        return;
      }
      finish();
    });
  });
}

async function requestCodexModelList(timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      env: process.env,
    });
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new CapabilityProbeError("CAPABILITY_TIMEOUT", "Codex 模型能力检查超时。"));
    }, timeoutMs);
    const finish = (error?: Error, value?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      if (error !== undefined) reject(error);
      else resolve(value);
    };
    child.on("error", (error) => {
      finish(new CapabilityProbeError(
        isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")
          ? "CLI_MISSING"
          : "CLI_UNAVAILABLE",
        isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")
          ? "本机没有找到 Codex CLI。"
          : "暂时无法启动 Codex CLI。",
      ));
    });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      let message: unknown;
      try {
        message = JSON.parse(line) as unknown;
      } catch {
        return;
      }
      if (!isPlainObject(message)) return;
      if (message.id === 1) {
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);
        child.stdin.write(`${JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "account/read",
          params: { refreshToken: false },
        })}\n`);
      } else if (message.id === 2) {
        if (message.error !== undefined) {
          finish(new CapabilityProbeError(
            "CAPABILITY_PROTOCOL_UNAVAILABLE",
            "Codex 当前版本不支持认证状态读取。",
          ));
        } else if (codexAccountRequiresLogin(message)) {
          finish(new CapabilityProbeError(
            "AUTHENTICATION_REQUIRED",
            "Codex 尚未登录。",
          ));
        } else {
          child.stdin.write(`${JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "model/list",
            params: {},
          })}\n`);
        }
      } else if (message.id === 3) {
        if (message.error !== undefined) {
          finish(new CapabilityProbeError(
            "CAPABILITY_PROTOCOL_UNAVAILABLE",
            "Codex 当前版本不支持模型能力读取。",
          ));
        } else {
          finish(undefined, message);
        }
      }
    });
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "moebius", version: "1" },
        capabilities: {},
      },
    })}\n`);
  });
}

function makeSnapshot(input: Omit<ExecutionCapabilitySnapshot, "snapshotId">): ExecutionCapabilitySnapshot {
  return {
    ...input,
    snapshotId: capabilitySnapshotId(input),
  };
}

function failedSnapshot(
  cli: "codex" | "claude" | "kimi",
  error: unknown,
  now?: () => Date,
  cliVersion: string | null = null,
): ExecutionCapabilitySnapshot {
  const missing = error instanceof CapabilityProbeError && error.code === "CLI_MISSING";
  return makeSnapshot({
    cli,
    cliVersion,
    status: missing ? "missing" : "unavailable",
    models: [],
    checkedAt: (now ?? (() => new Date()))().toISOString(),
    reason: error instanceof CapabilityProbeError
      ? error.safeMessage
      : "暂时无法读取这套 CLI 的模型能力。",
    ...(error instanceof CapabilityProbeError ? { failureCode: error.code } : {}),
  });
}

interface KimiModelCandidate {
  id: string;
  model: Record<string, unknown>;
}

function collectKimiModelCandidates(value: unknown): KimiModelCandidate[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectKimiModelCandidates);
  }
  if (!isPlainObject(value)) {
    return [];
  }
  if (isPlainObject(value.models)) {
    return Object.entries(value.models).flatMap(([alias, model]): KimiModelCandidate[] => (
      alias.trim().length > 0 && isPlainObject(model)
        ? [{ id: alias, model }]
        : []
    ));
  }
  const direct = firstString(value.alias, value.model, value.id) !== null
    && (
      Array.isArray(value.support_efforts)
      || Array.isArray(value.supportEfforts)
      || value.default_effort !== undefined
      || value.defaultEffort !== undefined
      || kimiModelSupportsThinking(value)
    );
  if (direct) {
    return [{
      id: firstString(value.alias, value.id, value.model)!,
      model: value,
    }];
  }
  return Object.values(value).flatMap(collectKimiModelCandidates);
}

function hasExplicitlyEmptyKimiProviders(value: unknown): boolean {
  if (!isPlainObject(value) || !Object.hasOwn(value, "providers")) {
    return false;
  }
  return Array.isArray(value.providers)
    ? value.providers.length === 0
    : isPlainObject(value.providers) && Object.keys(value.providers).length === 0;
}

function codexAccountRequiresLogin(message: Record<string, unknown>): boolean {
  if (!isPlainObject(message.result)) {
    return false;
  }
  return message.result.account === null && message.result.requiresOpenaiAuth === true;
}

function kimiModelSupportsThinking(model: Record<string, unknown>): boolean {
  const capabilities = Array.isArray(model.capabilities)
    ? model.capabilities
      .filter((capability): capability is string => typeof capability === "string")
      .map((capability) => capability.trim().toLowerCase())
    : [];
  if (capabilities.includes("thinking") || capabilities.includes("always_thinking")) {
    return true;
  }
  const upstreamModel = firstString(model.model);
  if (upstreamModel === null) return false;
  const normalizedModel = upstreamModel.toLowerCase();
  return (
    normalizedModel.includes("thinking")
    || normalizedModel.includes("reason")
    || normalizedModel === "kimi-for-coding"
    || normalizedModel === "kimi-code"
  );
}

function kimiModelAlwaysThinks(model: Record<string, unknown>): boolean {
  return Array.isArray(model.capabilities)
    && model.capabilities.some(
      (capability) => typeof capability === "string"
        && capability.trim().toLowerCase() === "always_thinking",
    );
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export class CapabilityProbeError extends Error {
  constructor(
    readonly code:
      | "CLI_MISSING"
      | "CLI_UNAVAILABLE"
      | "CLI_VERSION_UNSUPPORTED"
      | "AUTHENTICATION_REQUIRED"
      | "CAPABILITY_TIMEOUT"
      | "CAPABILITY_PROTOCOL_UNAVAILABLE",
    readonly safeMessage: string,
  ) {
    super(safeMessage);
    this.name = "CapabilityProbeError";
  }
}
