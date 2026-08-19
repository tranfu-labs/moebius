import {
  DEFAULT_TEAM_EXECUTION_PROFILE,
  type ExecutionProfile,
  type ExecutionProfileBinding,
} from "./team-execution-profile.js";
import {
  GITHUB_DEFAULT_BRANCH_BASELINE_VERSION,
  type GithubTeamUpstreamRecord,
} from "./github-team-install-plan.js";
import type {
  GithubTeamSnapshot,
} from "./github-team-snapshot.js";
import {
  contentMemberSlugs,
  planOfficialTeamAutoSync,
  type OfficialTeamAutoSyncPlan,
  type OfficialTeamContent,
} from "./team-auto-sync-plan.js";
import {
  computeOfficialTeamContentFingerprintFromContent,
  recommendationFingerprint,
  type AppliedOfficialTeamState,
  type PackagedOfficialMemberV1,
  type PackagedOfficialTeamManifestV1,
} from "./team-official-plan.js";

export interface GithubTeamRemoteOfficialState {
  manifest: PackagedOfficialTeamManifestV1;
  content: OfficialTeamContent;
  contentFingerprint: string;
  recommendationFingerprint: string;
}

export interface GithubTeamSyncInput {
  upstream: GithubTeamUpstreamRecord;
  snapshot: GithubTeamSnapshot;
  applied: AppliedOfficialTeamState;
  currentContent: OfficialTeamContent | null;
  bindings: Readonly<Record<string, ExecutionProfileBinding>>;
  suppressedOfficialVersions: readonly string[];
}

export type GithubTeamSyncPlan =
  | {
    kind: "skip";
    reason: "SOURCE_MISMATCH" | "REMOTE_UNREADABLE";
    upstream: GithubTeamUpstreamRecord;
    nextUpstream: GithubTeamUpstreamRecord;
  }
  | {
    kind: "decision";
    upstream: GithubTeamUpstreamRecord;
    nextUpstream: GithubTeamUpstreamRecord;
    remote: GithubTeamRemoteOfficialState;
    applied: AppliedOfficialTeamState;
    decision: OfficialTeamAutoSyncPlan;
  };

export function planGithubTeamSync(input: GithubTeamSyncInput): GithubTeamSyncPlan {
  const nextUpstream: GithubTeamUpstreamRecord = {
    provider: "github",
    repository: input.snapshot.repository.repository,
    defaultBranch: input.snapshot.repository.defaultBranch,
  };
  if (input.snapshot.repository.repository !== input.upstream.repository) {
    return {
      kind: "skip",
      reason: "SOURCE_MISMATCH",
      upstream: input.upstream,
      nextUpstream,
    };
  }
  if (input.snapshot.members.some((member) => !member.readable)) {
    return {
      kind: "skip",
      reason: "REMOTE_UNREADABLE",
      upstream: input.upstream,
      nextUpstream,
    };
  }

  const remote = buildRemoteOfficialState(input.snapshot);
  const applied = normalizeGithubAppliedState(input.applied);
  const decision = planOfficialTeamAutoSync({
    applied,
    currentContentFingerprint: input.currentContent === null
      ? null
      : computeOfficialTeamContentFingerprintFromContent(input.currentContent),
    currentContent: input.currentContent,
    packaged: remote,
    packagedContent: remote.content,
    bindings: input.bindings,
    suppressedOfficialVersions: input.suppressedOfficialVersions,
  });
  return {
    kind: "decision",
    upstream: input.upstream,
    nextUpstream,
    remote,
    applied,
    decision,
  };
}

export function buildRemoteOfficialState(
  snapshot: GithubTeamSnapshot,
): GithubTeamRemoteOfficialState {
  const members: Record<string, PackagedOfficialMemberV1> = Object.fromEntries(
    snapshot.definition.memberOrder.map((slug) => [
      slug,
      {
        recommendedProfile: snapshot.recommendations[slug] ?? DEFAULT_TEAM_EXECUTION_PROFILE,
      },
    ]),
  );
  const manifest = snapshot.recommendationManifest;
  if (manifest !== null) {
    for (const [slug, member] of Object.entries(manifest.members)) {
      members[slug] = member;
    }
  }
  const normalizedManifest: PackagedOfficialTeamManifestV1 = {
    schemaVersion: 1,
    officialVersion: snapshot.officialVersion
      ?? manifest?.officialVersion
      ?? GITHUB_DEFAULT_BRANCH_BASELINE_VERSION,
    members,
  };
  const content = { ...snapshot.content };
  return {
    manifest: normalizedManifest,
    content,
    contentFingerprint: computeOfficialTeamContentFingerprintFromContent(content),
    recommendationFingerprint: recommendationFingerprint(
      Object.fromEntries(Object.entries(members).map(([slug, member]) => [slug, member.recommendedProfile])),
    ),
  };
}

function normalizeGithubAppliedState(
  applied: AppliedOfficialTeamState,
): AppliedOfficialTeamState {
  if (applied.appliedContentSnapshot === undefined || applied.appliedContentSnapshot === null) {
    return applied;
  }
  const normalizedRecommendations: Record<string, ExecutionProfile> = {
    ...applied.appliedRecommendations,
  };
  for (const slug of contentMemberSlugs(applied.appliedContentSnapshot)) {
    if (!Object.hasOwn(normalizedRecommendations, slug)) {
      normalizedRecommendations[slug] = DEFAULT_TEAM_EXECUTION_PROFILE;
    }
  }
  const normalizedFingerprint = recommendationFingerprint(normalizedRecommendations);
  if (
    Object.keys(normalizedRecommendations).length === Object.keys(applied.appliedRecommendations).length
    && normalizedFingerprint === applied.appliedRecommendationFingerprint
  ) {
    return applied;
  }
  return {
    ...applied,
    appliedRecommendations: normalizedRecommendations,
    appliedRecommendationFingerprint: normalizedFingerprint,
  };
}
