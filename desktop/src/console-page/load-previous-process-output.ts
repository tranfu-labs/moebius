import {
  decidePreviousProcessOutputCommit,
  planPreviousProcessOutputFailed,
  planPreviousProcessOutputLoaded,
  planPreviousProcessOutputLoading,
  planPreviousProcessOutputRequest,
} from "./console-process-model.js";
import { planConsoleErrorMessage } from "./console-state-plan.js";
import type { ProcessDataSyncPort, ProcessOutputState } from "./process-data-sync-contract.js";
import type { ConsoleErrorController } from "./use-console-error-state.js";

type ProcessOutputs = Record<string, ProcessOutputState>;

export async function loadPreviousProcessOutput(input: {
  apiBase: string | null;
  sourceKey: string;
  cursor: string;
  selectedSessionId: string;
  currentSelectionId(): string;
  currentOutputs(): ProcessOutputs;
  commit(update: (current: ProcessOutputs) => ProcessOutputs): void;
  port: ProcessDataSyncPort;
  errors: ConsoleErrorController;
}): Promise<void> {
  const request = planPreviousProcessOutputRequest(
    input.apiBase,
    input.sourceKey,
    input.selectedSessionId,
    input.currentOutputs()[input.sourceKey],
  );
  if (request.kind === "skip") return;
  const errorOperation = input.errors.begin({ family: "process-data", scope: input.sourceKey });
  input.commit((states) => ({
    ...states,
    [input.sourceKey]: planPreviousProcessOutputLoading(states[input.sourceKey]),
  }));
  try {
    const page = await input.port.loadOutput({ ...request, cursor: input.cursor });
    if (decidePreviousProcessOutputCommit(
      input.currentSelectionId(),
      input.selectedSessionId,
    ) === "ignore") return;
    input.commit((states) => ({
      ...states,
      [input.sourceKey]: planPreviousProcessOutputLoaded(
        states[input.sourceKey],
        page,
      ) ?? states[input.sourceKey]!,
    }));
    input.errors.succeed(errorOperation);
  } catch (error) {
    if (decidePreviousProcessOutputCommit(
      input.currentSelectionId(),
      input.selectedSessionId,
    ) === "ignore") return;
    input.commit((states) => ({
      ...states,
      [input.sourceKey]: planPreviousProcessOutputFailed(
        states[input.sourceKey],
      ) ?? states[input.sourceKey]!,
    }));
    input.errors.fail(errorOperation, planConsoleErrorMessage(error));
  }
}
