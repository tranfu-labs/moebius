import { createHash } from "node:crypto";

export function createOfficialUpdatePlanId(input: {
  teamId: string;
  inputFingerprint: string;
  copyTeamId: string | null;
}): string {
  return createHash("sha256")
    .update(`moebius-official-update-plan-v1\0${input.teamId}\0${input.inputFingerprint}\0${input.copyTeamId ?? ""}`)
    .digest("hex");
}

export function selectPersistedOrRebuiltDocument<T>(persisted: T | null, rebuilt: T): T {
  return persisted ?? rebuilt;
}

export function assertOfficialContentFingerprint(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new OfficialUpdatePlanError("官方团队更新包校验失败。");
  }
}

export function selectBindingMembers<T>(members: T | undefined, fallback: T): T {
  return members ?? fallback;
}

export function selectSnapshotMemberSlugs(input: {
  memberOrder: string[] | undefined;
  members: ReadonlyArray<{ slug: string }>;
}): string[] {
  return input.memberOrder ?? input.members.map((member) => member.slug);
}

export class OfficialUpdatePlanError extends Error {
  readonly code = "OFFICIAL_UPDATE_UNAVAILABLE";
}
