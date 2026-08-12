import type {
  AgentTeamDetailState,
  AgentTeamMemberEditorState,
  OperatorAgentTeam,
  OperatorAgentTeamsState,
  TeamBuilderViewState,
  TranslationKey,
} from "@moebius/console-ui";

import type { LastUsedAgentTeam } from "../team-conversation-preference-contract.js";
import type { AgentTeamFileManagerKind } from "../team-file-manager-contract.js";
import type { AgentTeamListItem, AgentTeamMemberDocument } from "../team-ipc-contract.js";
import type { AgentTeamListResponse } from "../team-ipc-contract.js";
import type { AiTeamBuilderIpcResponse } from "../ai-team-builder/contract.js";
import type { AiTeamBuilderState } from "../ai-team-builder/dto.js";
import type { AgentTeamExternalChangeResponse } from "../team-external-change-contract.js";
import { parseAgentMarkdownFrontmatter, serializeAgentMarkdownFrontmatter } from "../../../src/agent-frontmatter.js";
import { tryParseAgentMarkdownIdentity } from "../team-model.js";
import type { DesktopLocale } from "../language-preference-contract.js";
import { translateDesktop } from "../i18n/index.js";
import { getAgentTeamKey } from "./team-state.js";
import type { AgentTeamRevisionsByTeam } from "./use-agent-team-revisions.js";
import {
  getAgentTeamMemberDraft,
  isAgentTeamMemberDirty,
  type AgentTeamDraftState,
  type AgentTeamMemberDraft,
  type AgentTeamSaveAllFailure,
  type AgentTeamSelection,
} from "./team-state.js";

export const AGENT_TEAM_BUILDER_DRAFT_STORAGE_KEY = "moebius.agent-teams.ai-builder-draft";

export function planAgentTeamFileManagerTranslationKey(
  kind: AgentTeamFileManagerKind | undefined,
): TranslationKey {
  if (kind === "finder") return "desktop.fileManager.finder";
  if (kind === "windows-explorer") return "desktop.fileManager.windowsExplorer";
  return "desktop.fileManager.generic";
}

export function decideSafeAiTeamBuilderDraftId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value);
}

export function planOperatorAgentTeam(team: AgentTeamListItem): OperatorAgentTeam {
  return {
    teamKey: getAgentTeamKey(team),
    id: team.id,
    ownership: team.ownership,
    createdAt: team.createdAt,
    officialSourceName: team.officialSourceName,
    name: team.definition?.name ?? null,
    description: team.definition?.description ?? null,
    primaryAgentSlug: team.definition?.primaryAgentSlug ?? null,
    memberOrder: team.definition?.memberOrder ?? [],
    members: team.members.map((member) => ({
      ...member,
      available: member.available !== false,
      executionProfile: member.executionProfile,
    })),
    status: team.status,
    canCreateConversation: team.canCreateConversation,
    canEditContent: team.capabilities?.canEditContent ?? true,
    canDeleteTeam: team.capabilities?.canDeleteTeam ?? team.ownership === "user",
    issues: team.issues,
    officialManagement: team.officialManagement,
    hasUnseenOfficialSync: team.hasUnseenOfficialSync,
    officialSyncBanner: team.officialSyncBanner,
    recentOfficialSync: team.recentOfficialSync,
    pendingOfficialSync: team.pendingOfficialSync,
  };
}

export function planAgentTeamIdentityKey(team: LastUsedAgentTeam): string {
  return `${team.ownership}:${team.teamId}`;
}

export function planFindOperatorAgentTeam(
  state: OperatorAgentTeamsState,
  teamKey: string,
): OperatorAgentTeam | undefined {
  return state.status === "ready"
    ? state.teams.find((team) => team.teamKey === teamKey)
    : undefined;
}

export function planGeneralAssistantTeamKey(state: OperatorAgentTeamsState): string | null {
  return state.status === "ready"
    ? state.teams.find((team) => team.ownership === "system" && team.id === "general-assistant")
      ?.teamKey ?? null
    : null;
}

export function planAgentTeamBuilderDraftSource(
  current: string | null,
  stored: string | null,
): "current" | "stored" | "create" {
  if (current !== null) return "current";
  return stored !== null && decideSafeAiTeamBuilderDraftId(stored) ? "stored" : "create";
}

export function planAgentTeamBuilderResponse(response: AiTeamBuilderIpcResponse):
  | { kind: "accepted"; state: AiTeamBuilderState }
  | { kind: "rejected"; error: Extract<AiTeamBuilderIpcResponse, { ok: false }>["error"] } {
  return response.ok
    ? { kind: "accepted", state: response.state }
    : { kind: "rejected", error: response.error };
}

