import { parseAgentMarkdownIdentity, isValidPathSegment } from "../team-model.js";
import { serializeAgentMarkdownFrontmatter } from "../../../src/agent-frontmatter.js";

export interface AiTeamBuilderClarifyingOutput {
  phase: "clarifying";
  question: string;
}

export interface AiTeamBuilderProposal {
  team: {
    name: string;
    purpose: string;
  };
  members: AiTeamBuilderMember[];
  primaryAgentSlug: string;
  relayBeats: AiTeamBuilderRelayBeat[];
}

export interface AiTeamBuilderProposalOutput extends AiTeamBuilderProposal {
  phase: "proposal";
}

export interface AiTeamBuilderMember {
  slug: string;
  name: string;
  role: string;
  responsibilities: string[];
  constraints: string[];
  handoffs: string[];
}

export interface AiTeamBuilderRelayBeat {
  speakerSlug: string;
  message: string;
}

export type AiTeamBuilderOutput =
  | AiTeamBuilderClarifyingOutput
  | AiTeamBuilderProposalOutput;

export type AiTeamBuilderValidationIssueCode =
  | "invalid-json"
  | "invalid-shape"
  | "member-count"
  | "invalid-slug"
  | "duplicate-slug"
  | "primary-agent-reference"
  | "handoff-reference"
  | "relay-reference"
  | "agent-markdown-invalid";

export interface AiTeamBuilderValidationIssue {
  code: AiTeamBuilderValidationIssueCode;
  path: string;
  message: string;
}

export type AiTeamBuilderValidationResult =
  | { ok: true; value: AiTeamBuilderOutput }
  | { ok: false; issues: AiTeamBuilderValidationIssue[] };

export function parseAndValidateAiTeamBuilderOutput(source: string): AiTeamBuilderValidationResult {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return invalid("invalid-json", "$", "Codex output is not valid JSON.");
  }
  return validateAiTeamBuilderOutput(value);
}

