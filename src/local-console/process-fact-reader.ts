import { readCodexThreadLinks } from "./codex-thread-link-reader.js";
import {
  readExecutionSessionLinks,
  readRunExecutionContexts,
} from "./execution-context-reader.js";
import type { LocalProcessFactReader } from "./process-history.js";

export const localProcessFactReader: LocalProcessFactReader = {
  readCodexThreadLinks,
  readExecutionSessionLinks,
  readRunExecutionContexts,
};