export function planSelectedBuilderTeamId(state: AiTeamBuilderState | null): string | null {
  return state?.phase === "selected" ? state.selectedTeamId : null;
}

export function planBuilderOperation(hasPort: boolean): "run" | "unavailable" {
  return hasPort ? "run" : "unavailable";
}

export function planBuilderRetry(started: boolean): "start" | "retry" {
  return started ? "retry" : "start";
}

export function planBuiltAgentTeam(
  teams: readonly AgentTeamListItem[] | null,
  teamId: string,
): AgentTeamListItem | null {
  return teams?.find((team) => team.ownership === "user" && team.id === teamId) ?? null;
}

export function planBuilderPendingState(
  current: TeamBuilderViewState | null,
  phase: "running" | "committing",
): TeamBuilderViewState | null {
  return current === null ? null : { ...current, phase, error: null };
}

export function planBuilderRetryPhase(current: TeamBuilderViewState | null): "running" | "committing" {
  return current?.proposal === null ? "running" : "committing";
}

export function planBuilderFailureState(
  current: TeamBuilderViewState | null,
  error: NonNullable<TeamBuilderViewState["error"]>,
): TeamBuilderViewState {
  return {
    phase: "failed",
    messages: current?.messages ?? [],
    proposal: current?.proposal ?? null,
    proposalRevision: current?.proposalRevision ?? null,
    error,
  };
}

export function planAgentTeamCatalogPort(hasPort: boolean): "load" | "unavailable" {
  return hasPort ? "load" : "unavailable";
}

export function planActiveAgentTeamCatalogCommit(cancelled: boolean): boolean {
  return !cancelled;
}

export type AgentTeamCatalogLoadPlan =
  | { kind: "retry" }
  | { kind: "configuration-error" }
  | {
      kind: "ready";
      state: OperatorAgentTeamsState;
      lastUsedTeamKey: string | null;
      teams: AgentTeamListItem[];
    };

export function planAgentTeamCatalogLoad(
  response: AgentTeamListResponse,
  lastUsedTeam: LastUsedAgentTeam | null,
): AgentTeamCatalogLoadPlan {
  if (response.status === "loading") return { kind: "retry" };
  if (response.status === "configuration-error") return { kind: "configuration-error" };
  return {
    kind: "ready",
    state: {
      status: "ready",
      teams: response.teams.map(planOperatorAgentTeam),
      registrationIssues: response.registrationIssues,
    },
    lastUsedTeamKey: lastUsedTeam === null ? null : planAgentTeamIdentityKey(lastUsedTeam),
    teams: response.teams,
  };
}

