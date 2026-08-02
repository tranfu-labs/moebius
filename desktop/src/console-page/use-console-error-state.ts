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
import { decideConsoleErrorCommit } from "./console-state-plan.js";

export interface ConsoleErrorController {
  begin(source: ConsoleErrorSource): ConsoleErrorOperation;
  fail(operation: ConsoleErrorOperation, message: string): void;
  succeed(operation: ConsoleErrorOperation): void;
  report(source: ConsoleErrorSource, message: string): void;
}

export function useConsoleErrorState() {
  const [state, setState] = useState(createConsoleErrorState);
  const stateRef = useRef(state);

  const controller = useMemo<ConsoleErrorController>(() => {
    const commit = (next: ConsoleErrorState): void => {
      const previousVisibleMessage = selectVisibleConsoleError(stateRef.current);
      stateRef.current = next;
      if (decideConsoleErrorCommit(previousVisibleMessage, selectVisibleConsoleError(next)) === "commit") {
        setState(next);
      }
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
