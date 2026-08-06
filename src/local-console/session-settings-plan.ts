export function decideSessionWorkspaceInspection(input: {
  messageCount: number;
  requestedMode: "direct" | "worktree";
}): { kind: "reject-locked" } | { kind: "inspect-git" } | { kind: "allow-direct" } {
  if (input.messageCount > 0) return { kind: "reject-locked" };
  return input.requestedMode === "worktree" ? { kind: "inspect-git" } : { kind: "allow-direct" };
}

export function decideSessionWorkspacePersistenceError(
  message: string,
): { kind: "workspace-locked" } | { kind: "rethrow" } {
  return message === "SESSION_WORKSPACE_LOCKED" ? { kind: "workspace-locked" } : { kind: "rethrow" };
}

export function decideTeamSnapshotLoad(
  available: boolean,
): { kind: "load" } | { kind: "skip" } {
  return available ? { kind: "load" } : { kind: "skip" };
}

export function planSessionHasActiveRun(activeRunCount: number): boolean {
  return activeRunCount > 0;
}

export function decideSessionArchive(input: {
  capabilityAvailable: boolean;
  activeRun: boolean;
}): { kind: "unavailable" } | { kind: "running" } | { kind: "archive" } {
  if (!input.capabilityAvailable) return { kind: "unavailable" };
  return input.activeRun ? { kind: "running" } : { kind: "archive" };
}

export function decideSessionRestore(
  capabilityAvailable: boolean,
): { kind: "unavailable" } | { kind: "restore" } {
  return capabilityAvailable ? { kind: "restore" } : { kind: "unavailable" };
}

export function decideSessionMemberExecutionUpdate(input: {
  activeRun: boolean;
  capabilityAvailable: boolean;
}): { kind: "update" } | { kind: "running" } | { kind: "unavailable" } {
  if (input.activeRun) return { kind: "running" };
  return input.capabilityAvailable ? { kind: "update" } : { kind: "unavailable" };
}

export function assertSessionWorkspaceMutable(hasMessages: boolean): void {
  if (hasMessages) throw new Error("SESSION_WORKSPACE_LOCKED");
}

export function planSessionTeamWrite(input: {
  hasRunningMessage: boolean;
  hasQueuedWorker: boolean;
}): "pending" | "effective" {
  return input.hasRunningMessage || input.hasQueuedWorker ? "pending" : "effective";
}

export function planPendingTeamPromotion(hasPendingTeam: boolean): "promote" | "skip" {
  return hasPendingTeam ? "promote" : "skip";
}

export function assertSessionArchiveIdle(hasPendingControlWork: boolean): void {
  if (hasPendingControlWork) throw new Error("SESSION_HAS_RUNNING_AGENT");
}

export function planArchivedSessionSelection(
  visibleSessionIds: readonly string[],
  archivedIndex: number,
): string | null {
  return visibleSessionIds[archivedIndex + 1] ?? visibleSessionIds[archivedIndex - 1] ?? null;
}
