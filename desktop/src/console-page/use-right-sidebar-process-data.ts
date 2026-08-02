import { useMemo } from "react";

import type { ProcessDataSyncPort } from "./process-data-sync-contract.js";
import { useProcessInvocationData } from "./use-process-invocation-data.js";
import { useProcessOutputData } from "./use-process-output-data.js";

export function useRightSidebarProcessData(
  apiBase: string | null,
  activeSourceKey: string | null,
  selectedSessionId: string,
  hostSessionId: string,
  port: ProcessDataSyncPort,
  invocationKey: (sessionId: string, runId: string) => string,
  setError: (error: string | null) => void,
) {
  const output = useProcessOutputData(
    apiBase, activeSourceKey, selectedSessionId, hostSessionId, port, setError,
  );
  const invocation = useProcessInvocationData(apiBase, hostSessionId, port, invocationKey);
  return useMemo(() => ({
    outputs: output.outputs,
    loadPrevious: output.loadPrevious,
    invocations: invocation.invocations,
    readInvocation: invocation.readInvocation,
  }), [invocation, output]);
}
