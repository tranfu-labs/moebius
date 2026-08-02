import type { ConsoleSelection } from "./console-state-coordinator.js";
import type { ConsolePresentationRoute } from "./presentation-route.js";

export function planArchivedSessionNavigation(input: {
  sessionId: string;
  presentationRoute: ConsolePresentationRoute | null;
  selection: ConsoleSelection;
}): { kind: "restore-main"; selection: ConsoleSelection } | { kind: "retain-host"; hostSessionId: string } {
  return input.presentationRoute?.selectedSessionId === input.sessionId
    ? { kind: "restore-main", selection: input.selection }
    : {
        kind: "retain-host",
        hostSessionId: input.presentationRoute?.hostSessionId ?? input.selection.sessionId,
      };
}

export function planArchivedSessionResult(
  archivedSessionIds: string[] | null,
): { kind: "skip" } | { kind: "commit"; archivedSessionIds: string[] } {
  return archivedSessionIds === null
    ? { kind: "skip" }
    : { kind: "commit", archivedSessionIds };
}

export function planActiveHostSessionId(
  presentationRoute: ConsolePresentationRoute | null,
  selection: ConsoleSelection,
): string {
  return presentationRoute?.hostSessionId ?? selection.sessionId;
}

export function decideSessionLogCopyAvailability(available: boolean): "copy" | "unavailable" {
  return available ? "copy" : "unavailable";
}