export function planAgentTeamDetailState(input: {
  activeTeamKey: string | null;
  catalog: OperatorAgentTeamsState;
  selection: AgentTeamSelection | null;
  drafts: AgentTeamDraftState;
  saveAllFailures: AgentTeamSaveAllFailure[];
  revisions: AgentTeamRevisionsByTeam;
  locale: DesktopLocale;
  now: string;
  primaryAgentChange: {
    teamKey: string;
    status: "saving" | "saved" | "failed";
    error: string | null;
  } | null;
  portraitChange: {
    teamKey: string;
    status: "saving" | "saved" | "failed";
    error: string | null;
  } | null;
}): AgentTeamDetailState | null {
  if (input.activeTeamKey === null) return null;
  const team = planFindOperatorAgentTeam(input.catalog, input.activeTeamKey);
  if (team === undefined) return null;
  const selectedMemberSlug = input.selection?.teamKey === input.activeTeamKey
    ? input.selection.memberSlug
    : null;
  const memberEditors: Record<string, AgentTeamMemberEditorState | undefined> = {};
  for (const member of team.members) {
    const editor = getAgentTeamMemberDraft(input.drafts, input.activeTeamKey, member.slug);
    if (editor === undefined) continue;
    const identity = editor.loadStatus === "ready"
      ? tryParseAgentMarkdownIdentity(editor.draftMarkdown, {
          displayName: member.displayName,
          description: member.description,
        })
      : { displayName: member.displayName, description: member.description };
    const revisionView = input.revisions[input.activeTeamKey]?.[member.slug] ?? null;
    memberEditors[member.slug] = {
      memberSlug: member.slug,
      loadStatus: editor.loadStatus,
      loadError: editor.loadError,
      draftMarkdown: editor.draftMarkdown,
      isDirty: isAgentTeamMemberDirty(editor),
      saveStatus: editor.saveStatus,
      saveError: editor.saveError,
      externalChangeStatus: editor.externalChangeStatus,
      displayName: identity.displayName,
      description: identity.description,
      ...(revisionView === null
        ? {}
        : {
            recentChange: revisionView.recentChange === null
              ? null
              : {
                  summary: revisionView.recentChange.summary,
                  summaryStatus: revisionView.recentChange.summaryStatus,
                  authorLabel: revisionView.recentChange.authorLabel,
                  timeLabel: planAgentRevisionTimeLabel(
                    revisionView.recentChange.timeLabel,
                    input.now,
                    input.locale,
                  ),
                },
            changeMarkers: revisionView.changeMarkers,
            revisionTimeline: revisionView.timeline.map((entry) => ({
              id: entry.revisionId,
              authorLabel: entry.authorKind === "user"
                ? translateDesktop(input.locale, "agentTeam.author.you")
                : entry.authorLabel ?? "",
              timeLabel: planAgentRevisionTimeLabel(entry.timeLabel, input.now, input.locale),
              summary: entry.summary,
              summaryStatus: entry.summaryStatus,
              ...(entry.isLatest ? { isLatest: true } : {}),
            })),
          }),
    };
  }
  return {
    teamKey: input.activeTeamKey,
    selectedMemberSlug,
    memberEditors,
    saveAllFailures: input.saveAllFailures,
    primaryAgentChangeStatus: input.primaryAgentChange?.teamKey === input.activeTeamKey
      ? input.primaryAgentChange.status
      : "idle",
    primaryAgentChangeError: input.primaryAgentChange?.teamKey === input.activeTeamKey
      ? input.primaryAgentChange.error
      : null,
    portraitChangeStatus: input.portraitChange?.teamKey === input.activeTeamKey
      ? input.portraitChange.status
      : "idle",
    portraitChangeError: input.portraitChange?.teamKey === input.activeTeamKey
      ? input.portraitChange.error
      : null,
  };
}

/**
 * Relative time label for revision provenance lines. Deliberately coarse:
 * a plain relative phrase beats an ISO timestamp for the target user; absolute
 * dates appear once the entry is older than a month.
 */
export function planAgentRevisionTimeLabel(
  iso: string,
  now: string,
  locale: DesktopLocale,
): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return iso;
  const elapsedMs = Math.max(0, Date.parse(now) - timestamp);
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (elapsedMs < minuteMs) {
    return translateDesktop(locale, "agentTeam.revisionTime.justNow");
  }
  if (elapsedMs < hourMs) {
    return translateDesktop(locale, "agentTeam.revisionTime.minutesAgo", {
      minutes: String(Math.floor(elapsedMs / minuteMs)),
    });
  }
  if (elapsedMs < dayMs) {
    return translateDesktop(locale, "agentTeam.revisionTime.hoursAgo", {
      hours: String(Math.floor(elapsedMs / hourMs)),
    });
  }
  if (elapsedMs < 30 * dayMs) {
    return translateDesktop(locale, "agentTeam.revisionTime.daysAgo", {
      days: String(Math.floor(elapsedMs / dayMs)),
    });
  }
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function planAgentTeamMemberSummary(
  state: OperatorAgentTeamsState,
  teamKey: string,
  document: AgentTeamMemberDocument,
): OperatorAgentTeamsState {
  if (state.status !== "ready") return state;
  return {
    status: "ready",
    teams: state.teams.map((team) => team.teamKey !== teamKey
      ? team
      : {
          ...team,
          members: team.members.map((member) => member.slug === document.slug
            ? {
                ...member,
                slug: document.slug,
                displayName: document.displayName,
                description: document.description,
                portraitId: document.portraitId ?? null,
              }
            : member),
        }),
  };
}

export function planAgentTeamMemberLoad(current: AgentTeamMemberDraft | undefined): "load" | "skip" {
  return current?.loadStatus === "ready" || current?.loadStatus === "loading" ? "skip" : "load";
}

export function planAgentTeamExternalCheck(inFlight: boolean): "check" | "skip" {
  return inFlight ? "skip" : "check";
}

export function planAgentTeamExternalResult(response: AgentTeamExternalChangeResponse):
  | { action: "clear" }
  | { action: "ignore" }
  | { action: "apply"; document: AgentTeamMemberDocument } {
  if (response.status === "unchanged") return { action: "clear" };
  if (response.status === "changed") return { action: "apply", document: response.document };
  return { action: "ignore" };
}

