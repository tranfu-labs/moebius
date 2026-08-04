import { useCallback, useMemo, useRef } from "react";
import type { AgentTeamSaveAllFailureView, Translate } from "@moebius/console-ui";

import type {
  AgentTeamMemberDocument,
  AgentTeamMemberWriteRequest,
} from "../team-ipc-contract.js";
import {
  planAgentTeamRequestedMarkdown,
  planAgentTeamSaveRequest,
  planFindOperatorAgentTeam,
} from "./agent-team-console-model.js";
import { planConsoleErrorMessage } from "./console-state-plan.js";
import { saveAllAgentTeamDrafts } from "./team-save-controller.js";
import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";
import type { AgentTeamDraftBundle } from "./use-agent-team-draft-state.js";
import {
  failAgentTeamMemberSave,
  finishAgentTeamMemberSave,
  getAgentTeamMemberDraft,
  startAgentTeamMemberExternalOverwrite,
  startAgentTeamMemberSave,
} from "./team-state.js";

interface AgentTeamMemberSavingPort {
  writeAgentTeamMember?: (request: AgentTeamMemberWriteRequest) => Promise<AgentTeamMemberDocument>;
}

export function useAgentTeamMemberSaving(input: {
  api: AgentTeamMemberSavingPort | undefined;
  catalog: AgentTeamCatalogBundle;
  draft: AgentTeamDraftBundle;
  updateSummary(teamKey: string, document: AgentTeamMemberDocument): void;
  t: Translate;
}) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const persist = useCallback(async (
    teamKey: string,
    memberSlug: string,
    agentMarkdown: string,
  ): Promise<AgentTeamMemberDocument> => {
    const runtime = inputRef.current;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, teamKey);
    const write = runtime.api?.writeAgentTeamMember;
    if (team === undefined || write === undefined) throw new Error(runtime.t("desktop.error.agentSave"));
    const document = await write.call(runtime.api, {
      teamId: team.id,
      ownership: team.ownership,
      memberSlug,
      agentMarkdown,
    });
    inputRef.current.updateSummary(teamKey, document);
    return document;
  }, []);
  const saveMember = useCallback(async (teamKey: string, memberSlug: string): Promise<void> => {
    const runtime = inputRef.current;
    const current = getAgentTeamMemberDraft(runtime.draft.draftsRef.current, teamKey, memberSlug);
    if (planAgentTeamSaveRequest(current) === "skip") return;
    runtime.draft.commitDrafts(startAgentTeamMemberSave(runtime.draft.draftsRef.current, teamKey, memberSlug));
    const requested = planAgentTeamRequestedMarkdown(
      getAgentTeamMemberDraft(runtime.draft.draftsRef.current, teamKey, memberSlug),
    );
    if (requested === null) return;
    try {
      const document = await persist(teamKey, memberSlug, requested);
      inputRef.current.draft.commitDrafts(finishAgentTeamMemberSave(
        inputRef.current.draft.draftsRef.current,
        teamKey,
        memberSlug,
        document.agentMarkdown,
      ));
      inputRef.current.draft.setSaveAllFailures((failures) =>
        failures.filter((failure) => failure.memberSlug !== memberSlug));
    } catch (error) {
      inputRef.current.draft.commitDrafts(failAgentTeamMemberSave(
        inputRef.current.draft.draftsRef.current,
        teamKey,
        memberSlug,
        planConsoleErrorMessage(error),
      ));
    }
  }, [persist]);
  const overwriteExternal = useCallback(async (teamKey: string, memberSlug: string): Promise<void> => {
    const runtime = inputRef.current;
    runtime.draft.commitDrafts(startAgentTeamMemberExternalOverwrite(
      runtime.draft.draftsRef.current,
      teamKey,
      memberSlug,
    ));
    const requested = planAgentTeamRequestedMarkdown(
      getAgentTeamMemberDraft(runtime.draft.draftsRef.current, teamKey, memberSlug),
    );
    if (requested === null) return;
    try {
      const document = await persist(teamKey, memberSlug, requested);
      inputRef.current.draft.commitDrafts(finishAgentTeamMemberSave(
        inputRef.current.draft.draftsRef.current,
        teamKey,
        memberSlug,
        document.agentMarkdown,
      ));
    } catch (error) {
      inputRef.current.draft.commitDrafts(failAgentTeamMemberSave(
        inputRef.current.draft.draftsRef.current,
        teamKey,
        memberSlug,
        planConsoleErrorMessage(error),
      ));
    }
  }, [persist]);
  const saveAll = useCallback(async (
    teamKey: string,
  ): Promise<{ failures: AgentTeamSaveAllFailureView[]; successCount: number }> => {
    const runtime = inputRef.current;
    const result = await saveAllAgentTeamDrafts({
      state: runtime.draft.draftsRef.current,
      teamKey,
      alreadySavingReason: runtime.t("desktop.error.teamMemberAlreadySaving"),
      saveMember: async (memberSlug, markdown) =>
        (await persist(teamKey, memberSlug, markdown)).agentMarkdown,
      onTransition: runtime.draft.commitDrafts,
    });
    inputRef.current.draft.commitDrafts(result.state);
    inputRef.current.draft.setSaveAllFailures(result.failures);
    return { failures: result.failures, successCount: result.successCount };
  }, [persist]);
  return useMemo(() => ({ saveMember, overwriteExternal, saveAll }), [overwriteExternal, saveAll, saveMember]);
}
