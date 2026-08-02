import type { SelectionMutationKind, SelectionMutationToken } from "./console-state-coordinator.js";
import type { ConsoleStateActionsOptions } from "./console-state-action-contract.js";
import { decideMutationFinished, decideMutationToken } from "./console-state-plan.js";

export const selectionMutationLifecycle = {
  begin(options: ConsoleStateActionsOptions, kind: SelectionMutationKind) {
    const decision = decideMutationToken(options.coordinator.beginSelectionMutation(kind));
    if (decision.kind === "acquired") options.setMutationKind(kind);
    return decision.kind === "acquired" ? decision.token : null;
  },
  finish(options: ConsoleStateActionsOptions, token: SelectionMutationToken) {
    const decision = decideMutationFinished(options.coordinator.endSelectionMutation(token));
    if (decision === "clear") options.setMutationKind(null);
  },
};
