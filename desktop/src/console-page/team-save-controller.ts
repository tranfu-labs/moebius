import {
  decideAgentTeamSaveAdmission,
  failAgentTeamMemberSave,
  finishAgentTeamMemberSave,
  getAgentTeamMemberDraft,
  getDirtyAgentTeamMemberSlugs,
  planAgentTeamSaveFailureReason,
  planAgentTeamRequestedSave,
  startAgentTeamMemberSave,
  type AgentTeamDraftState,
  type AgentTeamSaveAllFailure,
} from "./team-state.js";

export async function saveAllAgentTeamDrafts(input: {
  state: AgentTeamDraftState;
  teamKey: string;
  alreadySavingReason: string;
  saveMember: (memberSlug: string, agentMarkdown: string) => Promise<string>;
  onTransition?: (state: AgentTeamDraftState) => void;
}): Promise<{ state: AgentTeamDraftState; failures: AgentTeamSaveAllFailure[] }> {
  let state = input.state;
  const failures: AgentTeamSaveAllFailure[] = [];
  const memberSlugs = getDirtyAgentTeamMemberSlugs(state, input.teamKey);

  for (const memberSlug of memberSlugs) {
    const current = decideAgentTeamSaveAdmission(
      getAgentTeamMemberDraft(state, input.teamKey, memberSlug),
    );
    if (current.kind === "already-saving") {
      failures.push({ memberSlug, reason: input.alreadySavingReason });
      continue;
    }
    state = startAgentTeamMemberSave(state, input.teamKey, memberSlug);
    input.onTransition?.(state);
    const step = planAgentTeamRequestedSave(
      getAgentTeamMemberDraft(state, input.teamKey, memberSlug),
    );
    if (step.kind !== "save") continue;
    try {
      const persistedMarkdown = await input.saveMember(memberSlug, step.markdown);
      state = finishAgentTeamMemberSave(state, input.teamKey, memberSlug, persistedMarkdown);
    } catch (error) {
      const reason = planAgentTeamSaveFailureReason(error);
      state = failAgentTeamMemberSave(state, input.teamKey, memberSlug, reason);
      failures.push({ memberSlug, reason });
    }
    input.onTransition?.(state);
  }

  return { state, failures };
}
