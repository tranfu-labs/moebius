import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
} from "react";

import type { LocalConsoleState } from "./console-state-contract.js";
import { ConsoleStateCoordinator, type ConsoleSelection } from "./console-state-coordinator.js";
import type { ConversationDraftStore } from "./draft-store.js";
import { NEW_CONVERSATION_DRAFT_KEY } from "./conversation-draft-model.js";
import { createNewConversationDraft, type NewConversationDraftEvent } from "./new-conversation.js";
import {
  createConsolePresentationRouteStore,
  type ConsolePresentationRoute,
} from "./presentation-route.js";
import type { ConversationReadingPositionStore } from "./conversation-reading-position.js";
import { planRetainedConversationSessionIds } from "./conversation-reading-position.js";
import {
  clearConsoleSelectionPreference,
  decideConsoleSelectionCommit,
  decideConsoleSelectionPersistence,
  decideConsoleSessionIsRoot,
  planInitialConsoleSelection,
  planInitialConsoleSelectionPreference,
  readConsoleSelectionFromSearch,
  readConsoleSelectionPreference,
  writeConsoleSelectionPreference,
} from "./selection-preference.js";
import { planPresentationRouteCommit } from "./console-state-plan.js";

export function useConsoleSelectionState(
  storage: Storage,
  draftStore: ConversationDraftStore,
  readingPositionStore: ConversationReadingPositionStore,
  dispatchNewConversation: Dispatch<NewConversationDraftEvent>,
  search = "",
) {
  const [initialSelection] = useState<ConsoleSelection | null>(() => {
    const linkedSelection = readConsoleSelectionFromSearch(search);
    return planInitialConsoleSelectionPreference(linkedSelection, readConsoleSelectionPreference(storage));
  });
  const [selection, setSelection] = useState<ConsoleSelection>(() =>
    planInitialConsoleSelection(initialSelection));
  const selectionRef = useRef(selection);
  const persistedSelectionRef = useRef(initialSelection);
  const startupSelectionPendingRef = useRef(true);
  const selectionPersistenceEnabledRef = useRef(false);
  const coordinator = useMemo(() => new ConsoleStateCoordinator(), []);
  const [state, setState] = useState<LocalConsoleState | null>(null);
  const stateRef = useRef<LocalConsoleState | null>(null);
  const presentationStore = useMemo(() => createConsolePresentationRouteStore(storage), [storage]);
  const [presentationRoute, setPresentationRoute] = useState<ConsolePresentationRoute | null>(() =>
    presentationStore.read());
  const presentationRouteRef = useRef(presentationRoute);

  useEffect(() => {
    stateRef.current = state;
    readingPositionStore.retain(planRetainedConversationSessionIds(state));
  }, [readingPositionStore, state]);

  const commitSelection = useCallback((next: ConsoleSelection) => {
    selectionRef.current = next;
    setSelection(next);
  }, []);
  const commitPresentationRoute = useCallback((route: ConsolePresentationRoute | null) => {
    const decision = planPresentationRouteCommit(route);
    if (decision.kind === "clear") presentationStore.clear();
    else presentationStore.write(decision.route);
    presentationRouteRef.current = route;
    setPresentationRoute(route);
  }, [presentationStore]);
  const forgetPersistedSelection = useCallback(() => {
    clearConsoleSelectionPreference(storage);
    persistedSelectionRef.current = null;
  }, [storage]);
  const rememberConfirmedSelection = useCallback((next: ConsoleSelection) => {
    const persistence = decideConsoleSelectionPersistence(persistedSelectionRef.current, next);
    if (persistence === "skip") return;
    writeConsoleSelectionPreference(storage, next);
    persistedSelectionRef.current = next;
  }, [storage]);
  const commitConsoleState = useCallback((nextState: LocalConsoleState) => {
    const nextSelection = {
      projectId: nextState.selectedProjectId,
      sessionId: nextState.selectedSessionId,
    };
    const decision = decideConsoleSelectionCommit({
      startupPending: startupSelectionPendingRef.current,
      persistenceEnabled: selectionPersistenceEnabledRef.current,
      remembered: persistedSelectionRef.current,
      snapshot: {
        ...nextSelection,
        isRootSession: decideConsoleSessionIsRoot(nextState.selectedSession),
      },
    });
    startupSelectionPendingRef.current = false;
    selectionPersistenceEnabledRef.current = decision.persistenceEnabled;
    if (decision.action === "remember") rememberConfirmedSelection(nextSelection);
    if (decision.action === "forget" || decision.action === "open-new-conversation") {
      forgetPersistedSelection();
    }
    if (decision.action === "open-new-conversation") {
      dispatchNewConversation({
        type: "open",
        draft: createNewConversationDraft({
          teamKey: null,
          draft: draftStore.read(NEW_CONVERSATION_DRAFT_KEY),
        }),
      });
    }
    stateRef.current = nextState;
    setState(nextState);
  }, [dispatchNewConversation, draftStore, forgetPersistedSelection, rememberConfirmedSelection]);
  const replaceState = useCallback((nextState: LocalConsoleState) => {
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  return useMemo(() => ({
    selection,
    selectionRef,
    selectionPersistenceEnabledRef,
    coordinator,
    state,
    stateRef,
    presentationRoute,
    presentationRouteRef,
    commitSelection,
    commitPresentationRoute,
    forgetPersistedSelection,
    rememberConfirmedSelection,
    commitConsoleState,
    replaceState,
  }), [
    commitConsoleState, commitPresentationRoute, commitSelection, coordinator,
    forgetPersistedSelection, presentationRoute, rememberConfirmedSelection,
    replaceState, selection, state,
  ]);
}
