import type { LocalConsoleSessionSummary } from "../../src/local-console/types.js";
import type { DesktopStatusSnapshot } from "./status.js";

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

export function decideLocalConsoleUrl(
  status: DesktopStatusSnapshot["localConsole"],
): string | null {
  return status.status === "running" ? status.url ?? null : null;
}

export function decideLocalConsoleRunningTaskCount(
  server: { runtime: { getRunningTaskCount(): number } } | null | undefined,
): number {
  return server === undefined || server === null ? 0 : server.runtime.getRunningTaskCount();
}
