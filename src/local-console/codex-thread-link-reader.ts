import { projectCodexThreadLinks, type LocalCodexThreadLinkFact } from "./codex-thread-link.js";
import { readSessionFactLog } from "./session-fact-log.js";

export async function readCodexThreadLinks(
  logPath: string,
  sessionId: string,
): Promise<LocalCodexThreadLinkFact[]> {
  const snapshot = await readSessionFactLog(logPath, sessionId);
  return snapshot === null ? [] : projectCodexThreadLinks(snapshot.values, sessionId);
}
