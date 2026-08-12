import {
  computeOfficialTeamContentFingerprintFromContent,
  computeOfficialTeamMemberChanges,
  type AppliedOfficialTeamState,
  type OfficialTeamContent,
  type PackagedOfficialTeamState,
} from "./team-official-plan.js";

export type { OfficialTeamContent } from "./team-official-plan.js";
import {
  migrateOfficialMemberBindings,
  normalizeExecutionProfile,
  type ExecutionProfile,
  type ExecutionProfileBinding,
} from "./team-execution-profile.js";
import {
  parseTeamDefinitionJson,
  type TeamDefinition,
} from "./team-model.js";

export const AUTO_SYNC_JOURNAL_FILE = "auto-sync-journal-v1.json";
export const OFFICIAL_SYNC_BATCHES_FILE = "official-sync-batches-v1.json";

/**
 * One official sync batch: everything the auto-sync changed for one team, plus
 * the pre-sync snapshot that makes the whole batch revertible. Only the latest
 * batch per team is retained; a newer sync replaces it (the older sync stays
 * available member-by-member through the revision timelines).
 */
export interface OfficialSyncBatchRecord {
  schemaVersion: 1;
  batchId: string;
  teamId: string;
  officialVersion: string;
  occurredAt: string;
  status: "active" | "dismissed" | "reverted";
  seen: boolean;
  memberChanges: OfficialAutoSyncMemberChanges;
  affectedMemberCount: number;
  /** Full pre-sync team directory snapshot (relative path -> UTF-8 text). */
  previousContent: OfficialTeamContent | null;
  previousBindings: Record<string, ExecutionProfileBinding> | null;
}

/**
 * A merge that could not be completed: the official version has changes that
 * still need the default Agent, or the conservative baseline has never been
 * merged. Kept as a notice with a retry; never blocks any other operation.
 */
export interface PendingOfficialMergeRecord {
  teamId: string;
  officialVersion: string;
  reason: "CONSERVATIVE_BASELINE" | "DEFAULT_AGENT_UNAVAILABLE";
  pendingMemberSlugs: string[];
  since: string;
}

export interface OfficialAutoSyncMemberChanges {
  added: string[];
  removed: string[];
  renamed: Array<{ from: string; to: string }>;
  /** Members that followed C wholesale because B had not diverged from A. */
  adopted: string[];
  recommendationChanged: string[];
  /** Members C removed/renamed away that stay because the user changed them. */
  keptOverridden: string[];
  /** C-added slugs already present as user members; the official member does not join. */
  collidedMembers: string[];
  /** Members whose content was produced by the default-Agent merge. */
  mergedMembers: string[];
  /** Diverged members kept at B because the merge was unavailable. */
  pendingMergeMembers: string[];
}

export function isEmptyOfficialSyncMemberChanges(changes: OfficialAutoSyncMemberChanges): boolean {
  return changes.added.length === 0
    && changes.removed.length === 0
    && changes.renamed.length === 0
    && changes.adopted.length === 0
    && changes.recommendationChanged.length === 0
    && changes.keptOverridden.length === 0
    && changes.collidedMembers.length === 0
    && changes.mergedMembers.length === 0
    && changes.pendingMergeMembers.length === 0;
}

export function officialSyncAffectedMemberCount(changes: OfficialAutoSyncMemberChanges): number {
  return new Set([
    ...changes.added,
    ...changes.removed,
    ...changes.renamed.flatMap((entry) => [entry.from, entry.to]),
    ...changes.adopted,
    ...changes.recommendationChanged,
    ...changes.keptOverridden,
    ...changes.collidedMembers,
    ...changes.mergedMembers,
    ...changes.pendingMergeMembers,
  ]).size;
}

export interface OfficialAutoSyncApply {
  /** Full target content map (fingerprint-relevant files only). */
  targetContent: OfficialTeamContent;
  nextBindings: Record<string, ExecutionProfileBinding>;
  /** Members whose content changed vs B (official revision + change markers). */
  changedMemberSlugs: string[];
  /** Diverged members; the executor runs the default-Agent merge per member. */
  mergeCandidates: string[];
  memberChanges: OfficialAutoSyncMemberChanges;
}

