import type { OperatorSession } from "@moebius/console-ui";

import type { LocalConsoleState } from "./console-state-contract.js";
import { planAnalysisRootSession } from "./console-presentation-model.js";
import type { SelectionMutationToken } from "./console-state-coordinator.js";
import type {
  SidebarConversationDraft,
  SidebarConversationTextFragment,
} from "./sidebar-conversation-drafts.js";
import type { ConsolePresentationRoute } from "./presentation-route.js";

export type ConversationAnalysisRequest =
  | {
      kind: "message";
      sessionId: string;
      runId: string | null;
      messageId: number | null;
    }
  | {
      kind: "conversation";
      sessionId: string;
      projectId: string;
    };

export function planConversationAnalysisAvailability(apiBase: string | null): "run" | "skip" {
  return apiBase === null ? "skip" : "run";
}

export function planConversationAnalysisRouteSessionId(
  route: ConsolePresentationRoute | null,
): string | null {
  return route?.selectedSessionId ?? null;
}

export type ConversationAnalysisStartPlan =
  | {
      kind: "error";
      error: "source-missing" | "record-unavailable";
      notice: "open-failed" | "record-unavailable";
    }
  | {
      kind: "ready";
      source: OperatorSession;
      root: OperatorSession;
      targetSelection: { projectId: string; sessionId: string };
      loadTarget: boolean;
      commitConversationRoute: boolean;
      requiresMutation: boolean;
    };

export function planConversationAnalysisStart(
  state: LocalConsoleState | null,
  routeSelectedSessionId: string | null,
  request: ConversationAnalysisRequest,
): ConversationAnalysisStartPlan {
  const source = state?.projects
    .flatMap((project) => project.sessions)
    .find((session) => session.sessionId === request.sessionId);
  if (source === undefined) {
    return { kind: "error", error: "source-missing", notice: "open-failed" };
  }
  const root = planAnalysisRootSession(
    state?.projects.flatMap((project) => project.sessions) ?? [],
    source.sessionId,
  );
  if (root === null) {
    return { kind: "error", error: "source-missing", notice: "open-failed" };
  }
  if (request.kind === "conversation" && source.analysisRecordAvailable === false) {
    return { kind: "error", error: "record-unavailable", notice: "record-unavailable" };
  }
  const loadTarget = request.kind === "conversation"
    && state?.selectedSessionId !== request.sessionId;
  const commitConversationRoute = request.kind === "conversation"
    && routeSelectedSessionId !== request.sessionId;
  return {
    kind: "ready",
    source,
    root,
    targetSelection: { projectId: source.projectId, sessionId: source.sessionId },
    loadTarget,
    commitConversationRoute,
    requiresMutation: loadTarget || commitConversationRoute,
  };
}

export function planConversationAnalysisMutation(
  required: boolean,
  mutation: SelectionMutationToken | null,
): { kind: "ready"; mutation: SelectionMutationToken | null } | { kind: "busy" } {
  return required && mutation === null ? { kind: "busy" } : { kind: "ready", mutation };
}

export function planConversationAnalysisMutationOwner(
  mutation: SelectionMutationToken | null,
): SelectionMutationToken | undefined {
  return mutation ?? undefined;
}

export function planConversationAnalysisTargetResult(
  kind: "ready" | "failed",
): "continue" | "stop" {
  return kind === "ready" ? "continue" : "stop";
}

export function planConversationAnalysisReferenceRequest(request: ConversationAnalysisRequest): {
  sessionId: string;
  scope: "message" | "conversation";
  runId: string | null;
  messageId: number | null;
} {
  return {
    sessionId: request.sessionId,
    scope: request.kind,
    runId: request.kind === "message" ? request.runId : null,
    messageId: request.kind === "message" ? request.messageId : null,
  };
}

export function decideConversationAnalysisPreparedSource(
  state: LocalConsoleState | null,
  sessionId: string,
): boolean {
  return state?.projects
    .flatMap((project) => project.sessions)
    .some((session) => session.sessionId === sessionId) === true;
}

export function decideConversationAnalysisRefresh(
  loaded: boolean,
  state: LocalConsoleState | null,
): state is LocalConsoleState {
  return loaded && state !== null;
}

export function planConversationAnalysisTargetLoad(loadTarget: boolean): "load" | "retain" {
  return loadTarget ? "load" : "retain";
}

export function planConversationAnalysisFragmentIndex(
  existing: SidebarConversationDraft | null,
): number {
  return (existing?.textFragments.length ?? 0) + 1;
}

export function planConversationAnalysisCommit(
  request: ConversationAnalysisRequest,
  preparedState: LocalConsoleState | null,
): { kind: "retain" } | { kind: "commit-conversation"; preparedState: LocalConsoleState | null } {
  return request.kind === "conversation"
    ? { kind: "commit-conversation", preparedState }
    : { kind: "retain" };
}

export function planConversationAnalysisDraft(
  existing: SidebarConversationDraft | null,
  input: {
    draftId: string;
    source: OperatorSession;
    teamKey: string | null;
    fragment: SidebarConversationTextFragment;
    fragmentLabel: string;
    now: string;
  },
): SidebarConversationDraft {
  const draft = existing ?? {
    draftId: input.draftId,
    hostSessionId: input.source.sessionId,
    originSessionId: input.source.sessionId,
    entryTemplate: "session-analysis" as const,
    writePolicy: "confirm-current-plan-before-write" as const,
    initialContext: {
      projectId: input.source.projectId,
      workspaceMode: input.source.workspaceMode,
      teamKey: input.teamKey,
    },
    context: {
      projectId: input.source.projectId,
      workspaceMode: input.source.workspaceMode,
      teamKey: input.teamKey,
    },
    textFragments: [],
    body: "",
    attachmentDraftKey: `draft:sidebar:${input.draftId}` as const,
    managedAttachmentPresence: "absent" as const,
    updatedAt: input.now,
  };
  return {
    ...draft,
    textFragments: [
      ...draft.textFragments,
      { ...input.fragment, label: input.fragmentLabel },
    ],
    updatedAt: input.now,
  };
}
