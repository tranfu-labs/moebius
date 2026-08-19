import {
  GITHUB_TEAM_LANGUAGE_TOPICS,
  GITHUB_TEAM_TOPIC,
  type GithubRepositoryDirectoryEntry,
  type GithubRepositoryMetadata,
} from "./github-team-contract.js";
import {
  parseAgentMarkdownIdentity,
  parseTeamDefinitionJson,
  validateTeamStructure,
  type AgentMarkdownIdentity,
  type TeamDefinition,
} from "./team-model.js";
import {
  normalizeExecutionProfile,
  type ExecutionProfile,
} from "./team-execution-profile.js";

export const GITHUB_TEAM_OFFICIAL_MANIFEST_FILE = "official.json";

export interface GithubTeamRemoteFileRead {
  content: string | null;
  error?: string | null;
}

export interface GithubTeamSnapshotInput {
  repository: GithubRepositoryMetadata;
  rootEntries: readonly GithubRepositoryDirectoryEntry[];
  files: Readonly<Record<string, GithubTeamRemoteFileRead>>;
}

export interface GithubTeamSnapshotMember {
  slug: string;
  agentMarkdown: string | null;
  identity: AgentMarkdownIdentity | null;
  recommendedProfile: ExecutionProfile | null;
  readable: boolean;
  readError: string | null;
}

export interface GithubTeamRecommendationManifest {
  schemaVersion: 1;
  officialVersion: string;
  members: Readonly<Record<string, {
    recommendedProfile: ExecutionProfile;
    renamedFrom?: string;
  }>>;
}

export interface GithubTeamSnapshot {
  repository: GithubRepositoryMetadata;
  definition: TeamDefinition;
  members: readonly GithubTeamSnapshotMember[];
  recommendations: Readonly<Record<string, ExecutionProfile>>;
  /** The parsed recommendation manifest is retained for future rename-aware sync. */
  recommendationManifest: GithubTeamRecommendationManifest | null;
  officialVersion: string | null;
  /** Core files only; `official.json` is metadata and is not part of baseline A. */
  content: Readonly<Record<string, string>>;
}

export type GithubTeamSnapshotIssueCode =
  | "team-topic-missing"
  | "team-language-topic-missing"
  | "team-language-topic-conflict"
  | "team-manifest-missing"
  | "team-manifest-unreadable"
  | "team-manifest-invalid"
  | "members-directory-missing"
  | "team-structure-invalid"
  | "team-primary-missing"
  | "team-members-empty"
  | "member-agent-missing"
  | "member-agent-unreadable"
  | "member-agent-metadata-invalid"
  | "official-manifest-unreadable"
  | "official-manifest-invalid";

export interface GithubTeamSnapshotIssue {
  code: GithubTeamSnapshotIssueCode;
  path?: string;
  slug?: string;
  message: string;
}

export type GithubTeamSnapshotResult =
  | {
    status: "invalid";
    repository: GithubRepositoryMetadata;
    issues: readonly GithubTeamSnapshotIssue[];
  }
  | {
    status: "ready";
    snapshot: GithubTeamSnapshot;
    issues: readonly GithubTeamSnapshotIssue[];
  };

/**
 * Parses one already-fetched repository snapshot. Network orchestration stays
 * outside this module so format decisions remain deterministic and testable.
 * Member read failures are retained in a ready snapshot: the preview can show
 * readable members while the caller disables installation until all members are
 * available.
 */