export type OfficialTeamAutoSyncPlan =
  | { kind: "skip"; reason: "NO_OFFICIAL_RECORD" | "UNREADABLE" | "NEEDS_REPAIR" }
  | { kind: "none"; reason: "CURRENT" | "ONLY_USER_CHANGES" | "SUPPRESSED_VERSION" }
  | {
      kind: "register";
      memberChanges: OfficialAutoSyncMemberChanges;
      nextBindings: Record<string, ExecutionProfileBinding>;
    }
  | { kind: "defer"; reason: "CONSERVATIVE_BASELINE" }
  | { kind: "apply"; apply: OfficialAutoSyncApply };

export interface OfficialTeamAutoSyncInput {
  applied: AppliedOfficialTeamState;
  currentContentFingerprint: string | null;
  currentContent: OfficialTeamContent | null;
  packaged: PackagedOfficialTeamState;
  packagedContent: OfficialTeamContent;
  bindings: Readonly<Record<string, ExecutionProfileBinding>>;
  suppressedOfficialVersions: readonly string[];
}

/**
 * Three-way auto-sync decision per the 2026-08-07 product decision
 * (docs/product/pages/agent-teams.md#官方版本与三方比较):
 * - B == A content → adopt C with protection rules (overrides still protect).
 * - B == C content → register the new baseline only; content untouched.
 * - B and C diverged from A → per-member merge, default-Agent for diverged
 *   members (user intent first), structural rules applied without the Agent.
 * - conservative baseline (A unknowable) → never auto-merge; one-time entry.
 * - reverted versions → never re-merged after an undo.
 */
export function planOfficialTeamAutoSync(input: OfficialTeamAutoSyncInput): OfficialTeamAutoSyncPlan {
  if (input.currentContentFingerprint === null || input.currentContent === null) {
    return { kind: "skip", reason: "UNREADABLE" };
  }
  if (input.suppressedOfficialVersions.includes(input.packaged.manifest.officialVersion)) {
    return { kind: "none", reason: "SUPPRESSED_VERSION" };
  }
  const delta = computeOfficialTeamMemberChanges({
    applied: input.applied,
    packaged: input.packaged,
  });
  if (!delta.hasOfficialUpdate) {
    const customized = input.currentContentFingerprint !== input.applied.appliedContentFingerprint;
    return { kind: "none", reason: customized ? "ONLY_USER_CHANGES" : "CURRENT" };
  }
  if (input.applied.baselineConfidence === "conservative") {
    return { kind: "defer", reason: "CONSERVATIVE_BASELINE" };
  }
  const appliedContent = input.applied.appliedContentSnapshot;
  if (appliedContent === undefined || appliedContent === null) {
    // A verified baseline without a content snapshot is the same "A unknowable"
    // condition as conservative: without A's text there is no three-way compare.
    return { kind: "defer", reason: "CONSERVATIVE_BASELINE" };
  }
  const customized = input.currentContentFingerprint !== input.applied.appliedContentFingerprint;
  const contentAlreadyLatest = input.currentContentFingerprint === input.packaged.contentFingerprint;
  if (!customized) {
    return planApply({
      applied: input.applied,
      appliedContent,
      currentContent: input.currentContent,
      packagedContent: input.packagedContent,
      packaged: input.packaged,
      bindings: input.bindings,
    });
  }
  if (contentAlreadyLatest) {
    const nextBindings = planAutoSyncBindings({
      appliedRecommendations: input.applied.appliedRecommendations,
      packagedRecommendations: delta.packagedRecommendations,
      bindings: input.bindings,
      keptSlugs: [],
      removedSlugs: [],
    });
    return {
      kind: "register",
      nextBindings,
      memberChanges: {
        added: [],
        removed: [],
        renamed: [],
        adopted: [],
        recommendationChanged: delta.recommendationChangedMembers,
        keptOverridden: [],
        collidedMembers: [],
        mergedMembers: [],
        pendingMergeMembers: [],
      },
    };
  }
  return planApply({
    applied: input.applied,
    appliedContent,
    currentContent: input.currentContent,
    packagedContent: input.packagedContent,
    packaged: input.packaged,
    bindings: input.bindings,
  });
}

type MemberDecision =
  | { action: "keep" }
  | { action: "adopt-c" }
  | { action: "merge" }
  | { action: "keep-protected" }
  | { action: "remove" }
  | { action: "collide" }
  | { action: "add" };

