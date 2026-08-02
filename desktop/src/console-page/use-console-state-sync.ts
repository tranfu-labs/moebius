import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";

import type {
  ConsoleStateSyncPort,
  ConsoleStateSyncSnapshot,
} from "./console-state-sync-contract.js";
import type {
  ConsoleSelection,
  ConsoleStateCoordinator,
  SelectionMutationToken,
} from "./console-state-coordinator.js";
import {
  decideComposerDraftActivation,
  decideConsoleApiBase,
  decideConsoleStatePoll,
  decideStateEtagAvailability,
  planDisplayedResultAcknowledgement,
  planConsoleErrorMessage,
} from "./console-state-plan.js";
import { refreshConsoleState, type ConsoleStateEtagStore } from "./refresh-console-state.js";
import type { ConsoleErrorController } from "./use-console-error-state.js";

export function useConsoleStateSync<TState extends ConsoleStateSyncSnapshot>(
  apiBase: string | null,
  state: TState | null,
  coordinator: ConsoleStateCoordinator,
  selectionRef: MutableRefObject<ConsoleSelection>,
  commitState: (state: TState) => void,
  commitSelection: (selection: ConsoleSelection) => void,
  errors: ConsoleErrorController,
  newConversationOpen: boolean,
  selectedSessionId: string,
  activateComposer: (sessionId: string) => void,
  acknowledgedResultsRef: MutableRefObject<Set<string>>,
  port: ConsoleStateSyncPort,
) {
  const etagsRef = useRef(new Map<string, string>());
  const etags: ConsoleStateEtagStore = useMemo(() => ({
    read: (selection) => etagsRef.current.get(stateEtagKey(selection)),
    write: (selection, etag) => {
      etagsRef.current.set(stateEtagKey(selection), etag);
    },
  }), []);
  const input = {
    apiBase,
    state,
    coordinator,
    selectionRef,
    commitState,
    commitSelection,
    errors,
    newConversationOpen,
    selectedSessionId,
    activateComposer,
    acknowledgedResultsRef,
    port,
  };
  const inputRef = useRef(input);
  inputRef.current = input;

  const refresh = useCallback(async (
    selection: ConsoleSelection,
    mutationOwner?: SelectionMutationToken,
  ): Promise<boolean> => {
    const current = inputRef.current;
    const endpoint = decideConsoleApiBase(current.apiBase, "");
    if (endpoint.kind === "unavailable") return false;
    const etagAvailability = decideStateEtagAvailability(current.state, selection);
    return await refreshConsoleState<TState>({
      apiBase: endpoint.apiBase,
      selection,
      coordinator: current.coordinator,
      fetch: current.port.fetch,
      readSelection: (nextState) => ({
        projectId: nextState.selectedProjectId,
        sessionId: nextState.selectedSessionId,
      }),
      commitState: current.commitState,
      commitSelection: current.commitSelection,
      errors: current.errors,
      mutationOwner,
      etags: etagAvailability === "use" ? etags : undefined,
    });
  }, []);

  useEffect(() => {
    etagsRef.current.clear();
  }, [apiBase]);

  useEffect(() => {
    void refresh(inputRef.current.selectionRef.current);
    const timer = window.setInterval(() => {
      const current = inputRef.current;
      if (decideConsoleStatePoll(current.coordinator.isSelectionMutationPending) === "refresh") {
        void refresh(current.selectionRef.current);
      }
    }, 1_000);
    return () => {
      window.clearInterval(timer);
      inputRef.current.coordinator.invalidateRefresh();
    };
  }, [apiBase, refresh]);

  useEffect(() => {
    if (decideComposerDraftActivation(newConversationOpen) === "activate") {
      inputRef.current.activateComposer(selectedSessionId);
    }
  }, [newConversationOpen, selectedSessionId]);

  useEffect(() => {
    const current = inputRef.current;
    const acknowledgement = planDisplayedResultAcknowledgement(
      current.apiBase,
      current.state,
      current.acknowledgedResultsRef.current,
    );
    if (acknowledgement.kind === "skip") return;
    current.acknowledgedResultsRef.current.add(acknowledgement.key);
    const errorOperation = current.errors.begin({
      family: "result-acknowledgement",
      scope: acknowledgement.key,
    });
    void current.port.acknowledgeDisplayedResult({
      apiBase: acknowledgement.apiBase,
      sessionId: acknowledgement.sessionId,
      unreadSince: acknowledgement.unreadSince,
    }).then(async () => {
      inputRef.current.errors.succeed(errorOperation);
      await refresh(inputRef.current.selectionRef.current);
    }).catch((error: unknown) => {
      const latest = inputRef.current;
      latest.acknowledgedResultsRef.current.delete(acknowledgement.key);
      latest.errors.fail(errorOperation, planConsoleErrorMessage(error));
    });
  }, [apiBase, refresh, state]);

  return useMemo(() => ({ refresh }), [refresh]);
}

function stateEtagKey(selection: ConsoleSelection): string {
  return `${selection.projectId}\u0000${selection.sessionId}`;
}
