import type { createLocalWorkerWiring } from "./worker-wiring.js";
import type { LocalClaudeTerminalTraceStore } from "./claude-terminal-trace-store.js";

export interface SharedClaudeTerminalTracePort {
  traceStore: LocalClaudeTerminalTraceStore;
}

type WorkerWiringInput = Parameters<typeof createLocalWorkerWiring>[0];
export type SharedRunPorts = Pick<WorkerWiringInput,
  | "storePorts"
  | "executionRunner"
  | "activeRuns"
  | "lifecycle"
  | "idleTimeoutMs"
  | "toolTimeoutMs"
  | "now"
  | "nowIso"
  | "resolveWorkspace"
  | "readAgentFile"
  | "loadRecoverySnapshot"
  | "isCodexThreadAvailable"
  | "settleUnavailable"
> & SharedClaudeTerminalTracePort;

export function createLocalSharedRunPorts(input: SharedRunPorts): SharedRunPorts {
  return input;
}
