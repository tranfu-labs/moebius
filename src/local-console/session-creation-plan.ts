import { assertTextFragments, normalizeTitle } from "./runtime-domain.js";
import { serializeTextFragmentReferences } from "./session-reference-text.js";
import { deriveSessionTitle } from "./title.js";
import { resolveLocalUserMessageDispatch, type LocalUserMessageDispatch } from "./user-message-routing.js";
import type {
  LocalAttachment,
  LocalConsoleAgentTeamSnapshot,
  LocalConsoleProjectSummary,
  LocalConsoleTextFragment,
  LocalConsoleWorkspaceMode,
} from "./types.js";

export interface SessionCreationContentPlan {
  normalizedInitialMessage: string | undefined;
  persistedInitialMessage: string | undefined;
  attachmentIds: string[];
  attachmentDraftKey: string;
  hasInitialContent: boolean;
}

export function planSessionCreationContent(input: {
  initialMessage: string | undefined;
  attachmentIds: readonly string[];
  textFragments: readonly LocalConsoleTextFragment[] | undefined;
  attachmentDraftKey: string | undefined;
}): SessionCreationContentPlan {
  const normalizedInitialMessage = input.initialMessage?.trim();
  if (input.initialMessage !== undefined && normalizedInitialMessage === "" && input.attachmentIds.length === 0) {
    throw new Error("Message body must not be empty");
  }
  if (new Set(input.attachmentIds).size !== input.attachmentIds.length) {
    throw new Error("Attachment ids must be unique");
  }
  const textFragments = input.textFragments ?? [];
  assertTextFragments(textFragments);
  return {
    normalizedInitialMessage,
    persistedInitialMessage: normalizedInitialMessage === undefined
      ? undefined
      : serializeTextFragmentReferences(normalizedInitialMessage, textFragments),
    attachmentIds: [...input.attachmentIds],
    attachmentDraftKey: input.attachmentDraftKey ?? "draft:new",
    hasInitialContent: normalizedInitialMessage !== undefined || input.attachmentIds.length > 0,
  };
}

export function decideSessionCreationProject(
  project: LocalConsoleProjectSummary | undefined,
): { kind: "missing" } | { kind: "available"; project: LocalConsoleProjectSummary } {
  return project === undefined ? { kind: "missing" } : { kind: "available", project };
}

export function decideSessionCreationProjectId(projectId: string | undefined):
  | { kind: "requested"; projectId: string }
  | { kind: "default" } {
  return projectId === undefined
    ? { kind: "default" }
    : { kind: "requested", projectId };
}

export function decideSessionCreationWorkspaceRead(
  workspaceMode: LocalConsoleWorkspaceMode | undefined,
): { kind: "skip" } | { kind: "read" } {
  return workspaceMode === "worktree" ? { kind: "read" } : { kind: "skip" };
}

export function decideSessionCreationWorkspace(
  isGitRepository: boolean,
): { kind: "available" } | { kind: "reject" } {
  return isGitRepository ? { kind: "available" } : { kind: "reject" };
}

export function decideSessionCreationBaselineRead(
  hasInitialContent: boolean,
): { kind: "read" } | { kind: "skip" } {
  return hasInitialContent ? { kind: "read" } : { kind: "skip" };
}

export function decideSessionCreationTeamLoad(input: {
  agentTeam: { ownership: "system" | "user"; id: string } | undefined;
  portAvailable: boolean;
}): { kind: "skip" } | { kind: "load"; binding: { ownership: "system" | "user"; id: string } } {
  return input.agentTeam === undefined || !input.portAvailable
    ? { kind: "skip" }
    : { kind: "load", binding: input.agentTeam };
}

export function decideSessionCreationAgentNames(
  snapshot: LocalConsoleAgentTeamSnapshot | undefined,
): { kind: "snapshot"; names: string[] } | { kind: "fallback" } {
  const names = snapshot?.members.map((member) => member.name) ?? [];
  return names.length === 0 ? { kind: "fallback" } : { kind: "snapshot", names };
}

export function planSessionCreationDispatch(input: {
  content: SessionCreationContentPlan;
  routeAgentNames: readonly string[];
}): LocalUserMessageDispatch | undefined {
  const primaryAgent = input.routeAgentNames[0];
  if (!input.content.hasInitialContent || primaryAgent === undefined) return undefined;
  return resolveLocalUserMessageDispatch({
    body: input.content.normalizedInitialMessage ?? "",
    availableAgentNames: input.routeAgentNames,
    primaryAgent,
  });
}

export function decideSessionCreationAttachmentRead(input: {
  firstAttachmentId: string | undefined;
  portAvailable: boolean;
}): { kind: "skip" } | { kind: "read"; attachmentId: string } {
  return input.firstAttachmentId === undefined || !input.portAvailable
    ? { kind: "skip" }
    : { kind: "read", attachmentId: input.firstAttachmentId };
}

export function planSessionCreationTitle(input: {
  requestedTitle: string | undefined;
  normalizedInitialMessage: string | undefined;
  firstAttachment: LocalAttachment | undefined;
}): string {
  if (input.normalizedInitialMessage !== undefined) return deriveSessionTitle(input.normalizedInitialMessage);
  return input.firstAttachment === undefined
    ? normalizeTitle(input.requestedTitle)
    : deriveSessionTitle(input.firstAttachment.displayName);
}

export function decideSessionCreationProcessing(
  hasInitialContent: boolean,
): { kind: "start" } | { kind: "idle" } {
  return hasInitialContent ? { kind: "start" } : { kind: "idle" };
}

export function planSessionCreationBaselineCacheValue(
  baselineCommit: string | null | undefined,
): string | null {
  return baselineCommit ?? null;
}

export function assertAnalysisParent(input: { sessionId: string; analysisParentSessionId: string }): void {
  if (input.analysisParentSessionId === input.sessionId) {
    throw new Error("analysis session cannot parent itself");
  }
}

export function planInitialDispatchRole(input: {
  requestedRole: string | undefined;
  firstTeamMemberName: string | undefined;
}): string | null {
  return input.requestedRole ?? input.firstTeamMemberName ?? null;
}

export function assertChildProject(input: { requestedProjectId: string; parentProjectId: string }): void {
  if (input.requestedProjectId !== input.parentProjectId) {
    throw new Error(`local child project mismatch: parent=${input.parentProjectId} input=${input.requestedProjectId}`);
  }
}

export function planChildAgentTeam(input: {
  ownership: "system" | "user" | null;
  id: string | null;
}): { ownership: "system" | "user" | undefined; id: string | undefined } {
  return {
    ownership: input.ownership ?? undefined,
    id: input.id ?? undefined,
  };
}
