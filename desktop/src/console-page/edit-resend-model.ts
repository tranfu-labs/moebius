import type { OperatorEditAndResendTarget, OperatorMessage } from "@moebius/console-ui";

import type { LocalConsoleState } from "./console-state-contract.js";

export function planEditResendStart(
  state: LocalConsoleState | null,
  target: OperatorEditAndResendTarget,
):
  | { kind: "skip" }
  | { kind: "refill"; messages: readonly OperatorMessage[]; target: OperatorEditAndResendTarget } {
  return state === null
    ? { kind: "skip" }
    : { kind: "refill", messages: state.messages, target };
}

export function planEditResendPersistence(input: {
  runId: string | null;
  draftKey: string;
  activeDraftKey: string;
}): { persistRunId: boolean; commitActiveDraft: boolean } {
  return {
    persistRunId: input.runId !== null,
    commitActiveDraft: input.activeDraftKey === input.draftKey,
  };
}
