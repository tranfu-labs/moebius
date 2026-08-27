import type { ClaudeRunOptions } from "../claude.js";
import { runClaudeAgentSdk } from "../claude-agent-sdk.js";
import type {
  ClaudeAgentSdkRunOptions,
  ClaudeAgentSdkRunResult,
} from "../claude-agent-sdk.js";
import type { CodexRunResult } from "../codex.js";
import {
  executionInterruptionCause,
  type ExecutionInterruptionCause,
} from "../execution-contract.js";
import { planExecutionFailureTerminal } from "../execution-failure-plan.js";

/**
 * Adapts the shared Claude Agent SDK provider contract to the local-console
 * execution result contract. The execution driver remains the owner of the
 * invocation-scoped managed MCP capability, so this adapter does not close it.
 */
export function createLocalClaudeAgentSdkRunner(input: {
  run?: (options: ClaudeAgentSdkRunOptions) => Promise<ClaudeAgentSdkRunResult>;
} = {}):
  (options: ClaudeRunOptions) => Promise<CodexRunResult> {
  const run = input.run ?? runClaudeAgentSdk;
  return async (options) => {
    const result = await run({
      prompt: options.prompt,
      runDir: options.runDir,
      cwd: options.cwd,
      profile: {
        kind: "ordinary",
        model: options.profile.model,
        effort: options.profile.effort,
        ...(options.permissionMode === undefined ? {} : { permissionMode: options.permissionMode }),
      },
      mode: options.mode,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.executablePath === undefined ? {} : { executablePath: options.executablePath }),
      ...(options.resolveExecutable === undefined ? {} : { resolveExecutable: options.resolveExecutable }),
      ...(options.runVersion === undefined ? {} : { runVersion: options.runVersion }),
      ...(options.versionTimeoutMs === undefined ? {} : { versionTimeoutMs: options.versionTimeoutMs }),
      mcpServer: options.mcpServer,
      closeMcpServer: false,
      onProcessStarted: options.onProcessStarted,
      onStructuredActivity: options.onStructuredActivity,
      onSessionStarted: options.onSessionStarted,
    });
    return toLocalConsoleResult(result, options.signal);
  };
}

function toLocalConsoleResult(
  result: ClaudeAgentSdkRunResult,
  signal: AbortSignal | undefined,
): CodexRunResult {
  if (result.ok) {
    return {
      ok: true,
      finalText: result.finalText,
      threadId: result.sessionId,
      cachedInputTokens: result.usage.cachedInputTokens,
      runDir: result.runDir,
      stdoutPath: result.stdoutPath,
      stderrPath: result.stderrPath,
      terminal: {
        kind: "completed",
        externalSessionId: result.sessionId,
        finalText: result.finalText,
      },
    };
  }

  const interruptionCause = result.failure.code === "claude-cancelled"
    ? executionInterruptionCause(signal?.reason)
    : null;
  return {
    ok: false,
    reason: result.failure.code,
    failure: result.failure,
    ...(result.sessionId === null ? {} : { threadId: result.sessionId }),
    terminal: interruptionCause === null
      ? planExecutionFailureTerminal(result.failure, result.partialText)
      : interruptionTerminal(interruptionCause, result.partialText),
    runDir: result.runDir,
    stdoutPath: result.stdoutPath,
    stderrPath: result.stderrPath,
  };
}

function interruptionTerminal(
  cause: ExecutionInterruptionCause,
  partialText: string,
): Extract<NonNullable<CodexRunResult["terminal"]>, { kind: "interrupted" }> {
  return {
    kind: "interrupted",
    actor: cause === "user" ? "user" : "system",
    cause,
    partialText,
  };
}
