import type { LocalConsoleProjectSummary, LocalConsoleSessionSummary } from "./types.js";

export function planProjectSessionActiveRuns<T extends { sessionId: string }>(
  activeRuns: readonly T[],
  sessionId: string,
): T[] {
  return activeRuns.filter((active) => active.sessionId === sessionId);
}

export function decideProjectCommandCapability(
  available: boolean,
): { kind: "available" } | { kind: "unavailable" } {
  return available ? { kind: "available" } : { kind: "unavailable" };
}

export function decideProjectFolderAvailability(
  available: boolean,
): { kind: "available" } | { kind: "unavailable" } {
  return available ? { kind: "available" } : { kind: "unavailable" };
}

export function planProjectRepairError(
  message: string,
): { kind: "already-bound" } | { kind: "not-found" } | { kind: "rethrow" } {
  if (message.includes("PROJECT_FOLDER_ALREADY_BOUND")) return { kind: "already-bound" };
  return message.includes("LOCAL_PROJECT_NOT_FOUND") ? { kind: "not-found" } : { kind: "rethrow" };
}

export type ProjectRemovalPlan =
  | { kind: "not-found" }
  | { kind: "running" }
  | { kind: "remove"; sessionIds: string[]; abortActiveRuns: boolean };

export function planProjectRemoval(input: {
  project: LocalConsoleProjectSummary | undefined;
  allSessions: readonly LocalConsoleSessionSummary[];
  force: boolean;
}): ProjectRemovalPlan {
  if (input.project === undefined) return { kind: "not-found" };
  if (input.project.runningCount > 0 && !input.force) return { kind: "running" };
  const sessionIds = new Set(input.project.sessions.map((session) => session.sessionId));
  let changed = true;
  while (changed) {
    changed = false;
    for (const session of input.allSessions) {
      if (session.analysisParentSessionId != null
        && sessionIds.has(session.analysisParentSessionId)
        && !sessionIds.has(session.sessionId)) {
        sessionIds.add(session.sessionId);
        changed = true;
      }
    }
  }
  return { kind: "remove", sessionIds: [...sessionIds], abortActiveRuns: input.force };
}

export function planProjectRemovalError(
  message: string,
): { kind: "running" } | { kind: "rethrow" } {
  return message.includes("PROJECT_HAS_RUNNING_AGENTS") ? { kind: "running" } : { kind: "rethrow" };
}

export function planPersistedProjectTitle(input: string, fallback: string): string {
  return input.trim() || fallback;
}

export function assertProjectRemovalIdle(input: { hasPendingControlWork: boolean; force: boolean }): void {
  if (input.hasPendingControlWork && !input.force) throw new Error("PROJECT_HAS_RUNNING_AGENTS");
}

export function assertCompleteProjectOrder(
  requestedProjectIds: readonly string[],
  storedProjectIds: readonly string[],
): void {
  const requested = new Set(requestedProjectIds);
  if (
    requested.size !== requestedProjectIds.length
    || requestedProjectIds.length !== storedProjectIds.length
    || storedProjectIds.some((projectId) => !requested.has(projectId))
  ) {
    throw new Error("project order must contain every active project exactly once");
  }
}

export function decideDefaultProjectIdentity(input: {
  projectId: string;
  sourceType: string;
  title: string;
  folderPath: string;
  worktreeMode: boolean;
  expectedProjectId: string;
  expectedSourceType: string;
  expectedTitle: string;
  expectedFolderPath: string;
}): "inspect-session" | "used" {
  return input.projectId === input.expectedProjectId
    && input.sourceType === input.expectedSourceType
    && input.title === input.expectedTitle
    && input.folderPath === input.expectedFolderPath
    && !input.worktreeMode
    ? "inspect-session"
    : "used";
}

export function decideDefaultSessionIdentity(input: {
  sessionId: string;
  sourceType: string;
  expectedSessionId: string;
}): "inspect-facts" | "used" {
  return input.sessionId === input.expectedSessionId && input.sourceType === "local"
    ? "inspect-facts"
    : "used";
}
