import type { ResolveCodexRolloutOptions } from "./codex-rollout.js";
import type { LocalRunExecutionContextFact } from "./execution-context.js";
import type { LocalProcessTraceReader } from "./process-history-contracts.js";
import {
  planCodexDebugInvocation,
  planDebugProcessSource,
  planDebugTraceResolution,
  planNativeDebugInvocation,
  planTraceOptions,
  planUnavailableProcessInvocation,
  type LocalConsoleProcessDebugInvocation,
  type LocalProcessFactReader,
} from "./process-history.js";
import { loadLocalProcessLinks } from "./process-link-runtime.js";
import type { ProviderTraceResolverOptions } from "./provider-process-trace.js";

export async function loadLocalProcessDebugInvocation(options: {
  sessionId: string;
  runId: string;
  sessionFactLogPath: string;
  factReader: LocalProcessFactReader;
  traceReader: LocalProcessTraceReader;
  rollout?: ResolveCodexRolloutOptions;
  trace?: ProviderTraceResolverOptions;
}): Promise<LocalConsoleProcessDebugInvocation> {
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
    return planUnavailableProcessInvocation(options, "link-invalid");
  }
  const source = planDebugProcessSource({ links, contexts, runId: options.runId });
  if (source.kind === "unavailable") {
    return planUnavailableProcessInvocation(options, "link-missing");
  }
  const trace = planDebugTraceResolution(await options.traceReader.resolve({
    link: source.link,
    context: source.context,
    options: planTraceOptions(options),
  }));
  if (trace.kind === "unavailable") {
    return planUnavailableProcessInvocation(options, trace.reason);
  }
  if (trace.kind === "codex") {
    try {
      return planCodexDebugInvocation({
        options,
        link: source.link,
        context: source.context,
        invocation: await options.traceReader.readCodexInvocation({ resolution: trace.resolution.codex }),
      });
    } catch {
      return planUnavailableProcessInvocation(options, "cursor-invalid");
    }
  }
  return planNativeDebugInvocation({
    options,
    link: source.link,
    context: source.context,
    resolution: trace.resolution,
    providerContext: await options.traceReader.readContext(trace.resolution),
  });
}
