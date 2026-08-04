import type {
  LocalConsoleAgentTeamSnapshot,
  LocalConsoleSessionTeamUpdateCategory,
  LocalConsoleSessionTeamUpdateCategoryKind,
  LocalConsoleSessionTeamUpdateRecord,
  LocalConsoleSessionTeamUpdateState,
  LocalConsoleSessionSummary,
} from "./types.js";
import { computeAgentTeamSnapshotDigests } from "./session-team-snapshot.js";

function affectedMembers(
  effective: LocalConsoleAgentTeamSnapshot,
  candidate: LocalConsoleAgentTeamSnapshot,
  project: (snapshot: LocalConsoleAgentTeamSnapshot, index: number) => unknown,
): number {
  const slugs = new Set([
    ...effective.members.map((member) => member.name),
    ...candidate.members.map((member) => member.name),
  ]);
  let count = 0;
  for (const slug of slugs) {
    const effectiveIndex = effective.members.findIndex((member) => member.name === slug);
    const candidateIndex = candidate.members.findIndex((member) => member.name === slug);
    if (JSON.stringify(project(effective, effectiveIndex)) !== JSON.stringify(project(candidate, candidateIndex))) {
      count += 1;
    }
  }
  return count;
}

export function classifyAgentTeamSnapshotChanges(input: {
  effective: LocalConsoleAgentTeamSnapshot;
  candidate: LocalConsoleAgentTeamSnapshot;
}): LocalConsoleSessionTeamUpdateCategory[] {
  const effectiveDigests = input.effective.digests ?? computeAgentTeamSnapshotDigests(input.effective);
  const candidateDigests = input.candidate.digests ?? computeAgentTeamSnapshotDigests(input.candidate);
  const categories: LocalConsoleSessionTeamUpdateCategory[] = [];
  const append = (kind: LocalConsoleSessionTeamUpdateCategoryKind, count: number) => {
    categories.push({ kind, affectedMemberCount: Math.max(1, count) });
  };
  if (effectiveDigests.agentDefinition !== candidateDigests.agentDefinition) {
    append("agent-definition", affectedMembers(input.effective, input.candidate, (snapshot, index) =>
      index < 0 ? null : snapshot.members[index]!.agentMarkdown));
  }
  if (effectiveDigests.executionProfile !== candidateDigests.executionProfile) {
    append("execution-profile", affectedMembers(input.effective, input.candidate, (snapshot, index) =>
      index < 0 ? null : snapshot.members[index]!.executionProfile ?? null));
  }
  if (effectiveDigests.teamInformation !== candidateDigests.teamInformation) {
    const teamChanged = JSON.stringify(input.effective.team ?? null) !== JSON.stringify(input.candidate.team ?? null);
    append("team-information", affectedMembers(input.effective, input.candidate, (snapshot, index) =>
      index < 0 ? null : {
        name: snapshot.members[index]!.name,
        displayName: snapshot.members[index]!.displayName ?? null,
        description: snapshot.members[index]!.description ?? null,
      }) + (teamChanged ? 1 : 0));
  }
  return categories;
}

export function planSessionTeamUpdateBinding(
  session: LocalConsoleSessionSummary | undefined,
): { kind: "idle" } | { kind: "load"; ownership: "system" | "user"; id: string } {
  return session?.agentTeamOwnership == null
    || session.agentTeamId == null
    || session.agentTeamPendingId != null
    || session.agentTeamHealth === "deleted"
    || session.agentTeamHealth === "needs-repair"
    ? { kind: "idle" }
    : { kind: "load", ownership: session.agentTeamOwnership, id: session.agentTeamId };
}

export function projectAvailableSessionTeamUpdate(input: {
  effective: LocalConsoleAgentTeamSnapshot | null;
  candidate: LocalConsoleAgentTeamSnapshot;
}): { state: LocalConsoleSessionTeamUpdateState; persistedCandidate: LocalConsoleAgentTeamSnapshot | null } {
  if (input.effective === null) return { state: { status: "idle", categories: [] }, persistedCandidate: null };
  const categories = classifyAgentTeamSnapshotChanges({ effective: input.effective, candidate: input.candidate });
  return categories.length === 0
    ? { state: { status: "idle", categories: [] }, persistedCandidate: null }
    : {
        state: { status: "available", categories, updateToken: input.candidate.snapshotKey ?? null },
        persistedCandidate: input.candidate,
      };
}

export function projectPersistedSessionTeamUpdate(input: {
  effective: LocalConsoleAgentTeamSnapshot | null;
  record: LocalConsoleSessionTeamUpdateRecord;
}): LocalConsoleSessionTeamUpdateState {
  const target = input.record.pending ?? input.record.candidate;
  const categories = input.effective === null || target === null
    ? []
    : classifyAgentTeamSnapshotChanges({ effective: input.effective, candidate: target });
  if (input.record.intent === null) {
    return categories.length === 0
      ? { status: "idle", categories: [] }
      : { status: "available", categories, updateToken: target?.snapshotKey ?? null };
  }
  return {
    status: input.record.intent.status,
    categories,
    updateToken: input.record.intent.targetSnapshotKey,
    failure: input.record.intent.status === "failed"
      ? {
          code: input.record.intent.failureCode ?? "TEAM_UPDATE_APPLY_FAILED",
          summary: input.record.intent.failureSummary ?? "团队更新应用失败。",
        }
      : null,
  };
}

export function decideSessionTeamUpdateCapability(available: boolean): "available" | "unavailable" {
  return available ? "available" : "unavailable";
}

export function decideSessionTeamUpdateInspectionCapability(input: {
  load: boolean;
  readSnapshot: boolean;
  readRecord: boolean;
  writeCandidate: boolean;
}): "available" | "unavailable" {
  return input.load && input.readSnapshot && input.readRecord && input.writeCandidate
    ? "available"
    : "unavailable";
}

export function decideSessionTeamUpdateIntent(intent: LocalConsoleSessionTeamUpdateRecord["intent"]): "persisted" | "inspect" {
  return intent === null ? "inspect" : "persisted";
}

export function decideSessionTeamUpdateProcessing(state: LocalConsoleSessionTeamUpdateState): "process" | "wait" {
  return state.status === "idle" ? "process" : "wait";
}

export function planPersistedSessionTeamPromotion(input: {
  intentStatus: "waiting" | "failed" | null;
  hasPendingTeam: boolean;
  hasUnrecoverableOldWork: boolean;
}): "fail" | "wait" | "promote" | "skip" {
  if (input.intentStatus === "failed") return "wait";
  if (input.intentStatus === "waiting" && input.hasUnrecoverableOldWork) return "fail";
  return input.hasPendingTeam ? "promote" : "skip";
}

export function decideSessionTeamSnapshotRead(available: boolean): "read" | "empty" {
  return available ? "read" : "empty";
}
