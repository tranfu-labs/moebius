import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  FolderOpen,
  LoaderCircle,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

import { AgentPortrait, type PortraitId } from "@/console/agent-portrait";
import { AgentMemberStrip } from "@/console/agent-member-strip";
import { AgentPortraitPicker } from "@/console/agent-portrait-picker";
import { type ExecutionEngine } from "@/console/provider-mark";
import {
  AgentMarkdownMentionEditor,
  computeMarkdownBlocks,
  type AgentMarkdownChangeMarker,
} from "@/console/agent-markdown-mention-editor";
import { AgentMarkdownRevisionTimeline, type AgentMarkdownRevisionEntry } from "@/console/agent-markdown-revision-timeline";
import {
  findExecutionModel,
  findPiExecutionModel,
  isRegisteredExecutionEffort,
  listExecutionModels,
  PI_EXECUTION_MODELS,
  resolveProfileForCli,
  resolveProfileForModel,
} from "@/console/execution-profile-registry";
import { splitAgentMarkdown, withAgentMarkdownBody } from "@/console/agent-markdown-body";
import { MarkdownMessage } from "@/console/markdown-message";
import { cn } from "@/lib/utils";
import { useI18n, type Translate } from "@/i18n";
import { Button } from "@/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/ui/select";

/**
 * The trigger renders its own label rather than leaning on Radix's `SelectValue`. That component
 * learns the text from mounted items, and this package owns overlay presence, so the list is not
 * mounted while closed — leaving every trigger blank.
 */
const EXECUTION_ENGINE_LABELS: Record<AgentExecutionProfile["cli"], string> = {
  codex: "Codex",
  claude: "Claude Code",
  kimi: "Kimi",
  pi: "Pi API",
};

export interface AgentTeamDetailMember {
  slug: string;
  displayName: string;
  description: string;
  available?: boolean;
  /** Chosen face; null or absent leaves the member on the slug default. */
  portraitId?: string | null;
  executionProfile?: AgentExecutionProfileDocument;
}

/** Shapes an execution profile for the portrait badge. Exported: other views need it too. */
export function profileEngine(
  profile: AgentExecutionProfile | undefined,
): { cli: ExecutionEngine; providerId?: string } | undefined {
  if (profile === undefined) {
    return undefined;
  }
  return { cli: profile.cli, providerId: "providerId" in profile ? profile.providerId : undefined };
}

export type AgentExecutionProfile = {
  cli: "codex" | "claude" | "kimi";
  model: string;
  effort: string;
} | {
  cli: "pi";
  providerId: "deepseek";
  providerProfileId: string;
  model: string;
  effort: string;
};

export interface AgentExecutionProviderProfile {
  id: string;
  providerId: "deepseek";
  providerName: string;
  displayName: string;
  defaultModel: "deepseek-v4-flash" | "deepseek-v4-pro" | null;
  verifiedModels: Array<"deepseek-v4-flash" | "deepseek-v4-pro">;
  readiness: "ready" | "needs-attention" | "disabled";
  reason: string | null;
}

export interface AgentExecutionProfileDocument {
  binding: {
    source: "recommended" | "override" | "explicit";
    profile?: AgentExecutionProfile;
  };
  recommendation: AgentExecutionProfile | null;
  effectiveProfile: AgentExecutionProfile;
}

interface AgentExecutionProfileEditorState {
  document: AgentExecutionProfileDocument | null;
  draft: AgentExecutionProfile | null;
  status: "idle" | "saving" | "failed";
  error: string | null;
}

export interface AgentOfficialManagementState {
  customizationStatus: "clean" | "customized" | "unknown";
}

export type AgentTeamRepairIssueCode =
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

export interface AgentTeamRepairIssueView {
  code: AgentTeamRepairIssueCode;
  slug?: string;
}

export interface AgentTeamDetailTeam {
  teamKey: string;
  ownership: "system" | "user";
  name: string | null;
  description: string | null;
  primaryAgentSlug: string | null;
  memberOrder: string[];
  members: AgentTeamDetailMember[];
  status?: "usable" | "unfinished-draft" | "needs-repair";
  canCreateConversation?: boolean;
  issues?: AgentTeamRepairIssueView[];
  officialManagement?: AgentOfficialManagementState;
}

export interface AgentTeamMemberEditorState {
  memberSlug: string;
  loadStatus: "idle" | "loading" | "ready" | "failed";
  loadError: string | null;
  draftMarkdown: string;
  isDirty: boolean;
  saveStatus: "idle" | "saving" | "failed";
  saveError: string | null;
  externalChangeStatus: "none" | "reloaded" | "conflict";
  displayName: string;
  description: string;
  /**
   * One-line "recent change" summary shown above the member's body; absent only when the member
   * has no revision yet. `summary` is null while the background summary job is pending or failed;
   * the view renders a neutral placeholder from `summaryStatus` (never disappears).
   */
  recentChange?: {
    summary: string | null;
    summaryStatus: "pending" | "ready" | "unavailable";
    authorLabel: string;
    timeLabel: string;
  } | null;
  /** Presentational paragraph markers keyed by block index in the FULL AGENT.md content. */
  changeMarkers?: readonly AgentMarkdownChangeMarker[];
  revisionTimeline?: readonly AgentMarkdownRevisionEntry[];
}

export interface AgentTeamSaveAllFailureView {
  memberSlug: string;
  reason: string;
}

export interface AgentTeamDetailState {
  teamKey: string;
  selectedMemberSlug: string | null;
  memberEditors: Record<string, AgentTeamMemberEditorState | undefined>;
  saveAllFailures: AgentTeamSaveAllFailureView[];
  primaryAgentChangeStatus?: "idle" | "saving" | "saved" | "failed";
  primaryAgentChangeError?: string | null;
  /** Portrait writes are immediate persists (no draft); this mirrors primary-agent status. */
  portraitChangeStatus?: "idle" | "saving" | "saved" | "failed";
  portraitChangeError?: string | null;
}

export interface AgentOfficialSyncMemberChanges {
  added: string[];
  removed: string[];
  renamed: Array<{ from: string; to: string }>;
  adopted: string[];
  recommendationChanged: string[];
  keptOverridden: string[];
  collidedMembers: string[];
  mergedMembers: string[];
  pendingMergeMembers: string[];
}

export interface AgentOfficialSyncBannerView {
  officialVersion: string;
  affectedMemberCount: number;
  memberChanges: AgentOfficialSyncMemberChanges;
}

export type AgentTeamGuardedAction = (action: () => void | Promise<void>) => void;
export type AgentTeamActionSlot =
  | ReactNode
  | ((requestGuardedAction: AgentTeamGuardedAction) => ReactNode);

export interface AgentTeamDetailProps {
  team: AgentTeamDetailTeam;
  state: AgentTeamDetailState;
  readOnly?: boolean;
  teamActions?: AgentTeamActionSlot;
  memberSelectorActions?: ReactNode;
  memberActions?: AgentTeamActionSlot;
  onAddMember?(): void | Promise<void>;
  onChangePrimaryAgent?(memberSlug: string): void | Promise<void>;
  /**
   * New full order after a drag or a keyboard move. The first entry is the primary Agent — the
   * position *is* the appointment, so the host does not receive a separate primary change.
   */
  onReorderMembers?(memberSlugs: string[]): void | Promise<void>;
  onSelectMember(memberSlug: string): void;
  /**
   * Team name and one-line description, edited in place. Absent leaves both read-only.
   * Reported on blur: this is the same shape of data as a member's identity, and the page
   * already commits the primary-Agent change immediately, so a second Save would be noise.
   */
  onChangeTeamInformation?(information: { name: string; description: string }): void | Promise<void>;
  /** Absent means this detail cannot change portraits; the heading then shows a plain portrait. */
  onChangeMemberPortrait?(memberSlug: string, portraitId: PortraitId | null): void | Promise<void>;
  /**
   * Identity edits are reported as fields. The host owns writing them back into the file's
   * frontmatter, so this view never has to parse or serialise YAML.
   */
  onChangeMemberIdentity?(
    memberSlug: string,
    identity: { displayName?: string; description?: string },
  ): void;
  onChangeMember(memberSlug: string, agentMarkdown: string): void;
  onSaveMember(memberSlug: string): void | Promise<void>;
  onCheckExternalChange?(memberSlug: string): void | Promise<void>;
  onLoadExternalVersion?(memberSlug: string): void;
  onOverwriteExternalVersion?(memberSlug: string): void | Promise<void>;
  onRetryLoad(memberSlug: string): void;
  onDiscardMember(memberSlug: string): void;
  onDiscardAll(): void;
  onSaveAll(profileSuccessCount?: number): Promise<{ failures: AgentTeamSaveAllFailureView[]; successCount?: number }>;
  onRecheck?(): void | Promise<void>;
  onRelocate?(): void | Promise<void>;
  onRemoveRecord?(): void | Promise<void>;
  onSaveExecutionProfile?(
    memberSlug: string,
    profile: AgentExecutionProfile,
  ): Promise<AgentExecutionProfileDocument>;
  onRestoreRecommendedProfile?(memberSlug: string): Promise<AgentExecutionProfileDocument>;
  providerProfiles?: readonly AgentExecutionProviderProfile[];
  onOpenProviderSettings?(): void;
  onRestoreRevision?(memberSlug: string, revisionId: string): void | Promise<void>;
  /** Present only after an official sync; the banner is component-owned and needs no container. */
  officialSyncBanner?: AgentOfficialSyncBannerView | null;
  /** Official changes still waiting for the default Agent or the one-time merge. */
  pendingOfficialSync?: {
    officialVersion: string;
    reason: "CONSERVATIVE_BASELINE" | "DEFAULT_AGENT_UNAVAILABLE";
    pendingMemberSlugs: string[];
  } | null;
  onRetryOfficialSync?(): void | Promise<void>;
  onViewSyncChanges?(): void;
  /**
   * Incrementing request from a container-owned surface (e.g. the "recent official sync" panel)
   * asking the component to run the same select-first-changed-member / expand-timeline /
   * scroll-to-marker behavior as the banner's "see what changed" button.
   */
  viewSyncChangesSignal?: number | null;
  onRevertSync?(): void | Promise<void>;
  onDismissSyncBanner?(): void;
  onLeave(): void;
}

/**
 * Reports whether the page header has reached the top of whatever is scrolling it.
 *
 * Read from geometry, not from a scroll threshold: how far the header travels before it pins
 * depends on what the host page puts above it, which this view has no way to know. The sentinel
 * stays at the header's static position, so the moment the two separate is exactly the moment the
 * header is pinned.
 *
 * Listening on `document` in the capture phase catches scroll from any ancestor — element scroll
 * events do not bubble, and the scrolling ancestor belongs to the page, not to this component.
 */
