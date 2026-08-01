import type { LocalRunExecutionContextFact } from "./execution-context.js";
import {
  ProcessCursorError,
  type LocalProcessTraceReader,
} from "./process-history-contracts.js";
import {
  decideAvailableProviderTrace,
  planAppendProcessSelection,
  planExpectedIdentity,
  planProcessAppendResult,
  planTraceOptions,
  type LoadLocalProcessAppendOptions,
  type LocalConsoleProcessAppendPage,
} from "./process-history.js";
import { loadLocalProcessLinks } from "./process-link-runtime.js";

export async function loadLocalProcessAppendPage(
  options: LoadLocalProcessAppendOptions & { traceReader: LocalProcessTraceReader },
): Promise<LocalConsoleProcessAppendPage> {
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
    throw new ProcessCursorError();
  }
  const selection = planAppendProcessSelection({ links, options });
  if (selection.kind === "invalid") throw new ProcessCursorError();
  const trace = decideAvailableProviderTrace(await options.traceReader.resolve({
    link: selection.link,
    context: contexts.find((candidate) => candidate.runId === selection.link.runId),
    options: planTraceOptions(options),
  }));
  if (trace.kind === "invalid") throw new ProcessCursorError();
  const slice = await options.traceReader.readAppend({
    resolution: trace.resolution,
    runId: selection.link.runId,
    startOffset: selection.cursor.position,
    expectedIdentity: planExpectedIdentity(trace.resolution, selection.cursor.identity),
    minimumSize: selection.cursor.identity.minimumSize,
    maxBytes: options.maxBytes,
    maxEvents: options.maxEvents,
  });
  return planProcessAppendResult({ options, selection, slice });
}
