import type { AgentTeamListItem } from "../team-ipc-contract.js";

export interface AgentTeamSelection {
  teamKey: string;
  memberSlug: string | null;
}

export type AgentTeamMemberLoadStatus = "idle" | "loading" | "ready" | "failed";
export type AgentTeamMemberSaveStatus = "idle" | "saving" | "failed";
export type AgentTeamMemberExternalChangeStatus = "none" | "reloaded" | "conflict";

export interface AgentTeamMemberDraft {
  teamKey: string;
  memberSlug: string;
  savedMarkdown: string | null;
  draftMarkdown: string;
  loadStatus: AgentTeamMemberLoadStatus;
  loadError: string | null;
  saveStatus: AgentTeamMemberSaveStatus;
  saveError: string | null;
  saveRequestedMarkdown: string | null;
  externalChangeStatus: AgentTeamMemberExternalChangeStatus;
  externalMarkdown: string | null;
}

export interface AgentTeamDraftState {
  membersByKey: Record<string, AgentTeamMemberDraft>;
}

export interface AgentTeamSaveAllFailure {
  memberSlug: string;
  reason: string;
}

export const EMPTY_AGENT_TEAM_DRAFT_STATE: AgentTeamDraftState = { membersByKey: {} };

export function getAgentTeamKey(team: Pick<AgentTeamListItem, "id" | "ownership">): string {
  return `${team.ownership}:${team.id}`;
}

export function getAgentTeamMemberDraftKey(teamKey: string, memberSlug: string): string {
  return `${teamKey}\u0000${memberSlug}`;
}

export function getAgentTeamMemberDraft(
  state: AgentTeamDraftState,
  teamKey: string,
  memberSlug: string,
): AgentTeamMemberDraft | undefined {
  return state.membersByKey[getAgentTeamMemberDraftKey(teamKey, memberSlug)];
}

export function isAgentTeamMemberDirty(member: AgentTeamMemberDraft | undefined): boolean {
  return member?.loadStatus === "ready"
    && member.savedMarkdown !== null
    && member.draftMarkdown !== member.savedMarkdown;
}

export function getDirtyAgentTeamMemberSlugs(state: AgentTeamDraftState, teamKey: string): string[] {
  return Object.values(state.membersByKey)
    .filter((member) => member.teamKey === teamKey && isAgentTeamMemberDirty(member))
    .map((member) => member.memberSlug);
}

export function startAgentTeamMemberLoad(
  state: AgentTeamDraftState,
  teamKey: string,
  memberSlug: string,
): AgentTeamDraftState {
  const current = getAgentTeamMemberDraft(state, teamKey, memberSlug);
  if (current?.loadStatus === "ready" || current?.loadStatus === "loading") {
    return state;
  }
  return setMember(state, {
    teamKey,
    memberSlug,
    savedMarkdown: null,
    draftMarkdown: "",
    loadStatus: "loading",
    loadError: null,
    saveStatus: "idle",
    saveError: null,
    saveRequestedMarkdown: null,
    externalChangeStatus: "none",
    externalMarkdown: null,
  });
}

export function finishAgentTeamMemberLoad(
  state: AgentTeamDraftState,
  teamKey: string,
  memberSlug: string,
  agentMarkdown: string,
): AgentTeamDraftState {
  return setMember(state, {
    teamKey,
    memberSlug,
    savedMarkdown: agentMarkdown,
    draftMarkdown: agentMarkdown,
    loadStatus: "ready",
    loadError: null,
    saveStatus: "idle",
    saveError: null,
    saveRequestedMarkdown: null,
    externalChangeStatus: "none",
    externalMarkdown: null,
  });
}

export function failAgentTeamMemberLoad(
  state: AgentTeamDraftState,
  teamKey: string,
  memberSlug: string,
  reason: string,
): AgentTeamDraftState {
  const current = getAgentTeamMemberDraft(state, teamKey, memberSlug);
  return setMember(state, {
    teamKey,
    memberSlug,
    savedMarkdown: current?.savedMarkdown ?? null,
    draftMarkdown: current?.draftMarkdown ?? "",
    loadStatus: "failed",
    loadError: reason,
    saveStatus: "idle",
    saveError: null,
    saveRequestedMarkdown: null,
    externalChangeStatus: "none",
    externalMarkdown: null,
  });
}

export function updateAgentTeamMemberDraft(
  state: AgentTeamDraftState,
  teamKey: string,
  memberSlug: string,
  draftMarkdown: string,
): AgentTeamDraftState {
  const current = getAgentTeamMemberDraft(state, teamKey, memberSlug);
  if (current?.loadStatus !== "ready") {
    return state;
  }
  return setMember(state, {
    ...current,
    draftMarkdown,
    saveStatus: current.saveStatus === "failed" ? "idle" : current.saveStatus,
    saveError: null,
    externalChangeStatus: current.externalChangeStatus === "reloaded"
      ? "none"
      : current.externalChangeStatus,
  });
}

