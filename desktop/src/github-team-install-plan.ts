import {
  DEFAULT_TEAM_EXECUTION_PROFILE,
  type ExecutionProfile,
  type ExecutionProfileBinding,
} from "./team-execution-profile.js";
import type { GithubTeamSnapshot } from "./github-team-snapshot.js";
import { isValidPathSegment, type InstallationSource } from "./team-model.js";

/** The persisted source identity used to reject installing the same repository twice. */
export interface GithubTeamUpstreamRecord {
  provider: "github";
  repository: string;
  defaultBranch: string;
}

export interface GithubTeamExistingRecord {
  id: string;
  installationSource?: InstallationSource;
  /** Legacy GitHub-following metadata, accepted only for duplicate detection. */
  upstream?: GithubTeamUpstreamRecord;
}

export const GITHUB_DEFAULT_BRANCH_BASELINE_VERSION = "github-default-branch";

export interface GithubTeamInstallPlanInput {
  teamId: string;
  snapshot: GithubTeamSnapshot;
  existingRecords: readonly GithubTeamExistingRecord[];
  defaultProfile?: ExecutionProfile;
}

export interface GithubTeamCoreContentEntry {
  relativePath: string;
  content: string;
}

export type GithubTeamInstallPlanResult =
  | {
    status: "duplicate";
    existingTeamId: string;
  }
  | {
    status: "install";
    teamId: string;
    installationSource: Extract<InstallationSource, { provider: "github" }>;
    executionBindings: Record<string, ExecutionProfileBinding>;
  };

export function findExistingGithubTeam(
  records: readonly GithubTeamExistingRecord[],
  repository: string,
): GithubTeamExistingRecord | null {
  return records.find((record) => (
    (record.installationSource?.provider === "github"
      && record.installationSource.repository === repository)
    || (record.upstream?.provider === "github"
      && record.upstream.repository === repository)
  )) ?? null;
}

export function planGithubTeamInstallation(
  input: GithubTeamInstallPlanInput,
): GithubTeamInstallPlanResult {
  const existing = findExistingGithubTeam(input.existingRecords, input.snapshot.repository.repository);
  if (existing !== null) {
    return { status: "duplicate", existingTeamId: existing.id };
  }

  const unreadableMember = input.snapshot.members.find((member) => !member.readable);
  if (unreadableMember !== undefined) {
    throw new GithubTeamInstallPlanError(
      `成员 @${unreadableMember.slug} 的 AGENT.md 不可读取，不能安装团队。`,
    );
  }

  const defaultProfile = input.defaultProfile ?? DEFAULT_TEAM_EXECUTION_PROFILE;
  const executionBindings: Record<string, ExecutionProfileBinding> = Object.fromEntries(
    input.snapshot.definition.memberOrder.map((slug) => [
      slug,
      {
        source: "explicit" as const,
        profile: input.snapshot.recommendations[slug] ?? defaultProfile,
      },
    ]),
  );

  return {
    status: "install",
    teamId: input.teamId,
    installationSource: {
      provider: "github",
      repository: input.snapshot.repository.repository,
      defaultBranch: input.snapshot.repository.defaultBranch,
    },
    executionBindings,
  };
}

export function planGithubTeamCoreContent(
  content: Readonly<Record<string, string>>,
): GithubTeamCoreContentEntry[] {
  if (!Object.hasOwn(content, "team.json")) {
    throw new GithubTeamInstallPlanError("远端团队内容缺少 team.json。", "CONTENT_PATH_INVALID");
  }
  return Object.entries(content)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath, value]) => {
      const segments = relativePath.split("/");
      const validMemberPath = segments.length === 3
        && segments[0] === "members"
        && segments[2] === "AGENT.md"
        && typeof segments[1] === "string"
        && isValidPathSegment(segments[1]);
      const validPath = relativePath === "team.json" || validMemberPath;
      const unsafePath = relativePath.length === 0
        || relativePath.startsWith("/")
        || relativePath.includes("\\")
        || segments.some((segment) => segment === "" || segment === "." || segment === "..");
      if (!validPath || unsafePath) {
        throw new GithubTeamInstallPlanError("远端团队内容包含不支持或不安全的文件路径。", "CONTENT_PATH_INVALID");
      }
      return { relativePath, content: value };
    });
}

export class GithubTeamInstallPlanError extends Error {
  readonly code: string;

  constructor(message: string, code = "GITHUB_TEAM_INSTALL_PLAN_INVALID") {
    super(message);
    this.name = "GithubTeamInstallPlanError";
    this.code = code;
  }
}
