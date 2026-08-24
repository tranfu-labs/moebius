import {
  CODEX_EXEC_OPTIONS,
  CODEX_PROVIDER_CONFIG,
  buildCodexExecOptionsForRuntimeProfile,
} from "../config.js";
import type { ClaudeTuiTerminalData } from "../claude-tui-transport.js";
import {
  run as runCodex,
  type CodexRunOptions,
  type CodexRunResult,
} from "../codex.js";
import {
  runClaude,
  type ClaudeRunOptions,
  type ClaudeTuiNativePromptDecision,
} from "../claude.js";
import { runKimiAcp, type KimiAcpRunOptions } from "../kimi.js";
import { resolveKimiRuntimeHomePaths } from "../kimi-runtime-home.js";
import { planRuntimeFallback } from "./runtime-domain.js";
import type { ExecutionProgressEvent } from "../execution-contract.js";
import type { LocalConsoleExecutionProfile } from "./types.js";

export interface ManagedProcessMcpInvocation {
  command: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  preflight?(): Promise<void>;
  onToolCompletion?(listener: (event: ManagedProcessToolCompletion) => void): () => void;
  close(): void | Promise<void>;
}

export interface ManagedProcessToolCompletion {
  providerRunId: string;
  toolCallId: string;
  completionKind: "completed" | "failed";
  completedAt: string;
}

export type LocalExecutionEngine = "codex" | "claude" | "kimi" | "pi";
export type LocalExecutionMode =
  | { kind: "full" }
  | { kind: "resume"; externalSessionId: string };

export interface LocalExecutionRunOptions {
  prompt: string;
  runDir: string;
  cwd: string;
  profile: LocalConsoleExecutionProfile | null;
  mode: LocalExecutionMode;
  signal?: AbortSignal;
  imagePaths?: string[];
  idleTimeoutMs?: number;
  toolTimeoutMs?: number;
  maxDurationMs?: number;
  workspaceAccess?: "read-write" | "read-only";
  managedProcess?: { sessionId: string; providerRunId: string };
  onVisibleAgentMarkdown?: (text: string) => void;
  onTerminalData?: (data: ClaudeTuiTerminalData) => void;
  onNativePrompt?: (decision: ClaudeTuiNativePromptDecision) => void;
  onProcessStarted?: () => void | Promise<void>;
  onStructuredActivity?: (event: unknown) => void;
  onExecutionProgress?: (event: ExecutionProgressEvent) => void;
  onSessionStarted?: (input: {
    engine: LocalExecutionEngine;
    externalSessionId: string;
  }) => void | Promise<void>;
  onExecutionTraceReady?: (input: {
    engine: LocalExecutionEngine;
    externalSessionId: string;
    tracePath?: string;
  }) => void | Promise<void>;
}

export type PiExecutionRunOptions = LocalExecutionRunOptions & {
  profile: Extract<LocalConsoleExecutionProfile, { cli: "pi" }>;
  mcpServer?: ManagedProcessMcpInvocation;
};

export type LocalExecutionRunner = (
  options: LocalExecutionRunOptions,
) => Promise<CodexRunResult>;

