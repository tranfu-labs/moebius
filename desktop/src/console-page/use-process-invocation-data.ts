import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ProcessInvocationRequestCoordinator } from "./console-state-coordinator.js";
import {
  decideProcessInvocationCommit,
  planProcessInvocationReady,
  planProcessInvocationRequest,
} from "./console-process-model.js";
import { planConsoleErrorMessage } from "./console-state-plan.js";
import type { ProcessDataSyncPort, ProcessInvocationState } from "./process-data-sync-contract.js";

export function useProcessInvocationData(
  apiBase: string | null,
  hostSessionId: string,
  port: ProcessDataSyncPort,
  invocationKey: (sessionId: string, runId: string) => string,
) {
  const [invocations, setInvocations] = useState<Record<string, ProcessInvocationState>>({});
  const invocationsRef = useRef(invocations);
  const requestsRef = useRef(new ProcessInvocationRequestCoordinator());
  const inputRef = useRef({ apiBase, port, invocationKey });
  inputRef.current = { apiBase, port, invocationKey };

  const commitInvocations = useCallback((
    update: (
      current: Record<string, ProcessInvocationState>,
    ) => Record<string, ProcessInvocationState>,
  ) => {
    setInvocations((current) => {
      const next = update(current);
      invocationsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    requestsRef.current.abortAll();
    invocationsRef.current = {};
    commitInvocations(() => ({}));
  }, [commitInvocations, hostSessionId]);

  const readInvocation = useCallback((sessionId: string, runId: string) => {
    const key = inputRef.current.invocationKey(sessionId, runId);
    const request = planProcessInvocationRequest(
      inputRef.current.apiBase,
      sessionId,
      runId,
      invocationsRef.current[key],
    );
    if (request.kind === "skip") return;
    const controller = requestsRef.current.begin(key);
    commitInvocations((current) => ({ ...current, [key]: { status: "loading" } }));
    void inputRef.current.port.loadInvocation({ ...request, signal: controller.signal }).then((invocation) => {
      if (decideProcessInvocationCommit(requestsRef.current.finish(key, controller)) === "ignore") return;
      commitInvocations((current) => ({
        ...current,
        [key]: planProcessInvocationReady(invocation),
      }));
    }).catch((error: unknown) => {
      if (decideProcessInvocationCommit(requestsRef.current.finish(key, controller)) === "ignore") return;
      commitInvocations((current) => ({
        ...current,
        [key]: { status: "error", message: planConsoleErrorMessage(error) },
      }));
    });
  }, [commitInvocations]);

  return useMemo(() => ({ invocations, readInvocation }), [invocations, readInvocation]);
}
