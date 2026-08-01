import type { createLocalWorkerWiring } from "./worker-wiring.js";

type WorkerWiringInput = Parameters<typeof createLocalWorkerWiring>[0];
type SharedRunPorts = Pick<WorkerWiringInput,
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
>;

export function createLocalSharedRunPorts(input: SharedRunPorts): SharedRunPorts {
  return input;
}
