import type { OperatorAgentTeam } from "@/console/agent-teams-page";

export interface OnboardingTeamListProjection {
  query: string;
  total: number;
  matched: number;
  selectedOutsideResults: OperatorAgentTeam | null;
  builtInTeams: OperatorAgentTeam[];
  userTeams: OperatorAgentTeam[];
}

export function projectOnboardingTeamList(input: {
  teams: readonly OperatorAgentTeam[];
  selectedTeamKey: string | null;
  query: string;
}): OnboardingTeamListProjection {
  const teams = input.teams.filter((team) => team.canCreateConversation);
  const query = normalizeSearchText(input.query);
  const matches = query === ""
    ? teams
    : teams.filter((team) => onboardingTeamMatchesSearch(team, query));
  const selected = input.selectedTeamKey === null
    ? null
    : teams.find((team) => team.teamKey === input.selectedTeamKey) ?? null;

  return {
    query,
    total: teams.length,
    matched: matches.length,
    selectedOutsideResults: selected !== null && !matches.includes(selected) ? selected : null,
    builtInTeams: matches.filter((team) => team.ownership === "system"),
    userTeams: matches.filter((team) => team.ownership === "user"),
  };
}

export function onboardingTeamMatchesSearch(
  team: OperatorAgentTeam,
  normalizedQuery: string,
): boolean {
  const searchable = [
    team.name,
    team.description,
    ...team.members.flatMap((member) => [member.displayName, member.description]),
  ]
    .filter((value): value is string => typeof value === "string")
    .map(normalizeSearchText);
  return searchable.some((value) => value.includes(normalizedQuery));
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase();
}