export function parseGithubTeamSnapshot(input: GithubTeamSnapshotInput): GithubTeamSnapshotResult {
  const repositoryIssues = validateRepositoryTopics(input.repository);
  const rootIssues = validateRootEntries(input.rootEntries);
  const manifestRead = readRequiredFile(input.files, "team.json");
  if (manifestRead.error !== null) {
    return invalidResult(input.repository, [
      ...repositoryIssues,
      ...rootIssues,
      {
        code: manifestRead.missing ? "team-manifest-missing" : "team-manifest-unreadable",
        path: "team.json",
        message: manifestRead.error,
      },
    ]);
  }

  let definition: TeamDefinition;
  try {
    definition = parseTeamDefinitionJson(manifestRead.content);
  } catch (error) {
    return invalidResult(input.repository, [
      ...repositoryIssues,
      ...rootIssues,
      {
        code: "team-manifest-invalid",
        path: "team.json",
        message: formatError(error),
      },
    ]);
  }

  const structureIssues = validateDefinition(definition);
  if (repositoryIssues.length > 0 || rootIssues.length > 0 || structureIssues.length > 0) {
    return invalidResult(input.repository, [
      ...repositoryIssues,
      ...rootIssues,
      ...structureIssues,
    ]);
  }

  const official = parseOptionalOfficialManifest(input, definition);
  if (official.status === "invalid") {
    return invalidResult(input.repository, official.issues);
  }

  const members: GithubTeamSnapshotMember[] = [];
  const content: Record<string, string> = { "team.json": manifestRead.content };
  const issues: GithubTeamSnapshotIssue[] = [...official.issues];
  for (const slug of definition.memberOrder) {
    const relativePath = `members/${slug}/AGENT.md`;
    const memberRead = readRequiredFile(input.files, relativePath);
    if (memberRead.error !== null) {
      members.push({
        slug,
        agentMarkdown: null,
        identity: null,
        recommendedProfile: official.recommendations[slug] ?? null,
        readable: false,
        readError: memberRead.error,
      });
      issues.push({
        code: memberRead.missing ? "member-agent-missing" : "member-agent-unreadable",
        path: relativePath,
        slug,
        message: memberRead.error,
      });
      continue;
    }

    content[relativePath] = memberRead.content;
    try {
      const identity = parseAgentMarkdownIdentity(memberRead.content);
      members.push({
        slug,
        agentMarkdown: memberRead.content,
        identity,
        recommendedProfile: official.recommendations[slug] ?? null,
        readable: true,
        readError: null,
      });
    } catch (error) {
      members.push({
        slug,
        agentMarkdown: memberRead.content,
        identity: null,
        recommendedProfile: official.recommendations[slug] ?? null,
        readable: false,
        readError: formatError(error),
      });
      issues.push({
        code: "member-agent-metadata-invalid",
        path: relativePath,
        slug,
        message: formatError(error),
      });
    }
  }

  return {
    status: "ready",
    snapshot: {
      repository: input.repository,
      definition,
      members,
      recommendations: official.recommendations,
      recommendationManifest: official.manifest,
      officialVersion: official.manifest?.officialVersion ?? null,
      content,
    },
    issues,
  };
}

interface ParsedOfficialManifest {
  status: "ready";
  manifest: GithubTeamRecommendationManifest | null;
  recommendations: Record<string, ExecutionProfile>;
  issues: GithubTeamSnapshotIssue[];
}

function parseOptionalOfficialManifest(input: GithubTeamSnapshotInput, definition: TeamDefinition): ParsedOfficialManifest | {
  status: "invalid";
  issues: GithubTeamSnapshotIssue[];
} {
  const hasManifestEntry = input.rootEntries.some((entry) => entry.path === GITHUB_TEAM_OFFICIAL_MANIFEST_FILE);
  const manifestRead = input.files[GITHUB_TEAM_OFFICIAL_MANIFEST_FILE];
  if (!hasManifestEntry && manifestRead === undefined) {
    return { status: "ready", manifest: null, recommendations: {}, issues: [] };
  }
  if (manifestRead === undefined || manifestRead.content === null) {
    return {
      status: "invalid",
      issues: [{
        code: "official-manifest-unreadable",
        path: GITHUB_TEAM_OFFICIAL_MANIFEST_FILE,
        message: manifestRead?.error ?? "official.json is present but could not be read.",
      }],
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(manifestRead.content) as unknown;
  } catch (error) {
    return {
      status: "invalid",
      issues: [{
        code: "official-manifest-invalid",
        path: GITHUB_TEAM_OFFICIAL_MANIFEST_FILE,
        message: formatError(error),
      }],
    };
  }

  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.officialVersion !== "string"
    || value.officialVersion.trim().length === 0 || !isRecord(value.members)) {
    return {
      status: "invalid",
      issues: [{
        code: "official-manifest-invalid",
        path: GITHUB_TEAM_OFFICIAL_MANIFEST_FILE,
        message: "official.json must contain schemaVersion 1, officialVersion, and members.",
      }],
    };
  }

  const members: Record<string, { recommendedProfile: ExecutionProfile; renamedFrom?: string }> = {};
  const recommendations: Record<string, ExecutionProfile> = {};
  for (const [slug, rawMember] of Object.entries(value.members)) {
    if (!isValidStableSlug(slug) || !isRecord(rawMember)) {
      return invalidOfficialManifest(`official.json member @${slug} is invalid.`);
    }
    if (!definition.memberOrder.includes(slug)) {
      return invalidOfficialManifest(`official.json member @${slug} is not in team.json memberOrder.`);
    }
    if (typeof rawMember.recommendedProfile !== "object" || rawMember.recommendedProfile === null) {
      return invalidOfficialManifest(`official.json member @${slug} has no recommendedProfile.`);
    }
    let recommendedProfile: ExecutionProfile;
    try {
      recommendedProfile = normalizeExecutionProfile(rawMember.recommendedProfile);
    } catch (error) {
      return invalidOfficialManifest(`official.json member @${slug}: ${formatError(error)}`);
    }
    const renamedFrom = rawMember.renamedFrom;
    if (renamedFrom !== undefined && (typeof renamedFrom !== "string" || !isValidStableSlug(renamedFrom))) {
      return invalidOfficialManifest(`official.json member @${slug} has an invalid renamedFrom.`);
    }
    members[slug] = {
      recommendedProfile,
      ...(renamedFrom === undefined ? {} : { renamedFrom }),
    };
    recommendations[slug] = recommendedProfile;
  }

  return {
    status: "ready",
    manifest: {
      schemaVersion: 1,
      officialVersion: value.officialVersion.trim(),
      members,
    },
    recommendations,
    issues: [],
  };
}

