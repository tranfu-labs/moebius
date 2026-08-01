import type { LocalRunExecutionContextFact } from "./execution-context.js";
import type { LocalProcessTraceReader } from "./process-history-contracts.js";
import {
  planProcessAttemptMetadata,
  planProcessAttemptSelection,
  planTraceOptions,
  type LoadLocalProcessHistoryOptions,
  type ProcessAttemptsPreparation,
  type ResolvedAttempt,
} from "./process-history.js";
import { loadLocalProcessLinks } from "./process-link-runtime.js";

export async function loadLocalProcessAttempts(
  options: LoadLocalProcessHistoryOptions & { traceReader: LocalProcessTraceReader },
): Promise<ProcessAttemptsPreparation> {
  let links;
  let contexts: LocalRunExecutionContextFact[];
  try {
    [links, contexts] = await Promise.all([
      loadLocalProcessLinks({
        factReader: options.factReader,
        logPath: options.sessionFactLogPath,
        sessionId: options.sessionId,
      }),
      options.factReader.readRunExecutionContexts(options.sessionFactLogPath, options.sessionId),
    ]);
  } catch {
    return { kind: "unavailable", unavailableReason: "link-invalid", unavailableEngine: null };
  }
  const selection = planProcessAttemptSelection({
    links,
    contexts,
    requestedRunId: options.requestedRunId,
  });
  if (selection.kind === "unavailable") {
    return {
      kind: "unavailable",
      unavailableReason: selection.reason,
      unavailableEngine: selection.engine,
    };
  }
  const meta = planProcessAttemptMetadata({
    grouped: selection.grouped,
    contexts,
    messages: options.messages,
    activeRunIds: options.activeRunIds,
  });
  const attempts: ResolvedAttempt[] = [];
  for (const [index, link] of selection.grouped.entries()) {
    const resolution = await options.traceReader.resolve({
      link,
      context: contexts.find((candidate) => candidate.runId === link.runId),
      options: planTraceOptions(options),
    });
    attempts.push({ link, meta: meta[index]!, resolution });
  }
  return {
    kind: "available",
    attempts,
    meta,
    anchor: selection.anchor,
    sourceMessageId: selection.anchor.sourceMessageId,
  };
}
