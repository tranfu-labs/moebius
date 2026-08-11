import { useCallback, useRef } from "react";
import type { Translate } from "@moebius/console-ui";

import type {
  AgentTeamExternalChangeRequest,
  AgentTeamExternalChangeResponse,
} from "../team-external-change-contract.js";
import type { AgentTeamMemberDocument } from "../team-ipc-contract.js";
import {
  planAgentTeamExternalCheck,
  planAgentTeamExternalReloaded,
  planAgentTeamExternalResult,
  planFindOperatorAgentTeam,
} from "./agent-team-console-model.js";
import { planConsoleErrorMessage } from "./console-state-plan.js";
import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";
import type { AgentTeamDraftBundle } from "./use-agent-team-draft-state.js";
import {
  applyAgentTeamMemberExternalChange,
  clearAgentTeamMemberExternalChange,
  failAgentTeamMemberLoad,
  getAgentTeamMemberDraft,
} from "./team-state.js";

interface AgentTeamExternalChangePort {
  checkAgentTeamMemberExternalChange?: (
    request: AgentTeamExternalChangeRequest,
  ) => Promise<AgentTeamExternalChangeResponse>;
}

export function useAgentTeamExternalChange(input: {
  api: AgentTeamExternalChangePort | undefined;
  catalog: AgentTeamCatalogBundle;
  draft: AgentTeamDraftBundle;
  updateSummary(teamKey: string, document: AgentTeamMemberDocument): void;
  /**
   * Called after an external change is RELOADED: the main process persisted the
   * revision before returning `changed`, so refreshing here shows the new
   * timeline entry immediately — no wait for a re-open or a save.
   */
  refreshRevisions(teamKey: string, memberSlug: string): void;
  t: Translate;
}) {
  const inputRef = useRef(input);
  inputRef.current = input;
  return useCallback(async (teamKey: string, memberSlug: string): Promise<void> => {
    const runtime = inputRef.current;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const current = getAgentTeamMemberDraft(runtime.draft.draftsRef.current, teamKey, memberSlug);
    const check = runtime.api?.checkAgentTeamMemberExternalChange;
    if (team === undefined || current?.loadStatus !== "ready" || current.savedMarkdown === null
      || current.saveStatus === "saving" || check === undefined) return;
    const checkKey = `${teamKey}\u0000${memberSlug}`;
    if (planAgentTeamExternalCheck(runtime.draft.externalChecksRef.current.has(checkKey)) === "skip") return;
    runtime.draft.externalChecksRef.current.add(checkKey);
    try {
      const response = await check.call(runtime.api, {
        teamId: team.id,
        ownership: team.ownership,
        memberSlug,
        knownAgentMarkdown: current.savedMarkdown,
      });
      const result = planAgentTeamExternalResult(response);
      if (result.action === "clear") {
        runtime.draft.commitDrafts(clearAgentTeamMemberExternalChange(
          runtime.draft.draftsRef.current,
          teamKey,
          memberSlug,
        ));
        return;
      }
      if (result.action === "ignore") return;
      const nextState = applyAgentTeamMemberExternalChange(
        runtime.draft.draftsRef.current,
        teamKey,
        memberSlug,
        result.document.agentMarkdown,
      );
      runtime.draft.commitDrafts(nextState);
      const reloaded = planAgentTeamExternalReloaded(
        getAgentTeamMemberDraft(nextState, teamKey, memberSlug),
      );
      if (reloaded) {
        runtime.updateSummary(teamKey, result.document);
        // The revision is already durably persisted (the main process awaits
        // it before answering `changed`); refresh the member's history in
        // place so the timeline entry appears without any user action.
        runtime.refreshRevisions(teamKey, memberSlug);
      }
    } catch (error) {
      inputRef.current.draft.commitDrafts(failAgentTeamMemberLoad(
        inputRef.current.draft.draftsRef.current,
        teamKey,
        memberSlug,
        inputRef.current.t("desktop.error.externalCheck", { error: planConsoleErrorMessage(error) }),
      ));
    } finally {
      inputRef.current.draft.externalChecksRef.current.delete(checkKey);
    }
  }, []);
}
