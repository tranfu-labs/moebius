export function shouldTrackSeedConflictRecovery(input: {
  teamId: string;
  generalAssistantTeamId: string;
  preserveConflicts: boolean | undefined;
}): boolean {
  return input.teamId === input.generalAssistantTeamId && input.preserveConflicts === true;
}

export function selectSeedConflictRecoveryDirectory(input: {
  current: string | null;
  copiedDirectory: string;
  teamId: string;
  generalAssistantTeamId: string;
  preserveConflicts: boolean | undefined;
}): string | null {
  return shouldTrackSeedConflictRecovery(input) ? input.copiedDirectory : input.current;
}

export function deriveBuiltInTeamSeedStatus(
  conflictCount: number,
  copiedTeamCount: number,
): "seeded" | "skipped" | "conflict" {
  return conflictCount > 0 ? "conflict" : copiedTeamCount > 0 ? "seeded" : "skipped";
}

export function assertSeedEntryIsNotReserved(
  relativePath: string,
  reservedMarkerFile: string,
): void {
  if (relativePath === reservedMarkerFile) {
    throw new Error(`${reservedMarkerFile} is reserved and cannot be packaged as team seed content`);
  }
}
