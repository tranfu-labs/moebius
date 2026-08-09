import crypto from "node:crypto";

import type {
  LocalConsoleAgentTeamSnapshot,
  LocalConsoleAgentTeamSnapshotDigests,
} from "./types.js";

function digest(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function computeAgentTeamSnapshotDigests(
  snapshot: LocalConsoleAgentTeamSnapshot,
): LocalConsoleAgentTeamSnapshotDigests {
  return {
    agentDefinition: digest(snapshot.members.map((member) => ({
      slug: member.name,
      agentMarkdown: member.agentMarkdown,
    }))),
    executionProfile: digest(snapshot.members.map((member) => ({
      slug: member.name,
      profile: member.executionProfile ?? null,
    }))),
    teamInformation: digest({
      team: snapshot.team ?? null,
      members: snapshot.members.map((member) => ({
        slug: member.name,
        displayName: member.displayName ?? null,
        description: member.description ?? null,
      })),
    }),
  };
}

export function finalizeAgentTeamSnapshot(
  snapshot: LocalConsoleAgentTeamSnapshot,
  options: { capturedAt: string; loadedAt?: string | null },
): LocalConsoleAgentTeamSnapshot {
  const canonical = {
    team: snapshot.team ?? null,
    members: snapshot.members.map((member) => ({
      name: member.name,
      displayName: member.displayName ?? null,
      description: member.description ?? null,
      agentMarkdown: member.agentMarkdown,
      portraitId: member.portraitId ?? null,
      executionProfile: member.executionProfile ?? null,
    })),
  };
  return {
    ...snapshot,
    members: canonical.members,
    capturedAt: options.capturedAt,
    loadedAt: options.loadedAt ?? snapshot.loadedAt ?? null,
    snapshotKey: digest(canonical),
    digests: computeAgentTeamSnapshotDigests(snapshot),
  };
}

export function withAgentTeamSnapshotLoadedAt(
  snapshot: LocalConsoleAgentTeamSnapshot,
  loadedAt: string,
): LocalConsoleAgentTeamSnapshot {
  return {
    ...snapshot,
    loadedAt,
  };
}

export function withOptionalAgentTeamSnapshotLoadedAt(
  snapshot: LocalConsoleAgentTeamSnapshot | undefined,
  loadedAt: string,
): LocalConsoleAgentTeamSnapshot | undefined {
  return snapshot === undefined ? undefined : withAgentTeamSnapshotLoadedAt(snapshot, loadedAt);
}
