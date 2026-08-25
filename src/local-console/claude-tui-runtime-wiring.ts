import { createHash } from "node:crypto";
import path from "node:path";

import { ClaudeTuiRuntime, createClaudeTuiRunner } from "../claude.js";
import type { ClaudeTuiLifecycleReceiver } from "../claude-tui-lifecycle.js";
import { ClaudeTuiManagedProcessLease } from "./claude-tui-managed-process-lease.js";
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
    claudeOwnsManagedProcess,
    claudeReportsProcessStart: runtime !== null,
    close: async () => await runtime?.close(),
  };
}

export { createLocalManagedProcessMcpFactory } from "./managed-process-mcp-wiring.js";