export function startAgentTeamMemberSave(
  state: AgentTeamDraftState,
  teamKey: string,
  memberSlug: string,
): AgentTeamDraftState {
  const current = getAgentTeamMemberDraft(state, teamKey, memberSlug);
  if (current === undefined || !isAgentTeamMemberDirty(current) || current.saveStatus === "saving") {
    return state;
  }
  return setMember(state, {
    ...current,
    saveStatus: "saving",
    saveError: null,
    saveRequestedMarkdown: current.draftMarkdown,
  });
}

export function finishAgentTeamMemberSave(
  state: AgentTeamDraftState,
  teamKey: string,
  memberSlug: string,
  persistedMarkdown: string,
): AgentTeamDraftState {
  const current = getAgentTeamMemberDraft(state, teamKey, memberSlug);
  if (current?.loadStatus !== "ready" || current.saveStatus !== "saving") {
    return state;
  }
  return setMember(state, {
    ...current,
    savedMarkdown: persistedMarkdown,
    saveStatus: "idle",
    saveError: null,
    saveRequestedMarkdown: null,
    externalChangeStatus: "none",
    externalMarkdown: null,
  });
}

export function failAgentTeamMemberSave(
  state: AgentTeamDraftState,
  teamKey: string,
  memberSlug: string,
  reason: string,
): AgentTeamDraftState {
  const current = getAgentTeamMemberDraft(state, teamKey, memberSlug);
  if (current?.loadStatus !== "ready" || current.saveStatus !== "saving") {
    return state;
  }
  return setMember(state, {
    ...current,
    saveStatus: "failed",
    saveError: reason,
    saveRequestedMarkdown: null,
  });
}

export function discardAgentTeamMemberDraft(
  state: AgentTeamDraftState,
  teamKey: string,
  memberSlug: string,
): AgentTeamDraftState {
  const current = getAgentTeamMemberDraft(state, teamKey, memberSlug);
  if (current?.loadStatus !== "ready" || current.savedMarkdown === null || current.saveStatus === "saving") {
    return state;
  }
  return setMember(state, {
    ...current,
    draftMarkdown: current.savedMarkdown,
    saveStatus: "idle",
    saveError: null,
    saveRequestedMarkdown: null,
  });
}

export function discardAllAgentTeamDrafts(state: AgentTeamDraftState, teamKey: string): AgentTeamDraftState {
  let nextState = state;
  for (const member of Object.values(state.membersByKey)) {
    if (member.teamKey === teamKey) {
      nextState = discardAgentTeamMemberDraft(nextState, teamKey, member.memberSlug);
    }
  }
  return nextState;
}

export function applyAgentTeamMemberExternalChange(
  state: AgentTeamDraftState,
  teamKey: string,
  memberSlug: string,
  externalMarkdown: string,
): AgentTeamDraftState {
  const current = getAgentTeamMemberDraft(state, teamKey, memberSlug);
  if (
    current?.loadStatus !== "ready"
    || current.savedMarkdown === null
    || current.saveStatus === "saving"
    || externalMarkdown === current.savedMarkdown
  ) {
    return state;
  }

  if (isAgentTeamMemberDirty(current)) {
    return setMember(state, {
      ...current,
      externalChangeStatus: "conflict",
      externalMarkdown,
    });
  }

  return setMember(state, {
    ...current,
    savedMarkdown: externalMarkdown,
    draftMarkdown: externalMarkdown,
    externalChangeStatus: "reloaded",
    externalMarkdown: null,
    saveStatus: "idle",
    saveError: null,
    saveRequestedMarkdown: null,
  });
}

export function clearAgentTeamMemberExternalChange(
  state: AgentTeamDraftState,
  teamKey: string,
  memberSlug: string,
): AgentTeamDraftState {
  const current = getAgentTeamMemberDraft(state, teamKey, memberSlug);
  if (current === undefined || current.externalChangeStatus === "none") {
    return state;
  }
  return setMember(state, {
    ...current,
    externalChangeStatus: "none",
    externalMarkdown: null,
  });
}

export function loadAgentTeamMemberExternalVersion(
  state: AgentTeamDraftState,
  teamKey: string,
  memberSlug: string,
): AgentTeamDraftState {
  const current = getAgentTeamMemberDraft(state, teamKey, memberSlug);
  if (current?.loadStatus !== "ready" || current.externalChangeStatus !== "conflict" || current.externalMarkdown === null) {
    return state;
  }
  return setMember(state, {
    ...current,
    savedMarkdown: current.externalMarkdown,
    draftMarkdown: current.externalMarkdown,
    saveStatus: "idle",
    saveError: null,
    saveRequestedMarkdown: null,
    externalChangeStatus: "reloaded",
    externalMarkdown: null,
  });
}

