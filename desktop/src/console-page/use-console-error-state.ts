import { useMemo, useRef, useState } from "react";

import {
  beginConsoleErrorOperation,
  createConsoleErrorState,
  failConsoleErrorOperation,
  selectVisibleConsoleError,
  succeedConsoleErrorOperation,
  type ConsoleErrorOperation,
  type ConsoleErrorSource,
  type ConsoleErrorState,
} from "./console-error-model.js";

export interface ConsoleErrorController {
  begin(source: ConsoleErrorSource): ConsoleErrorOperation;
  fail(operation: ConsoleErrorOperation, message: string): void;
  succeed(operation: ConsoleErrorOperation): void;
  report(source: ConsoleErrorSource, message: string): void;
}

export function useConsoleErrorState() {
  const [state, setState] = useState(createConsoleErrorState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const controller = useMemo<ConsoleErrorController>(() => {
    const commit = (next: ConsoleErrorState): void => {
      stateRef.current = next;
      setState(next);
    };
    return {
      begin(source) {
        const begun = beginConsoleErrorOperation(stateRef.current, source);
        commit(begun.state);
        return begun.operation;
      },
      fail(operation, message) {
        commit(failConsoleErrorOperation(stateRef.current, operation, message));
      },
      succeed(operation) {
        commit(succeedConsoleErrorOperation(stateRef.current, operation));
      },
      report(source, message) {
        const begun = beginConsoleErrorOperation(stateRef.current, source);
        commit(failConsoleErrorOperation(begun.state, begun.operation, message));
      },
    };
  }, []);

  return useMemo(() => ({
    controller,
    visibleMessage: selectVisibleConsoleError(state),
  }), [controller, state]);
}
