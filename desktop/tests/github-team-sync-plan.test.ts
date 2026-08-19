import { describe, expect, it } from "vitest";

import {
  DEFAULT_TEAM_EXECUTION_PROFILE,
  type ExecutionProfile,
} from "../src/team-execution-profile.js";
import {
  computeOfficialTeamContentFingerprintFromContent,
  recommendationFingerprint,
  type AppliedOfficialTeamState,
} from "../src/team-official-plan.js";
import {
  buildRemoteOfficialState,
  planGithubTeamSync,
} from "../src/github-team-sync-plan.js";
import type { GithubTeamSnapshot } from "../src/github-team-snapshot.js";

const profile: ExecutionProfile = { cli: "codex", model: "gpt-5.6-sol", effort: "high" };
const upstream = {
  provider: "github" as const,
  repository: "tranfu-labs/moebius-team-development",
  defaultBranch: "main",
};

const baseContent = {
  "team.json": JSON.stringify({
    name: "开发团队",
    description: "负责软件交付。",
    primaryAgentSlug: "dev",
    memberOrder: ["dev"],
  }),
  "members/dev/AGENT.md": "---\ndisplay_name: 开发\ndescription: A\n---\n\n# A\n",
};

const updatedContent = {
  "team.json": JSON.stringify({
    name: "开发团队",
    description: "负责软件交付。",
    primaryAgentSlug: "dev",
    memberOrder: ["dev"],
  }),
  "members/dev/AGENT.md": "---\ndisplay_name: 开发\ndescription: C\n---\n\n# C\n",
};

function makeSnapshot(input: {
  content?: Readonly<Record<string, string>>;
  officialVersion?: string | null;
  recommendationManifest?: GithubTeamSnapshot["recommendationManifest"];
  readable?: boolean;
} = {}): GithubTeamSnapshot {
  const content = input.content ?? baseContent;
  const readable = input.readable ?? true;
  return {
    repository: {
      repository: upstream.repository,
      name: "开发团队",
      description: "负责软件交付。",
      stars: 12,
      updatedAt: "2026-08-18T00:00:00Z",
      private: false,
      topics: ["moebius-team", "moebius-team-zh"],
      defaultBranch: "main",
      htmlUrl: "https://github.com/tranfu-labs/moebius-team-development",
    },
    definition: {
      name: "开发团队",
      description: "负责软件交付。",
      primaryAgentSlug: "dev",
      memberOrder: ["dev"],
    },
    members: [{
      slug: "dev",
      agentMarkdown: readable ? content["members/dev/AGENT.md"] ?? null : null,
      identity: readable ? { displayName: "开发", description: "开发规则" } : null,
      recommendedProfile: profile,
      readable,
      readError: readable ? null : "GitHub returned 403",
    }],
    recommendations: { dev: profile },
    recommendationManifest: input.recommendationManifest === undefined
      ? {
          schemaVersion: 1,
          officialVersion: input.officialVersion ?? "2",
          members: { dev: { recommendedProfile: profile } },
        }
      : input.recommendationManifest,
    officialVersion: input.officialVersion === undefined ? "2" : input.officialVersion,
    content,
  };
}

function makeApplied(content: Readonly<Record<string, string>> = baseContent): AppliedOfficialTeamState {
  return {
    appliedOfficialVersion: "1",
    appliedContentFingerprint: computeOfficialTeamContentFingerprintFromContent(content),
    appliedRecommendationFingerprint: recommendationFingerprint({ dev: profile }),
    appliedRecommendations: { dev: profile },
    baselineConfidence: "verified",
    appliedContentSnapshot: { ...content },
  };
}

function makeInput(snapshot: GithubTeamSnapshot, applied = makeApplied()) {
  return {
    upstream,
    snapshot,
    applied,
    currentContent: baseContent,
    bindings: { dev: { source: "recommended" as const } },
    suppressedOfficialVersions: [],
  };
}

describe("planGithubTeamSync", () => {
  it("maps a clean remote update into the existing A/B/C apply plan", () => {
    const result = planGithubTeamSync(makeInput(makeSnapshot({ content: updatedContent })));

    expect(result.kind).toBe("decision");
    if (result.kind !== "decision") return;
    expect(result.decision.kind).toBe("apply");
    if (result.decision.kind !== "apply") return;
    expect(result.decision.apply.targetContent).toEqual(updatedContent);
    expect(result.decision.apply.memberChanges.adopted).toEqual(["dev"]);
    expect(result.nextUpstream).toEqual(upstream);
  });

  it("normalizes an installed no-manifest baseline without treating the first check as an update", () => {
    const snapshot = makeSnapshot({ officialVersion: null, recommendationManifest: null });
    const applied = makeApplied();
    applied.appliedOfficialVersion = "github-default-branch";
    applied.appliedRecommendations = {};
    applied.appliedRecommendationFingerprint = recommendationFingerprint({});

    const result = planGithubTeamSync(makeInput(snapshot, applied));

    expect(result.kind).toBe("decision");
    if (result.kind !== "decision") return;
    expect(result.applied.appliedRecommendations).toEqual({ dev: DEFAULT_TEAM_EXECUTION_PROFILE });
    expect(result.decision).toEqual({ kind: "none", reason: "CURRENT" });
    expect(buildRemoteOfficialState(snapshot).manifest.members.dev?.recommendedProfile).toEqual(
      DEFAULT_TEAM_EXECUTION_PROFILE,
    );
  });

  it("retains rename metadata for structural user-priority decisions", () => {
    const renamedContent = {
      "team.json": JSON.stringify({
        name: "开发团队",
        description: "负责软件交付。",
        primaryAgentSlug: "quality",
        memberOrder: ["quality"],
      }),
      "members/quality/AGENT.md": "---\ndisplay_name: 质量\ndescription: C\n---\n\n# C\n",
    };
    const snapshot = makeSnapshot({
      content: renamedContent,
      recommendationManifest: {
        schemaVersion: 1,
        officialVersion: "2",
        members: { quality: { recommendedProfile: profile, renamedFrom: "dev" } },
      },
    });
    snapshot.definition = {
      ...snapshot.definition,
      primaryAgentSlug: "quality",
      memberOrder: ["quality"],
    };
    snapshot.members = [{
      ...snapshot.members[0]!,
      slug: "quality",
      agentMarkdown: renamedContent["members/quality/AGENT.md"]!,
    }];
    snapshot.recommendations = { quality: profile };

    const result = planGithubTeamSync(makeInput(snapshot));

    expect(result.kind).toBe("decision");
    if (result.kind !== "decision" || result.decision.kind !== "apply") return;
    expect(result.decision.apply.memberChanges.renamed).toEqual([{ from: "dev", to: "quality" }]);
  });

  it("does not decide an update from a partial remote snapshot or a different source", () => {
    const unreadable = planGithubTeamSync(makeInput(makeSnapshot({ readable: false })));
    expect(unreadable).toMatchObject({ kind: "skip", reason: "REMOTE_UNREADABLE" });

    const differentSource = planGithubTeamSync({
      ...makeInput(makeSnapshot()),
      upstream: { ...upstream, repository: "tranfu-labs/other-team" },
    });
    expect(differentSource).toMatchObject({ kind: "skip", reason: "SOURCE_MISMATCH" });
  });
});
