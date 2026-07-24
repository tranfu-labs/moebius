import type { AiTeamBuilderState } from "./dto.js";

export const AI_TEAM_BUILDER_IPC_CHANNELS = {
  state: "agent-teams:ai-builder:state",
  start: "agent-teams:ai-builder:start",
  submit: "agent-teams:ai-builder:submit",
  adjust: "agent-teams:ai-builder:adjust",
  retry: "agent-teams:ai-builder:retry",
  commit: "agent-teams:ai-builder:commit",
} as const;

export interface AiTeamBuilderDraftRequest {
  draftId: string;
}

export interface AiTeamBuilderTurnRequest extends AiTeamBuilderDraftRequest {
  text: string;
}

export interface AiTeamBuilderCommitRequest extends AiTeamBuilderDraftRequest {
  proposalRevision: number;
}

export type AiTeamBuilderIpcResponse =
  | { ok: true; state: AiTeamBuilderState }
  | {
      ok: false;
      error: {
        code: "invalid-request" | "stale-revision" | "temporarily-unavailable";
        humanMessage: string;
        canRetry: boolean;
      };
    };