function planApply(input: {
  applied: AppliedOfficialTeamState;
  appliedContent: OfficialTeamContent;
  currentContent: OfficialTeamContent;
  packagedContent: OfficialTeamContent;
  packaged: PackagedOfficialTeamState;
  bindings: Readonly<Record<string, ExecutionProfileBinding>>;
}): OfficialTeamAutoSyncPlan {
  const appliedSlugs = contentMemberSlugs(input.appliedContent);
  const currentSlugs = contentMemberSlugs(input.currentContent);
  const packagedSlugs = contentMemberSlugs(input.packagedContent);
  const renamedTo: Set<string> = new Set(
    Object.values(input.packaged.manifest.members)
      .filter((member) => member.renamedFrom !== undefined)
      .map((member) => member.renamedFrom as string),
  );
  const renamedFromOf = new Map<string, string>();
  for (const [to, member] of Object.entries(input.packaged.manifest.members)) {
    if (member.renamedFrom !== undefined) {
      renamedFromOf.set(to, member.renamedFrom);
    }
  }

  const decisions = new Map<string, MemberDecision>();
  for (const slug of currentSlugs) {
    if (packagedSlugs.includes(slug)) {
      if (!appliedSlugs.includes(slug)) {
        // Official C adds a slug the user already built: the user member stays
        // and the official member does not join.
        decisions.set(slug, { action: "collide" });
        continue;
      }
      const a = memberFileMap(input.appliedContent, slug);
      const b = memberFileMap(input.currentContent, slug);
      const c = memberFileMap(input.packagedContent, slug);
      if (equalFileMaps(a, c)) {
        decisions.set(slug, { action: "keep" });
      } else if (equalFileMaps(a, b)) {
        decisions.set(slug, { action: "adopt-c" });
      } else if (equalFileMaps(b, c)) {
        decisions.set(slug, { action: "keep" });
      } else {
        decisions.set(slug, { action: "merge" });
      }
      continue;
    }
    if (renamedTo.has(slug)) {
      // Official renamed this slug away; `from` follows the removal rules and
      // the new slug is added below as a fresh official member.
      decisions.set(slug, userChangedMember(slug, input)
        ? { action: "keep-protected" }
        : { action: "remove" });
      continue;
    }
    decisions.set(slug, userChangedMember(slug, input)
      ? { action: "keep-protected" }
      : { action: "remove" });
  }
  for (const slug of packagedSlugs) {
    if (decisions.has(slug)) {
      continue;
    }
    if (currentSlugs.includes(slug) && !appliedSlugs.includes(slug)) {
      decisions.set(slug, { action: "collide" });
      continue;
    }
    decisions.set(slug, { action: "add" });
  }

  const survivingSlugs = currentSlugs.filter((slug) => {
    const decision = decisions.get(slug)?.action;
    return decision === "keep"
      || decision === "adopt-c"
      || decision === "merge"
      || decision === "keep-protected"
      || decision === "collide";
  });
  const removedSlugs = currentSlugs.filter((slug) => decisions.get(slug)?.action === "remove");
  const addedSlugs = packagedSlugs.filter((slug) => decisions.get(slug)?.action === "add");
  const keptSlugs = currentSlugs.filter((slug) => decisions.get(slug)?.action === "keep-protected");
  const collideSlugs = currentSlugs.filter((slug) => decisions.get(slug)?.action === "collide");
  const mergeSlugs = currentSlugs.filter((slug) => decisions.get(slug)?.action === "merge");
  const adoptSlugs = currentSlugs.filter((slug) => decisions.get(slug)?.action === "adopt-c");

  const appliedDefinition = parseTeamDefinitionJson(input.appliedContent["team.json"] ?? "{}");
  const currentDefinition = parseTeamDefinitionJson(input.currentContent["team.json"] ?? "{}");
  const packagedDefinition = parseTeamDefinitionJson(input.packagedContent["team.json"] ?? "{}");
  const targetContent = planTargetContent({
    appliedContent: input.appliedContent,
    currentContent: input.currentContent,
    packagedContent: input.packagedContent,
    decisions,
    survivingSlugs,
    addedSlugs,
    appliedDefinition,
    currentDefinition,
    packagedDefinition,
  });

  const delta = computeOfficialTeamMemberChanges({
    applied: input.applied,
    packaged: input.packaged,
  });

  const renamed: Array<{ from: string; to: string }> = [];
  for (const [to, from] of renamedFromOf) {
    if (decisions.get(from)?.action === "remove" && decisions.get(to)?.action === "add") {
      renamed.push({ from, to });
    }
  }
  renamed.sort((left, right) => compareNames(left.to, right.to));

  const nextBindings = planAutoSyncBindings({
    appliedRecommendations: input.applied.appliedRecommendations,
    packagedRecommendations: recommendationsFromManifestOf(input.packaged),
    bindings: input.bindings,
    keptSlugs,
    removedSlugs,
  });

  const memberChanges: OfficialAutoSyncMemberChanges = {
    added: [...addedSlugs],
    removed: [...removedSlugs],
    renamed,
    adopted: [...adoptSlugs],
    recommendationChanged: delta.recommendationChangedMembers,
    keptOverridden: [...keptSlugs],
    collidedMembers: [...collideSlugs],
    mergedMembers: [],
    pendingMergeMembers: [],
  };

  return {
    kind: "apply",
    apply: {
      targetContent,
      nextBindings,
      changedMemberSlugs: [...adoptSlugs, ...mergeSlugs, ...addedSlugs],
      mergeCandidates: [...mergeSlugs],
      memberChanges,
    },
  };
}

