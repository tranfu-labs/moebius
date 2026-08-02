import type { ProviderTraceLink } from "./provider-process-trace.js";
import {
  planProcessLinks,
  type LocalProcessFactReader,
} from "./process-history.js";

export async function loadLocalProcessLinks(input: {
  factReader: LocalProcessFactReader;
  logPath: string;
  sessionId: string;
}): Promise<ProviderTraceLink[]> {
  const [executionLinks, legacyLinks] = await Promise.all([
    input.factReader.readExecutionSessionLinks(input.logPath, input.sessionId),
    input.factReader.readCodexThreadLinks(input.logPath, input.sessionId),
  ]);
  return planProcessLinks(executionLinks, legacyLinks);
}
