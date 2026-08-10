import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Translate } from "@moebius/console-ui";

import type {
  AgentMarkdownRevisionSummarySettledPayload,
  AgentTeamMemberRevisionsResponse,
  AgentTeamMemberRevisionRestoreResponse,
} from "../team-ipc-contract.js";
import { planSummarySettledTarget } from "../agent-revision-plan.js";
import { planFindOperatorAgentTeam } from "./agent-team-console-model.js";
import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";

export interface AgentTeamRevisionsPort {
  listAgentTeamMemberRevisions?: (
    request: { teamId: string; ownership: "system" | "user"; memberSlug: string },
  ) => Promise<AgentTeamMemberRevisionsResponse>;
  restoreAgentTeamMemberRevision?: (
    request: {
      teamId: string;
      ownership: "system" | "user";
      memberSlug: string;
      revisionId: string;
    },
  ) => Promise<AgentTeamMemberRevisionRestoreResponse>;
}

export type AgentTeamRevisionsByMember = Readonly<Record<string, AgentTeamMemberRevisionsResponse | null>>;
export type AgentTeamRevisionsByTeam = Readonly<Record<string, AgentTeamRevisionsByMember>>;

export interface AgentTeamRevisionsBundle {
  revisions: AgentTeamRevisionsByTeam;
  loadRevisions(teamKey: string, memberSlug: string): void;
  refreshRevisions(teamKey: string, memberSlug: string): void;
  restoreRevision(
    teamKey: string,
    memberSlug: string,
    revisionId: string,
  ): Promise<{ agentMarkdown: string; revision: AgentTeamMemberRevisionRestoreResponse["revision"] }>;
}

function revisionsKey(teamKey: string, memberSlug: string): string {
  return `${teamKey}/${memberSlug}`;
}

export function useAgentTeamRevisions(input: {
  api: AgentTeamRevisionsPort | undefined;
  catalog: AgentTeamCatalogBundle;
  t: Translate;
  /** Main-process push subscription; fires when a summary job reaches a terminal state. */
  subscribeRevisionSummarySettled?: (
    listener: (payload: AgentMarkdownRevisionSummarySettledPayload) => void,
  ) => () => void;
}): AgentTeamRevisionsBundle {
  const inputRef = useRef(input);
  inputRef.current = input;
  const [revisions, setRevisions] = useState<AgentTeamRevisionsByTeam>({});
  const revisionsRef = useRef(revisions);
  revisionsRef.current = revisions;
  const inFlightRef = useRef(new Set<string>());
  // Per-key generation: a refresh bumps the generation so a slower in-flight
  // response from an earlier request can never overwrite newer state (the
  // repository's late-response discipline).
  const generationByKeyRef = useRef(new Map<string, number>());

  const loadRevisions = useCallback((teamKey: string, memberSlug: string, generation?: number) => {
    const runtime = inputRef.current;
    const key = revisionsKey(teamKey, memberSlug);
    const requestGeneration = generation ?? generationByKeyRef.current.get(key) ?? 1;
    generationByKeyRef.current.set(key, requestGeneration);
    if (inFlightRef.current.has(key)) return;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const list = runtime.api?.listAgentTeamMemberRevisions;
    if (team === undefined || list === undefined) return;
    inFlightRef.current.add(key);
    void list.call(runtime.api, {
      teamId: team.id,
      ownership: team.ownership,
      memberSlug,
    }).then((response) => {
      if (generationByKeyRef.current.get(key) !== requestGeneration) {
        return;
      }
      setRevisions((current) => ({
        ...current,
        [teamKey]: { ...current[teamKey], [memberSlug]: response },
      }));
    }).catch(() => {
      // Revisions are presentational; a failed read must never break editing.
    }).finally(() => {
      inFlightRef.current.delete(key);
    });
  }, []);

  const refreshRevisions = useCallback((teamKey: string, memberSlug: string) => {
    const key = revisionsKey(teamKey, memberSlug);
    const nextGeneration = (generationByKeyRef.current.get(key) ?? 1) + 1;
    generationByKeyRef.current.set(key, nextGeneration);
    inFlightRef.current.delete(key);
    // The previous response stays mounted while the reload is in flight: the
    // recent-change line, change markers and the expanded timeline must not
    // flash out on save or on a summary-settled refresh.
    loadRevisions(teamKey, memberSlug, nextGeneration);
  }, [loadRevisions]);

  useEffect(() => {
    return inputRef.current.subscribeRevisionSummarySettled?.((payload) => {
      const runtime = inputRef.current;
      const target = planSummarySettledTarget({
        catalog: runtime.catalog.state,
        revisions: revisionsRef.current,
        payload,
      });
      if (target !== null) {
        refreshRevisions(target.teamKey, target.memberSlug);
      }
    });
  }, [refreshRevisions]);

  const restoreRevision = useCallback(async (
    teamKey: string,
    memberSlug: string,
    revisionId: string,
  ): Promise<{ agentMarkdown: string; revision: AgentTeamMemberRevisionRestoreResponse["revision"] }> => {
    const runtime = inputRef.current;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const restore = runtime.api?.restoreAgentTeamMemberRevision;
    if (team === undefined || restore === undefined) {
      throw new Error(runtime.t("desktop.error.agentSave"));
    }
    const response = await restore.call(runtime.api, {
      teamId: team.id,
      ownership: team.ownership,
      memberSlug,
      revisionId,
    });
    refreshRevisions(teamKey, memberSlug);
    return { agentMarkdown: response.agentMarkdown, revision: response.revision };
  }, [refreshRevisions]);

  return useMemo(() => ({
    revisions,
    loadRevisions,
    refreshRevisions,
    restoreRevision,
  }), [loadRevisions, refreshRevisions, restoreRevision, revisions]);
}
