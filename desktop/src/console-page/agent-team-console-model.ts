import type {
  OperatorAgentTeam,
  OperatorAgentTeamsState,
  TranslationKey,
} from "@moebius/console-ui";

import type { LastUsedAgentTeam } from "../team-conversation-preference-contract.js";
import type { AgentTeamFileManagerKind } from "../team-file-manager-contract.js";
import type { AgentTeamListItem } from "../team-ipc-contract.js";
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
