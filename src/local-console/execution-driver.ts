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
  onSessionStarted?: (input: {
    engine: LocalExecutionEngine;
    externalSessionId: string;
  }) => void | Promise<void>;
}

export type LocalExecutionRunner = (
  options: LocalExecutionRunOptions,
) => Promise<CodexRunResult>;

export function createLocalExecutionRunner(input: {
  runCodex?: (options: CodexRunOptions) => Promise<CodexRunResult>;
  runKimi?: (options: KimiAcpRunOptions) => Promise<CodexRunResult>;
} = {}): LocalExecutionRunner {
  const codex = input.runCodex ?? runCodex;
  const kimi = input.runKimi ?? runKimiAcp;
  return async (options) => {
    const engine = options.profile?.cli ?? "codex";
    if (engine === "kimi") {
      const profile = options.profile;
      if (profile === null || profile.cli !== "kimi") {
        throw new Error("Kimi execution requires a complete Kimi profile");
      }
      return kimi({
        prompt: options.prompt,
        runDir: options.runDir,
        cwd: options.cwd,
        profile: { ...profile, cli: "kimi" },
        mode: options.mode,
        signal: options.signal,
        imagePaths: options.imagePaths,
        idleTimeoutMs: options.idleTimeoutMs,
        maxDurationMs: options.maxDurationMs,
        onVisibleAgentMarkdown: options.onVisibleAgentMarkdown,
        onSessionStarted: async (sessionId) => options.onSessionStarted?.({
          engine: "kimi",
          externalSessionId: sessionId,
        }),
      });
    }

    const profile = options.profile;
    return codex({
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
      onThreadStarted: async (threadId) => options.onSessionStarted?.({
        engine: "codex",
        externalSessionId: threadId,
      }),
    });
  };
}
