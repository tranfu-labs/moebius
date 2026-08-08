import {
  parseAgentMarkdownFrontmatter,
  serializeAgentMarkdownFrontmatter,
} from "../../src/agent-frontmatter.js";

export const TEAM_MANIFEST_FILE = "team.json";
export const TEAM_MEMBERS_DIRECTORY = "members";
export const TEAM_AGENT_FILE = "AGENT.md";

export type TeamOwnership = "system" | "user";
// TeamStatus describes only a team already present on disk. AI builder draft and
// commit lifecycle belong to ai-team-builder/AiTeamBuilderPhase and must stay separate.
export type TeamStatus = "usable" | "unfinished-draft" | "needs-repair";

export interface TeamDefinition {
  name: string;
  description: string;
  primaryAgentSlug: string | null;
  memberOrder: string[];
}

export interface AgentMarkdownIdentity {
  displayName: string;
  description: string;
  /** Chosen face id; absent or null keeps the slug-derived default. */
  portraitId?: string | null;
}

export interface TeamInformation {
  name: string;
  description: string;
}

export const DEFAULT_NEW_AGENT_IDENTITY: AgentMarkdownIdentity = {
  displayName: "新 Agent",
  description: "描述这个 Agent 负责什么。",
};

export type TeamRepairIssueCode =
  | "team-directory-missing"
  | "team-directory-unreadable"
  | "team-manifest-missing"
  | "team-manifest-unreadable"
  | "team-manifest-invalid"
  | "member-slug-missing"
  | "member-slug-duplicate"
  | "primary-agent-not-member"
  | "member-agent-missing"
  | "member-agent-unreadable"
  | "member-agent-metadata-invalid";

export interface TeamRepairIssue {
  code: TeamRepairIssueCode;
  slug?: string;
  message: string;
}

export interface TeamStatusInput {
  definition: TeamDefinition | null;
  issues?: readonly TeamRepairIssue[];
}

export interface TeamStatusResult {
  status: TeamStatus;
  canCreateConversation: boolean;
  issues: TeamRepairIssue[];
}

export function parseTeamDefinitionJson(source: string): TeamDefinition {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new TeamDefinitionError("team.json must contain valid JSON");
  }

  if (!isPlainObject(value)) {
    throw new TeamDefinitionError("team.json must contain a JSON object");
  }

  const allowedKeys = new Set(["name", "description", "primaryAgentSlug", "memberOrder", "relayBeats"]);
  const unexpectedKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unexpectedKey !== undefined) {
    throw new TeamDefinitionError(`team.json contains unsupported field: ${unexpectedKey}`);
  }

  if (typeof value.name !== "string" || typeof value.description !== "string") {
    throw new TeamDefinitionError("team.json name and description must be strings");
  }
  const primaryAgentSlug = value.primaryAgentSlug;
  if (primaryAgentSlug !== null && typeof primaryAgentSlug !== "string") {
    throw new TeamDefinitionError("team.json primaryAgentSlug must be a string or null");
  }
  if (!Array.isArray(value.memberOrder)) {
    throw new TeamDefinitionError("team.json memberOrder must be an array");
  }
  return {
    name: value.name,
    description: value.description,
    primaryAgentSlug: primaryAgentSlug === null || primaryAgentSlug.trim().length === 0 ? null : primaryAgentSlug,
    memberOrder: [...value.memberOrder] as string[],
  };
}

export function serializeTeamDefinition(definition: TeamDefinition): string {
  return `${JSON.stringify(
    {
      name: definition.name,
      description: definition.description,
      primaryAgentSlug: definition.primaryAgentSlug,
      memberOrder: definition.memberOrder,
    },
    null,
    2,
  )}\n`;
}

export function parseAgentMarkdownIdentity(source: string): AgentMarkdownIdentity {
  let parsed: ReturnType<typeof parseAgentMarkdownFrontmatter>;
  try {
    parsed = parseAgentMarkdownFrontmatter(source);
  } catch (error) {
    throw new AgentMarkdownMetadataError(formatError(error));
  }

  const frontmatter = parsed.frontmatter;
  const hasDisplayName = frontmatter !== null && Object.hasOwn(frontmatter, "display_name");
  const hasDescription = frontmatter !== null && Object.hasOwn(frontmatter, "description");
  const portraitId = frontmatter !== null && Object.hasOwn(frontmatter, "portrait_id")
    ? parseOptionalPortraitId(frontmatter.portrait_id)
    : undefined;
  if (hasDisplayName || hasDescription) {
    if (!hasDisplayName || !hasDescription) {
      throw new AgentMarkdownMetadataError(
        "Agent frontmatter identity requires both display_name and description",
      );
    }
    return {
      displayName: parseIdentityField(frontmatter?.display_name, "display_name"),
      description: parseIdentityField(frontmatter?.description, "description"),
      ...(portraitId === undefined ? {} : { portraitId }),
    };
  }

  const legacy = parseLegacyAgentMarkdownIdentity(parsed.body);
  return portraitId === undefined ? legacy : { ...legacy, portraitId };
}