export function createLocalExecutionRunner(input: {
  dataRoot?: string;
  runCodex?: (options: CodexRunOptions) => Promise<CodexRunResult>;
  runClaude?: (options: ClaudeRunOptions) => Promise<CodexRunResult>;
  /** The supplied Claude adapter owns its stable relay and per-turn lease. */
  claudeOwnsManagedProcess?: boolean;
  /** The supplied Claude adapter reports process/run activation at PTY start. */
  claudeReportsProcessStart?: boolean;
  runKimi?: (options: KimiAcpRunOptions) => Promise<CodexRunResult>;
  runPi?: (options: PiExecutionRunOptions) => Promise<CodexRunResult>;
  createManagedProcessMcp?: (input: {
    sessionId: string;
    providerRunId: string;
    workspaceRoot: string;
  }) => ManagedProcessMcpInvocation | Promise<ManagedProcessMcpInvocation>;
} = {}): LocalExecutionRunner {
  const codex = input.runCodex ?? runCodex;
  const claude = input.runClaude ?? runClaude;
  const kimi = input.runKimi ?? runKimiAcp;
  const kimiRuntimeHomePaths = input.dataRoot === undefined
    ? undefined
    : resolveKimiRuntimeHomePaths({
        dataRoot: input.dataRoot,
        env: process.env,
      });
  const codexReportsProcessStart = input.runCodex === undefined;
  const claudeReportsProcessStart = input.claudeReportsProcessStart ?? input.runClaude === undefined;
  const kimiReportsProcessStart = input.runKimi === undefined;
  return async (options) => {
    const engine = options.profile?.cli ?? "codex";
    const claudeOwnsManagedProcess = engine === "claude" && input.claudeOwnsManagedProcess === true;
    const managedMcp = claudeOwnsManagedProcess || options.managedProcess === undefined || input.createManagedProcessMcp === undefined
      ? null
      : await input.createManagedProcessMcp({
          ...options.managedProcess,
          workspaceRoot: options.cwd,
        });
    try {
    await managedMcp?.preflight?.();
    let observedExternalSessionId: string | null = null;
    let traceReadyExternalSessionId: string | null = null;
    const observeSession = async (
      observedEngine: LocalExecutionEngine,
      externalSessionId: string,
    ): Promise<void> => {
      if (
        options.mode.kind === "resume"
        && externalSessionId !== options.mode.externalSessionId
      ) {
        throw new Error(
          `provider-session-id-mismatch:${options.mode.externalSessionId}:${externalSessionId}`,
        );
      }
      if (
        observedExternalSessionId !== null
        && observedExternalSessionId !== externalSessionId
      ) {
        throw new Error("provider-reported-conflicting-session-ids");
      }
      observedExternalSessionId = externalSessionId;
      await options.onSessionStarted?.({
        engine: observedEngine,
        externalSessionId,
      });
    };
    const markExecutionTraceReady = async (
      observedEngine: LocalExecutionEngine,
      externalSessionId: string,
      tracePath?: string,
    ): Promise<void> => {
      if (observedExternalSessionId === null) {
        throw new Error("provider-execution-trace-ready-before-session-observed");
      }
      if (observedExternalSessionId !== externalSessionId) {
        throw new Error("provider-execution-trace-session-id-conflict");
      }
      if (traceReadyExternalSessionId !== null) {
        if (traceReadyExternalSessionId !== externalSessionId) {
          throw new Error("provider-reported-conflicting-execution-trace-ids");
        }
        return;
      }
      traceReadyExternalSessionId = externalSessionId;
      await options.onExecutionTraceReady?.({
        engine: observedEngine,
        externalSessionId,
        ...(tracePath === undefined ? {} : { tracePath }),
      });
    };
    const observeSessionAndTrace = async (
      observedEngine: LocalExecutionEngine,
      externalSessionId: string,
    ): Promise<void> => {
      await observeSession(observedEngine, externalSessionId);
      await markExecutionTraceReady(observedEngine, externalSessionId);
    };
    const finishProviderRun = async (
      observedEngine: LocalExecutionEngine,
      result: CodexRunResult,
    ): Promise<CodexRunResult> => {
      if (
        result.ok
        && observedEngine === "kimi"
        && observedExternalSessionId === null
        && result.threadId !== null
      ) {
        await observeSession(observedEngine, result.threadId);
      }
      assertSuccessfulSessionIdentity(options.mode, observedExternalSessionId, result);
      if (result.ok && observedExternalSessionId !== null) {
        await markExecutionTraceReady(
          observedEngine,
          planRuntimeFallback(result.threadId, observedExternalSessionId),
        );
      }
      return result;
    };
    if (engine === "claude") {
      const profile = options.profile;
      if (profile === null || profile.cli !== "claude") {
        throw new Error("Claude execution requires a complete Claude profile");
      }
      if (!claudeReportsProcessStart) {
        await options.onProcessStarted?.();
      }
      const result = await claude({
        prompt: options.prompt,
        runDir: options.runDir,
        cwd: options.cwd,
        profile: { ...profile, cli: "claude" },
        mode: options.mode,
        signal: options.signal,
        idleTimeoutMs: options.idleTimeoutMs,
        toolTimeoutMs: options.toolTimeoutMs,
        maxDurationMs: options.maxDurationMs,
        onVisibleAgentMarkdown: options.onVisibleAgentMarkdown,
        onTerminalData: options.onTerminalData,
        onNativePrompt: options.onNativePrompt,
        onProcessStarted: options.onProcessStarted,
        onStructuredActivity: options.onStructuredActivity,
        onExecutionProgress: options.onExecutionProgress,
        mcpServer: managedMcp,
        managedProcess: options.managedProcess,
        onSessionStarted: async (sessionId) => observeSessionAndTrace("claude", sessionId),
      });
      return await finishProviderRun("claude", result);
    }
    if (engine === "kimi") {
      const profile = options.profile;
      if (profile === null || profile.cli !== "kimi") {
        throw new Error("Kimi execution requires a complete Kimi profile");
      }
      if (!kimiReportsProcessStart) {
        await options.onProcessStarted?.();
      }
      const result = await kimi({
        prompt: options.prompt,
        runDir: options.runDir,
        cwd: options.cwd,
        profile: { ...profile, cli: "kimi" },
        mode: options.mode,
        signal: options.signal,
        imagePaths: options.imagePaths,
        idleTimeoutMs: options.idleTimeoutMs,
        toolTimeoutMs: options.toolTimeoutMs,
        maxDurationMs: options.maxDurationMs,
        workspaceAccess: options.workspaceAccess,
        runtimeHomePaths: kimiRuntimeHomePaths,
        onVisibleAgentMarkdown: options.onVisibleAgentMarkdown,
        onProcessStarted: options.onProcessStarted,
        onStructuredActivity: options.onStructuredActivity,
        onExecutionProgress: options.onExecutionProgress,
        mcpServer: managedMcp,
        onSessionStarted: async (sessionId) => observeSession("kimi", sessionId),
        onExecutionTraceReady: async (sessionId) =>
          markExecutionTraceReady("kimi", sessionId),
      });
      return await finishProviderRun("kimi", result);
    }
    if (engine === "pi") {
      const profile = options.profile;
      if (profile === null || profile.cli !== "pi" || input.runPi === undefined) {
        throw new Error("Pi execution requires a complete Pi profile and desktop Pi adapter");
      }
      const result = await input.runPi({
        ...options,
        profile,
        ...(managedMcp === null ? {} : { mcpServer: managedMcp }),
        onSessionStarted: async ({ engine: reportedEngine, externalSessionId }) => {
          if (reportedEngine !== "pi") throw new Error("pi-reported-conflicting-engine");
          await observeSession("pi", externalSessionId);
        },
        onExecutionTraceReady: async ({ engine: reportedEngine, externalSessionId, tracePath }) => {
          if (reportedEngine !== "pi") throw new Error("pi-reported-conflicting-engine");
          await markExecutionTraceReady("pi", externalSessionId, tracePath);
        },
      });
      return await finishProviderRun("pi", result);
    }

    const profile = options.profile;
    if (!codexReportsProcessStart) {
      await options.onProcessStarted?.();
    }
    const configuredExecOptions = profile === null
      ? (managedMcp === null ? undefined : CODEX_EXEC_OPTIONS)
      : buildCodexExecOptionsForRuntimeProfile(
          CODEX_PROVIDER_CONFIG,
          profile.model,
          profile.effort,
        );
    const result = await codex({
      prompt: options.prompt,
      runDir: options.runDir,
      cwd: options.cwd,
      mode: options.mode.kind === "resume"
        ? { kind: "resume", threadId: options.mode.externalSessionId }
        : { kind: "full" },
      execOptions: withCodexSandbox(
        withCodexManagedProcessMcp(configuredExecOptions, managedMcp),
        options.workspaceAccess === "read-only" ? "read-only" : null,
      ),
      signal: options.signal,
      imagePaths: options.imagePaths,
      idleTimeoutMs: options.idleTimeoutMs,
      toolTimeoutMs: options.toolTimeoutMs,
      maxDurationMs: options.maxDurationMs,
      onVisibleAgentMarkdown: options.onVisibleAgentMarkdown,
      onProcessStarted: options.onProcessStarted,
      onStructuredActivity: options.onStructuredActivity,
      onExecutionProgress: options.onExecutionProgress,
      onThreadStarted: async (threadId) => observeSessionAndTrace("codex", threadId),
    });
    return await finishProviderRun("codex", result);
    } finally {
      await managedMcp?.close();
    }
  };
}

