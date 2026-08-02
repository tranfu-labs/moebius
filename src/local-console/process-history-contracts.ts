import type { readCodexRolloutInvocation } from "./codex-rollout.js";
import type {
  readProviderTraceAppend,
  readProviderTraceContext,
  readProviderTracePage,
  resolveProviderTrace,
} from "./provider-process-trace.js";

export class ProcessCursorError extends Error {
  constructor() {
    super("invalid process history cursor");
    this.name = "ProcessCursorError";
  }
}

export interface LocalProcessTraceReader {
  resolve(input: Parameters<typeof resolveProviderTrace>[0]): ReturnType<typeof resolveProviderTrace>;
  readCodexInvocation(
    input: Parameters<typeof readCodexRolloutInvocation>[0],
  ): ReturnType<typeof readCodexRolloutInvocation>;
  readContext(
    input: Parameters<typeof readProviderTraceContext>[0],
  ): ReturnType<typeof readProviderTraceContext>;
  readPage(input: Parameters<typeof readProviderTracePage>[0]): ReturnType<typeof readProviderTracePage>;
  readAppend(input: Parameters<typeof readProviderTraceAppend>[0]): ReturnType<typeof readProviderTraceAppend>;
}
