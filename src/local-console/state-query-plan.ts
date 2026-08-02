import { buildFallbackProjectSummary } from "./runtime-domain.js";
import type {
  LocalConsoleMessage,
  LocalConsoleProjectSummary,
  LocalConsoleRunSnapshot,
  LocalConsoleSessionSummary,
  LocalConsoleSnapshot,
} from "./types.js";

export function planLocalSnapshotStatus(input: {
  messages: readonly LocalConsoleMessage[];
  activeRunCount: number;
}): LocalConsoleSnapshot["status"] {
  if (input.activeRunCount > 0 || input.messages.some((message) => message.status === "running")) return "running";
  if (input.messages.some((message) => message.status === "stuck")) return "stuck";
  return input.messages.some((message) => message.status === "failed") ? "failed" : "idle";
}

export function planStateQueryRequest(
  selected: string | { sessionId?: string; projectId?: string },
  defaultSessionId: string,
): { sessionId: string; projectId: string | undefined } {
  return typeof selected === "string"
    ? { sessionId: selected, projectId: undefined }
    : { sessionId: selected.sessionId ?? defaultSessionId, projectId: selected.projectId };
}

export function planPrimaryActiveRun(
  activeRuns: readonly LocalConsoleRunSnapshot[],
  primaryRunId: string | null,
): LocalConsoleRunSnapshot | null {
  return activeRuns.find((run) => run.runId === primaryRunId) ?? null;
}

export function planSelectedConsoleState(input: {
  projects: readonly LocalConsoleProjectSummary[];
  requestedProjectId: string | undefined;
  selectedSessionId: string;
  projectRoot: string;
}): {
  selectedProject: LocalConsoleProjectSummary;
  selectedSession: LocalConsoleSessionSummary | null;
  sessionId: string;
} {
  const sessions = input.projects.flatMap((project) => project.sessions);
  const firstRootSession = sessions.find((session) =>
    session.parentSessionId == null && session.analysisParentSessionId == null);
  const requestedProject = input.requestedProjectId === undefined
    ? undefined
    : input.projects.find((project) => project.projectId === input.requestedProjectId);
  const requestedSession = (requestedProject?.sessions ?? sessions)
    .find((session) => session.sessionId === input.selectedSessionId);
  const selectedProject = requestedProject
    ?? (requestedSession === undefined
      ? undefined
      : input.projects.find((project) => project.projectId === requestedSession.projectId))
    ?? (firstRootSession === undefined
      ? undefined
      : input.projects.find((project) => project.projectId === firstRootSession.projectId))
    ?? input.projects[0]
    ?? buildFallbackProjectSummary(input.projectRoot);
  const selectedSession = (requestedSession?.projectId === selectedProject.projectId ? requestedSession : undefined)
    ?? selectedProject.sessions.find((session) =>
      session.parentSessionId == null && session.analysisParentSessionId == null)
    ?? (requestedProject === undefined ? firstRootSession : undefined)
    ?? null;
  return {
    selectedProject,
    selectedSession,
    sessionId: selectedSession?.sessionId ?? input.selectedSessionId,
  };
}

export function decideSelectedSessionRead(
  session: LocalConsoleSessionSummary | null,
): { kind: "empty" } | { kind: "read"; session: LocalConsoleSessionSummary } {
  return session === null ? { kind: "empty" } : { kind: "read", session };
}

export function decideSessionView(
  session: LocalConsoleSessionSummary | undefined,
): { kind: "missing" } | { kind: "read"; session: LocalConsoleSessionSummary } {
  return session === undefined ? { kind: "missing" } : { kind: "read", session };
}

export function planSessionSearchMatch(title: string | null, normalizedQuery: string): boolean {
  return (title ?? "").trim().normalize("NFKC").toLowerCase().includes(normalizedQuery);
}

export function planPendingAttentionRunningCount(input: {
  persistedRunningCount: number;
  hasPendingControlWork: boolean;
}): number {
  return input.hasPendingControlWork ? Math.max(1, input.persistedRunningCount) : input.persistedRunningCount;
}

export function decidePendingAttentionState(
  hasPendingControlWork: boolean,
): "blink" | "inspect-unread" {
  return hasPendingControlWork ? "blink" : "inspect-unread";
}