export function validateAiTeamBuilderOutput(value: unknown): AiTeamBuilderValidationResult {
  if (!isPlainObject(value) || (value.phase !== "clarifying" && value.phase !== "proposal")) {
    return invalid("invalid-shape", "$.phase", "phase must be clarifying or proposal.");
  }
  if (value.phase === "clarifying") {
    const isNarrowClarifying = hasOnlyKeys(value, ["phase", "question"]);
    const isSchemaClarifying = hasOnlyKeys(
      value,
      ["phase", "question", "team", "members", "primaryAgentSlug", "relayBeats"],
    )
      && value.team === null
      && value.members === null
      && value.primaryAgentSlug === null
      && value.relayBeats === null;
    if ((!isNarrowClarifying && !isSchemaClarifying) || !isNonEmptyText(value.question)) {
      return invalid("invalid-shape", "$.question", "clarifying output must contain one non-empty question.");
    }
    return {
      ok: true,
      value: { phase: "clarifying", question: value.question.trim() },
    };
  }

  const shapeIssues: AiTeamBuilderValidationIssue[] = [];
  const isNarrowProposal = hasOnlyKeys(
    value,
    ["phase", "team", "members", "primaryAgentSlug", "relayBeats"],
  );
  const isSchemaProposal = hasOnlyKeys(
    value,
    ["phase", "question", "team", "members", "primaryAgentSlug", "relayBeats"],
  ) && value.question === null;
  if (!isNarrowProposal && !isSchemaProposal) {
    shapeIssues.push(issue("invalid-shape", "$", "proposal output contains unsupported fields."));
  }
  const team = parseTeam(value.team, shapeIssues);
  const members = parseMembers(value.members, shapeIssues);
  const primaryAgentSlug = parseText(value.primaryAgentSlug, "$.primaryAgentSlug", shapeIssues);
  const relayBeats = parseRelayBeats(value.relayBeats, shapeIssues);
  if (shapeIssues.length > 0 || team === null || members === null || primaryAgentSlug === null || relayBeats === null) {
    return { ok: false, issues: shapeIssues };
  }

  const businessIssues: AiTeamBuilderValidationIssue[] = [];
  if (members.length < 2 || members.length > 6) {
    businessIssues.push(issue("member-count", "$.members", "A team must contain between 2 and 6 members."));
  }
  const slugs = new Set<string>();
  for (const [index, member] of members.entries()) {
    if (!isStableSlug(member.slug)) {
      businessIssues.push(issue(
        "invalid-slug",
        `$.members[${String(index)}].slug`,
        `Member slug is not a stable path-safe slug: ${member.slug}`,
      ));
    } else if (slugs.has(member.slug)) {
      businessIssues.push(issue(
        "duplicate-slug",
        `$.members[${String(index)}].slug`,
        `Member slug is duplicated: ${member.slug}`,
      ));
    }
    slugs.add(member.slug);
  }
  if (!slugs.has(primaryAgentSlug)) {
    businessIssues.push(issue(
      "primary-agent-reference",
      "$.primaryAgentSlug",
      `Primary Agent does not reference a current member: ${primaryAgentSlug}`,
    ));
  }
  for (const [memberIndex, member] of members.entries()) {
    for (const [handoffIndex, handoff] of member.handoffs.entries()) {
      if (!slugs.has(handoff)) {
        businessIssues.push(issue(
          "handoff-reference",
          `$.members[${String(memberIndex)}].handoffs[${String(handoffIndex)}]`,
          `Handoff does not reference a current member: ${handoff}`,
        ));
      }
    }
    try {
      parseAgentMarkdownIdentity(renderAiTeamMemberMarkdown(member));
    } catch (error) {
      businessIssues.push(issue(
        "agent-markdown-invalid",
        `$.members[${String(memberIndex)}]`,
        error instanceof Error ? error.message : "Generated AGENT.md is invalid.",
      ));
    }
  }
  for (const [index, beat] of relayBeats.entries()) {
    if (!slugs.has(beat.speakerSlug)) {
      businessIssues.push(issue(
        "relay-reference",
        `$.relayBeats[${String(index)}].speakerSlug`,
        `Relay beat does not reference a current member: ${beat.speakerSlug}`,
      ));
    }
  }
  if (businessIssues.length > 0) {
    return { ok: false, issues: businessIssues };
  }

  return {
    ok: true,
    value: {
      phase: "proposal",
      team,
      members,
      primaryAgentSlug,
      relayBeats,
    },
  };
}

export function renderAiTeamMemberMarkdown(member: AiTeamBuilderMember): string {
  const responsibilityLines = member.responsibilities
    .map((responsibility) => `- ${responsibility}`)
    .join("\n");
  const constraintLines = member.constraints
    .map((constraint) => `- ${constraint}`)
    .join("\n");
  const handoffLines = member.handoffs.length === 0
    ? "- 完成工作后把结论交回主 Agent。"
    : member.handoffs.map((slug) => `- 需要下一步协作时交给 @${slug}。`).join("\n");
  return serializeAgentMarkdownFrontmatter(
    {
      display_name: member.name,
      description: member.role,
    },
    `# 角色

${member.role}

## 职责

${responsibilityLines}

## 克制与启用条件

${constraintLines}

## 协作与交棒

${handoffLines}
`,
  );
}

export function formatAiTeamBuilderValidationIssues(
  issues: readonly AiTeamBuilderValidationIssue[],
): string {
  return issues.map((entry) => `${entry.path}: ${entry.message}`).join("\n");
}

function parseTeam(
  value: unknown,
  issues: AiTeamBuilderValidationIssue[],
): AiTeamBuilderProposal["team"] | null {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["name", "purpose"])) {
    issues.push(issue("invalid-shape", "$.team", "team must contain only name and purpose."));
    return null;
  }
  const name = parseText(value.name, "$.team.name", issues);
  const purpose = parseText(value.purpose, "$.team.purpose", issues);
  if (name === null || purpose === null) {
    return null;
  }
  return { name, purpose };
}