function useHeaderPinned(): {
  pinned: boolean;
  sentinelRef: RefObject<HTMLDivElement>;
  headerRef: RefObject<HTMLElement>;
} {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const check = (): void => {
      const sentinel = sentinelRef.current;
      const header = headerRef.current;
      if (sentinel === null || header === null) {
        return;
      }
      setPinned(header.getBoundingClientRect().top - sentinel.getBoundingClientRect().top > 0.5);
    };
    check();
    document.addEventListener("scroll", check, { capture: true, passive: true });
    window.addEventListener("resize", check);
    return () => {
      document.removeEventListener("scroll", check, { capture: true });
      window.removeEventListener("resize", check);
    };
  }, []);

  return { pinned, sentinelRef, headerRef };
}

export function AgentTeamDetail({
  team,
  state,
  readOnly = false,
  teamActions,
  onChangeTeamInformation,
  memberSelectorActions,
  memberActions,
  onAddMember,
  onChangePrimaryAgent,
  onReorderMembers,
  onSelectMember,
  onChangeMemberPortrait,
  onChangeMemberIdentity,
  onChangeMember,
  onSaveMember,
  onCheckExternalChange,
  onLoadExternalVersion,
  onOverwriteExternalVersion,
  onRetryLoad,
  onDiscardMember,
  onDiscardAll,
  onSaveAll,
  onRecheck,
  onRelocate,
  onRemoveRecord,
  onSaveExecutionProfile,
  onRestoreRecommendedProfile,
  providerProfiles = [],
  onOpenProviderSettings,
  onRestoreRevision,
  officialSyncBanner,
  pendingOfficialSync,
  onRetryOfficialSync,
  onViewSyncChanges,
  viewSyncChangesSignal,
  onRevertSync,
  onDismissSyncBanner,
  onLeave,
}: AgentTeamDetailProps): JSX.Element {
  const { t } = useI18n();
  const { pinned: headerPinned, sentinelRef: headerSentinelRef, headerRef } = useHeaderPinned();
  const pendingGuardedActionRef = useRef<(() => void | Promise<void>) | null>(null);
  const [leavePromptOpen, setLeavePromptOpen] = useState(false);
  const [externalConflictPromptOpen, setExternalConflictPromptOpen] = useState(false);
  const [revertSyncPromptOpen, setRevertSyncPromptOpen] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [addMemberStatus, setAddMemberStatus] = useState<"idle" | "adding" | "failed">("idle");
  const [addMemberError, setAddMemberError] = useState<string | null>(null);
  const [repairAction, setRepairAction] = useState<"idle" | "rechecking" | "relocating" | "removing">("idle");
  const [repairError, setRepairError] = useState<string | null>(null);
  const [removeRecordPromptOpen, setRemoveRecordPromptOpen] = useState(false);
  const [profileEditors, setProfileEditors] = useState<Record<string, AgentExecutionProfileEditorState>>(
    () => createProfileEditors(team),
  );
  const profileEditorsTeamKeyRef = useRef(team.teamKey);
  /** Reading is the default; switching members returns to it rather than carrying edit mode over. */
  const [editingMarkdown, setEditingMarkdown] = useState(false);
  /**
   * Member order and portraits are drafts like everything else on this page (product decision:
   * the whole page goes through the one Save). Dragging a member or picking a face only edits
   * these local drafts; the host persists them through the ordinary save paths — the commit
   * callbacks (`onReorderMembers` / `onChangeMemberPortrait`) fire at save time, not on the
   * gesture. Until then the rest of the application keeps showing the saved state.
   */
  const [draftMemberOrder, setDraftMemberOrder] = useState<string[] | null>(null);
  const [draftPortraits, setDraftPortraits] = useState<Record<string, PortraitId | null>>({});
  /** Latest single-save action; the Cmd/Ctrl+S listener reads it so the effect stays stable. */
  const savePendingChangesRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    // A different team has different members and a different saved order; drafts do not carry.
    setDraftMemberOrder(null);
    setDraftPortraits({});
  }, [team.teamKey]);
  /**
   * A successful save is the expected outcome, so it earns the smallest possible acknowledgement:
   * the unsaved count disappears, Save greys out, and this sits beside them briefly. A banner for
   * every routine success pushes the page down and, worse, tends to fill itself with system rules.
   */
  const [justSaved, setJustSaved] = useState(false);
  const teamInformationEditable = !readOnly && onChangeTeamInformation !== undefined;
  const [teamNameDraft, setTeamNameDraft] = useState(team.name ?? "");
  const [teamDescriptionDraft, setTeamDescriptionDraft] = useState(team.description ?? "");
  const teamInformationRef = useRef({ name: team.name ?? "", description: team.description ?? "" });
  if (
    teamInformationRef.current.name !== (team.name ?? "")
    || teamInformationRef.current.description !== (team.description ?? "")
  ) {
    // The host is the source of truth; adopt its value when it changes underneath us.
    teamInformationRef.current = { name: team.name ?? "", description: team.description ?? "" };
    setTeamNameDraft(team.name ?? "");
    setTeamDescriptionDraft(team.description ?? "");
  }
  /**
   * Team information is a draft like everything else on this page. One page, one save model:
   * typing has an in-between state, so it belongs in a draft — unlike dragging a member into
   * first place, which either happened or did not and so commits immediately.
   */
  const teamInformationDirty = teamInformationEditable
    && (teamNameDraft.trim() !== (team.name ?? "").trim()
      || teamDescriptionDraft.trim() !== (team.description ?? "").trim());
  const discardTeamInformation = (): void => {
    setTeamNameDraft(team.name ?? "");
    setTeamDescriptionDraft(team.description ?? "");
  };
  const [pendingSyncAction, setPendingSyncAction] = useState<"idle" | "running" | "failed">("idle");
  const [pendingSyncError, setPendingSyncError] = useState<string | null>(null);
  /** The expanded member revision timeline lives on the detail; it is not a container concern. */
  const [expandedTimelineMemberSlug, setExpandedTimelineMemberSlug] = useState<string | null>(null);
  const pendingSyncChangesTargetRef = useRef<string | null>(null);
  const lastViewSyncChangesSignalRef = useRef<number | null>(null);
  const savedOrderedMembers = useMemo(() => orderAgentTeamMembers(team), [team]);
  const orderedMembers = draftMemberOrder === null
    ? savedOrderedMembers
    : draftMemberOrder
        .map((slug) => savedOrderedMembers.find((member) => member.slug === slug))
        .filter((member): member is AgentTeamDetailMember => member !== undefined);
  const displayedPrimarySlug = draftMemberOrder !== null
    ? (draftMemberOrder[0] ?? null)
    : team.primaryAgentSlug;
  const selectedMember = orderedMembers.find((member) => member.slug === state.selectedMemberSlug) ?? null;
  const selectedEditor = selectedMember === null ? undefined : state.memberEditors[selectedMember.slug];
  const profileEditor = selectedMember === null
    ? undefined
    : profileEditors[selectedMember.slug];
  const profileDocument = profileEditor?.document ?? null;
  const profileDraft = profileEditor?.draft ?? null;
  /**
   * The engine mark follows the unsaved draft, not the saved binding: the user changing the
   * engine dropdown is exactly when they look at the portrait to check it took effect, and a
   * mark that still shows the old engine reads as "the change did not register".
   */
  const memberEngineMark = (member: AgentTeamDetailMember): ReturnType<typeof profileEngine> =>
    profileEngine(profileEditors[member.slug]?.draft ?? member.executionProfile?.effectiveProfile);
  const profileStatus = profileEditor?.status ?? "idle";
  const profileError = profileEditor?.error ?? null;
  const primaryAgentChangeStatus = state.primaryAgentChangeStatus ?? "idle";
  const primaryAgentChangeError = state.primaryAgentChangeError ?? null;
  const portraitChangeStatus = state.portraitChangeStatus ?? "idle";
  const portraitChangeError = state.portraitChangeError ?? null;
  const mentionMembers = useMemo(() => orderedMembers.filter((member) => member.available !== false).map((member) => ({
    slug: member.slug,
    displayName: state.memberEditors[member.slug]?.displayName || member.displayName,
  })), [orderedMembers, state.memberEditors]);
  const hasDirtyMembers = Object.values(state.memberEditors).some((editor) => editor?.isDirty === true);
  /**
   * The order draft is dirty when it differs from the saved displayed order (primary first).
   * Portrait drafts are pruned to entries that differ from the saved face, so their keys are
   * exactly the dirty members.
   */
  const hasDirtyOrder = draftMemberOrder !== null
    && !sameSlugOrder(draftMemberOrder, savedOrderedMembers.map((member) => member.slug));
  const dirtyPortraitSlugs = Object.keys(draftPortraits).filter((slug) =>
    (draftPortraits[slug] ?? null)
      !== (team.members.find((member) => member.slug === slug)?.portraitId ?? null));
  const hasDirtyPortraits = dirtyPortraitSlugs.length > 0;
  const profileDirty = profileDocument !== null
    && profileDraft !== null
    && (
      profileDraft.cli !== profileDocument.effectiveProfile.cli
      || providerProfileIdentity(profileDraft) !== providerProfileIdentity(profileDocument.effectiveProfile)
      || profileDraft.model !== profileDocument.effectiveProfile.model
      || profileDraft.effort !== profileDocument.effectiveProfile.effort
    );
  const hasDirtyProfiles = Object.values(profileEditors).some(isProfileEditorDirty);
  const hasExternalConflicts = Object.values(state.memberEditors)
    .some((editor) => editor?.externalChangeStatus === "conflict");
  const externalConflictMemberSlugs = Object.values(state.memberEditors)
    .filter((editor) => editor?.externalChangeStatus === "conflict")
    .map((editor) => editor!.memberSlug);
  const hasSavingMembers = Object.values(state.memberEditors).some((editor) => editor?.saveStatus === "saving");
  /**
   * The two drafts stay separate underneath — that is the isolation rule for a partial failure —
   * but the user gets one Save. Splitting the button was leaking an implementation boundary into
   * the interface and left two save controls 421px apart on the page.
   */
  const unsavedItemCount = (selectedEditor?.isDirty === true ? 1 : 0)
    + (profileDirty ? 1 : 0)
    + (teamInformationDirty ? 1 : 0)
    + (hasDirtyOrder ? 1 : 0)
    + dirtyPortraitSlugs.length;
  // A fresh edit retires the acknowledgement; it should never linger over unsaved work.
  useEffect(() => {
    if (unsavedItemCount > 0) {
      setJustSaved(false);
    }
  }, [unsavedItemCount]);

  const canAddMember = !readOnly
    && team.status !== "needs-repair"
    && onAddMember !== undefined;
  const profileModelError = profileDraft !== null && profileDraft.model.trim().length === 0
    ? t("console.agentTeamDetail.enterModel")
    : null;
  const profileEffortError = profileDraft !== null && profileDraft.effort.trim().length === 0
    ? t("console.agentTeamDetail.enterEffort")
    : null;
  const selectedProviderProfile = profileDraft?.cli === "pi"
    ? providerProfiles.find((profile) => profile.id === profileDraft.providerProfileId) ?? null
    : null;
  const selectableProviderProfiles = providerProfiles.filter((profile) => profile.readiness === "ready");
  const profileProviderError = profileDraft?.cli === "pi" && (
    selectedProviderProfile === null
    || selectedProviderProfile.readiness !== "ready"
  ) ? t("console.agentTeamDetail.selectReadyProviderProfile") : null;
  const profileDraftValid = profileDraft !== null
    && profileModelError === null
    && profileEffortError === null
    && profileProviderError === null
    && (profileDraft.cli !== "pi" || selectedProviderProfile?.verifiedModels.includes(profileDraft.model as "deepseek-v4-flash" | "deepseek-v4-pro") === true);
  const profileModelDefinition = profileDraft === null
    ? null
    : profileDraft.cli === "pi"
      ? findPiExecutionModel(profileDraft.model)
      : findExecutionModel(profileDraft.cli, profileDraft.model);
  const profileModelUnsupported = profileDraft !== null && profileModelDefinition === null;
  const profileEffortUnsupported = profileDraft !== null
    && !(profileDraft.cli === "pi"
      ? findPiExecutionModel(profileDraft.model)?.efforts.includes(profileDraft.effort) === true
      : isRegisteredExecutionEffort(profileDraft.cli, profileDraft.model, profileDraft.effort));

  /**
   * Change markers are keyed by block index in the FULL `AGENT.md` content (the desktop computes
   * them that way), but the body editor renders only the persona body — the frontmatter owns the
   * first block(s). Re-base the marker indices onto the body's own block space; markers that
   * belong to the frontmatter (identity changes are edits too) simply have no block in the body
   * and are dropped. Presentation-only: the underlying revision data is untouched.
   */
  const bodyChangeMarkers = useMemo(() => {
    const markers = selectedEditor?.changeMarkers;
    if (selectedEditor === undefined || markers === undefined || selectedEditor.draftMarkdown.length === 0) {
      return markers;
    }
    const full = selectedEditor.draftMarkdown;
    const { body } = splitAgentMarkdown(full);
    if (body.length === 0) {
      return [];
    }
    const bodyStart = full.lastIndexOf(body);
    const firstBodyBlock = computeMarkdownBlocks(full)
      .findIndex((block) => block.start >= bodyStart);
    const offset = firstBodyBlock <= 0 ? 0 : firstBodyBlock;
    return markers
      .filter((marker) => marker.blockIndex >= offset)
      .map((marker) => ({ ...marker, blockIndex: marker.blockIndex - offset }));
  }, [selectedEditor?.changeMarkers, selectedEditor?.draftMarkdown]);

  useEffect(() => {
    const teamChanged = profileEditorsTeamKeyRef.current !== team.teamKey;
    profileEditorsTeamKeyRef.current = team.teamKey;
    setProfileEditors((current) => {
      const next = teamChanged ? {} : { ...current };
      let changed = teamChanged;
      for (const member of team.members) {
        if (next[member.slug] !== undefined || member.executionProfile === undefined) {
          continue;
        }
        next[member.slug] = profileEditorFromDocument(member.executionProfile);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [team.members, team.teamKey]);

  useEffect(() => {
    if (
      selectedMember === null
      || selectedEditor?.loadStatus !== "ready"
      || onCheckExternalChange === undefined
    ) {
      return;
    }
    const check = () => void onCheckExternalChange(selectedMember.slug);
    check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [onCheckExternalChange, selectedEditor?.loadStatus, selectedMember]);

  const requestGuardedAction: AgentTeamGuardedAction = (action) => {
    if (hasExternalConflicts) {
      setExternalConflictPromptOpen(true);
      return;
    }
    if (hasDirtyMembers || hasDirtyProfiles || hasDirtyOrder || hasDirtyPortraits) {
      pendingGuardedActionRef.current = action;
      setLeavePromptOpen(true);
      return;
    }
    void action();
  };

  const continueGuardedAction = () => {
    const action = pendingGuardedActionRef.current;
    pendingGuardedActionRef.current = null;
    setLeavePromptOpen(false);
    if (action !== null) {
      void action();
    }
  };

  /**
   * Commits the draft member order through the host's reorder persistence. Returns whether the
   * commit succeeded (or had nothing to do); a failure keeps the draft so the same order can be
   * retried and is surfaced through the host's primary-change status line.
   */
  const commitDraftOrder = async (): Promise<boolean> => {
    if (!hasDirtyOrder || onReorderMembers === undefined) {
      return true;
    }
    try {
      await onReorderMembers(draftMemberOrder!);
      setDraftMemberOrder(null);
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Commits one member's draft portrait through the host's portrait persistence. Same per-item
   * failure contract as `commitDraftOrder`: the draft survives a failed commit.
   */
  const commitDraftPortrait = async (memberSlug: string): Promise<boolean> => {
    if (onChangeMemberPortrait === undefined) {
      return true;
    }
    const saved = team.members.find((member) => member.slug === memberSlug)?.portraitId ?? null;
    const picked = draftPortraits[memberSlug] ?? null;
    if (picked === saved) {
      return true;
    }
    try {
      await onChangeMemberPortrait(memberSlug, picked);
      setDraftPortraits((current) => {
        const next = { ...current };
        delete next[memberSlug];
        return next;
      });
      return true;
    } catch {
      return false;
    }
  };

  const saveAllAndContinue = async () => {
    if (savingAll) {
      return;
    }
    setSavingAll(true);
    try {
      let allSaved = await commitDraftOrder();
      for (const memberSlug of dirtyPortraitSlugs) {
        if (!await commitDraftPortrait(memberSlug)) {
          allSaved = false;
        }
      }
      let profileSuccessCount = 0;
      for (const memberSlug of Object.keys(profileEditors)
        .filter((slug) => isProfileEditorDirty(profileEditors[slug]))) {
        const saved = await saveExecutionProfile(memberSlug);
        if (!saved) return;
        profileSuccessCount += 1;
      }
      const result = await onSaveAll(profileSuccessCount);
      if (allSaved && result.failures.length === 0) {
        continueGuardedAction();
      } else {
        pendingGuardedActionRef.current = null;
        setLeavePromptOpen(false);
      }
    } finally {
      setSavingAll(false);
    }
  };

  const runPendingSyncAction = async () => {
    if (pendingSyncAction === "running" || onRetryOfficialSync === undefined) {
      return;
    }
    setPendingSyncAction("running");
    setPendingSyncError(null);
    try {
      await onRetryOfficialSync();
      setPendingSyncAction("idle");
    } catch (error) {
      setPendingSyncAction("failed");
      setPendingSyncError(error instanceof Error ? error.message : String(error));
    }
  };

  const canReorder = !readOnly && onReorderMembers !== undefined && orderedMembers.length > 1;

  const canSavePendingChanges = !readOnly
    && unsavedItemCount > 0
    && selectedEditor?.externalChangeStatus !== "conflict"
    && selectedEditor?.saveStatus !== "saving"
    && profileStatus !== "saving"
    && (!profileDirty || profileDraftValid);

  /**
   * Saves everything the page is holding: team information, the draft member order, the current
   * member's portrait, identity, body and execution profile. Each part still reports its own
   * outcome, so a failing item does not roll back an already-saved file and keeps its draft.
   * The "saved" acknowledgement only fires when every committed item actually landed — a failed
   * order or portrait commit leaves the draft on screen and must not read as success.
   */
  const savePendingChanges = async (): Promise<void> => {
    if (teamInformationDirty) {
      await onChangeTeamInformation?.({
        name: teamNameDraft.trim(),
        description: teamDescriptionDraft.trim(),
      });
    }
    let allCommitted = await commitDraftOrder();
    if (selectedMember === null) {
      return;
    }
    if (!await commitDraftPortrait(selectedMember.slug)) {
      allCommitted = false;
    }
    if (profileDirty && !await saveExecutionProfile(selectedMember.slug)) {
      return;
    }
    if (selectedEditor?.isDirty === true) {
      await onSaveMember(selectedMember.slug);
    }
    if (allCommitted) {
      setJustSaved(true);
    }
  };
  // Kept current per render so the Cmd/Ctrl+S listener stays stable across renders.
  useEffect(() => {
    savePendingChangesRef.current = savePendingChanges;
  });

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (canSavePendingChanges) {
          void savePendingChangesRef.current();
        }
      }
    };
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [canSavePendingChanges]);

  const saveExecutionProfile = async (
    memberSlug = selectedMember?.slug,
  ): Promise<boolean> => {
    const editor = memberSlug === undefined ? undefined : profileEditors[memberSlug];
    const document = editor?.document ?? null;
    const draft = editor?.draft ?? null;
    if (
      memberSlug === undefined
      || draft === null
      || document === null
      || onSaveExecutionProfile === undefined
    ) {
      return false;
    }
    if (draft.model.trim().length === 0 || draft.effort.trim().length === 0) {
      updateProfileEditor(memberSlug, {
        status: "failed",
        error: draft.model.trim().length === 0
          ? t("console.agentTeamDetail.modelRequired")
          : t("console.agentTeamDetail.effortRequired"),
      });
      return false;
    }
    updateProfileEditor(memberSlug, { status: "saving", error: null });
    try {
      const savedDocument = await onSaveExecutionProfile(
        memberSlug,
        draft,
      );
      setProfileEditors((current) => ({
        ...current,
        [memberSlug]: {
          document: savedDocument,
          draft: savedDocument.effectiveProfile,
          status: "idle",
          error: null,
        },
      }));
      return true;
    } catch (error) {
      updateProfileEditor(memberSlug, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };

  function updateProfileEditor(
    memberSlug: string,
    patch: Partial<AgentExecutionProfileEditorState>,
  ): void {
    setProfileEditors((current) => ({
      ...current,
      [memberSlug]: {
        document: current[memberSlug]?.document ?? null,
        draft: current[memberSlug]?.draft ?? null,
        status: current[memberSlug]?.status ?? "idle",
        error: current[memberSlug]?.error ?? null,
        ...patch,
      },
    }));
  }

  const addMember = async () => {
    if (!canAddMember || addMemberStatus === "adding") {
      return;
    }
    setAddMemberStatus("adding");
    setAddMemberError(null);
    try {
      await onAddMember();
      setAddMemberStatus("idle");
    } catch (error) {
      setAddMemberStatus("failed");
      setAddMemberError(error instanceof Error ? error.message : String(error));
    }
  };

  const runRepairAction = async (
    action: "rechecking" | "relocating" | "removing",
    callback: (() => void | Promise<void>) | undefined,
  ) => {
    if (repairAction !== "idle" || callback === undefined) {
      return;
    }
    setRepairAction(action);
    setRepairError(null);
    try {
      await callback();
      setRepairAction("idle");
    } catch (error) {
      setRepairAction("idle");
      setRepairError(error instanceof Error ? error.message : String(error));
    }
  };

  /**
   * "See what changed" is component-owned behavior, NOT a container callback: it selects the
   * first member changed by the latest official sync (preferring official/agent-authored
   * markers — the sync's own revisions — over user-only edits), enters the body's edit mode
   * (change markers live in the editor), expands that member's timeline and scrolls to its
   * first change marker. `onViewSyncChanges` stays an optional side notification; the button
   * must work without it.
   */
  const performViewSyncChanges = () => {
    const changedMembers = orderedMembers.filter((member) => {
      const markers = state.memberEditors[member.slug]?.changeMarkers ?? [];
      return markers.length > 0;
    });
    const firstSyncChanged = changedMembers.find((member) =>
      (state.memberEditors[member.slug]?.changeMarkers ?? [])
        .some((marker) => marker.authorKind !== "user"));
    const firstChangedMember = firstSyncChanged ?? changedMembers[0];
    if (firstChangedMember === undefined) {
      onViewSyncChanges?.();
      return;
    }
    if (selectedMember?.slug !== firstChangedMember.slug) {
      onSelectMember(firstChangedMember.slug);
    }
    setEditingMarkdown(true);
    setExpandedTimelineMemberSlug(firstChangedMember.slug);
    pendingSyncChangesTargetRef.current = firstChangedMember.slug;
    onViewSyncChanges?.();
  };
  const performViewSyncChangesRef = useRef(performViewSyncChanges);
  performViewSyncChangesRef.current = performViewSyncChanges;

  useEffect(() => {
    const signal = viewSyncChangesSignal;
    if (signal === null || signal === undefined || signal === lastViewSyncChangesSignalRef.current) {
      return;
    }
    lastViewSyncChangesSignalRef.current = signal;
    performViewSyncChangesRef.current();
  }, [viewSyncChangesSignal]);

  useEffect(() => {
    const targetSlug = pendingSyncChangesTargetRef.current;
    if (targetSlug === null || selectedMember?.slug !== targetSlug) {
      // The container may switch the member asynchronously; keep the request
      // pending until the target member is actually the one being rendered.
      return;
    }
    pendingSyncChangesTargetRef.current = null;
    const scrollToFirstMarker = (attempt = 0) => {
      const firstMarker = document.querySelector<HTMLElement>("[data-change-marker]");
      if (firstMarker === null || firstMarker === undefined || typeof firstMarker.scrollIntoView !== "function") {
        if (attempt < 20) {
          window.setTimeout(() => scrollToFirstMarker(attempt + 1), 16);
        }
        return;
      }
      const reduceMotion = typeof window.matchMedia === "function"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      firstMarker.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    };
    scrollToFirstMarker();
  }, [editingMarkdown, state.selectedMemberSlug, expandedTimelineMemberSlug]);

  return (
    <section className="min-h-0" aria-labelledby="agent-team-detail-title" data-testid="agent-team-detail">
      {/* Sits at the header's resting position so `headerPinned` can be read as a gap, not a guess. */}
      <div ref={headerSentinelRef} aria-hidden="true" className="h-0" />

      {/*
        Vertical rhythm on this page, tightest to loosest — spacing is what says which things
        belong together, so it has to be a scale and not a series of local guesses:
          6px   back link to title      a breadcrumb hanging off its own title
          8px   title to description    one form: a team's name and its one-line description
          12px  heading to its content
          20px  member strip to panel   still one section; the panel's own border does the rest
          32px  between sections        the only real break on the page
        The previous values ran 4 / 12 / 12 / 28 / 24, which put more air inside a section than
        between two — that is the arrangement that reads as "no rhythm".
      */}
      <header ref={headerRef} className="sticky top-0 z-20 -mx-1 px-1 pb-2 pt-1">
        {/*
          The bar reaches back up over the page's top inset. The scrolling container pads its
          content down by `--page-inset-top` to clear the window chrome, and a bar that started at
          its own top edge would leave that band live: text kept drifting past above the title,
          which read as a floating slab rather than a page header. The plate is opaque rather than
          a fade — this package draws no gradients.
          The hairline only appears once something is actually underneath, so at rest the page is
          not divided by a rule that means nothing.
        */}
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 top-[calc(var(--page-inset-top,0px)*-1)] -z-10 border-b bg-canvas transition-colors",
            headerPinned ? "border-line" : "border-transparent",
          )}
        />
        {/*
          Pulled left by the chevron's own side bearing: lucide draws the glyph 6px inside a 16px
          box, so a button sitting flush on the column would still put visible ink 6px in. What
          lines up down the left edge of a page is ink, not boxes.
        */}
        <button
          type="button"
          className="-ml-1.5 mb-1.5 inline-flex h-7 items-center gap-1 rounded-lg pr-2 text-sm text-sub hover:bg-hover hover:text-ink"
          onClick={() => requestGuardedAction(onLeave)}
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          {t("console.agentTeamDetail.back")}
        </button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              {/*
                Edited in place, exactly like a member's name below. Sending the same shape of
                data through a modal on one half of the page and an inline field on the other is
                the sort of split that makes a page feel assembled rather than designed.
              */}
              {/*
                The -9px is this field's own invisible chrome — 1px transparent border plus 8px of
                padding — pulled back out so the title's ink lands on the column and not one
                indent to the right of everything below it. The hover surface still bleeds left,
                which is what makes it read as a field rather than a heading that shifted.
              */}
              {teamInformationEditable ? (
                <input
                  id="agent-team-detail-title"
                  className="-ml-[9px] min-w-0 max-w-full rounded-lg border border-transparent bg-transparent px-2 py-0.5 text-lg font-semibold tracking-[-0.02em] text-ink transition-colors [field-sizing:content] hover:border-line hover:bg-sunken focus:border-accent focus:bg-sunken focus:outline-none"
                  aria-label={t("console.agentTeamDetail.teamNameLabel")}
                  value={teamNameDraft}
                  placeholder={t("console.agentTeamDetail.unnamed")}
                  onChange={(event) => setTeamNameDraft(event.currentTarget.value)}
                />
              ) : (
                <h1 id="agent-team-detail-title" className="truncate text-lg font-semibold tracking-[-0.02em] text-ink">
                  {team.name?.trim() || t("console.agentTeamDetail.unnamed")}
                </h1>
              )}
              <span className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-meta font-normal text-sub">
                {team.ownership === "system"
                  ? t("console.agentTeamDetail.official")
                  : t("console.agentTeamDetail.userTeam")}
              </span>
              {team.officialManagement?.customizationStatus === "customized" ? (
                <span className="shrink-0 rounded-md bg-sunken px-1.5 py-0.5 text-meta font-normal text-sub">
                  {t("console.agentTeamDetail.customized")}
                </span>
              ) : null}
              {readOnly ? (
                <span className="shrink-0 rounded-md bg-sunken px-1.5 py-0.5 text-meta font-normal text-hint">
                  {t("console.agentTeamDetail.readOnly")}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/*
              One page, one save. Team information, the member's identity, its body and its
              execution profile all land here — a page that saves in two places asks the user to
              work out which button owns what.
            */}
            {/*
              Nothing to save while an external change is unresolved: the only way forward is to
              take the file on disk or to overwrite it, and leaving Save reachable would offer a
              third path the product does not have.
            */}
            {!readOnly && selectedEditor?.externalChangeStatus !== "conflict" ? (
              <>
                {selectedEditor?.recentChange !== undefined && selectedEditor?.recentChange !== null ? (
                  <span
                    className="inline-flex items-center gap-1.5 text-xs text-sub"
                    role="status"
                    aria-live="polite"
                    data-testid="agent-team-markdown-summary-status"
                  >
                    {selectedEditor.recentChange.summaryStatus === "pending" ? (
                      <LoaderCircle className="h-3 w-3 animate-spin" strokeWidth={1.5} aria-hidden="true" />
                    ) : null}
                    {recentChangeSummary(t, selectedEditor.recentChange, selectedEditor.changeMarkers)}
                  </span>
                ) : null}
                {selectedEditor?.saveStatus === "saving" || profileStatus === "saving" ? (
                  <span className="inline-flex items-center text-sm text-sub" role="status">
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5} aria-hidden="true" />
                    {t("console.agentTeamDetail.saving")}
                  </span>
                ) : unsavedItemCount > 0 ? (
                  <span className="text-sm text-sub">
                    {t("console.agentTeamDetail.unsavedCount", { count: String(unsavedItemCount) })}
                  </span>
                ) : justSaved ? (
                  <span className="inline-flex items-center text-sm text-sub" role="status">
                    <Check className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                    {t("console.agentTeamDetail.saved")}
                  </span>
                ) : null}
                {/* Hidden when there is nothing to discard: a permanently greyed button is just noise. */}
                {unsavedItemCount > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={selectedEditor?.saveStatus === "saving"}
                  onClick={() => {
                    discardTeamInformation();
                    setDraftMemberOrder(null);
                    setDraftPortraits({});
                    if (profileDirty && profileDocument !== null && selectedMember !== null) {
                      updateProfileEditor(selectedMember.slug, {
                        draft: profileDocument.effectiveProfile,
                        error: null,
                      });
                    }
                    if (selectedMember !== null) {
                      onDiscardMember(selectedMember.slug);
                    }
                  }}
                >
                  {t("console.agentTeamDetail.discardChanges")}
                </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  disabled={!canSavePendingChanges}
                  onClick={() => void savePendingChanges()}
                >
                  {selectedEditor?.saveStatus === "saving" || profileStatus === "saving"
                    ? t("console.agentTeamDetail.savingNoEllipsis")
                    : t("console.agentTeamDetail.save")}
                </Button>
              </>
            ) : null}
            {typeof teamActions === "function" ? teamActions(requestGuardedAction) : teamActions}
          </div>
        </div>

        {team.ownership === "system" && officialSyncBanner !== undefined && officialSyncBanner !== null ? (
          <div className="mt-5 border-l-2 border-accent/50 bg-sunken px-4 py-3" role="status" data-testid="agent-team-official-sync-banner">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-normal text-ink">
                  {t("console.agentTeamDetail.syncedTo", {
                    version: officialSyncBanner.officialVersion,
                    count: officialSyncBanner.affectedMemberCount,
                  })}
                </p>
                <p className="mt-1 text-sm leading-6 text-sub">{officialSyncChangeSummary(t, officialSyncBanner.memberChanges)}</p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-sm p-1 text-sub hover:bg-hover hover:text-ink"
                aria-label={t("console.agentTeamDetail.dismissSyncBanner")}
                onClick={onDismissSyncBanner}
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              </button>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {/* Always works without a container callback: the select/expand/scroll
                  behavior is component-owned (see performViewSyncChanges above). */}
              <Button type="button" variant="outline" size="sm" onClick={performViewSyncChanges}>
                {t("console.agentTeamDetail.viewSyncChanges")}
              </Button>
              {onRevertSync !== undefined ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => requestGuardedAction(() => setRevertSyncPromptOpen(true))}
                >
                  {t("console.agentTeamDetail.revertSync")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {team.ownership === "system" && pendingOfficialSync !== undefined && pendingOfficialSync !== null ? (
          <div className="mt-5 border-l-2 border-warning/50 bg-sunken px-4 py-3" role="status" data-testid="agent-team-pending-official-sync">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">
                  {pendingOfficialSync.reason === "CONSERVATIVE_BASELINE"
                    ? t("console.agentTeamDetail.pendingConservativeTitle", {
                        version: pendingOfficialSync.officialVersion,
                      })
                    : t("console.agentTeamDetail.pendingMergeTitle", {
                        version: pendingOfficialSync.officialVersion,
                      })}
                </p>
                <p className="mt-1 text-sm leading-6 text-sub">
                  {pendingOfficialSync.reason === "CONSERVATIVE_BASELINE"
                    ? t("console.agentTeamDetail.pendingConservativeDescription")
                    : t("console.agentTeamDetail.pendingMergeDescription", {
                        agents: formatAgentSlugs(t, pendingOfficialSync.pendingMemberSlugs),
                      })}
                </p>
                {pendingSyncError !== null ? (
                  <p className="mt-2 text-sm text-danger" role="alert">{pendingSyncError}</p>
                ) : null}
              </div>
              {onRetryOfficialSync !== undefined ? (
                <Button
                  type="button"
                  disabled={pendingSyncAction === "running"}
                  onClick={() => requestGuardedAction(runPendingSyncAction)}
                >
                  {pendingSyncAction === "running" ? (
                    <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" strokeWidth={1.5} aria-hidden="true" />
                  ) : null}
                  {pendingOfficialSync.reason === "CONSERVATIVE_BASELINE"
                    ? t("console.agentTeamDetail.mergeOfficialOnce")
                    : t("console.agentTeamDetail.retryOfficialSync")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {team.status === "needs-repair" ? (
          <div className="mt-5 border border-danger/30 bg-danger/5 px-4 py-3" role="alert" data-testid="agent-team-repair-panel">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={1.5} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-normal text-danger">
                  {t("console.agentTeamDetail.needsRepair")}
                </p>
                <ul className="mt-1 space-y-1 text-sm leading-5 text-sub">
                  {repairIssueMessages(t, team.issues ?? []).map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
                <p className="mt-2 text-sm leading-5 text-sub">
                  {t("console.agentTeamDetail.repairNotice")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {onRecheck !== undefined ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={repairAction !== "idle"}
                      onClick={() => void runRepairAction("rechecking", onRecheck)}
                    >
                      {repairAction === "rechecking" ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} aria-hidden="true" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                      )}
                      {repairAction === "rechecking"
                        ? t("console.agentTeamDetail.checking")
                        : t("console.agentTeamDetail.recheck")}
                    </Button>
                  ) : null}
                  {onRelocate !== undefined ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={repairAction !== "idle"}
                      onClick={() => void runRepairAction("relocating", onRelocate)}
                    >
                      {repairAction === "relocating" ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} aria-hidden="true" />
                      ) : (
                        <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                      )}
                      {repairAction === "relocating"
                        ? t("console.agentTeamDetail.verifying")
                        : t("console.agentTeamDetail.relocate")}
                    </Button>
                  ) : null}
                  {onRemoveRecord !== undefined ? (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={repairAction !== "idle"}
                      onClick={() => {
                        setRepairError(null);
                        setRemoveRecordPromptOpen(true);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                      {t("console.agentTeamDetail.removeRecord")}
                    </Button>
                  ) : null}
                </div>
                {repairError !== null ? <p className="mt-2 text-sm text-danger">{repairError}</p> : null}
              </div>
            </div>
          </div>
        ) : null}

        {/*
          No primary-Agent select. Appointing is dragging a member into first place, so the
          ability lives on the member strip itself; a second entry point for the same act only
          gives the two a chance to disagree. The outcome is still announced here.
        */}
        <div className="text-xs text-sub empty:hidden" aria-live="polite">
          {primaryAgentChangeStatus === "saving" ? (
            <span className="inline-flex items-center" role="status">
              <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" strokeWidth={1.5} aria-hidden="true" />
              {t("console.agentTeamDetail.saving")}
            </span>
          ) : null}
          {primaryAgentChangeStatus === "saved" ? (
            <span className="inline-flex items-center" role="status">
              <Check className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              {t("console.agentTeamDetail.saved")}
            </span>
          ) : null}
          {primaryAgentChangeStatus === "failed" ? (
            <span className="text-danger" role="alert">
              {t("console.agentTeamDetail.switchFailed", {
                error: primaryAgentChangeError || t("console.agentTeamDetail.tryAgain"),
              })}
            </span>
          ) : null}
        </div>
      </header>

      {/*
        Left out of the pinned bar deliberately. The bar has to keep carrying identity and the save
        controls, so everything put in it is viewport the page never gets back; the description is
        prose, and prose can scroll away like the rest of the page.
      */}
      {teamInformationEditable ? (
        <input
          className="-ml-[9px] w-[calc(100%+9px)] rounded-lg border border-transparent bg-transparent px-2 py-0.5 text-sm leading-6 text-sub transition-colors hover:border-line hover:bg-sunken focus:border-accent focus:bg-sunken focus:text-ink focus:outline-none"
          aria-label={t("console.agentTeamDetail.teamDescriptionLabel")}
          value={teamDescriptionDraft}
          placeholder={t("console.agentTeamDetail.noDescription")}
          onChange={(event) => setTeamDescriptionDraft(event.currentTarget.value)}
        />
      ) : (
        <p className="max-w-2xl text-sm leading-6 text-sub">
          {team.description?.trim() || t("console.agentTeamDetail.noDescription")}
        </p>
      )}

      <div className="pt-8">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="text-sm font-normal text-ink">
              {t("console.agentTeamDetail.members")}
            </h2>
            {/* Standing and visible, not sr-only: sighted users have to learn this too. */}
            {canReorder ? (
              <span id="agent-team-member-reorder-hint" className="truncate text-xs text-hint">
                {t("console.agentTeamDetail.reorderHint")}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {memberSelectorActions}
            {canAddMember && orderedMembers.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={addMemberStatus === "adding"}
                onClick={() => void addMember()}
              >
                {addMemberStatus === "adding" ? (
                  <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" strokeWidth={1.5} aria-hidden="true" />
                ) : (
                  <Plus className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                )}
                {addMemberStatus === "adding"
                  ? t("console.agentTeamDetail.adding")
                  : t("console.agentTeamDetail.addAgent")}
              </Button>
            ) : null}
          </div>
        </div>
        <AgentMemberStrip
          reorderable={canReorder}
          onSelect={onSelectMember}
          onReorder={(slugs) => setDraftMemberOrder(slugs)}
          items={orderedMembers.map((member) => ({
            slug: member.slug,
            selected: member.slug === selectedMember?.slug,
            primary: member.slug === displayedPrimarySlug,
            disabled: member.available === false,
            content: (
              <>
                <AgentPortrait
                  displayName={member.displayName}
                  slug={member.slug}
                  portraitId={draftPortraits[member.slug] ?? member.portraitId}
                  engine={memberEngineMark(member)}
                />
                <span>{member.displayName || `@${member.slug}`}</span>
                {member.slug === displayedPrimarySlug ? (
                  <span className="text-xs text-hint">
                    {t("console.agentTeamDetail.primarySuffix")}
                  </span>
                ) : null}
                {member.available === false ? (
                  <span className="text-xs text-danger">
                    {t("console.agentTeamDetail.unavailableSuffix")}
                  </span>
                ) : null}
                {state.memberEditors[member.slug]?.isDirty === true ? (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-accent"
                    title={t("console.agentTeamDetail.unsaved")}
                    aria-label={t("console.agentTeamDetail.unsaved")}
                  />
                ) : null}
              </>
            ),
          }))}
        />
        {addMemberStatus === "failed" && orderedMembers.length > 0 ? (
          <p className="mt-2 text-sm text-danger" role="alert">
            {t("console.agentTeamDetail.addFailed", {
              error: addMemberError || t("console.agentTeamDetail.tryAgain"),
            })}
          </p>
        ) : null}
      </div>

      <div className="pt-5" id="agent-team-member-editor" role="tabpanel">
        {state.saveAllFailures.length > 0 ? (
          <div className="mb-5 border border-danger/30 bg-danger/5 px-4 py-3" role="alert">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={1.5} aria-hidden="true" />
              <div>
                <p className="text-sm font-normal text-danger">
                  {t("console.agentTeamDetail.membersSaveFailed")}
                </p>
                <ul className="mt-1 space-y-1 text-sm text-sub">
                  {state.saveAllFailures.map((failure) => (
                    <li key={failure.memberSlug}>
                      {memberLabel(orderedMembers, failure.memberSlug)}：{failure.reason}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : null}

        {selectedMember === null ? (
          <div className="rounded-xl bg-sunken px-6 py-12 text-center">
            <p className="text-sm font-normal text-ink">
              {t("console.agentTeamDetail.noMembers")}
            </p>
            <p className="mt-2 text-sm text-sub">
              {t("console.agentTeamDetail.addFirstDescription")}
            </p>
            {canAddMember ? (
              <Button
                type="button"
                className="mt-5"
                disabled={addMemberStatus === "adding"}
                onClick={() => void addMember()}
              >
                {addMemberStatus === "adding" ? (
                  <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" strokeWidth={1.5} aria-hidden="true" />
                ) : (
                  <Plus className="mr-1.5 h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                )}
                {addMemberStatus === "adding"
                  ? t("console.agentTeamDetail.addingEllipsis")
                  : t("console.agentTeamDetail.addFirst")}
              </Button>
            ) : null}
            {addMemberStatus === "failed" ? (
              <p className="mt-3 text-sm text-danger" role="alert">
                {t("console.agentTeamDetail.addFailed", {
                  error: addMemberError || t("console.agentTeamDetail.tryAgain"),
                })}
              </p>
            ) : null}
          </div>
        ) : selectedEditor?.loadStatus === "failed" ? (
          <div className="rounded-xl bg-sunken px-6 py-8" role="alert">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <p className="text-sm font-normal text-danger">
                {t("console.agentTeamDetail.agentFileUnreadable", {
                  agent: selectedMember.displayName || `@${selectedMember.slug}`,
                })}
              </p>
              {typeof memberActions === "function" ? memberActions(requestGuardedAction) : memberActions}
            </div>
            <p className="mt-1 text-sm text-sub">{selectedEditor.loadError}</p>
            <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => onRetryLoad(selectedMember.slug)}>
              {t("console.agentTeamDetail.retry")}
            </Button>
          </div>
        ) : selectedEditor?.loadStatus !== "ready" ? (
          <div className="flex min-h-48 items-center justify-center rounded-xl bg-sunken text-sm text-sub" role="status">
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5} aria-hidden="true" />
            {t("console.agentTeamDetail.readingAgentFile")}
          </div>
        ) : (
          <>
            {/*
              Two columns rather than one long stack. Configuration is the main line and the
              body is reference; side by side, that ranking is visible. Stacked they are just two
              bands of equal width, and half the horizontal space goes unused.
            */}
            <div className="grid gap-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
            {/*
              The whole column sticks, not just the card: pinning the card alone lets the save
              row below it scroll away. `self-start` is required — a grid item stretches to the
              row height by default, which leaves a sticky element no room to move.
            */}
            <div className="lg:sticky lg:top-4 lg:self-start">
            {/*
              The body gets no inner scrollbar: reading a long persona through a small window is
              worse than scrolling the page. It extends naturally and the panel scrolls, while the
              main line stays pinned so configuration is still in view while reading.
            */}
            <div
              className="rounded-xl border border-line bg-card p-4"
              data-testid="agent-execution-profile-editor"
            >
              {/*
                Identity belongs in this card rather than in a band of its own above it. That
                band added nothing the member strip had not already shown — it simply restated the
                selection, with the portrait and the name each appearing twice. The strip answers
                "which member"; this card answers "who is it and how does it run".
              */}
              {/*
                Portrait beside the name, description on its own full-width row. Keeping all three
                on one line left the description about 300px inside a 400px card, which truncated
                the very sentence that explains what the member is for.
              */}
              <div className="flex items-center gap-3">
                <AgentPortraitPicker
                  displayName={selectedEditor.displayName || selectedMember.displayName}
                  slug={selectedMember.slug}
                  portraitId={draftPortraits[selectedMember.slug] ?? selectedMember.portraitId ?? null}
                  engine={memberEngineMark(selectedMember)}
                  size="hero"
                  disabled={readOnly || onChangeMemberPortrait === undefined}
                  onChange={(picked) => {
                    // Picking is a draft edit; the host persists it on Save. Picking the face
                    // that is already saved prunes the draft instead of recording a no-op.
                    const saved = team.members
                      .find((member) => member.slug === selectedMember.slug)?.portraitId ?? null;
                    setDraftPortraits((current) => {
                      const next = { ...current };
                      if ((picked ?? null) === saved) {
                        delete next[selectedMember.slug];
                      } else {
                        next[selectedMember.slug] = picked;
                      }
                      return next;
                    });
                  }}
                />
                <input
                  className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-0.5 text-base font-semibold tracking-[-0.01em] text-ink transition-colors hover:border-line hover:bg-sunken focus:border-accent focus:bg-sunken focus:outline-none disabled:cursor-default disabled:border-transparent disabled:bg-transparent disabled:px-0"
                  aria-label={t("console.agentTeamDetail.memberNameLabel")}
                  value={selectedEditor.displayName}
                  placeholder={`@${selectedMember.slug}`}
                  disabled={readOnly || onChangeMemberIdentity === undefined}
                  onChange={(event) => onChangeMemberIdentity?.(selectedMember.slug, {
                    displayName: event.currentTarget.value,
                  })}
                />
                {typeof memberActions === "function" ? memberActions(requestGuardedAction) : memberActions}
              </div>
              <input
                className="mt-2 w-full rounded-lg border border-transparent bg-transparent px-2 py-0.5 text-sm text-sub transition-colors hover:border-line hover:bg-sunken focus:border-accent focus:bg-sunken focus:text-ink focus:outline-none disabled:cursor-default disabled:border-transparent disabled:bg-transparent disabled:px-0"
                aria-label={t("console.agentTeamDetail.memberDescriptionLabel")}
                value={selectedEditor.description}
                placeholder={t("console.agentTeamDetail.memberDescriptionPlaceholder")}
                disabled={readOnly || onChangeMemberIdentity === undefined}
                onChange={(event) => onChangeMemberIdentity?.(selectedMember.slug, {
                  description: event.currentTarget.value,
                })}
              />
              {portraitChangeStatus !== "idle" ? (
                <span className="mt-1.5 flex min-h-5 items-center gap-1.5 text-xs text-sub" aria-live="polite">
                  {portraitChangeStatus === "saving" ? (
                    <span className="inline-flex items-center" role="status">
                      <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" strokeWidth={1.5} aria-hidden="true" />
                      {t("console.agentTeamDetail.saving")}
                    </span>
                  ) : null}
                  {portraitChangeStatus === "saved" ? (
                    <span className="inline-flex items-center" role="status">
                      <Check className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                      {t("console.agentTeamDetail.saved")}
                    </span>
                  ) : null}
                  {portraitChangeStatus === "failed" ? (
                    <span className="text-danger" role="alert">
                      {t("console.agentTeamDetail.portraitChangeFailed", {
                        error: portraitChangeError || t("console.agentTeamDetail.tryAgain"),
                      })}
                    </span>
                  ) : null}
                </span>
              ) : null}

              {/* Same scale as the page: 20px is a break inside a section, 32px is between two. */}
              <div className="mt-5 flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold tracking-[0.02em] text-ink">
                    {t("console.agentTeamDetail.runtimeConfiguration")}
                  </h3>
                </div>
                {profileDocument !== null ? (
                  <span className="rounded-full border border-line bg-sunken px-2 py-0.5 text-meta font-normal text-sub">
                    {profileDocument.binding.source === "recommended"
                      ? t("console.agentTeamDetail.followRecommendation")
                      : t("console.agentTeamDetail.userOverride")}
                  </span>
                ) : null}
              </div>
              {profileDraft !== null && profileDocument !== null ? (
                <>
                  <div className="mt-3 grid gap-3">
                    <label className="grid content-start gap-1.5 text-xs text-hint">
                      {t("console.agentTeamDetail.executionEngineLabel")}
                      <Select
                        value={profileDraft.cli}
                        disabled={readOnly || profileStatus === "saving"}
                        onValueChange={(value) => updateProfileEditor(selectedMember.slug, {
                          draft: resolveProfileForEngine(value as AgentExecutionProfile["cli"], selectableProviderProfiles),
                          error: null,
                        })}
                      >
                        <SelectTrigger aria-label={t("console.agentTeamDetail.executionEngineLabel")}>
                          {EXECUTION_ENGINE_LABELS[profileDraft.cli]}
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="codex">Codex</SelectItem>
                          <SelectItem value="claude">Claude Code</SelectItem>
                          <SelectItem value="kimi">Kimi</SelectItem>
                          <SelectItem value="pi">Pi API</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                    {profileDraft.cli === "pi" ? (
                      <label className="grid content-start gap-1.5 text-xs text-hint">
                        Provider
                        <Select
                          value={profileDraft.providerProfileId}
                          disabled={readOnly || profileStatus === "saving"}
                          onValueChange={(value) => updateProfileEditor(selectedMember.slug, {
                            draft: resolvePiProviderProfile(value, selectableProviderProfiles),
                            error: null,
                          })}
                        >
                          <SelectTrigger aria-label="Provider" aria-invalid={profileProviderError !== null}>
                            {selectedProviderProfile === null
                              ? <span className="text-hint">{t("console.agentTeamDetail.selectProviderProfilePlaceholder")}</span>
                              : `${selectedProviderProfile.providerName} · ${selectedProviderProfile.displayName}`}
                          </SelectTrigger>
                          <SelectContent>
                            {selectedProviderProfile !== null && selectedProviderProfile.readiness !== "ready" ? (
                              <SelectItem value={selectedProviderProfile.id}>
                                {t("console.agentTeamDetail.providerUnavailableOption", {
                                  providerName: selectedProviderProfile.providerName,
                                  displayName: selectedProviderProfile.displayName,
                                })}
                              </SelectItem>
                            ) : null}
                            {selectableProviderProfiles.map((profile) => (
                              <SelectItem key={profile.id} value={profile.id}>
                                {profile.providerName} · {profile.displayName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {profileProviderError !== null ? <span className="text-danger">{profileProviderError}</span> : null}
                        {selectableProviderProfiles.length === 0 && onOpenProviderSettings !== undefined ? (
                          <button type="button" className="w-fit text-xs text-accent hover:underline" onClick={onOpenProviderSettings}>
                            {t("console.agentTeamDetail.goToProviderSettings")}
                          </button>
                        ) : null}
                      </label>
                    ) : null}
                    <label className="grid content-start gap-1.5 text-xs text-hint">
                      {t("console.agentTeamDetail.modelLabel")}
                      <Select
                        value={profileDraft.model}
                        disabled={readOnly || profileStatus === "saving"}
                        onValueChange={(value) => updateProfileEditor(selectedMember.slug, { draft: {
                          ...resolveSelectedModel(profileDraft, value),
                        }, error: null })}
                      >
                        <SelectTrigger aria-label="Model" aria-invalid={profileModelError !== null}>
                          {profileDraft.model === ""
                            ? <span className="text-hint">{t("console.agentTeamDetail.selectVerifiedModelPlaceholder")}</span>
                            : profileModelUnsupported
                              ? t("console.agentTeamDetail.legacyModelOption", { model: profileDraft.model })
                              : profileModelDefinition?.label ?? profileDraft.model}
                        </SelectTrigger>
                        <SelectContent>
                          {profileModelUnsupported && profileDraft.model !== "" ? (
                            <SelectItem value={profileDraft.model}>
                              {t("console.agentTeamDetail.legacyModelOption", { model: profileDraft.model })}
                            </SelectItem>
                          ) : null}
                          {(profileDraft.cli === "pi"
                            ? PI_EXECUTION_MODELS.filter((model) => selectedProviderProfile?.verifiedModels.includes(model.value as "deepseek-v4-flash" | "deepseek-v4-pro") === true)
                            : listExecutionModels(profileDraft.cli)).map((model) => (
                            <SelectItem key={model.value} value={model.value}>
                              {model.membershipRestricted
                                ? t("console.agentTeamDetail.membershipModelOption", { model: model.label })
                                : model.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {profileModelError !== null ? <span className="text-danger">{profileModelError}</span> : null}
                    </label>
                    <label className="grid content-start gap-1.5 text-xs text-hint">
                      {t("console.agentTeamDetail.effort")}
                      <Select
                        value={profileDraft.effort}
                        disabled={readOnly || profileStatus === "saving"}
                        onValueChange={(value) => updateProfileEditor(selectedMember.slug, { draft: {
                          ...profileDraft,
                          effort: value,
                        }, error: null })}
                      >
                        <SelectTrigger aria-label={t("console.agentTeamDetail.effort")} aria-invalid={profileEffortError !== null}>
                          {profileEffortUnsupported
                            ? t("console.agentTeamDetail.legacyEffortOption", { effort: profileDraft.effort })
                            : profileDraft.effort}
                        </SelectTrigger>
                        <SelectContent>
                          {profileEffortUnsupported ? (
                            <SelectItem value={profileDraft.effort}>
                              {t("console.agentTeamDetail.legacyEffortOption", { effort: profileDraft.effort })}
                            </SelectItem>
                          ) : null}
                          {profileModelDefinition?.efforts.map((effort) => (
                            <SelectItem key={effort} value={effort}>{effort}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {profileEffortError !== null ? <span className="text-danger">{profileEffortError}</span> : null}
                    </label>
                  </div>
                  {profileModelUnsupported || profileEffortUnsupported ? (
                    <p className="mt-3 text-sm text-sub" role="status">
                      {t("console.agentTeamDetail.legacyProfileNotice")}
                    </p>
                  ) : null}
                  {!profileDraftValid ? (
                    <p className="mt-2 text-sm text-sub">
                      {t("console.agentTeamDetail.savedUnchanged")}
                    </p>
                  ) : null}
                  {profileError !== null ? <p className="mt-3 text-sm text-danger" role="alert">{profileError}</p> : null}
                  {/*
                    `empty:hidden` because the only thing in this row is conditional: with nothing
                    to restore it collapses to zero height but its margin does not, and the card
                    ends up with 16px more padding at the bottom than at the top.
                  */}
                  {!readOnly ? (
                    <div className="mt-5 flex flex-wrap justify-end gap-2 empty:hidden">
                      {profileDocument.recommendation !== null
                        && profileDocument.binding.source !== "recommended"
                        && onRestoreRecommendedProfile !== undefined ? (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={profileStatus === "saving"}
                            onClick={() => {
                              updateProfileEditor(selectedMember.slug, { status: "saving", error: null });
                              void onRestoreRecommendedProfile(selectedMember.slug).then((document) => {
                                setProfileEditors((current) => ({
                                  ...current,
                                  [selectedMember.slug]: {
                                    document,
                                    draft: document.effectiveProfile,
                                    status: "idle",
                                    error: null,
                                  },
                                }));
                              }).catch((error: unknown) => {
                                updateProfileEditor(selectedMember.slug, {
                                  status: "failed",
                                  error: error instanceof Error ? error.message : String(error),
                                });
                              });
                            }}
                          >
                            {t("console.agentTeamDetail.restoreRecommendation")}
                          </Button>
                        ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="mt-4 text-sm text-danger" role="alert">
                  {t("console.agentTeamDetail.runtimeReadFailed", {
                    error: profileError ?? t("console.agentTeamDetail.tryAgainLater"),
                  })}
                </p>
              )}
            </div>
            </div>

            <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-hint">
                  AGENT.md
                </span>
                {selectedEditor.recentChange !== undefined && selectedEditor.recentChange !== null ? (
                  <span className="text-xs text-sub">
                    {recentChangeSummary(t, selectedEditor.recentChange, selectedEditor.changeMarkers)}
                  </span>
                ) : null}
              </div>
              {selectedEditor.revisionTimeline !== undefined ? (
                <button
                  type="button"
                  data-testid="agent-team-markdown-timeline-toggle"
                  className="inline-flex items-center gap-0.5 text-xs text-hint hover:text-ink"
                  aria-expanded={expandedTimelineMemberSlug === selectedMember.slug}
                  onClick={() => setExpandedTimelineMemberSlug((current) =>
                    current === selectedMember.slug ? null : selectedMember.slug)}
                >
                  {t("console.agentTeamDetail.viewAllChanges")}
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 transition-transform motion-reduce:transition-none",
                      expandedTimelineMemberSlug === selectedMember.slug && "rotate-180",
                    )}
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                </button>
              ) : null}
            </div>
            {expandedTimelineMemberSlug === selectedMember.slug
              && selectedEditor.revisionTimeline !== undefined ? (
                <div className="mb-4">
                  <AgentMarkdownRevisionTimeline
                    memberDisplayName={selectedEditor.displayName || selectedMember.displayName || `@${selectedMember.slug}`}
                    entries={selectedEditor.revisionTimeline}
                    onRestore={onRestoreRevision === undefined
                      ? undefined
                      : (revisionId) => void onRestoreRevision(selectedMember.slug, revisionId)}
                  />
                </div>
              ) : null}
            {/*
              The right column is not a card. The left one is a control surface — fields and
              selects — so a border earns its place there; the body is reading material, and
              boxing it too is just habit. Grouping here is whitespace and type, not rules.
            */}
            <div>
            {/*
              The edit entry follows the registered light-action pattern: absolutely positioned
              over the top-right of the body, transparent until the block is hovered or takes
              keyboard focus — a code block's copy button. It does not deserve its own row.

              The `@slug` and its copy button that used to share that row are gone: typing `@` in
              the editor already completes member names, so copying a slug by hand is a need that
              does not exist, and it only took up space.
            */}
            <div className="group relative">
              {readOnly ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1 z-10 h-7 bg-canvas px-2 text-xs opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
                  aria-pressed={editingMarkdown}
                  onClick={() => setEditingMarkdown((editing) => !editing)}
                >
                  {editingMarkdown
                    ? t("console.agentTeamDetail.doneEditingMarkdown")
                    : t("console.agentTeamDetail.editMarkdown")}
                </Button>
              )}
            {/*
              Reading is the common case on this page — people come here to adjust how a member
              runs, not to write its persona — so the body is rendered by default and editing is
              an explicit second step. Both views show the same draft, so an unsaved change is
              still visible after leaving the editor.
            */}
            {editingMarkdown && !readOnly ? (
              <AgentMarkdownMentionEditor
                id="agent-team-markdown-editor"
                value={splitAgentMarkdown(selectedEditor.draftMarkdown).body}
                members={mentionMembers}
                label={t("console.agentTeamDetail.responsibilitiesLabel", {
                  name: selectedEditor.displayName || selectedMember.displayName || selectedMember.slug,
                })}
                readOnly={readOnly}
                disabled={selectedEditor.saveStatus === "saving"}
                changeMarkers={bodyChangeMarkers}
                onValueChange={(body) => onChangeMember(
                  selectedMember.slug,
                  withAgentMarkdownBody(selectedEditor.draftMarkdown, body),
                )}
              />
            ) : (
              <div
                id="agent-team-markdown-editor"
                className="min-h-[220px] px-1"
                data-testid="agent-team-markdown-preview"
              >
                {splitAgentMarkdown(selectedEditor.draftMarkdown).body.trim() === "" ? (
                  <p className="text-sm text-hint">{t("console.agentTeamDetail.emptyMarkdown")}</p>
                ) : (
                  <MarkdownMessage content={splitAgentMarkdown(selectedEditor.draftMarkdown).body} />
                )}
              </div>
            )}
            </div>
            </div>
            </div>
            </div>

            {selectedEditor.externalChangeStatus === "reloaded" ? (
              <div className="mt-3 border-l-2 border-line-strong bg-sunken px-3 py-2 text-sm text-sub" role="status">
                {t("console.agentTeamDetail.externalReloaded")}
              </div>
            ) : null}

            {selectedEditor.externalChangeStatus === "conflict" ? (
              <div className="mt-3 border border-line bg-sunken px-3 py-3" role="alert">
                <p className="text-sm font-normal text-ink">
                  {t("console.agentTeamDetail.externalChanged")}
                </p>
                <p className="mt-1 text-sm leading-6 text-sub">
                  {t("console.agentTeamDetail.externalConflictDescription")}
                </p>
                {selectedEditor.saveStatus === "failed" ? (
                  <p className="mt-2 text-sm text-danger">
                    {t("console.agentTeamDetail.overwriteFailed", {
                      error: selectedEditor.saveError ?? "",
                    })}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={selectedEditor.saveStatus === "saving"}
                    onClick={() => onLoadExternalVersion?.(selectedMember.slug)}
                  >
                    {t("console.agentTeamDetail.loadExternal")}
                  </Button>
                  <Button
                    type="button"
                    disabled={selectedEditor.saveStatus === "saving"}
                    onClick={() => void onOverwriteExternalVersion?.(selectedMember.slug)}
                  >
                    {selectedEditor.saveStatus === "saving"
                      ? t("console.agentTeamDetail.overwriting")
                      : t("console.agentTeamDetail.overwriteCurrent")}
                  </Button>
                </div>
              </div>
            ) : null}

            {selectedEditor.saveStatus === "failed" && selectedEditor.externalChangeStatus !== "conflict" ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border border-danger/30 bg-danger/5 px-3 py-2.5" role="alert">
                <span className="text-sm text-danger">
                  {t("console.agentTeamDetail.saveFailed", {
                    error: selectedEditor.saveError ?? "",
                  })}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => void onSaveMember(selectedMember.slug)}>
                  {t("console.agentTeamDetail.retry")}
                </Button>
              </div>
            ) : null}

          </>
        )}
      </div>

      {leavePromptOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-6" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !savingAll) {
            pendingGuardedActionRef.current = null;
            setLeavePromptOpen(false);
          }
        }}>
          <div
            className="w-full max-w-md border border-line bg-card p-5 text-ink"
            role="dialog"
            aria-modal="true"
            aria-label={t("console.agentTeamDetail.unsavedDialog")}
          >
            <h2 className="text-base font-semibold">
              {t("console.agentTeamDetail.unsavedDialog")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-sub">
              {t("console.agentTeamDetail.unsavedDialogDescription")}
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" disabled={savingAll} onClick={() => {
                pendingGuardedActionRef.current = null;
                setLeavePromptOpen(false);
              }}>
                {t("console.agentTeamDetail.continueEditing")}
              </Button>
              <Button type="button" variant="outline" disabled={savingAll || hasSavingMembers} onClick={() => {
                setDraftMemberOrder(null);
                setDraftPortraits({});
                onDiscardAll();
                setProfileEditors((current) => Object.fromEntries(
                  Object.entries(current).map(([slug, editor]) => [
                    slug,
                    {
                      ...editor,
                      draft: editor.document?.effectiveProfile ?? null,
                      error: null,
                      status: editor.status === "saving" ? editor.status : "idle",
                    },
                  ]),
                ));
                continueGuardedAction();
              }}>
                {t("console.agentTeamDetail.discardAllContinue")}
              </Button>
              <Button type="button" disabled={savingAll || hasSavingMembers} onClick={() => void saveAllAndContinue()}>
                {savingAll
                  ? t("console.agentTeamDetail.savingEach")
                  : hasSavingMembers
                    ? t("console.agentTeamDetail.savingCurrentMember")
                    : t("console.agentTeamDetail.saveAllContinue")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {externalConflictPromptOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-6">
          <div
            className="w-full max-w-md border border-line bg-card p-5 text-ink"
            role="dialog"
            aria-modal="true"
            aria-label={t("console.agentTeamDetail.cannotReturn")}
          >
            <h2 className="text-base font-semibold">
              {t("console.agentTeamDetail.cannotReturn")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-sub">
              {t("console.agentTeamDetail.cannotReturnDescription")}
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink">
              {externalConflictMemberSlugs.map((slug) => (
                <li key={slug}>{memberLabel(orderedMembers, slug)} AGENT.md</li>
              ))}
            </ul>
            <div className="mt-5 flex justify-end">
              <Button type="button" onClick={() => setExternalConflictPromptOpen(false)}>
                {t("console.agentTeamDetail.understood")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {removeRecordPromptOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-6">
          <div
            className="w-full max-w-md border border-line bg-card p-5 text-ink"
            role="dialog"
            aria-modal="true"
            aria-label={t("console.agentTeamDetail.removeInvalidRecord")}
          >
            <h2 className="text-base font-semibold">
              {t("console.agentTeamDetail.removeInvalidRecordTitle")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-sub">
              {t("console.agentTeamDetail.removeInvalidRecordDescription")}
            </p>
            {repairError !== null ? <p className="mt-3 text-sm text-danger" role="alert">{repairError}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={repairAction === "removing"} onClick={() => setRemoveRecordPromptOpen(false)}>
                {t("console.agentTeamDetail.cancel")}
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={repairAction === "removing"}
                onClick={() => void runRepairAction("removing", onRemoveRecord)}
              >
                {repairAction === "removing"
                  ? t("console.agentTeamDetail.removingRecord")
                  : t("console.agentTeamDetail.removeOnly")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {revertSyncPromptOpen && officialSyncBanner !== null && officialSyncBanner !== undefined ? (
        <RevertSyncConfirmationDialog
          officialVersion={officialSyncBanner.officialVersion}
          affectedMemberCount={officialSyncBanner.affectedMemberCount}
          onCancel={() => setRevertSyncPromptOpen(false)}
          onConfirm={() => {
            setRevertSyncPromptOpen(false);
            void onRevertSync?.();
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * Confirmation before "revert this sync" (PRD §dialogs-and-dangerous-actions): the action
 * rewrites the whole team, so it must say which official version it returns to
 * and how many members are affected before the user confirms — without
 * delete-level warning language (the sync itself is a revertible revision).
 */
export function RevertSyncConfirmationDialog({
  officialVersion,
  affectedMemberCount,
  onCancel,
  onConfirm,
}: {
  officialVersion: string;
  affectedMemberCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        className="w-full max-w-md border border-line bg-card p-5 text-ink"
        role="dialog"
        aria-modal="true"
        aria-label={t("console.agentTeamDetail.revertSyncTitle")}
      >
        <h2 className="text-base font-semibold">
          {t("console.agentTeamDetail.revertSyncTitle")}
        </h2>
        <p className="mt-2 text-sm leading-6 text-sub">
          {t("console.agentTeamDetail.revertSyncDetail", {
            version: officialVersion,
            count: String(affectedMemberCount),
          })}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("console.agentTeamDetail.cancel")}
          </Button>
          <Button type="button" onClick={onConfirm}>
            {t("console.agentTeamDetail.revertSyncConfirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function orderAgentTeamMembers(team: AgentTeamDetailTeam): AgentTeamDetailMember[] {
  const membersBySlug = new Map(team.members.map((member) => [member.slug, member]));
  const orderedSlugs = [
    ...(team.primaryAgentSlug === null ? [] : [team.primaryAgentSlug]),
    ...team.memberOrder,
    ...team.members.map((member) => member.slug),
  ];
  const seen = new Set<string>();
  const orderedMembers: AgentTeamDetailMember[] = [];
  for (const slug of orderedSlugs) {
    const member = membersBySlug.get(slug);
    if (member !== undefined && !seen.has(slug)) {
      seen.add(slug);
      orderedMembers.push(member);
    }
  }
  return orderedMembers;
}

function memberLabel(members: readonly AgentTeamDetailMember[], memberSlug: string): string {
  return members.find((member) => member.slug === memberSlug)?.displayName || `@${memberSlug}`;
}

/**
 * Renders the "recent change" line for the latest revision. The line stays persistent once the
 * member has any revision: pending shows a neutral "generating…" placeholder, unavailable shows a
 * mechanical per-block count, and ready renders the provider-written summary. Placeholder copy is
 * i18n-generated in the view — the main process never composes localized text.
 */
function recentChangeSummary(
  t: Translate,
  recentChange: NonNullable<AgentTeamMemberEditorState["recentChange"]>,
  changeMarkers: readonly AgentMarkdownChangeMarker[] | undefined,
): string {
  if (recentChange.summaryStatus === "pending") {
    return t("console.agentTeamDetail.recentChangePending");
  }
  if (recentChange.summaryStatus === "unavailable" || recentChange.summary === null) {
    return t("console.agentTeamDetail.recentChangeUnavailable", {
      count: String(changeMarkers?.length ?? 0),
    });
  }
  return t("console.agentTeamDetail.recentChange", { summary: recentChange.summary });
}

function sameSlugOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((slug, index) => slug === right[index]);
}

function formatAgentSlugs(t: Translate, slugs: readonly string[]): string {
  return [...new Set(slugs)]
    .map((slug) => `@${slug}`)
    .join(t("console.agentTeamDetail.listSeparator"));
}

/**
 * Plain-language sync summary composed from the structured member changes; the
 * main process never composes localized copy.
 */
export function officialSyncChangeSummary(
  t: Translate,
  changes: AgentOfficialSyncMemberChanges,
): string {
  const facts = [
    changes.added.length > 0
      ? t("console.agentTeamDetail.syncFactAdded", {
          agents: formatAgentSlugs(t, changes.added),
        })
      : null,
    changes.removed.length > 0
      ? t("console.agentTeamDetail.syncFactRemoved", {
          agents: formatAgentSlugs(t, changes.removed),
        })
      : null,
    changes.renamed.length > 0
      ? t("console.agentTeamDetail.syncFactRenamed", {
          agents: changes.renamed
            .map(({ from, to }) => `@${from} → @${to}`)
            .join(t("console.agentTeamDetail.listSeparator")),
        })
      : null,
    changes.adopted.length > 0
      ? t("console.agentTeamDetail.syncFactAdopted", {
          agents: formatAgentSlugs(t, changes.adopted),
        })
      : null,
    changes.recommendationChanged.length > 0
      ? t("console.agentTeamDetail.syncFactRecommendations", {
          agents: formatAgentSlugs(t, changes.recommendationChanged),
        })
      : null,
    changes.keptOverridden.length > 0
      ? t("console.agentTeamDetail.syncFactKept", {
          agents: formatAgentSlugs(t, changes.keptOverridden),
        })
      : null,
    changes.collidedMembers.length > 0
      ? t("console.agentTeamDetail.syncFactCollided", {
          agents: formatAgentSlugs(t, changes.collidedMembers),
        })
      : null,
    changes.mergedMembers.length > 0
      ? t("console.agentTeamDetail.syncFactMerged", {
          agents: formatAgentSlugs(t, changes.mergedMembers),
        })
      : null,
    changes.pendingMergeMembers.length > 0
      ? t("console.agentTeamDetail.syncFactPendingMerge", {
          agents: formatAgentSlugs(t, changes.pendingMergeMembers),
        })
      : null,
  ].filter((fact): fact is string => fact !== null);
  return facts.length === 0
    ? t("console.agentTeamDetail.syncNoMemberChanges")
    : facts.join(t("console.agentTeamDetail.syncFactSeparator"));
}

function isProfileEditorDirty(
  editor: AgentExecutionProfileEditorState | undefined,
): boolean {
  return editor?.document !== null
    && editor?.document !== undefined
    && editor.draft !== null
    && (
      editor.draft.cli !== editor.document.effectiveProfile.cli
      || providerProfileIdentity(editor.draft) !== providerProfileIdentity(editor.document.effectiveProfile)
      || editor.draft.model !== editor.document.effectiveProfile.model
      || editor.draft.effort !== editor.document.effectiveProfile.effort
    );
}

function providerProfileIdentity(profile: AgentExecutionProfile): string {
  return profile.cli === "pi" ? profile.providerProfileId : "";
}

function resolveProfileForEngine(
  engine: AgentExecutionProfile["cli"],
  providers: readonly AgentExecutionProviderProfile[],
): AgentExecutionProfile {
  if (engine !== "pi") return resolveProfileForCli(engine);
  return providers.length === 1
    ? resolvePiProviderProfile(providers[0]!.id, providers)
    : { cli: "pi", providerId: "deepseek", providerProfileId: "", model: "", effort: "high" };
}

function resolvePiProviderProfile(
  profileId: string,
  providers: readonly AgentExecutionProviderProfile[],
): AgentExecutionProfile {
  const profile = providers.find((candidate) => candidate.id === profileId);
  const model = profile?.defaultModel !== null
    && profile?.verifiedModels.includes(profile.defaultModel) === true
    ? profile.defaultModel
    : "";
  return {
    cli: "pi",
    providerId: "deepseek",
    providerProfileId: profile?.id ?? "",
    model,
    effort: findPiExecutionModel(model)?.defaultEffort ?? "high",
  };
}

function resolveSelectedModel(
  profile: AgentExecutionProfile,
  model: string,
): AgentExecutionProfile {
  if (profile.cli !== "pi") return resolveProfileForModel(profile, model);
  const definition = findPiExecutionModel(model);
  return {
    ...profile,
    model,
    effort: profile.model !== "" && definition?.efforts.includes(profile.effort) === true
      ? profile.effort
      : definition?.defaultEffort ?? profile.effort,
  };
}

function createProfileEditors(
  team: AgentTeamDetailTeam,
): Record<string, AgentExecutionProfileEditorState> {
  return Object.fromEntries(team.members.flatMap((member) => (
    member.executionProfile === undefined
      ? []
      : [[member.slug, profileEditorFromDocument(member.executionProfile)]]
  )));
}

function profileEditorFromDocument(
  document: AgentExecutionProfileDocument,
): AgentExecutionProfileEditorState {
  return {
    document,
    draft: { ...document.effectiveProfile },
    status: "idle",
    error: null,
  };
}

function repairIssueMessages(
  t: Translate,
  issues: readonly AgentTeamRepairIssueView[],
): string[] {
  const messages = issues.map((issue) => {
    switch (issue.code) {
      case "team-directory-missing":
      case "team-directory-unreadable":
        return t("console.agentTeamDetail.repairDirectory");
      case "team-manifest-missing":
      case "team-manifest-unreadable":
      case "team-manifest-invalid":
        return t("console.agentTeamDetail.repairManifest");
      case "member-slug-missing":
        return t("console.agentTeamDetail.repairMissingSlug");
      case "member-slug-duplicate":
        return issue.slug === undefined
          ? t("console.agentTeamDetail.repairDuplicateSlug")
          : t("console.agentTeamDetail.repairDuplicateSlugNamed", { slug: issue.slug });
      case "primary-agent-not-member":
        return t("console.agentTeamDetail.repairPrimary");
      case "member-agent-missing":
      case "member-agent-unreadable":
        return issue.slug === undefined
          ? t("console.agentTeamDetail.repairAgentFile")
          : t("console.agentTeamDetail.repairAgentFileNamed", { slug: issue.slug });
      case "member-agent-metadata-invalid":
        return issue.slug === undefined
          ? t("console.agentTeamDetail.repairMetadata")
          : t("console.agentTeamDetail.repairMetadataNamed", { slug: issue.slug });
    }
  });
  return [...new Set(messages.length > 0
    ? messages
    : [t("console.agentTeamDetail.filesUnavailable")])];
}
