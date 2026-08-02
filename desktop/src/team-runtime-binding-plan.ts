import type { LocalConsoleSessionSummary } from "../../src/local-console/types.js";
import {
  DEFAULT_TEAM_EXECUTION_PROFILE,
  type ExecutionProfile,
  type ExecutionProfileBinding,
} from "./team-execution-profile.js";
import type { AppliedOfficialTeamState } from "./team-official-plan.js";
import type { TeamSnapshot } from "./team-store.js";

export function planSessionAgentSource(
  session: Pick<LocalConsoleSessionSummary, "agentTeamOwnership" | "agentTeamId">,
): "shared" | "team" {
  return session.agentTeamOwnership == null || session.agentTeamId == null ? "shared" : "team";
}

export function assertUsableTeamSnapshot(snapshot: TeamSnapshot, teamId: string): void {
  if (snapshot.status !== "usable") {
    throw new AgentTeamRosterUnavailableError(teamId);
  }
}

export function selectRuntimeExecutionProfile(
  profile: ExecutionProfile | undefined,
): ExecutionProfile | null {
  return profile ?? null;
}

export function deriveAgentTeamHealth(input: {
  snapshot: TeamSnapshot;
  teamId: string;
}): { health: "usable" | "needs-repair"; reason: string | null } {
  return input.snapshot.status === "usable"
    ? { health: "usable", reason: null }
    : {
        health: "needs-repair",
        reason: input.snapshot.issues[0]?.message ?? `Agent 团队“${input.teamId}”需要修复。`,
      };
}

export function planRosterReadFailure(error: unknown): "deleted" | "rethrow" {
  return error instanceof AgentTeamRosterUnavailableError && error.health === "deleted"
    ? "deleted"
    : "rethrow";
}

export function planBoundTeamLocation(ownership: "system" | "user"): "system" | "user" {
  return ownership;
}

export function orderPrimaryFirst<T extends { slug: string }>(snapshot: {
  definition: { primaryAgentSlug: string | null } | null;
  members: T[];
}): T[] {
  const primary = snapshot.definition?.primaryAgentSlug;
  return primary == null
    ? [...snapshot.members]
    : [...snapshot.members].sort(
        (left, right) => Number(right.slug === primary) - Number(left.slug === primary),
      );
}

export function selectOfficialRecommendations(input: {
  ownership: "system" | "user";
  official: AppliedOfficialTeamState | undefined;
}): Record<string, ExecutionProfile> {
  return input.ownership === "system" ? input.official?.appliedRecommendations ?? {} : {};
}

export function selectMemberExecutionBinding(input: {
  binding: ExecutionProfileBinding | undefined;
  recommendation: ExecutionProfile | undefined;
}): ExecutionProfileBinding {
  return input.binding ?? (
    input.recommendation === undefined
      ? { source: "explicit", profile: DEFAULT_TEAM_EXECUTION_PROFILE }
      : { source: "recommended" }
  );
}

export class AgentTeamRosterUnavailableError extends Error {
  readonly code = "AGENT_TEAM_ROSTER_UNAVAILABLE";

  constructor(teamId: string, readonly health: "deleted" | "needs-repair" = "needs-repair") {
    super(health === "deleted"
      ? `当前会话绑定的 Agent 团队“${teamId}”已经被删除，请改选另一支团队。`
      : `当前会话绑定的 Agent 团队“${teamId}”需要修复，暂时无法解析可用 Agent。`);
    this.name = "AgentTeamRosterUnavailableError";
  }
}
