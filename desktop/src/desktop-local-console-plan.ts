import type { LocalConsoleSessionSummary } from "../../src/local-console/types.js";

export function decideRequiredLocalConsoleSession(
  sessions: readonly LocalConsoleSessionSummary[],
  sessionId: string,
): LocalConsoleSessionSummary {
  const session = sessions.find((candidate) => candidate.sessionId === sessionId);
  if (session === undefined) {
    throw new Error(`local console session not found: ${sessionId}`);
  }
  return session;
}

export function planLocalConsoleServerAccess(
  isAvailable: boolean,
): "available" | "unavailable" {
  return isAvailable ? "available" : "unavailable";
}