export function withCodexManagedProcessMcp(
  options: readonly string[] | undefined,
  mcp: ManagedProcessMcpInvocation | null,
): string[] | undefined {
  if (mcp === null) return options === undefined ? undefined : [...options];
  return [
    ...(options ?? []),
    "-c", `mcp_servers.moebius_managed.command=${JSON.stringify(mcp.command)}`,
    "-c", `mcp_servers.moebius_managed.args=${JSON.stringify(mcp.args)}`,
    "-c", `mcp_servers.moebius_managed.env=${tomlInlineStringMap(mcp.env)}`,
    "-c", "mcp_servers.moebius_managed.required=true",
    "-c", `mcp_servers.moebius_managed.enabled_tools=${JSON.stringify([
      "managed_process_start",
      "managed_process_list",
      "managed_process_inspect",
      "managed_process_read_logs",
      "managed_process_stop",
    ])}`,
    "-c", "mcp_servers.moebius_managed.default_tools_approval_mode=\"approve\"",
  ];
}

function tomlInlineStringMap(values: Readonly<Record<string, string>>): string {
  const entries = Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${JSON.stringify(name)} = ${JSON.stringify(value)}`);
  return `{ ${entries.join(", ")} }`;
}

export function withCodexSandbox(
  options: readonly string[] | undefined,
  sandbox: "read-only" | null,
): string[] | undefined {
  if (sandbox === null) return options === undefined ? undefined : [...options];
  const source = options ?? [];
  const result: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "--sandbox") {
      index += 1;
      continue;
    }
    result.push(source[index]!);
  }
  return [...result, "--sandbox", sandbox];
}

function assertSuccessfulSessionIdentity(
  mode: LocalExecutionMode,
  observedExternalSessionId: string | null,
  result: CodexRunResult,
): void {
  if (!result.ok) return;
  const resultExternalSessionId = planRuntimeFallback(result.threadId, observedExternalSessionId);
  if (resultExternalSessionId === null) {
    throw new Error("provider-session-id-missing");
  }
  if (
    observedExternalSessionId !== null
    && observedExternalSessionId !== resultExternalSessionId
  ) {
    throw new Error("provider-result-session-id-conflict");
  }
  if (
    mode.kind === "resume"
    && resultExternalSessionId !== mode.externalSessionId
  ) {
    throw new Error(
      `provider-session-id-mismatch:${mode.externalSessionId}:${resultExternalSessionId}`,
    );
  }
}
