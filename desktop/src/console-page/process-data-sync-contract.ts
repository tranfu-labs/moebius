import type {
  OperatorProcessDebugInvocation,
  OperatorProcessOutput,
  OperatorProcessInvocationState,
  OperatorProcessOutputState,
} from "@moebius/console-ui";

import type { ProcessOutputUpdate } from "./console-process-model.js";

export interface ProcessDataSyncPort {
  loadOutput(input: {
    apiBase: string;
    sessionId: string;
    runId: string;
    cursor?: string;
    signal?: AbortSignal;
  }): Promise<OperatorProcessOutput>;
  loadUpdate(input: {
    apiBase: string;
    sessionId: string;
    runId: string;
    appendCursor: string;
    currentStatus: "running" | "settled";
    signal?: AbortSignal;
  }): Promise<ProcessOutputUpdate>;
  loadInvocation(input: {
    apiBase: string;
    sessionId: string;
    runId: string;
    signal?: AbortSignal;
  }): Promise<OperatorProcessDebugInvocation>;
}

export type ProcessInvocationState = OperatorProcessInvocationState;
export type ProcessOutputState = OperatorProcessOutputState;
