import {
  decideLocalClaudeNativePromptController,
  decideLocalClaudeNativePromptClear,
  decideLocalClaudeNativePromptSelection,
} from "./active-run.js";
import type { LocalActiveRunRegistry } from "./active-run-registry.js";
import type {
  ClaudeTuiNativePromptSelectionInput,
  ClaudeTuiNativePromptSelectionResult,
} from "../claude.js";

export class LocalClaudeNativePromptRuntime {
  constructor(private readonly input: {
    controller?: (input: ClaudeTuiNativePromptSelectionInput) => ClaudeTuiNativePromptSelectionResult;
    activeRuns: LocalActiveRunRegistry;
  }) {}

  select(input: ClaudeTuiNativePromptSelectionInput): ClaudeTuiNativePromptSelectionResult {
    const result = decideLocalClaudeNativePromptController(this.input.controller, input);
    const selection = decideLocalClaudeNativePromptSelection(result);
    if (selection.kind === "clear") {
      for (const active of this.input.activeRuns.values()) {
        const target = decideLocalClaudeNativePromptClear(active, input);
        if (target.kind === "clear") {
          target.active.nativePromptDecision = null;
          this.input.activeRuns.touch(active.runId);
        }
      }
    }
    return result;
  }
}
