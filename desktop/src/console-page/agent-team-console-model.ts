import type {
  OperatorAgentTeam,
  OperatorAgentTeamsState,
  TeamBuilderViewState,
  TranslationKey,
} from "@moebius/console-ui";

import type { LastUsedAgentTeam } from "../team-conversation-preference-contract.js";
import type { AgentTeamFileManagerKind } from "../team-file-manager-contract.js";
import type { AgentTeamListItem } from "../team-ipc-contract.js";
import type { AiTeamBuilderIpcResponse } from "../ai-team-builder/contract.js";
import type { AiTeamBuilderState } from "../ai-team-builder/dto.js";
import { getAgentTeamKey } from "./team-state.js";

export function planAgentTeamFileManagerTranslationKey(
  kind: AgentTeamFileManagerKind,
): TranslationKey {
  if (kind === "finder") return "desktop.fileManager.finder";
  if (kind === "windows-explorer") return "desktop.fileManager.windowsExplorer";
  return "desktop.fileManager.generic";
}

export function decideSafeAiTeamBuilderDraftId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value);
}

export function planOperatorAgentTeam(team: AgentTeamListItem): OperatorAgentTeam {
  return {
    teamKey: getAgentTeamKey(team),
    id: team.id,
    ownership: team.ownership,
    createdAt: team.createdAt,
    officialSourceName: team.officialSourceName,
    name: team.definition?.name ?? null,
    description: team.definition?.description ?? null,
    primaryAgentSlug: team.definition?.primaryAgentSlug ?? null,
    memberOrder: team.definition?.memberOrder ?? [],
    members: team.members.map((member) => ({
      ...member,
      available: member.available !== false,
      executionProfile: member.executionProfile,
    })),
    status: team.status,
    canCreateConversation: team.canCreateConversation,
    canEditContent: team.capabilities?.canEditContent ?? true,
    canDeleteTeam: team.capabilities?.canDeleteTeam ?? team.ownership === "user",
    issues: team.issues,
    officialManagement: team.officialManagement,
  };
}

export function planAgentTeamIdentityKey(team: LastUsedAgentTeam): string {
  return `${team.ownership}:${team.teamId}`;
}

export function planFindOperatorAgentTeam(
  state: OperatorAgentTeamsState,
  teamKey: string,
): OperatorAgentTeam | undefined {
  return state.status === "ready"
    ? state.teams.find((team) => team.teamKey === teamKey)
    : undefined;
}

export function planAgentTeamBuilderDraftSource(
  current: string | null,
  stored: string | null,
): "current" | "stored" | "create" {
  if (current !== null) return "current";
  return stored !== null && decideSafeAiTeamBuilderDraftId(stored) ? "stored" : "create";
}

export function planAgentTeamBuilderResponse(response: AiTeamBuilderIpcResponse):
  | { kind: "accepted"; state: AiTeamBuilderState }
  | { kind: "rejected"; error: Extract<AiTeamBuilderIpcResponse, { ok: false }>["error"] } {
  return response.ok
    ? { kind: "accepted", state: response.state }
    : { kind: "rejected", error: response.error };
}

export function planSelectedBuilderTeamId(state: AiTeamBuilderState | null): string | null {
  return state?.phase === "selected" ? state.selectedTeamId : null;
}

export function planBuilderOperation(hasPort: boolean): "run" | "unavailable" {
  return hasPort ? "run" : "unavailable";
}

export function planBuilderRetry(started: boolean): "start" | "retry" {
  return started ? "retry" : "start";
}

export function planBuiltAgentTeam(
  teams: readonly AgentTeamListItem[] | null,
  teamId: string,
): AgentTeamListItem | null {
  return teams?.find((team) => team.ownership === "user" && team.id === teamId) ?? null;
}

export function planBuilderPendingState(
  current: TeamBuilderViewState | null,
  phase: "running" | "committing",
): TeamBuilderViewState | null {
  return current === null ? null : { ...current, phase, error: null };
}

export function planBuilderRetryPhase(current: TeamBuilderViewState | null): "running" | "committing" {
  return current?.proposal === null ? "running" : "committing";
}

export function planBuilderFailureState(
  current: TeamBuilderViewState | null,
  error: NonNullable<TeamBuilderViewState["error"]>,
): TeamBuilderViewState {
  return {
    phase: "failed",
    messages: current?.messages ?? [],
    proposal: current?.proposal ?? null,
    proposalRevision: current?.proposalRevision ?? null,
    error,
  };
}
