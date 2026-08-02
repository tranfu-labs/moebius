import { useCallback, useMemo, useRef } from "react";
import type { Translate } from "@moebius/console-ui";

import type { AgentTeamMemberDocument, AgentTeamMemberRequest } from "../team-ipc-contract.js";
import { tryParseAgentMarkdownIdentity } from "../team-model.js";
import {
  planAgentTeamExternalMarkdown,
  planAgentTeamMemberLoad,
  planAgentTeamMemberSummary,
  planFindOperatorAgentTeam,
} from "./agent-team-console-model.js";
import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";
import type { AgentTeamDraftBundle } from "./use-agent-team-draft-state.js";
import {
  failAgentTeamMemberLoad,
  finishAgentTeamMemberLoad,
  getAgentTeamMemberDraft,
  loadAgentTeamMemberExternalVersion,
  startAgentTeamMemberLoad,
} from "./team-state.js";
import { planConsoleErrorMessage } from "./console-state-plan.js";

interface AgentTeamMemberLoadingPort {
  readAgentTeamMember?: (request: AgentTeamMemberRequest) => Promise<AgentTeamMemberDocument>;
}

export function useAgentTeamMemberLoading(input: {
  api: AgentTeamMemberLoadingPort | undefined;
  catalog: AgentTeamCatalogBundle;
  draft: AgentTeamDraftBundle;
  t: Translate;
}) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const updateSummary = useCallback((teamKey: string, document: AgentTeamMemberDocument) => {
    inputRef.current.catalog.setState((current) =>
      planAgentTeamMemberSummary(current, teamKey, document));
  }, []);
  const loadMember = useCallback(async (teamKey: string, memberSlug: string) => {
    const runtime = inputRef.current;
    const current = getAgentTeamMemberDraft(runtime.draft.draftsRef.current, teamKey, memberSlug);
    if (planAgentTeamMemberLoad(current) === "skip") return;
    runtime.draft.commitDrafts(startAgentTeamMemberLoad(
      runtime.draft.draftsRef.current,
      teamKey,
      memberSlug,
    ));
    try {
      const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
      const readMember = runtime.api?.readAgentTeamMember;
      if (team === undefined || readMember === undefined) {
        throw new Error(runtime.t("desktop.error.agentRead"));
      }
      const document = await readMember.call(runtime.api, {
        teamId: team.id,
        ownership: team.ownership,
        memberSlug,
      });
      inputRef.current.draft.commitDrafts(finishAgentTeamMemberLoad(
        inputRef.current.draft.draftsRef.current,
        teamKey,
        memberSlug,
        document.agentMarkdown,
      ));
    } catch (error) {
      inputRef.current.draft.commitDrafts(failAgentTeamMemberLoad(
        inputRef.current.draft.draftsRef.current,
        teamKey,
        memberSlug,
        planConsoleErrorMessage(error),
      ));
    }
  }, []);
  const loadExternalVersion = useCallback((teamKey: string, memberSlug: string): void => {
    const runtime = inputRef.current;
    const current = getAgentTeamMemberDraft(runtime.draft.draftsRef.current, teamKey, memberSlug);
    const externalMarkdown = planAgentTeamExternalMarkdown(current);
    if (externalMarkdown === null) return;
    runtime.draft.commitDrafts(loadAgentTeamMemberExternalVersion(
      runtime.draft.draftsRef.current,
      teamKey,
      memberSlug,
    ));
    updateSummary(teamKey, {
      slug: memberSlug,
      agentMarkdown: externalMarkdown,
      ...tryParseAgentMarkdownIdentity(externalMarkdown),
    });
  }, [updateSummary]);
  return useMemo(() => ({
    loadMember,
    loadExternalVersion,
    updateSummary,
  }), [loadExternalVersion, loadMember, updateSummary]);
}
