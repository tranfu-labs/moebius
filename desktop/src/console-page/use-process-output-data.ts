import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  planLoadedProcessOutputState,
  planProcessOutputErrorState,
  planProcessOutputLoadingState,
  planProcessOutputPolling,
  planProcessOutputRequest,
  planProcessOutputUpdateState,
} from "./console-process-model.js";
import { decideRemoteViewCommit, decideRemoteViewRequest, planConsoleErrorMessage } from "./console-state-plan.js";
import type { ProcessDataSyncPort, ProcessOutputState } from "./process-data-sync-contract.js";
import { loadPreviousProcessOutput } from "./load-previous-process-output.js";

export function useProcessOutputData(
  apiBase: string | null,
  activeSourceKey: string | null,
  selectedSessionId: string,
  hostSessionId: string,
  port: ProcessDataSyncPort,
  setError: (error: string | null) => void,
) {
  const [outputs, setOutputs] = useState<Record<string, ProcessOutputState>>({});
  const outputsRef = useRef(outputs);
  const inputRef = useRef({ apiBase, selectedSessionId, port, setError });
  inputRef.current = { apiBase, selectedSessionId, port, setError };

  const commitOutputs = useCallback((
    update: (current: Record<string, ProcessOutputState>) => Record<string, ProcessOutputState>,
  ) => {
    setOutputs((current) => {
      const next = update(current);
      outputsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    outputsRef.current = {};
    commitOutputs(() => ({}));
  }, [commitOutputs, hostSessionId]);

  const loadPrevious = useCallback((sourceKey: string, cursor: string) => {
    const current = inputRef.current;
    void loadPreviousProcessOutput({
      apiBase: current.apiBase,
      sourceKey,
      cursor,
      selectedSessionId: current.selectedSessionId,
      currentSelectionId: () => inputRef.current.selectedSessionId,
      currentOutputs: () => outputsRef.current,
      commit: commitOutputs,
      port: current.port,
      setError: (error) => inputRef.current.setError(error),
    });
  }, [commitOutputs]);

  useEffect(() => {
    const polling = planProcessOutputPolling(apiBase, activeSourceKey, selectedSessionId);
    if (polling.kind === "skip") return;
    const controller = new AbortController();
    let inFlight = false;
    let timer: number | undefined;
    commitOutputs((current) => ({
      ...current,
      [polling.sourceKey]: planProcessOutputLoadingState(current[polling.sourceKey]),
    }));
    const refreshOutput = async (): Promise<void> => {
      if (decideRemoteViewRequest(inFlight) === "wait") return;
      inFlight = true;
      try {
        const current = outputsRef.current[polling.sourceKey];
        const request = planProcessOutputRequest(current);
        if (request.kind === "update") {
          const update = await inputRef.current.port.loadUpdate({
            apiBase: polling.apiBase,
            sessionId: polling.sessionId,
            runId: polling.runId,
            appendCursor: request.appendCursor,
            currentStatus: request.currentStatus,
            signal: controller.signal,
          });
          if (decideRemoteViewCommit(controller.signal.aborted) === "commit") {
            commitOutputs((latest) => ({
              ...latest,
              [polling.sourceKey]: planProcessOutputUpdateState(
                latest[polling.sourceKey],
                update,
              ) ?? latest[polling.sourceKey]!,
            }));
          }
        } else {
          const output = await inputRef.current.port.loadOutput({
            apiBase: polling.apiBase,
            sessionId: polling.sessionId,
            runId: polling.runId,
            signal: controller.signal,
          });
          if (decideRemoteViewCommit(controller.signal.aborted) === "commit") {
            commitOutputs((latest) => ({
              ...latest,
              [polling.sourceKey]: planLoadedProcessOutputState(latest[polling.sourceKey], output),
            }));
          }
        }
      } catch (error) {
        if (decideRemoteViewCommit(controller.signal.aborted) === "commit") {
          commitOutputs((current) => ({
            ...current,
            [polling.sourceKey]: planProcessOutputErrorState(
              current[polling.sourceKey],
              planConsoleErrorMessage(error),
            ),
          }));
        }
      } finally {
        inFlight = false;
        if (decideRemoteViewCommit(controller.signal.aborted) === "commit") {
          timer = window.setTimeout(() => void refreshOutput(), 1_000);
        }
      }
    };
    void refreshOutput();
    return () => {
      window.clearTimeout(timer);
      controller.abort("process-output-tab-changed");
    };
  }, [activeSourceKey, apiBase, commitOutputs, selectedSessionId]);

  return useMemo(() => ({ outputs, loadPrevious }), [loadPrevious, outputs]);
}