export function startAgentTeamMemberExternalOverwrite(
  state: AgentTeamDraftState,
  teamKey: string,
  memberSlug: string,
): AgentTeamDraftState {
  const current = getAgentTeamMemberDraft(state, teamKey, memberSlug);
  if (
    current?.loadStatus !== "ready"
    || current.externalChangeStatus !== "conflict"
    || current.saveStatus === "saving"
  ) {
    return state;
  }
  return setMember(state, {
    ...current,
    saveStatus: "saving",
    saveError: null,
    saveRequestedMarkdown: current.draftMarkdown,
  });
}

export function removeAgentTeamMemberDraft(
  state: AgentTeamDraftState,
  teamKey: string,
  memberSlug: string,
): AgentTeamDraftState {
  const key = getAgentTeamMemberDraftKey(teamKey, memberSlug);
  if (!(key in state.membersByKey)) {
    return state;
  }
  const membersByKey = { ...state.membersByKey };
  delete membersByKey[key];
  return { membersByKey };
}

export function removeAgentTeamDrafts(state: AgentTeamDraftState, teamKey: string): AgentTeamDraftState {
  const membersByKey = Object.fromEntries(
    Object.entries(state.membersByKey).filter(([, member]) => member.teamKey !== teamKey),
  );
  return Object.keys(membersByKey).length === Object.keys(state.membersByKey).length
    ? state
    : { membersByKey };
}

export async function saveAllAgentTeamDrafts(input: {
  state: AgentTeamDraftState;
  teamKey: string;
  saveMember: (memberSlug: string, agentMarkdown: string) => Promise<string>;
  onTransition?: (state: AgentTeamDraftState) => void;
}): Promise<{ state: AgentTeamDraftState; failures: AgentTeamSaveAllFailure[] }> {
  let state = input.state;
  const failures: AgentTeamSaveAllFailure[] = [];
  const memberSlugs = getDirtyAgentTeamMemberSlugs(state, input.teamKey);

  for (const memberSlug of memberSlugs) {
    const current = getAgentTeamMemberDraft(state, input.teamKey, memberSlug);
    if (current?.saveStatus === "saving") {
      failures.push({ memberSlug, reason: "该成员仍在保存，请稍后重试。" });
      continue;
    }
    state = startAgentTeamMemberSave(state, input.teamKey, memberSlug);
    input.onTransition?.(state);
    const savingMember = getAgentTeamMemberDraft(state, input.teamKey, memberSlug);
    const requestedMarkdown = savingMember?.saveRequestedMarkdown;
    if (requestedMarkdown === null || requestedMarkdown === undefined) {
      continue;
    }

    try {
      const persistedMarkdown = await input.saveMember(memberSlug, requestedMarkdown);
      state = finishAgentTeamMemberSave(state, input.teamKey, memberSlug, persistedMarkdown);
    } catch (error) {
      const reason = formatStateError(error);
      state = failAgentTeamMemberSave(state, input.teamKey, memberSlug, reason);
      failures.push({ memberSlug, reason });
    }
    input.onTransition?.(state);
  }

  return { state, failures };
}

export function reconcileAgentTeamSelection(
  teams: readonly AgentTeamListItem[],
  current: AgentTeamSelection | null,
): AgentTeamSelection | null {
  const currentTeam = current === null
    ? undefined
    : teams.find((team) => getAgentTeamKey(team) === current.teamKey);
  const team = currentTeam ?? teams[0];
  if (team === undefined) {
    return null;
  }

  const memberSlugs = new Set(team.members.map((member) => member.slug));
  const canKeepMember = currentTeam !== undefined
    && current?.memberSlug !== null
    && current?.memberSlug !== undefined
    && memberSlugs.has(current.memberSlug);
  const preferredMemberSlug = team.definition?.primaryAgentSlug;
  const memberSlug = canKeepMember
    ? current.memberSlug
    : preferredMemberSlug !== null && preferredMemberSlug !== undefined && memberSlugs.has(preferredMemberSlug)
      ? preferredMemberSlug
      : team.members[0]?.slug ?? null;

  return {
    teamKey: getAgentTeamKey(team),
    memberSlug,
  };
}

function setMember(state: AgentTeamDraftState, member: AgentTeamMemberDraft): AgentTeamDraftState {
  const key = getAgentTeamMemberDraftKey(member.teamKey, member.memberSlug);
  if (state.membersByKey[key] === member) {
    return state;
  }
  return {
    membersByKey: {
      ...state.membersByKey,
      [key]: member,
    },
  };
}

function formatStateError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
