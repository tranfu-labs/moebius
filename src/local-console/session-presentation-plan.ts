import { nonContinuableSystemMessage } from "./session-status.js";
import type {
  LocalConsoleAgentTeamSnapshot,
  LocalConsoleMessage,
  LocalConsoleProjectSummary,
  LocalConsoleSessionSummary,
} from "./types.js";

export function decideProjectWorkspaceFactsRead(
  directoryAvailable: boolean | undefined,
): { kind: "fallback" } | { kind: "read" } {
  return directoryAvailable === false ? { kind: "fallback" } : { kind: "read" };
}

export function planSessionBranchRead(input: {
  workspaceMode: "direct" | "worktree";
  projectBranchName: string | null;
}): { kind: "direct"; branchName: string | null } | { kind: "worktree" } {
  return input.workspaceMode === "direct"
    ? { kind: "direct", branchName: input.projectBranchName }
    : { kind: "worktree" };
}

export function decideWorktreeBranchRead(
  directoryAvailable: boolean,
): { kind: "read" } | { kind: "skip" } {
  return directoryAvailable ? { kind: "read" } : { kind: "skip" };
}

export function planAttentionSynchronization(input: {
  continuation: LocalConsoleSessionSummary["continuation"];
  currentKind: LocalConsoleSessionSummary["attentionKind"];
  portAvailable: boolean;
}): { kind: "preserve" } | { kind: "sync"; desiredKind: Exclude<LocalConsoleSessionSummary["attentionKind"], undefined> } {
  const desiredKind = input.continuation?.canContinue === false ? input.continuation.kind : null;
  return !input.portAvailable || (input.currentKind ?? null) === desiredKind
    ? { kind: "preserve" }
    : { kind: "sync", desiredKind };
}

export function planRuntimeActivity(
  project: LocalConsoleProjectSummary,
  activeRunCounts: Readonly<Record<string, number>>,
): LocalConsoleProjectSummary {
  const sessions = project.sessions.map((session) => {
    const runningCount = Math.max(session.runningCount, activeRunCounts[session.sessionId] ?? 0);
    return {
      ...session,
      status: runningCount > 0 ? "running" as const : session.status,
      runningCount,
      hasPendingControlWork: session.hasPendingControlWork === true || runningCount > 0,
    };
  });
  return {
    ...project,
    sessions,
    runningCount: sessions.reduce((total, session) => total + session.runningCount, 0),
  };
}

export function planNonContinuableRecord(
  session: LocalConsoleSessionSummary,
): { kind: "skip" } | { kind: "record"; body: string; error: string } {
  if (session.continuation === undefined || session.continuation.canContinue) return { kind: "skip" };
  const body = nonContinuableSystemMessage(session.continuation);
  return body === null ? { kind: "skip" } : { kind: "record", body, error: session.continuation.kind };
}

export function decideNonContinuableRecordWrite(
  messages: readonly LocalConsoleMessage[],
  body: string,
): { kind: "skip" } | { kind: "record" } {
  return messages.some((message) => message.speaker === "system" && message.body === body)
    ? { kind: "skip" }
    : { kind: "record" };
}

export function planUnsafeRunContext(input: {
  workspaceMode: "direct" | "worktree" | null;
  sourceProjectId: string;
  unavailableProjectIds: ReadonlySet<string>;
  sessionHealth: LocalConsoleSessionSummary["agentTeamHealth"] | undefined;
}): { kind: "abort-project" } | { kind: "inspect-team" } | { kind: "keep" } {
  if (input.workspaceMode === "direct" && input.unavailableProjectIds.has(input.sourceProjectId)) {
    return { kind: "abort-project" };
  }
  return input.sessionHealth === "deleted" || input.sessionHealth === "needs-repair"
    ? { kind: "inspect-team" }
    : { kind: "keep" };
}

export function decideUnavailableTeamStop(
  snapshot: LocalConsoleAgentTeamSnapshot | null | undefined,
): { kind: "abort" } | { kind: "keep" } {
  return snapshot == null ? { kind: "abort" } : { kind: "keep" };
}
