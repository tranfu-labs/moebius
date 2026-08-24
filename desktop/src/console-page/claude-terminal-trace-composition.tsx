import { useMemo } from "react";
import type { OperatorNativePromptSelection } from "@moebius/console-ui";

import { fetchFromBrowser as fetch } from "./browser-fetch.js";
import {
  loadClaudeTerminalTrace,
  selectClaudeNativePrompt as selectClaudeNativePromptRequest,
} from "./console-api-client.js";
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
  props: Omit<OperatorConsoleViewProps, "claudeTerminalTraces" | "selectClaudeNativePrompt">,
): JSX.Element {
  const activeRuns = useMemo(() => planVisibleClaudeTerminalTraceRuns(
    props.presentation.activeRuns,
    props.presentation.subSessionViews,
  ), [props.presentation.activeRuns, props.presentation.subSessionViews]);
  const processOutputs = useMemo(
    () => Object.values(props.rightSidebar.processData.outputs)
      .flatMap((state) => state.status === "ready" ? [state.output] : []),
    [props.rightSidebar.processData.outputs],
  );
  const claudeTerminalTraces = useClaudeTerminalTraces(
    props.desktopShell.runtime.apiBase,
    activeRuns,
    claudeTerminalTracePort,
    processOutputs,
  );
  const selectClaudeNativePrompt = async (input: OperatorNativePromptSelection): Promise<void> => {
    const apiBase = props.desktopShell.runtime.apiBase;
    if (apiBase === null) {
      throw new Error("Local console API is unavailable");
    }
    await selectClaudeNativePromptRequest({
      ...input,
      apiBase,
      fetch,
    });
  };
  return (
    <OperatorConsoleView
      {...props}
      claudeTerminalTraces={claudeTerminalTraces}
      selectClaudeNativePrompt={selectClaudeNativePrompt}
    />
  );
}
