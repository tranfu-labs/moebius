import type { LocalProcessTraceReader } from "./process-history-contracts.js";
import { ProcessCursorError } from "./process-history-contracts.js";
import {
  decideProcessHistoryContinuation,
  decideProcessAttemptsAvailability,
  planProcessHistoryResult,
  planProcessHistoryStart,
  planProcessHistoryStep,
  planProcessIntroSlice,
  planUnavailableProcessPage,
  type LoadLocalProcessHistoryOptions,
  type LocalConsoleProcessHistoryPage,
} from "./process-history.js";
import { loadLocalProcessAttempts } from "./process-attempts-runtime.js";
import { loadLocalProcessOutputIteration } from "./process-history-output-runtime.js";

const DEFAULT_PAGE_BYTES = 256 * 1024;
const DEFAULT_PAGE_EVENTS = 80;

export async function loadLocalProcessHistoryPage(
  options: LoadLocalProcessHistoryOptions & { traceReader: LocalProcessTraceReader },
): Promise<LocalConsoleProcessHistoryPage> {
  const prepared = await loadLocalProcessAttempts(options);
  const availability = decideProcessAttemptsAvailability(prepared);
  if (availability.kind === "unavailable") {
    return planUnavailableProcessPage(
      options,
      availability.prepared.unavailableReason,
      availability.prepared.unavailableEngine,
    );
  }
  const available = availability.prepared;
  let accumulator = planProcessHistoryStart({
    options,
    attempts: available.attempts,
    sourceMessageId: available.sourceMessageId,
    defaultPageBytes: DEFAULT_PAGE_BYTES,
    defaultPageEvents: DEFAULT_PAGE_EVENTS,
  });
  while (decideProcessHistoryContinuation(accumulator)) {
    const step = planProcessHistoryStep(
      available.attempts[accumulator.state.attemptIndex],
      accumulator.state,
    );
    if (step.kind === "invalid") throw new ProcessCursorError();
    if (step.kind === "output") {
      accumulator = await loadLocalProcessOutputIteration({
        accumulator,
        options,
        attempt: step.attempt,
        attempts: available.attempts,
        sourceMessageId: available.sourceMessageId,
        traceReader: options.traceReader,
      });
      continue;
    }
    accumulator = planProcessIntroSlice({
      accumulator,
      options,
      attempts: available.attempts,
      attempt: step.attempt,
      sourceMessageId: available.sourceMessageId,
    });
  }
  return planProcessHistoryResult({ options, prepared: available, accumulator });
}