function validateRepositoryTopics(repository: GithubRepositoryMetadata): GithubTeamSnapshotIssue[] {
  const issues: GithubTeamSnapshotIssue[] = [];
  if (!repository.topics.includes(GITHUB_TEAM_TOPIC)) {
    issues.push({
      code: "team-topic-missing",
      message: `Repository must have the ${GITHUB_TEAM_TOPIC} topic.`,
    });
  }
  const languageTopics = (["zh", "en"] as const).filter((language) =>
    repository.topics.includes(GITHUB_TEAM_LANGUAGE_TOPICS[language]));
  if (languageTopics.length === 0) {
    issues.push({
      code: "team-language-topic-missing",
      message: "Repository must have one language topic.",
    });
  } else if (languageTopics.length > 1) {
    issues.push({
      code: "team-language-topic-conflict",
      message: "Repository must not have both language topics.",
    });
  }
  return issues;
}

function validateRootEntries(entries: readonly GithubRepositoryDirectoryEntry[]): GithubTeamSnapshotIssue[] {
  const teamManifest = entries.find((entry) => entry.path === "team.json");
  const membersDirectory = entries.find((entry) => entry.path === "members");
  const officialManifest = entries.find((entry) => entry.path === GITHUB_TEAM_OFFICIAL_MANIFEST_FILE);
  const issues: GithubTeamSnapshotIssue[] = [];
  if (teamManifest === undefined) {
    issues.push({
      code: "team-manifest-missing",
      path: "team.json",
      message: "Repository must contain a team.json file.",
    });
  } else if (teamManifest.type !== "file") {
    issues.push({
      code: "team-manifest-invalid",
      path: "team.json",
      message: "team.json must be a regular file.",
    });
  }
  if (membersDirectory === undefined || membersDirectory.type !== "dir") {
    issues.push({
      code: "members-directory-missing",
      path: "members",
      message: "Repository must contain a members directory.",
    });
  }
  if (officialManifest !== undefined && officialManifest.type !== "file") {
    issues.push({
      code: "official-manifest-invalid",
      path: GITHUB_TEAM_OFFICIAL_MANIFEST_FILE,
      message: "official.json must be a regular file.",
    });
  }
  return issues;
}

function validateDefinition(definition: TeamDefinition): GithubTeamSnapshotIssue[] {
  const issues: GithubTeamSnapshotIssue[] = validateTeamStructure(definition).map((issue) => ({
    code: "team-structure-invalid",
    slug: issue.slug,
    message: issue.message,
  }));
  if (definition.memberOrder.length === 0) {
    issues.push({ code: "team-members-empty", message: "Team must contain at least one member." });
  }
  if (definition.primaryAgentSlug === null) {
    issues.push({ code: "team-primary-missing", message: "Team must declare a primary agent." });
  }
  return issues;
}

function readRequiredFile(
  files: Readonly<Record<string, GithubTeamRemoteFileRead>>,
  path: string,
): { content: string; error: null; missing: false } | { content: null; error: string; missing: boolean } {
  const read = files[path];
  if (read === undefined) {
    return { content: null, error: `${path} was not found in the repository.`, missing: true };
  }
  if (read.content === null) {
    return {
      content: null,
      error: read.error ?? `${path} could not be read from the repository.`,
      missing: false,
    };
  }
  return { content: read.content, error: null, missing: false };
}

function invalidResult(
  repository: GithubRepositoryMetadata,
  issues: readonly GithubTeamSnapshotIssue[],
): GithubTeamSnapshotResult {
  return { status: "invalid", repository, issues };
}

function invalidOfficialManifest(message: string): { status: "invalid"; issues: GithubTeamSnapshotIssue[] } {
  return {
    status: "invalid",
    issues: [{
      code: "official-manifest-invalid",
      path: GITHUB_TEAM_OFFICIAL_MANIFEST_FILE,
      message,
    }],
  };
}

function isValidStableSlug(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,62})$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
