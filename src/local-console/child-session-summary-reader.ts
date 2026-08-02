import { LOCAL_CONSOLE_STORE_TIMEOUT_MS } from "../config.js";
import { runSqliteStateCommand } from "../sqlite-state.js";
import {
  summarizeChildSessions,
  type ChildSessionSummarySource,
} from "./child-session-summary.js";
import type { LocalConsoleChildSessionSummary } from "./types.js";

export interface ChildSessionSummaryCommandOptions {
  sqlitePath: string;
  busyTimeoutMs?: number;
  timeoutMs?: number;
}

export async function listLocalChildSessionSummaries(
  options: ChildSessionSummaryCommandOptions,
  parentSessionId: string,
): Promise<LocalConsoleChildSessionSummary[]> {
  const sources = await runSqliteStateCommand<ChildSessionSummarySource[]>({
    sqlitePath: options.sqlitePath,
    busyTimeoutMs: options.busyTimeoutMs,
    timeoutMs: options.timeoutMs ?? LOCAL_CONSOLE_STORE_TIMEOUT_MS,
    readOnly: true,
    command: { kind: "local-list-child-session-summary-sources", parentSessionId },
  });
  return summarizeChildSessions(parentSessionId, sources);
}
