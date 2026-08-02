import { vi } from "vitest";

import type { ConsoleErrorOperation } from "../src/console-page/console-error-model.js";
import {
  beginConsoleErrorOperation,
  createConsoleErrorState,
  failConsoleErrorOperation,
  selectVisibleConsoleError,
  succeedConsoleErrorOperation,
} from "../src/console-page/console-error-model.js";
import type { ConsoleErrorController } from "../src/console-page/use-console-error-state.js";

export function createTestConsoleErrorController() {
  let generation = 0;
  const messages: string[] = [];
  const begin = vi.fn<ConsoleErrorController["begin"]>((source) => ({
    sourceKey: source.scope === undefined ? source.family : `${source.family}:${source.scope}`,
    generation: ++generation,
  }));
  const fail = vi.fn((operation: ConsoleErrorOperation, message: string) => {
    void operation;
    messages.push(message);
  });
  const succeed = vi.fn((operation: ConsoleErrorOperation) => { void operation; });
  const report = vi.fn<ConsoleErrorController["report"]>((source, message) => {
    void source;
    messages.push(message);
  });
  const controller: ConsoleErrorController = { begin, fail, succeed, report };
  return { controller, begin, fail, succeed, report, messages };
}

export function createTestConsoleErrorSetter(
  setError: (message: string | null) => void,
): ConsoleErrorController {
  const harness = createTestConsoleErrorController();
  harness.fail.mockImplementation((_operation, message) => setError(message));
  harness.report.mockImplementation((_source, message) => setError(message));
  harness.succeed.mockImplementation(() => setError(null));
  return harness.controller;
}

export function createModelConsoleErrorController() {
  let state = createConsoleErrorState();
  const controller: ConsoleErrorController = {
    begin(source) {
      const begun = beginConsoleErrorOperation(state, source);
      state = begun.state;
      return begun.operation;
    },
    fail(operation, message) {
      state = failConsoleErrorOperation(state, operation, message);
    },
    succeed(operation) {
      state = succeedConsoleErrorOperation(state, operation);
    },
    report(source, message) {
      const begun = beginConsoleErrorOperation(state, source);
      state = failConsoleErrorOperation(begun.state, begun.operation, message);
    },
  };
  return {
    controller,
    visibleMessage: () => selectVisibleConsoleError(state),
  };
}
