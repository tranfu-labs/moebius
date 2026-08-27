import { log } from "../log.js";
import { formatLocalError } from "./runtime-domain.js";
import type { createLocalRuntimeRunWiring } from "./runtime-run-wiring.js";

type RunWiringInput = Parameters<typeof createLocalRuntimeRunWiring>[0];
type RunWiringPorts = Pick<
  RunWiringInput,
  | "scheduleRun"
  | "processPending"
  | "executeWorkerChildSession"
  | "executePrimaryChildSession"
  | "recordChildSessionCardError"
  | "scheduleWorker"
  | "primaryReport"
  | "flushWorkspaceCleanup"
>;

/**
 * 装配端口集中层：run wiring 需要的回调（由 runtime 的 late-bound 成员提供）
 * 统一在这里转成 createLocalRuntimeRunWiring 的端口形状。runtime（composition
 * root）只提供一行一个的 binding，具体闭包体住在这里，避免装配细节堆在 root。
 */
export function planLocalRunWiringPorts(bindings: {
  setLastError(error: string | null): void;
  processPending(sessionId: string): Promise<void>;
  workerExecutionRun: RunWiringInput["scheduleRun"];
  workerDispatchSchedule: RunWiringInput["scheduleWorker"];
  executeChildOrchestration(input: {
    sessionId: string;
    runId: string;
    runDir: string;
    finalText: string;
    availableAgentNames: string[];
  }): Promise<{ sourceId: string; childSessionIds: string[] } | null>;
  recordVisibleChildFailure(sessionId: string, reason: string): Promise<void>;
  flushWorkspaceCleanup(): Promise<void>;
}): RunWiringPorts {
  return {
    scheduleRun: bindings.workerExecutionRun,
    processPending: (sessionId) => {
      void bindings.processPending(sessionId);
    },
    executeWorkerChildSession: (run, _runDir, result) => bindings.executeChildOrchestration({
      sessionId: run.sessionId,
      runId: run.runId,
      runDir: result.runDir,
      finalText: result.finalText,
      availableAgentNames: run.agentFiles.map((agent) => agent.name),
    }),
    executePrimaryChildSession: (run, result) => bindings.executeChildOrchestration({
      sessionId: run.sessionId,
      runId: run.runId,
      runDir: result.runDir,
      finalText: result.finalText,
      availableAgentNames: run.agentFiles.map((agent) => agent.name),
    }),
    recordChildSessionCardError: async (sessionId, error) => {
      const reason = formatLocalError(error);
      bindings.setLastError(reason);
      await bindings.recordVisibleChildFailure(sessionId, reason);
    },
    scheduleWorker: bindings.workerDispatchSchedule,
    primaryReport: (event, error) => log({ event, error }),
    flushWorkspaceCleanup: bindings.flushWorkspaceCleanup,
  };
}
