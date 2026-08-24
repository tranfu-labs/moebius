import { createHash, randomBytes } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ClaudeTuiRuntime,
  createClaudeTuiRunner,
  type ClaudeTuiNativePromptSelectionInput,
  type ClaudeTuiNativePromptSelectionResult,
} from "../claude.js";
import type { ClaudeTuiLifecycleReceiver } from "../claude-tui-lifecycle.js";
import { ClaudeTuiManagedProcessLease } from "./claude-tui-managed-process-lease.js";
import type { ManagedProcessMcpInvocation } from "./execution-driver.js";
import { createPreflightCache, preflightManagedProcessMcpServer } from "./managed-process-mcp-preflight.js";
import type { ManagedProcessSupervisor } from "./managed-process-supervisor.js";

export interface ManagedProcessPrograms {
  command: string;
  wrapperArgs: string[];
  bridgeArgs: string[];
  environment: Record<string, string>;
}

/**
 * Creates the ordinary-Claude adapter at the local-console composition edge.
 * AI Team Builder supplies its own isolated print-mode adapter and never
 * reaches this wiring.
 */
export function createLocalClaudeTuiRuntimeWiring(input: {
  lifecycleReceiver: ClaudeTuiLifecycleReceiver;
  supervisor: ManagedProcessSupervisor;
  managedCapabilityRoot: string;
  managedPrograms: ManagedProcessPrograms;
  hasCustomCodexRunner: boolean;
  hasCustomClaudeRunner: boolean;
  hasCustomExecutionRunner: boolean;
}): {
  runClaude: ReturnType<typeof createClaudeTuiRunner> | undefined;
  selectNativePrompt: ((input: ClaudeTuiNativePromptSelectionInput) => ClaudeTuiNativePromptSelectionResult) | undefined;
  claudeOwnsManagedProcess: boolean;
  claudeReportsProcessStart: boolean;
  close(): Promise<void>;
} {
  const createRuntime = !input.hasCustomExecutionRunner && !input.hasCustomClaudeRunner;
  const claudeOwnsManagedProcess = createRuntime && !input.hasCustomCodexRunner;
  const runtime = createRuntime
    ? new ClaudeTuiRuntime({
        lifecycleReceiver: input.lifecycleReceiver,
        ...(claudeOwnsManagedProcess ? {
          createManagedProcessLease: ({ sessionId, canonicalSessionId, workspaceRoot }) =>
            new ClaudeTuiManagedProcessLease({
              supervisor: input.supervisor,
              sessionId,
              workspaceRoot,
              capabilityPath: path.join(
                input.managedCapabilityRoot,
                `claude-tui-${createHash("sha256").update(`${sessionId}\0${canonicalSessionId}`).digest("hex").slice(0, 32)}.token`,
              ),
              relayProgram: {
                command: input.managedPrograms.command,
                bridgeArgs: input.managedPrograms.bridgeArgs,
                environment: input.managedPrograms.environment,
              },
            }),
        } : {}),
      })
    : null;
  return {
    runClaude: runtime === null ? undefined : createClaudeTuiRunner(runtime),
    selectNativePrompt: runtime === null ? undefined : (input) => runtime.selectNativePrompt(input),
    claudeOwnsManagedProcess,
    claudeReportsProcessStart: runtime !== null,
    close: async () => await runtime?.close(),
  };
}

/** Ordinary one-shot MCP injection for Codex, Kimi, and Pi. */
export function createLocalManagedProcessMcpFactory(input: {
  supervisor: ManagedProcessSupervisor;
  managedCapabilityRoot: string;
  managedPrograms: ManagedProcessPrograms;
}): (input: {
  sessionId: string;
  providerRunId: string;
  workspaceRoot: string;
}) => Promise<ManagedProcessMcpInvocation> {
  // The bridge program is fixed for this application lifetime. Cache only a
  // successful tool-face probe; a failed probe remains retryable per run.
  const runPreflight = createPreflightCache();
  return async ({ sessionId, providerRunId, workspaceRoot }) => {
    const capability = input.supervisor.createCapability({ sessionId, providerRunId, workspaceRoot });
    const capabilityPath = path.join(
      input.managedCapabilityRoot,
      `${createHash("sha256").update(providerRunId).digest("hex").slice(0, 16)}-${randomBytes(12).toString("hex")}.token`,
    );
    try {
      await writeFile(capabilityPath, capability.token, { encoding: "utf8", mode: 0o600, flag: "wx" });
    } catch (error) {
      input.supervisor.revokeCapability(capability.token);
      throw error;
    }
    const invocation: Omit<ManagedProcessMcpInvocation, "preflight"> = {
      command: input.managedPrograms.command,
      args: [...input.managedPrograms.bridgeArgs, capability.socketPath, capabilityPath],
      env: input.managedPrograms.environment,
      onToolCompletion: (listener) => input.supervisor.onToolCompletion(providerRunId, listener),
      close: async () => {
        input.supervisor.revokeCapability(capability.token);
        await unlink(capabilityPath).catch(() => undefined);
      },
    };
    return {
      ...invocation,
      preflight: () => runPreflight(() => preflightManagedProcessMcpServer(invocation)),
    };
  };
}
