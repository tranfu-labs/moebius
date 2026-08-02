import type { TeamOwnership } from "../team-model.js";
import type { CreatedSession } from "./console-state-action-contract.js";

export interface ConversationAgentTeamIdentity {
  teamId: string;
  ownership: TeamOwnership;
}

export interface NewConversationDraftState {
  isOpen: boolean;
  projectId: string | null;
  workspaceMode: "direct" | "worktree";
  teamKey: string | null;
  draft: string;
  isSubmitting: boolean;
  error: string | null;
}

export interface NewConversationSubmissionState extends Omit<NewConversationDraftState, "isOpen"> {
  readyAttachmentCount?: number;
  hasBlockingAttachments?: boolean;
}

export interface ReadyNewConversationSubmission extends NewConversationDraftState {
  projectId: string;
  teamKey: string;
}

export type NewConversationDraftEvent =
  | { type: "open"; draft: NewConversationDraftState }
  | { type: "show" }
  | { type: "hide" }
  | { type: "consume" }
  | { type: "select-project"; projectId: string | null }
  | { type: "select-workspace"; workspaceMode: "direct" | "worktree" }
  | { type: "select-team"; teamKey: string | null }
  | { type: "edit-draft"; draft: string }
  | { type: "submit-started" }
  | { type: "submit-failed"; error: string };

export type SubmitNewConversationResult =
  | { created: false }
  | { created: true; sessionId: string; preferenceRecorded: true }
  | { created: true; sessionId: string; preferenceRecorded: false; preferenceError: unknown };

export function createNewConversationDraft(input: {
  projectId?: string;
  workspaceMode?: "direct" | "worktree";
  teamKey: string | null;
  draft: string;
}): NewConversationDraftState {
  return {
    isOpen: true,
    projectId: input.projectId ?? null,
    workspaceMode: input.workspaceMode ?? "direct",
    teamKey: input.teamKey,
    draft: input.draft,
    isSubmitting: false,
    error: null,
  };
}

export function canSubmitNewConversation(state: NewConversationSubmissionState): boolean {
  return state.projectId !== null
    && state.teamKey !== null
    && (state.draft.trim() !== "" || (state.readyAttachmentCount ?? 0) > 0)
    && state.hasBlockingAttachments !== true
    && !state.isSubmitting;
}

export function reduceNewConversationDraft(
  state: NewConversationDraftState | null,
  event: NewConversationDraftEvent,
): NewConversationDraftState | null {
  if (event.type === "open") {
    return event.draft;
  }
  if (event.type === "consume") {
    return null;
  }
  if (state === null) {
    return null;
  }

  switch (event.type) {
    case "show":
      return { ...state, isOpen: true };
    case "hide":
      return { ...state, isOpen: false };
    case "select-project":
      return { ...state, projectId: event.projectId, error: null };
    case "select-workspace":
      return { ...state, workspaceMode: event.workspaceMode, error: null };
    case "select-team":
      return { ...state, teamKey: event.teamKey, error: null };
    case "edit-draft":
      return { ...state, draft: event.draft, error: null };
    case "submit-started":
      return { ...state, isSubmitting: true, error: null };
    case "submit-failed":
      return { ...state, isSubmitting: false, error: event.error };
  }
}

export async function submitNewConversation(input: {
  projectId: string;
  workspaceMode: "direct" | "worktree";
  initialMessage: string;
  team: ConversationAgentTeamIdentity;
  createSessionWithFirstMessage(
    projectId: string,
    initialMessage: string,
    team: ConversationAgentTeamIdentity,
    workspaceMode: "direct" | "worktree",
  ): Promise<CreatedSession | null>;
  recordSuccessfulTeam(request: ConversationAgentTeamIdentity & { sessionId: string }): Promise<unknown>;
}): Promise<SubmitNewConversationResult> {
  const session = await input.createSessionWithFirstMessage(
    input.projectId,
    input.initialMessage,
    input.team,
    input.workspaceMode,
  );
  if (session === null) {
    return { created: false };
  }

  try {
    await input.recordSuccessfulTeam({ sessionId: session.sessionId, ...input.team });
    return { created: true, sessionId: session.sessionId, preferenceRecorded: true };
  } catch (preferenceError) {
    return { created: true, sessionId: session.sessionId, preferenceRecorded: false, preferenceError };
  }
}

export function planNewConversationSubmission(
  state: NewConversationDraftState | null,
  readyAttachmentCount: number,
  hasBlockingAttachments: boolean,
): ReadyNewConversationSubmission | null {
  if (state === null || !state.isOpen || state.projectId === null || state.teamKey === null) return null;
  if (!canSubmitNewConversation({ ...state, readyAttachmentCount, hasBlockingAttachments })) return null;
  return { ...state, projectId: state.projectId, teamKey: state.teamKey };
}

export function planNewConversationCreation(
  result: SubmitNewConversationResult,
): { kind: "failed" } | { kind: "created"; sessionId: string } {
  return result.created
    ? { kind: "created", sessionId: result.sessionId }
    : { kind: "failed" };
}

export function planNewConversationPreferenceResult(
  result: SubmitNewConversationResult,
): "recorded" | "failed" | "not-created" {
  if (!result.created) return "not-created";
  return result.preferenceRecorded ? "recorded" : "failed";
}

export function planNewConversationPreferenceError(
  result: SubmitNewConversationResult,
): unknown {
  if (!result.created || result.preferenceRecorded) return null;
  return result.preferenceError;
}