function userChangedMember(
  slug: string,
  input: {
    appliedContent: OfficialTeamContent;
    currentContent: OfficialTeamContent;
    bindings: Readonly<Record<string, ExecutionProfileBinding>>;
  },
): boolean {
  const binding = input.bindings[slug];
  if (binding !== undefined && binding.source !== "recommended") {
    return true;
  }
  return !equalFileMaps(
    memberFileMap(input.appliedContent, slug),
    memberFileMap(input.currentContent, slug),
  );
}

function planTargetContent(input: {
  appliedContent: OfficialTeamContent;
  currentContent: OfficialTeamContent;
  packagedContent: OfficialTeamContent;
  decisions: ReadonlyMap<string, MemberDecision>;
  survivingSlugs: readonly string[];
  addedSlugs: readonly string[];
  appliedDefinition: TeamDefinition;
  currentDefinition: TeamDefinition;
  packagedDefinition: TeamDefinition;
}): OfficialTeamContent {
  const target: Record<string, string> = {};
  for (const slug of input.survivingSlugs) {
    const decision = input.decisions.get(slug)!.action;
    const source = decision === "adopt-c"
      ? input.packagedContent
      : input.currentContent;
    for (const [relativePath, content] of memberFiles(source, slug)) {
      target[relativePath] = content;
    }
  }
  for (const slug of input.addedSlugs) {
    for (const [relativePath, content] of memberFiles(input.packagedContent, slug)) {
      target[relativePath] = content;
    }
  }
  const orderSource = sameMemberOrder(input.appliedDefinition, input.currentDefinition)
    ? input.packagedDefinition
    : input.currentDefinition;
  const survivingSet = new Set(input.survivingSlugs);
  const memberOrder = [
    ...orderSource.memberOrder.filter((slug) => survivingSet.has(slug)),
    ...input.packagedDefinition.memberOrder.filter((slug) =>
      !orderSource.memberOrder.includes(slug) && survivingSet.has(slug)),
  ];
  let primaryAgentSlug = input.currentDefinition.primaryAgentSlug
    !== input.appliedDefinition.primaryAgentSlug
    ? input.currentDefinition.primaryAgentSlug
    : input.packagedDefinition.primaryAgentSlug;
  if (primaryAgentSlug === null || !memberOrder.includes(primaryAgentSlug)) {
    primaryAgentSlug = memberOrder[0] ?? null;
  }
  const portraits = Object.fromEntries(
    Object.entries(input.currentDefinition.memberPortraits ?? {})
      .filter(([slug]) => survivingSet.has(slug)),
  );
  target["team.json"] = JSON.stringify({
    name: input.currentDefinition.name !== input.appliedDefinition.name
      ? input.currentDefinition.name
      : input.packagedDefinition.name,
    description: input.currentDefinition.description !== input.appliedDefinition.description
      ? input.currentDefinition.description
      : input.packagedDefinition.description,
    primaryAgentSlug,
    memberOrder,
    ...(Object.keys(portraits).length > 0 ? { memberPortraits: portraits } : {}),
  });
  return target;
}

