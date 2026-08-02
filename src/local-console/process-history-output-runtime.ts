import type { LocalProcessTraceReader } from "./process-history-contracts.js";
import {
  planProcessOutputRequest,
  planProcessOutputSlice,
  planUnavailableProcessOutput,
  type LoadLocalProcessHistoryOptions,
  type ProcessHistoryAccumulator,
  type ResolvedAttempt,
} from "./process-history.js";

export async function loadLocalProcessOutputIteration(input: {
  accumulator: ProcessHistoryAccumulator;
  options: LoadLocalProcessHistoryOptions;
  attempt: ResolvedAttempt;
  attempts: ResolvedAttempt[];
  sourceMessageId: number;
  traceReader: LocalProcessTraceReader;
}): Promise<ProcessHistoryAccumulator> {
  const request = planProcessOutputRequest({
    attempt: input.attempt,
    state: input.accumulator.state as Extract<ProcessHistoryAccumulator["state"], { stage: "output" }>,
    remainingBytes: input.accumulator.remainingBytes,
    remainingEvents: input.accumulator.remainingEvents,
  });
  if (request.kind === "intro") {
    return planUnavailableProcessOutput(input);
  }
  const slice = await input.traceReader.readPage(request.request);
  return planProcessOutputSlice({
    ...input,
    slice,
    attemptCount: input.attempts.length,
  });
}
