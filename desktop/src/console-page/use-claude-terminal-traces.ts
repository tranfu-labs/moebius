import type {
  OperatorClaudeTerminalTraces,
  OperatorRunSnapshot,
} from "@moebius/console-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { decideRemoteViewCommit } from "./console-state-plan.js";
import {
  decideClaudeTerminalTracePageCommit,
  decideClaudeTerminalTraceRequest,
  isClaudeTerminalTraceUnavailableError,
  planClaudeTerminalTraceCursor,
  planClaudeTerminalTraceFailureState,
  planClaudeTerminalTracePageState,
  planClaudeTerminalTracePolling,
  planClaudeTerminalTraceTargetSignature,
  planClaudeTerminalTraceTargets,
  planClaudeTerminalTraceViews,
  type ClaudeTerminalTracePort,
  type ClaudeTerminalTraceStates,
} from "./claude-terminal-trace-model.js";

const CLAUDE_TERMINAL_POLL_MS = 250;

/**
 * Polls the active Claude-only terminal trace with a monotonic cursor. This
 * lives outside console-ui so the presentational package never owns network IO.
 */
export function useClaudeTerminalTraces(
  apiBase: string | null,
  activeRuns: readonly OperatorRunSnapshot[],
  port: ClaudeTerminalTracePort,
): OperatorClaudeTerminalTraces {
  const [traces, setTraces] = useState<ClaudeTerminalTraceStates>({});
  const tracesRef = useRef(traces);
  tracesRef.current = traces;
  const commit = useCallback((update: (current: ClaudeTerminalTraceStates) => ClaudeTerminalTraceStates) => {
    setTraces((current) => {
      const next = update(current);
      tracesRef.current = next;
      return next;
    });
  }, []);
  const targetSignature = planClaudeTerminalTraceTargetSignature(activeRuns);
  const targets = useMemo(() => planClaudeTerminalTraceTargets(activeRuns), [targetSignature]);

  useEffect(() => {
    const polling = planClaudeTerminalTracePolling({ apiBase, targets, current: tracesRef.current });
    commit(() => polling.states);
    if (polling.kind === "skip") return;

    const controller = new AbortController();
    let timer: number | undefined;
    let inFlight = false;
    const refresh = async (): Promise<void> => {
      if (decideClaudeTerminalTraceRequest(inFlight) === "wait") return;
      inFlight = true;
      try {
        await Promise.all(polling.targets.map(async (target) => {
          const current = tracesRef.current[target.key];
          try {
            const page = await port.load({
              apiBase: polling.apiBase,
              sessionId: target.sessionId,
              runId: target.runId,
              cursor: planClaudeTerminalTraceCursor(current),
              signal: controller.signal,
            });
            if (decideClaudeTerminalTracePageCommit({
              aborted: controller.signal.aborted,
              target,
              page,
            }) === "commit") {
              commit((latest) => ({
                ...latest,
                [target.key]: planClaudeTerminalTracePageState(latest[target.key], page),
              }));
            }
          } catch (error) {
            if (decideRemoteViewCommit(controller.signal.aborted) === "commit") {
              commit((latest) => ({
                ...latest,
                [target.key]: planClaudeTerminalTraceFailureState(
                  latest[target.key],
                  isClaudeTerminalTraceUnavailableError(error),
                ),
              }));
            }
          }
        }));
      } finally {
        inFlight = false;
        if (decideRemoteViewCommit(controller.signal.aborted) === "commit") {
          timer = window.setTimeout(() => void refresh(), CLAUDE_TERMINAL_POLL_MS);
        }
      }
    };
    void refresh();
    return () => {
      window.clearTimeout(timer);
      controller.abort("Claude terminal trace target changed");
    };
  }, [apiBase, commit, port, targets]);

  return useMemo(() => planClaudeTerminalTraceViews(targets, traces), [targets, traces]);
}
