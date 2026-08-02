import type { LocalConsoleState } from "./console-state-contract.js";
import {
  decideConversationAnalysisPreparedSource,
  decideConversationAnalysisRefresh,
  planConversationAnalysisMutationOwner,
  planConversationAnalysisTargetLoad,
} from "./conversation-analysis-model.js";
import {
  ConsoleStateCoordinator,
  type ConsoleSelection,
  type SelectionMutationToken,
} from "./console-state-coordinator.js";
import { refreshConsoleState } from "./refresh-console-state.js";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function loadConversationAnalysisTarget(input: {
  loadTarget: boolean;
  apiBase: string;
  selection: ConsoleSelection;
  sessionId: string;
  coordinator: ConsoleStateCoordinator;
  mutation: SelectionMutationToken | null;
  fetch: FetchLike;
  sourceMissingError: string;
  setError(error: string | null): void;
}): Promise<{ kind: "ready" | "failed"; state: LocalConsoleState | null }> {
  if (planConversationAnalysisTargetLoad(input.loadTarget) === "retain") {
    return { kind: "ready", state: null };
  }
  let preparedState: LocalConsoleState | null = null;
  const loaded = await refreshConsoleState<LocalConsoleState>({
    apiBase: input.apiBase,
    selection: input.selection,
    coordinator: input.coordinator,
    fetch: input.fetch,
    readSelection: (state) => ({
      projectId: state.selectedProjectId,
      sessionId: state.selectedSessionId,
    }),
    commitState: (state) => { preparedState = state; },
    commitSelection: () => undefined,
    setError: input.setError,
    mutationOwner: planConversationAnalysisMutationOwner(input.mutation),
  });
  if (!decideConversationAnalysisRefresh(loaded, preparedState)) {
    return { kind: "failed", state: null };
  }
  if (!decideConversationAnalysisPreparedSource(preparedState, input.sessionId)) {
    throw new Error(input.sourceMissingError);
  }
  return { kind: "ready", state: preparedState };
}