function parseMembers(
  value: unknown,
  issues: AiTeamBuilderValidationIssue[],
): AiTeamBuilderMember[] | null {
  if (!Array.isArray(value)) {
    issues.push(issue("invalid-shape", "$.members", "members must be an array."));
    return null;
  }
  const members: AiTeamBuilderMember[] = [];
  for (const [index, candidate] of value.entries()) {
    const base = `$.members[${String(index)}]`;
    if (!isPlainObject(candidate)
      || !hasOnlyKeys(candidate, ["slug", "name", "role", "responsibilities", "constraints", "handoffs"])) {
      issues.push(issue("invalid-shape", base, "member has an invalid shape."));
      continue;
    }
    const slug = parseText(candidate.slug, `${base}.slug`, issues);
    const name = parseSingleLineText(candidate.name, `${base}.name`, issues);
    const role = parseSingleLineText(candidate.role, `${base}.role`, issues);
    const responsibilities = parseTextArray(candidate.responsibilities, `${base}.responsibilities`, issues, true);
    const constraints = parseTextArray(candidate.constraints, `${base}.constraints`, issues, true);
    const handoffs = parseTextArray(candidate.handoffs, `${base}.handoffs`, issues, false);
    if (slug !== null && name !== null && role !== null && responsibilities !== null && constraints !== null && handoffs !== null) {
      members.push({ slug, name, role, responsibilities, constraints, handoffs });
    }
  }
  return members;
}

function parseRelayBeats(
  value: unknown,
  issues: AiTeamBuilderValidationIssue[],
): AiTeamBuilderRelayBeat[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(issue("invalid-shape", "$.relayBeats", "relayBeats must be a non-empty array."));
    return null;
  }
  const beats: AiTeamBuilderRelayBeat[] = [];
  for (const [index, candidate] of value.entries()) {
    const base = `$.relayBeats[${String(index)}]`;
    if (!isPlainObject(candidate) || !hasOnlyKeys(candidate, ["speakerSlug", "message"])) {
      issues.push(issue("invalid-shape", base, "relay beat has an invalid shape."));
      continue;
    }
    const speakerSlug = parseText(candidate.speakerSlug, `${base}.speakerSlug`, issues);
    const message = parseText(candidate.message, `${base}.message`, issues);
    if (speakerSlug !== null && message !== null) {
      beats.push({ speakerSlug, message });
    }
  }
  return beats;
}

function parseSingleLineText(
  value: unknown,
  path: string,
  issues: AiTeamBuilderValidationIssue[],
): string | null {
  const text = parseText(value, path, issues);
  if (text !== null && /\r|\n/u.test(text)) {
    issues.push(issue("invalid-shape", path, "value must fit on one line."));
    return null;
  }
  return text;
}

function parseText(
  value: unknown,
  path: string,
  issues: AiTeamBuilderValidationIssue[],
): string | null {
  if (!isNonEmptyText(value)) {
    issues.push(issue("invalid-shape", path, "value must be a non-empty string."));
    return null;
  }
  return value.trim();
}

function parseTextArray(
  value: unknown,
  path: string,
  issues: AiTeamBuilderValidationIssue[],
  requireValue: boolean,
): string[] | null {
  if (!Array.isArray(value) || (requireValue && value.length === 0)) {
    issues.push(issue("invalid-shape", path, `value must be ${requireValue ? "a non-empty " : "an "}array.`));
    return null;
  }
  const parsed: string[] = [];
  for (const [index, candidate] of value.entries()) {
    const text = parseText(candidate, `${path}[${String(index)}]`, issues);
    if (text !== null) {
      parsed.push(text);
    }
  }
  return parsed;
}

function isStableSlug(value: string): boolean {
  return isValidPathSegment(value)
    && value === value.toLowerCase()
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)
    && value.length <= 64;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function invalid(
  code: AiTeamBuilderValidationIssueCode,
  path: string,
  message: string,
): AiTeamBuilderValidationResult {
  return { ok: false, issues: [issue(code, path, message)] };
}

function issue(
  code: AiTeamBuilderValidationIssueCode,
  path: string,
  message: string,
): AiTeamBuilderValidationIssue {
  return { code, path, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
