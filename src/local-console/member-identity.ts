import { parseAgentMarkdownFrontmatter } from "../agent-frontmatter.js";
import type {
  LocalConsoleAgentTeamSnapshot,
  LocalConsoleExecutionProfile,
  LocalConsoleMemberIdentity,
} from "./types.js";

const BUILT_IN_MEMBER_NAMES: Readonly<Record<string, string>> = {
  ceo: "CEO",
  dev: "开发",
  "dev-manager": "技术负责人",
  "hermes-user": "用户代表",
  "product-manager": "产品",
  qa: "测试",
  secretary: "秘书",
};

export function projectLocalConsoleMemberIdentities(
  snapshot: LocalConsoleAgentTeamSnapshot | null | undefined,
): LocalConsoleMemberIdentity[] {
  return snapshot?.members.map((member) => {
    const identity: LocalConsoleMemberIdentity = {
      slug: member.name,
      displayName: readSnapshotDisplayName(member.agentMarkdown),
    };
    const engine = projectMemberEngine(member.executionProfile);
    if (engine !== undefined) {
      identity.engine = engine;
    }
    // The portrait now lives in the app record and rides along in the snapshot. Snapshots
    // captured before the migration only carry the legacy AGENT.md `portrait_id`, so the
    // frontmatter remains a fallback for those frozen facts. A resolved null in the snapshot
    // means "no portrait" and must not be overridden by a stale legacy field.
    const portraitId = member.portraitId === undefined
      ? readSnapshotPortraitId(member.agentMarkdown)
      : member.portraitId;
    if (portraitId !== undefined && portraitId !== null) {
      identity.portraitId = portraitId;
    }
    return identity;
  }) ?? [];
}

function projectMemberEngine(
  profile: LocalConsoleExecutionProfile | null | undefined,
): LocalConsoleMemberIdentity["engine"] {
  if (profile === null || profile === undefined) return undefined;
  return profile.cli === "pi"
    ? { cli: profile.cli, providerId: profile.providerId }
    : { cli: profile.cli };
}

export function resolveLocalConsoleMemberName(
  role: string | null,
  memberIdentities: readonly LocalConsoleMemberIdentity[],
  unknownLabel = "成员未知",
): string {
  if (role === null || role.trim() === "") {
    return unknownLabel;
  }
  const identity = memberIdentities.find((member) => member.slug === role);
  if (identity !== undefined) {
    return identity.displayName.trim() || `@${identity.slug}`;
  }
  if (memberIdentities.length > 0) {
    return unknownLabel;
  }
  return BUILT_IN_MEMBER_NAMES[role] ?? unknownLabel;
}

function readSnapshotDisplayName(agentMarkdown: string): string {
  try {
    const parsed = parseAgentMarkdownFrontmatter(agentMarkdown);
    const frontmatter = parsed.frontmatter;
    if (
      frontmatter !== null
      && (Object.hasOwn(frontmatter, "display_name") || Object.hasOwn(frontmatter, "description"))
    ) {
      return readSingleLineDisplayName(frontmatter.display_name);
    }
    return readLegacyDisplayName(parsed.body);
  } catch {
    return "";
  }
}

function readSingleLineDisplayName(value: unknown): string {
  if (typeof value !== "string" || /\r|\n/u.test(value)) {
    return "";
  }
  return value.trim();
}

function readSnapshotPortraitId(agentMarkdown: string): string | undefined {
  try {
    const frontmatter = parseAgentMarkdownFrontmatter(agentMarkdown).frontmatter;
    if (frontmatter === null || !Object.hasOwn(frontmatter, "portrait_id")) {
      return undefined;
    }
    const value = frontmatter.portrait_id;
    if (typeof value !== "string" || /\r|\n/u.test(value)) {
      return undefined;
    }
    const normalized = value.trim();
    return normalized.length === 0 ? undefined : normalized;
  } catch {
    return undefined;
  }
}

function readLegacyDisplayName(body: string): string {
  const heading = body
    .split(/\r?\n/u)
    .find((line) => /^#(?!#)\s+\S/u.test(line.trim()));
  return heading?.trim().replace(/^#(?!#)\s+/u, "").trim() ?? "";
}
