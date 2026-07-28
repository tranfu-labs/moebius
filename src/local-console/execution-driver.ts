import {
  CODEX_PROVIDER_CONFIG,
  buildCodexExecOptionsForRuntimeProfile,
} from "../config.js";
import {
  run as runCodex,
  type CodexRunOptions,
  type CodexRunResult,
} from "../codex.js";
import { runKimiAcp, type KimiAcpRunOptions } from "../kimi.js";
import { resolveKimiRuntimeHomePaths } from "../kimi-runtime-home.js";
import type { LocalConsoleExecutionProfile } from "./types.js";

export type LocalExecutionEngine = "codex" | "kimi";
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
  maxDurationMs?: number;
  onVisibleAgentMarkdown?: (text: string) => void;
  onProcessStarted?: () => void | Promise<void>;
  onStructuredActivity?: (event: unknown) => void;
  onSessionStarted?: (input: {
    engine: LocalExecutionEngine;
    externalSessionId: string;
  }) => void | Promise<void>;
}

export type LocalExecutionRunner = (
  options: LocalExecutionRunOptions,
) => Promise<CodexRunResult>;

export function createLocalExecutionRunner(input: {
  dataRoot?: string;
  runCodex?: (options: CodexRunOptions) => Promise<CodexRunResult>;
  runKimi?: (options: KimiAcpRunOptions) => Promise<CodexRunResult>;
} = {}): LocalExecutionRunner {
  const codex = input.runCodex ?? runCodex;
  const kimi = input.runKimi ?? runKimiAcp;
  const kimiRuntimeHomePaths = input.dataRoot === undefined
    ? undefined
    : resolveKimiRuntimeHomePaths({
        dataRoot: input.dataRoot,
        env: process.env,
      });
  const codexReportsProcessStart = input.runCodex === undefined;
  const kimiReportsProcessStart = input.runKimi === undefined;
  return async (options) => {
    const engine = options.profile?.cli ?? "codex";
    let observedExternalSessionId: string | null = null;
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
        maxDurationMs: options.maxDurationMs,
        runtimeHomePaths: kimiRuntimeHomePaths,
        onVisibleAgentMarkdown: options.onVisibleAgentMarkdown,
        onProcessStarted: options.onProcessStarted,
        onStructuredActivity: options.onStructuredActivity,
        onSessionStarted: async (sessionId) => observeSession("kimi", sessionId),
      });
      assertSuccessfulSessionIdentity(options.mode, observedExternalSessionId, result);
      return result;
    }

    const profile = options.profile;
    if (!codexReportsProcessStart) {
      await options.onProcessStarted?.();
    }
    const result = await codex({
      prompt: options.prompt,
      runDir: options.runDir,
      cwd: options.cwd,
      mode: options.mode.kind === "resume"
        ? { kind: "resume", threadId: options.mode.externalSessionId }
        : { kind: "full" },
      ...(profile === null
        ? {}
        : {
            execOptions: buildCodexExecOptionsForRuntimeProfile(
              CODEX_PROVIDER_CONFIG,
              profile.model,
              profile.effort,
            ),
          }),
      signal: options.signal,
      imagePaths: options.imagePaths,
      idleTimeoutMs: options.idleTimeoutMs,
      maxDurationMs: options.maxDurationMs,
      onVisibleAgentMarkdown: options.onVisibleAgentMarkdown,
      onProcessStarted: options.onProcessStarted,
      onStructuredActivity: options.onStructuredActivity,
      onThreadStarted: async (threadId) => observeSession("codex", threadId),
    });
    assertSuccessfulSessionIdentity(options.mode, observedExternalSessionId, result);
    return result;
  };
}

function assertSuccessfulSessionIdentity(
  mode: LocalExecutionMode,
  observedExternalSessionId: string | null,
  result: CodexRunResult,
): void {
  if (!result.ok) return;
  const resultExternalSessionId = result.threadId ?? observedExternalSessionId;
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