export function planAgentTeamExternalReloaded(current: AgentTeamMemberDraft | undefined): boolean {
  return current?.externalChangeStatus === "reloaded";
}

export function planAgentTeamExternalMarkdown(current: AgentTeamMemberDraft | undefined): string | null {
  return current?.externalChangeStatus === "conflict" ? current.externalMarkdown : null;
}

export function planAgentTeamSaveRequest(current: AgentTeamMemberDraft | undefined): "save" | "skip" {
  return isAgentTeamMemberDirty(current) && current?.saveStatus !== "saving" ? "save" : "skip";
}

export function planAgentTeamRequestedMarkdown(current: AgentTeamMemberDraft | undefined): string | null {
  return current?.saveStatus === "saving" ? current.saveRequestedMarkdown : null;
}

export function planAgentTeamMemberSelection(
  team: OperatorAgentTeam,
  current: AgentTeamSelection | null,
): string | null {
  if (current?.teamKey === team.teamKey && current.memberSlug !== null
    && team.members.some((member) => member.slug === current.memberSlug)) {
    return current.memberSlug;
  }
  if (team.primaryAgentSlug !== null
    && team.members.some((member) => member.slug === team.primaryAgentSlug)) {
    return team.primaryAgentSlug;
  }
  return team.members[0]?.slug ?? null;
}

export function planAgentTeamMemberTarget(team: OperatorAgentTeam | undefined, memberSlug: string): boolean {
  return team?.members.some((member) => member.slug === memberSlug) === true;
}

export function planAgentTeamMemberLoadTarget(memberSlug: string | null): boolean {
  return memberSlug !== null;
}

export function planAgentTeamPrimaryChange(team: OperatorAgentTeam | undefined, memberSlug: string): "save" | "skip" {
  return team !== undefined
    && team.primaryAgentSlug !== memberSlug
    && team.members.some((member) => member.slug === memberSlug)
    ? "save"
    : "skip";
}

export function planAgentTeamPrimaryOperation(
  team: OperatorAgentTeam | undefined,
  memberSlug: string,
  hasOperation: boolean,
): "save" | "skip" {
  return hasOperation && planAgentTeamPrimaryChange(team, memberSlug) === "save" ? "save" : "skip";
}

export function planAgentTeamPortraitChange(team: OperatorAgentTeam | undefined, memberSlug: string): "save" | "skip" {
  return team !== undefined && team.members.some((member) => member.slug === memberSlug)
    ? "save"
    : "skip";
}

export function planAgentTeamPortraitOperation(
  team: OperatorAgentTeam | undefined,
  memberSlug: string,
  hasOperation: boolean,
): "save" | "skip" {
  return hasOperation && planAgentTeamPortraitChange(team, memberSlug) === "save" ? "save" : "skip";
}

export function planAgentTeamReorderChange(
  team: OperatorAgentTeam | undefined,
  memberSlugs: string[],
): "save" | "skip" {
  if (team === undefined || memberSlugs.length !== team.memberOrder.length) {
    return "skip";
  }
  const current = new Set(team.memberOrder);
  const next = new Set(memberSlugs);
  const sameMembers = next.size === current.size
    && [...next].every((slug) => current.has(slug));
  if (!sameMembers || memberSlugs.every((slug, index) => slug === team.memberOrder[index])) {
    return "skip";
  }
  return "save";
}

export function planAgentTeamReorderOperation(
  team: OperatorAgentTeam | undefined,
  memberSlugs: string[],
  hasOperation: boolean,
): "save" | "skip" {
  return hasOperation && planAgentTeamReorderChange(team, memberSlugs) === "save" ? "save" : "skip";
}

/**
 * Rewrites the identity fields of a member draft's AGENT.md frontmatter. The editor reports
 * identity as plain fields (`displayName` / `description`), and the page owns serialising them
 * back into the frontmatter; a draft without a frontmatter yet (legacy heading-format file) is
 * seeded with the current parsed identity so a partial edit never splits the identity across
 * two sources. The result stays inside the member's ordinary draft and is persisted by the
 * normal save path.
 */
export function planAgentTeamIdentityMarkdown(
  draftMarkdown: string,
  identity: { displayName?: string; description?: string },
): string {
  let parsed: ReturnType<typeof parseAgentMarkdownFrontmatter>;
  try {
    parsed = parseAgentMarkdownFrontmatter(draftMarkdown);
  } catch {
    return draftMarkdown;
  }
  let frontmatter = { ...(parsed.frontmatter ?? {}) };
  if (parsed.frontmatter === null) {
    const current = tryParseAgentMarkdownIdentity(draftMarkdown);
    frontmatter = { display_name: current.displayName, description: current.description };
  }
  if (identity.displayName !== undefined) {
    frontmatter.display_name = identity.displayName;
  }
  if (identity.description !== undefined) {
    frontmatter.description = identity.description;
  }
  return serializeAgentMarkdownFrontmatter(frontmatter, parsed.body);
}

