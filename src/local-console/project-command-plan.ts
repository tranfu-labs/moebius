import type { LocalConsoleProjectSummary, LocalConsoleSessionSummary } from "./types.js";

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
