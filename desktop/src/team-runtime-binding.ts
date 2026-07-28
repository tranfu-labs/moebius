import fs from "node:fs/promises";
import path from "node:path";

import type { LocalConsoleAgentFile } from "../../src/local-console/runtime.js";
import type {
  LocalConsoleAgentTeamSnapshot,
  LocalConsoleSessionSummary,
} from "../../src/local-console/types.js";
import { resolveRecordedTeamLocation } from "./team-record-store.js";
import {
  readOfficialTeamStateDocument,
  readTeamExecutionBindings,
} from "./team-management-store.js";
import {
  DEFAULT_TEAM_EXECUTION_PROFILE,
  resolveEffectiveExecutionProfile,
  type ExecutionProfile,
  type ExecutionProfileBinding,
} from "./team-execution-profile.js";
import { readTeamSnapshot, resolveTeamLocation } from "./team-store.js";

export class AgentTeamRosterUnavailableError extends Error {
  readonly code = "AGENT_TEAM_ROSTER_UNAVAILABLE";

  constructor(teamId: string, readonly health: "deleted" | "needs-repair" = "needs-repair") {
    super(health === "deleted"
      ? `当前会话绑定的 Agent 团队“${teamId}”已经被删除，请改选另一支团队。`
      : `当前会话绑定的 Agent 团队“${teamId}”需要修复，暂时无法解析可用 Agent。`);
    this.name = "AgentTeamRosterUnavailableError";
  }
}

export async function listSessionAgentFiles(input: {
  dataRoot: string;
  session: LocalConsoleSessionSummary;
}): Promise<LocalConsoleAgentFile[]> {
  if (input.session.agentTeamOwnership == null || input.session.agentTeamId == null) {
    return listSharedAgentFiles(path.join(input.dataRoot, "agents"));
  }
  const snapshot = await readBoundTeamSnapshot(input.dataRoot, input.session);
  if (snapshot.status !== "usable") {
    throw new AgentTeamRosterUnavailableError(input.session.agentTeamId);
  }
  return orderPrimaryFirst(snapshot).map((member) => ({ name: member.slug, path: member.agentFile }));
}

export async function loadAgentTeamSnapshot(input: {
  dataRoot: string;
  ownership: "system" | "user";
  teamId: string;
}): Promise<LocalConsoleAgentTeamSnapshot> {
  const snapshot = await readBoundTeamSnapshot(input.dataRoot, {
    agentTeamOwnership: input.ownership,
    agentTeamId: input.teamId,
  });
  if (snapshot.status !== "usable") {
    throw new AgentTeamRosterUnavailableError(input.teamId);
  }
  const profiles = await loadEffectiveProfiles({
    dataRoot: input.dataRoot,
    ownership: input.ownership,
    teamId: input.teamId,
    memberSlugs: snapshot.members.map((member) => member.slug),
  });
  return {
    members: orderPrimaryFirst(snapshot).map((member) => ({
      name: member.slug,
      agentMarkdown: member.agentMarkdown,
      executionProfile: profiles[member.slug] ?? null,
    })),
  };
}

export async function resolveSessionAgentTeamHealth(input: {
  dataRoot: string;
  session: LocalConsoleSessionSummary;
}): Promise<{ health: "usable" | "deleted" | "needs-repair"; reason: string | null }> {
  if (input.session.agentTeamOwnership == null || input.session.agentTeamId == null) {
    return { health: "usable", reason: null };
  }
  let snapshot: Awaited<ReturnType<typeof readBoundTeamSnapshot>>;
  try {
    snapshot = await readBoundTeamSnapshot(input.dataRoot, input.session);
  } catch (error) {
    if (error instanceof AgentTeamRosterUnavailableError && error.health === "deleted") {
      return { health: "deleted", reason: error.message };
    }
    throw error;
  }
  return snapshot.status === "usable"
    ? { health: "usable", reason: null }
    : {
        health: "needs-repair",
        reason: snapshot.issues[0]?.message ?? `Agent 团队“${input.session.agentTeamId}”需要修复。`,
      };
}

async function readBoundTeamSnapshot(
  dataRoot: string,
  session: Pick<LocalConsoleSessionSummary, "agentTeamOwnership" | "agentTeamId">,
) {
  const teamId = session.agentTeamId;
  const ownership = session.agentTeamOwnership;
  if (teamId == null || ownership == null) {
    throw new Error("Session has no Agent team binding");
  }
  let location;
  try {
    location = ownership === "system"
      ? resolveTeamLocation({ dataRoot, teamId, ownership: "system" })
      : await resolveRecordedTeamLocation(dataRoot, teamId);
  } catch {
    throw new AgentTeamRosterUnavailableError(teamId, "deleted");
  }
  return readTeamSnapshot(location);
}

function orderPrimaryFirst<T extends { slug: string }>(snapshot: { definition: { primaryAgentSlug: string | null } | null; members: T[] }): T[] {
  const primary = snapshot.definition?.primaryAgentSlug;
  return primary == null
    ? [...snapshot.members]
    : [...snapshot.members].sort((left, right) => Number(right.slug === primary) - Number(left.slug === primary));
}

async function listSharedAgentFiles(directory: string): Promise<LocalConsoleAgentFile[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => ({ name: path.basename(entry.name, ".md"), path: path.join(directory, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function loadEffectiveProfiles(input: {
  dataRoot: string;
  ownership: "system" | "user";
  teamId: string;
  memberSlugs: readonly string[];
}): Promise<Record<string, ExecutionProfile>> {
  const bindings = await readTeamExecutionBindings(input);
  const recommendations = input.ownership === "system"
    ? (await readOfficialTeamStateDocument(input.dataRoot)).teams[input.teamId]?.appliedRecommendations ?? {}
    : {};
  return Object.fromEntries(input.memberSlugs.map((slug) => {
    const binding: ExecutionProfileBinding = bindings[slug] ?? (
      recommendations[slug] === undefined
        ? {
            source: "explicit",
            profile: DEFAULT_TEAM_EXECUTION_PROFILE,
          }
        : { source: "recommended" }
    );
    return [slug, resolveEffectiveExecutionProfile({
      binding,
      recommendation: recommendations[slug],
    })];
  }));
}