export function planAgentTeamProfileOperation(
  team: OperatorAgentTeam | undefined,
  hasOperation: boolean,
): "run" | "unavailable" {
  return team !== undefined && hasOperation ? "run" : "unavailable";
}

export function planAgentTeamOfficialSync(
  team: OperatorAgentTeam | undefined,
  hasOperation: boolean,
): "run" | "unavailable" {
  return team?.ownership === "system" && hasOperation ? "run" : "unavailable";
}

export function planAgentTeamCatalogReplace(
  state: OperatorAgentTeamsState,
  updated: OperatorAgentTeam,
): OperatorAgentTeamsState {
  if (state.status !== "ready") return state;
  return {
    status: "ready",
    teams: state.teams.map((candidate) => candidate.teamKey === updated.teamKey ? updated : candidate),
  };
}

export function planAgentTeamCatalogAddIfMissing(
  state: OperatorAgentTeamsState,
  added: OperatorAgentTeam,
): OperatorAgentTeamsState {
  if (state.status !== "ready" || state.teams.some((candidate) => candidate.teamKey === added.teamKey)) {
    return state;
  }
  return { status: "ready", teams: [...state.teams, added] };
}

export function planOptionalOperatorAgentTeam(
  item: AgentTeamListItem | null,
): OperatorAgentTeam | null {
  return item === null ? null : planOperatorAgentTeam(item);
}

export function planAgentTeamMutation(
  team: OperatorAgentTeam | undefined,
  ownership: "any" | "system" | "user",
  hasOperation: boolean,
): "run" | "unavailable" {
  if (team === undefined || !hasOperation) return "unavailable";
  return ownership === "any" || team.ownership === ownership ? "run" : "unavailable";
}

export function planAgentTeamDirtyGuard(dirtyCount: number): "continue" | "reject" {
  return dirtyCount === 0 ? "continue" : "reject";
}

export function planAgentTeamCatalogAppend(
  state: OperatorAgentTeamsState,
  added: OperatorAgentTeam,
): OperatorAgentTeamsState {
  return state.status === "ready"
    ? { status: "ready", teams: [...state.teams, added] }
    : state;
}

export function planAgentTeamMemberRemoval(
  team: OperatorAgentTeam | undefined,
  memberSlug: string,
  hasOperation: boolean,
): "remove" | "primary" | "unavailable" {
  if (team === undefined || !hasOperation) return "unavailable";
  return team.primaryAgentSlug === memberSlug ? "primary" : "remove";
}

export function planAgentTeamCatalogRemove(
  state: OperatorAgentTeamsState,
  teamKey: string,
): OperatorAgentTeamsState {
  return state.status === "ready"
    ? { status: "ready", teams: state.teams.filter((candidate) => candidate.teamKey !== teamKey) }
    : { status: "ready", teams: [] };
}

export function planAgentTeamCatalogTeams(state: OperatorAgentTeamsState): OperatorAgentTeam[] {
  return state.status === "ready" ? state.teams : [];
}

export function planAgentTeamFallbackSelection(
  teams: readonly OperatorAgentTeam[],
): AgentTeamSelection | null {
  const team = teams[0];
  return team === undefined
    ? null
    : { teamKey: team.teamKey, memberSlug: planAgentTeamMemberSelection(team, null) };
}

export function planAgentTeamSelectionAfterRemoval(
  selection: AgentTeamSelection | null,
  teamKey: string,
): AgentTeamSelection | null {
  return selection?.teamKey === teamKey ? null : selection;
}

export function planAgentTeamShouldClose(activeTeamKey: string | null, teamKey: string): boolean {
  return activeTeamKey === teamKey;
}

export function planAgentTeamRelocationDirectory(directory: string | null): "relocate" | "cancel" {
  return directory === null ? "cancel" : "relocate";
}

export function planAgentTeamRelocation(
  team: OperatorAgentTeam | undefined,
  hasFolderSelection: boolean,
  hasRelocation: boolean,
): "run" | "unavailable" {
  return team?.ownership === "user" && hasFolderSelection && hasRelocation ? "run" : "unavailable";
}
