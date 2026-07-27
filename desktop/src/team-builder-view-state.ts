import type {
  TeamBuilderViewState,
  Translate,
  TranslationKey,
} from "@moebius/console-ui";

import type { AiTeamBuilderIpcResponse } from "./ai-team-builder/contract.js";
import type {
  AiTeamBuilderErrorSummary,
  AiTeamBuilderState,
} from "./ai-team-builder/dto.js";

type AiTeamBuilderIpcError = Extract<AiTeamBuilderIpcResponse, { ok: false }>["error"];

const builderStateErrorKeys: Readonly<Record<
  AiTeamBuilderErrorSummary["code"],
  TranslationKey
>> = {
  "invalid-response": "teamBuilder.error.invalidResponse",
  "context-lost": "teamBuilder.error.contextLost",
  "create-failed": "teamBuilder.error.createFailed",
  "temporarily-unavailable": "teamBuilder.error.temporarilyUnavailable",
};

const builderIpcErrorKeys: Readonly<Record<
  AiTeamBuilderIpcError["code"],
  TranslationKey
>> = {
  "invalid-request": "teamBuilder.error.invalidRequest",
  "stale-revision": "teamBuilder.error.staleRevision",
  "temporarily-unavailable": "teamBuilder.error.temporarilyUnavailable",
};

export function toTeamBuilderViewState(
  state: AiTeamBuilderState,
  t: Translate,
): TeamBuilderViewState {
  return {
    phase: state.phase,
    messages: state.messages.map((message) => ({ ...message })),
    proposal: state.proposal === null
      ? null
      : {
          team: { ...state.proposal.team },
          members: state.proposal.members.map((member) => ({
            ...member,
            responsibilities: [...member.responsibilities],
            handoffs: [...member.handoffs],
          })),
          primaryAgentSlug: state.proposal.primaryAgentSlug,
          relayBeats: state.proposal.relayBeats.map((beat) => ({ ...beat })),
        },
    proposalRevision: state.proposalRevision,
    error: state.error === null
      ? null
      : {
          code: state.error.code,
          humanMessage: t(builderStateErrorKeys[state.error.code]),
          canRetry: state.error.canRetry,
        },
  };
}

export function toTeamBuilderIpcViewError(
  error: AiTeamBuilderIpcError,
  t: Translate,
): NonNullable<TeamBuilderViewState["error"]> {
  return {
    code: error.code,
    humanMessage: t(builderIpcErrorKeys[error.code]),
    canRetry: error.canRetry,
  };
}
