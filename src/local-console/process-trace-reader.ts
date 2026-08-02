import { readCodexRolloutInvocation } from "./codex-rollout.js";
import { ProcessCursorError, type LocalProcessTraceReader } from "./process-history-contracts.js";
import {
  readProviderTraceAppend,
  readProviderTraceContext,
  readProviderTracePage,
  resolveProviderTrace,
} from "./provider-process-trace.js";
import { TrustedJsonlCursorInvalidError } from "../trusted-jsonl.js";

export const localProcessTraceReader: LocalProcessTraceReader = {
  resolve: resolveProviderTrace,
  readCodexInvocation: readCodexRolloutInvocation,
  readContext: readProviderTraceContext,
  async readPage(input) {
    try {
      return await readProviderTracePage(input);
    } catch (error) {
      if (error instanceof TrustedJsonlCursorInvalidError) throw new ProcessCursorError();
      throw error;
    }
  },
  async readAppend(input) {
    try {
      return await readProviderTraceAppend(input);
    } catch (error) {
      if (error instanceof TrustedJsonlCursorInvalidError) throw new ProcessCursorError();
      throw error;
    }
  },
};
