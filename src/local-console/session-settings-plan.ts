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
