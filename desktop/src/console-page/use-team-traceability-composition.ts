import { useCallback } from "react";

import {
  loadRunAgentInfo,
  loadRunAgentMarkdown,
  loadSessionTeamUpdate,
  mutateSessionTeamUpdate,
} from "./console-api-client.js";
import { fetchFromBrowser as fetch } from "./browser-fetch.js";
import { useSessionTeamUpdate } from "./use-session-team-update.js";

export function useTeamTraceabilityComposition(input: {
  apiBase: string | null;
  sessionId: string | null;
  sessionRevision: string | null;
}) {
  const inspect = useCallback(
    (options: Omit<Parameters<typeof loadSessionTeamUpdate>[0], "fetch">) =>
      loadSessionTeamUpdate({ ...options, fetch }),
    [],
  );
  const mutate = useCallback(
    (options: Omit<Parameters<typeof mutateSessionTeamUpdate>[0], "fetch">) =>
      mutateSessionTeamUpdate({ ...options, fetch }),
    [],
  );
  const sessionTeamUpdate = useSessionTeamUpdate({ ...input, load: inspect, mutate });
  const loadHistoricalRunAgentInfo = useCallback(({ sessionId, runId, signal }: {
    sessionId: string;
    runId: string;
    signal: AbortSignal;
  }) => input.apiBase === null
    ? Promise.reject(new Error("local console unavailable"))
    : loadRunAgentInfo({ apiBase: input.apiBase, sessionId, runId, signal, fetch }), [input.apiBase]);
  const loadHistoricalRunAgentMarkdown = useCallback(({ sessionId, runId, signal }: {
    sessionId: string;
    runId: string;
    signal: AbortSignal;
  }) => input.apiBase === null
    ? Promise.reject(new Error("local console unavailable"))
    : loadRunAgentMarkdown({ apiBase: input.apiBase, sessionId, runId, signal, fetch }), [input.apiBase]);
  return { sessionTeamUpdate, loadHistoricalRunAgentInfo, loadHistoricalRunAgentMarkdown };
}