export function tryParseAgentMarkdownIdentity(
  source: string,
  fallback: AgentMarkdownIdentity = { displayName: "", description: "" },
): AgentMarkdownIdentity {
  try {
    return parseAgentMarkdownIdentity(source);
  } catch {
    return fallback;
  }
}

function parseLegacyAgentMarkdownIdentity(body: string): AgentMarkdownIdentity {
  const lines = body.split(/\r?\n/u);
  const headingIndex = lines.findIndex((line) => /^#(?!#)\s+\S/u.test(line));

  if (headingIndex < 0) {
    return { displayName: "", description: "" };
  }

  const displayName = lines[headingIndex]?.replace(/^#(?!#)\s+/, "").trim() ?? "";
  const description =
    lines
      .slice(headingIndex + 1)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("<!--")) ?? "";

  return { displayName, description };
}

export function createInitialAgentMarkdown(identity: AgentMarkdownIdentity): string {
  const displayName = identity.displayName.trim();
  const description = identity.description.trim();
  if (displayName.length === 0 || description.length === 0) {
    throw new TeamDefinitionError("Agent display name and description are required");
  }
  if (/\r|\n/u.test(displayName) || /\r|\n/u.test(description)) {
    throw new TeamDefinitionError("Agent display name and description must each fit on one line");
  }
  return serializeAgentMarkdownFrontmatter(
    { display_name: displayName, description },
    "# 角色\n\n请补充这个 Agent 的职责、边界和协作方式。\n",
  );
}

export function createUniqueAgentSlug(displayName: string, existingSlugs: Iterable<string>): string {
  const normalized = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48)
    .replace(/-+$/gu, "");
  const baseSlug = normalized || "agent";
  const occupied = new Set(existingSlugs);
  if (!occupied.has(baseSlug)) {
    return baseSlug;
  }

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${baseSlug}-${suffix}`;
    if (!occupied.has(candidate)) {
      return candidate;
    }
  }
}

export function evaluateTeamStatus(input: TeamStatusInput): TeamStatusResult {
  const issues = [...(input.issues ?? [])];
  if (input.definition !== null) {
    issues.push(...validateTeamStructure(input.definition));
  }

  if (input.definition === null || issues.length > 0) {
    return { status: "needs-repair", canCreateConversation: false, issues };
  }

  if (input.definition.primaryAgentSlug === null || input.definition.primaryAgentSlug.trim().length === 0) {
    return { status: "unfinished-draft", canCreateConversation: false, issues: [] };
  }

  return { status: "usable", canCreateConversation: true, issues: [] };
}

export function validateTeamStructure(definition: TeamDefinition): TeamRepairIssue[] {
  const issues: TeamRepairIssue[] = [];
  const seenSlugs = new Set<string>();

  for (const candidate of definition.memberOrder) {
    if (typeof candidate !== "string" || !isValidPathSegment(candidate) || candidate.trim() !== candidate) {
      issues.push({ code: "member-slug-missing", message: "A team member is missing its stable slug." });
      continue;
    }

    if (seenSlugs.has(candidate)) {
      issues.push({
        code: "member-slug-duplicate",
        slug: candidate,
        message: `Team member slug is duplicated: ${candidate}`,
      });
      continue;
    }
    seenSlugs.add(candidate);
  }

  const primaryAgentSlug = definition.primaryAgentSlug;
  if (primaryAgentSlug !== null && primaryAgentSlug.trim().length > 0 && !seenSlugs.has(primaryAgentSlug)) {
    issues.push({
      code: "primary-agent-not-member",
      slug: primaryAgentSlug,
      message: `Primary agent is not a current team member: ${primaryAgentSlug}`,
    });
  }

  return issues;
}

export function isValidPathSegment(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\") && !value.includes("\0");
}

export class TeamDefinitionError extends Error {
  readonly code = "TEAM_DEFINITION_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "TeamDefinitionError";
  }
}

export class AgentMarkdownMetadataError extends TeamDefinitionError {
  readonly metadataCode = "AGENT_METADATA_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "AgentMarkdownMetadataError";
  }
}

function parseIdentityField(value: unknown, field: "display_name" | "description"): string {
  if (typeof value !== "string") {
    throw new AgentMarkdownMetadataError(`Agent frontmatter ${field} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || /\r|\n/u.test(normalized)) {
    throw new AgentMarkdownMetadataError(`Agent frontmatter ${field} must be a non-empty single-line string`);
  }
  return normalized;
}

/**
 * The portrait is cosmetic: unlike the identity fields it never fails the team read, it only
 * falls back to the slug default when it is absent or not a clean single-line string. Unknown
 * ids are the UI's problem (`AgentPortrait` already falls back per-id), not a team health issue.
 */
function parseOptionalPortraitId(value: unknown): string | null {
  if (typeof value !== "string" || /\r|\n/u.test(value)) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
