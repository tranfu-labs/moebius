import { useMemo } from "react";

import { fetchFromBrowser as fetch } from "./browser-fetch.js";
import { loadClaudeTerminalTrace } from "./console-api-client.js";
import {
  planVisibleClaudeTerminalTraceRuns,
  type ClaudeTerminalTracePort,
} from "./claude-terminal-trace-model.js";
import {
  OperatorConsoleView,
  type OperatorConsoleViewProps,
} from "./operator-console-view.js";
import { useClaudeTerminalTraces } from "./use-claude-terminal-traces.js";

const claudeTerminalTracePort: ClaudeTerminalTracePort = {
  load: (input) => loadClaudeTerminalTrace({ ...input, fetch }),
};

/** Composition root: injects loopback trace IO before passing pure state to the view. */
export function ClaudeTerminalTraceOperatorConsole(
  props: Omit<OperatorConsoleViewProps, "claudeTerminalTraces">,
): JSX.Element {
  const activeRuns = useMemo(() => planVisibleClaudeTerminalTraceRuns(
    props.presentation.activeRuns,
    props.presentation.subSessionViews,
  ), [props.presentation.activeRuns, props.presentation.subSessionViews]);
  const claudeTerminalTraces = useClaudeTerminalTraces(
    props.desktopShell.runtime.apiBase,
    activeRuns,
    claudeTerminalTracePort,
  );
  return <OperatorConsoleView {...props} claudeTerminalTraces={claudeTerminalTraces} />;
}
