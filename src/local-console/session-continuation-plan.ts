import {
  LOCAL_CONSOLE_PROJECT_ID,
  LocalConsoleProjectFolderError,
  type LocalConsoleProjectSummary,
  type LocalConsoleSessionSummary,
  type LocalConsoleSessionWorkspaceSource,
} from "./types.js";
import type { resolveLocalSessionContinuation } from "./session-status.js";

type LocalSessionContinuation = ReturnType<typeof resolveLocalSessionContinuation>;

export function planDefaultProjectId(projects: readonly LocalConsoleProjectSummary[]): string {
  return projects[0]?.projectId ?? LOCAL_CONSOLE_PROJECT_ID;
}

export function decideProjectReadSource(available: boolean): { kind: "direct" } | { kind: "list" } {
  return available ? { kind: "direct" } : { kind: "list" };
}

export function planStoredProject(
  project: LocalConsoleProjectSummary | null | undefined,
): LocalConsoleProjectSummary | undefined {
  return project ?? undefined;
}

export function requireStoredProject(project: LocalConsoleProjectSummary | undefined): LocalConsoleProjectSummary {
  if (project === undefined) {
    throw new LocalConsoleProjectFolderError("LOCAL_PROJECT_NOT_FOUND", "项目不存在或已移除");
  }
  return project;
}

export function requireProjectDirectoryAvailable(available: boolean): void {
  if (!available) {
    throw new LocalConsoleProjectFolderError(
      "PROJECT_DIRECTORY_UNAVAILABLE",
      "当前项目本地文件夹不可用，请先使用红色扳手修复",
    );
  }
}

export function requireStoredSession(
  session: LocalConsoleSessionSummary | undefined,
  sessionId: string,
): LocalConsoleSessionSummary {
  if (session === undefined) throw new Error(`local console session not found: ${sessionId}`);
  return session;
}

export function requireContinuableSession(continuation: LocalSessionContinuation): void {
  if (!continuation.canContinue) throw new Error(continuation.reason);
}

export function decideWorkspaceContinuationCandidate(input: {
  directoryAvailable: boolean;
  session: LocalConsoleSessionSummary | undefined;
}): { kind: "unavailable" } | { kind: "inspect-health"; session: LocalConsoleSessionSummary } {
  return !input.directoryAvailable || input.session === undefined
    ? { kind: "unavailable" }
    : { kind: "inspect-health", session: input.session };
}

export function planContinuableWorkspace(input: {
  source: LocalConsoleSessionWorkspaceSource;
  session: LocalConsoleSessionSummary;
}): LocalConsoleSessionWorkspaceSource | null {
  return input.session.agentTeamHealth === "deleted" || input.session.agentTeamHealth === "needs-repair"
    ? null
    : input.source;
}

export function decideDirectoryAvailabilityRead(
  knownAvailable: boolean | undefined,
): { kind: "known"; available: boolean } | { kind: "read" } {
  return knownAvailable === undefined ? { kind: "read" } : { kind: "known", available: knownAvailable };
}

export function planProjectDirectoryAvailability(
  project: LocalConsoleProjectSummary,
  available: boolean,
): LocalConsoleProjectSummary {
  return {
    ...project,
    directoryAvailable: available,
    directoryUnavailableReason: available ? null : "当前项目本地文件夹未找到，可以指定新的文件夹",
    newConversationDisabledReason: available ? null : "当前项目本地文件夹不可用，无法新建对话",
  };
}

export function decideAgentTeamHealthRead(input: {
  ownership: LocalConsoleSessionSummary["agentTeamOwnership"];
  teamId: string | null | undefined;
  resolverAvailable: boolean;
}): { kind: "not-bound" } | { kind: "preserve" } | { kind: "resolve" } {
  if (input.ownership == null || input.teamId == null) return { kind: "not-bound" };
  return input.resolverAvailable ? { kind: "resolve" } : { kind: "preserve" };
}
