import type { OperatorAgentTeam } from "@/console/agent-teams-page";

export function getAgentTeamSelectionLabel(input: {
  team: OperatorAgentTeam;
  teams: readonly OperatorAgentTeam[];
  locale: string;
  untitledLabel: string;
  officialLabel: string;
  userLabel: string;
}): string {
  const name = normalizedTeamName(input.team, input.untitledLabel);
  const duplicates = input.teams.filter(
    (candidate) => normalizedTeamName(candidate, input.untitledLabel) === name,
  );
  if (duplicates.length < 2) return name;

  const sameOwnership = duplicates.filter(
    (candidate) => candidate.ownership === input.team.ownership,
  );
  const ownershipLabel = input.team.ownership === "system"
    ? input.officialLabel
    : input.userLabel;
  if (sameOwnership.length < 2) return `${name} · ${ownershipLabel}`;

  if (input.team.installationSource?.provider === "github") {
    return `${name} · ${ownershipLabel} · ${input.team.installationSource.repository}`;
  }

  if (input.team.installationSource?.provider === "moebius" || input.team.ownership === "system") {
    return `${name} · ${ownershipLabel} · Moebius`;
  }

  return `${name} · ${ownershipLabel} · ${formatCreationTime(input.team.createdAt, input.locale)}`;
}

function normalizedTeamName(team: OperatorAgentTeam, untitledLabel: string): string {
  return team.name?.trim() || untitledLabel;
}

function formatCreationTime(value: string | undefined, locale: string): string {
  if (value === undefined) return locale.startsWith("zh") ? "创建时间未知" : "creation time unavailable";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  const base = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(parsed);
  return `${base}.${String(parsed.getMilliseconds()).padStart(3, "0")}`;
}