function planAutoSyncBindings(input: {
  appliedRecommendations: Record<string, ExecutionProfile>;
  packagedRecommendations: Record<string, ExecutionProfile>;
  bindings: Readonly<Record<string, ExecutionProfileBinding>>;
  keptSlugs: readonly string[];
  removedSlugs: readonly string[];
}): Record<string, ExecutionProfileBinding> {
  const migrated = migrateOfficialMemberBindings({
    previousMembers: input.appliedRecommendations,
    nextMembers: input.packagedRecommendations,
    bindings: input.bindings,
  });
  for (const slug of input.keptSlugs) {
    const binding = input.bindings[slug];
    if (binding === undefined || binding.source === "recommended") {
      // The official version no longer carries this member, so "follow
      // recommendation" freezes at the last applied recommendation.
      const recommendation = input.appliedRecommendations[slug];
      migrated.nextBindings[slug] = {
        source: "explicit",
        profile: recommendation === undefined
          ? DEFAULT_KEPT_MEMBER_PROFILE
          : normalizeExecutionProfile(recommendation),
      };
      continue;
    }
    migrated.nextBindings[slug] = {
      source: binding.source,
      profile: normalizeExecutionProfile(binding.profile),
    };
  }
  for (const slug of input.removedSlugs) {
    delete migrated.nextBindings[slug];
  }
  return migrated.nextBindings;
}

const DEFAULT_KEPT_MEMBER_PROFILE: ExecutionProfile = Object.freeze({
  cli: "codex",
  model: "gpt-5.6-sol",
  effort: "high",
});

/**
 * Prompt for the default-Agent semantic merge of one diverged member. The
 * Agent's output is an accepted, revertible fact (the sync batch undo restores
 * the pre-sync content); user intent wins on any conflict.
 */
export function buildMemberMergePrompt(input: {
  memberSlug: string;
  officialPrevious: string;
  userCurrent: string;
  officialNew: string;
}): string {
  return [
    "你是 Moebius 的官方团队合并助手。下面是一份成员规则文档（AGENT.md）的三个版本：",
    "",
    "官方旧版（A）：上次应用在用户机器上的官方版本。",
    "用户当前版（B）：用户可能修改过。",
    "官方新版（C）：当前软件携带的官方改进。",
    "",
    "规则：用户的意图优先。C 中不与 B 冲突的改进要合入；B 与 C 冲突时保留 B 的写法。",
    "保留 YAML frontmatter（display_name / description）与原有格式。",
    "只输出合并后的完整 AGENT.md 本身，不要任何解释。",
    "",
    "官方旧版（A）：",
    "---",
    input.officialPrevious,
    "---",
    "",
    "用户当前版（B）：",
    "---",
    input.userCurrent,
    "---",
    "",
    "官方新版（C）：",
    "---",
    input.officialNew,
    "---",
  ].join("\n");
}

export function computeTargetContentFingerprint(content: OfficialTeamContent): string {
  return computeOfficialTeamContentFingerprintFromContent(content);
}

export function contentMemberSlugs(content: OfficialTeamContent): string[] {
  const slugs = new Set<string>();
  const prefix = "members/";
  for (const relativePath of Object.keys(content)) {
    if (!relativePath.startsWith(prefix)) {
      continue;
    }
    const rest = relativePath.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash > 0) {
      slugs.add(rest.slice(0, slash));
    }
  }
  return [...slugs].sort(compareNames);
}

function memberFileMap(content: OfficialTeamContent, slug: string): Record<string, string> {
  const result: Record<string, string> = {};
  const prefix = `members/${slug}/`;
  for (const [relativePath, value] of Object.entries(content)) {
    if (relativePath.startsWith(prefix)) {
      result[relativePath] = value;
    }
  }
  return result;
}

function memberFiles(content: OfficialTeamContent, slug: string): Array<[string, string]> {
  const prefix = `members/${slug}/`;
  return Object.entries(content)
    .filter(([relativePath]) => relativePath.startsWith(prefix))
    .sort(([left], [right]) => compareNames(left, right));
}

function equalFileMaps(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left).sort(compareNames);
  const rightKeys = Object.keys(right).sort(compareNames);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => left[key] === right[key]);
}

function sameMemberOrder(left: TeamDefinition, right: TeamDefinition): boolean {
  return left.memberOrder.length === right.memberOrder.length
    && left.memberOrder.every((slug, index) => slug === right.memberOrder[index]);
}

function recommendationsFromManifestOf(packaged: PackagedOfficialTeamState): Record<string, ExecutionProfile> {
  return Object.fromEntries(Object.entries(packaged.manifest.members).map(([slug, member]) => [
    slug,
    member.recommendedProfile,
  ]));
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
