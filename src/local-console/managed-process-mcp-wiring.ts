import { createHash, randomBytes } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ManagedProcessMcpInvocation } from "./execution-driver.js";
import { createPreflightCache, preflightManagedProcessMcpServer } from "./managed-process-mcp-preflight.js";
import type { ManagedProcessSupervisor } from "./managed-process-supervisor.js";

export interface ManagedProcessPrograms {
  command: string;
  wrapperArgs: string[];
  bridgeArgs: string[];
  environment: Record<string, string>;
}

/** Ordinary one-shot MCP injection for local-console providers. */
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
