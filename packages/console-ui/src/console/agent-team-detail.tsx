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
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AgentInitialAvatar } from "@/console/agent-initial-avatar";
import {
  AgentMarkdownMentionEditor,
  CopyableAgentSlug,
} from "@/console/agent-markdown-mention-editor";
import {
  findExecutionModel,
  isRegisteredExecutionEffort,
  listExecutionModels,
  resolveProfileForCli,
  resolveProfileForModel,
} from "@/console/execution-profile-registry";
import { cn } from "@/lib/utils";
import { useI18n, type Translate } from "@/i18n";
import { Button } from "@/ui/button";

export interface AgentTeamDetailMember {
  slug: string;
  displayName: string;
  description: string;
  available?: boolean;
  executionProfile?: AgentExecutionProfileDocument;
}

export interface AgentExecutionProfile {
  cli: "codex" | "kimi";
  model: string;
  effort: string;
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
  currentOfficialVersion?: string;
  latestOfficialVersion?: string;
  customizationStatus: "clean" | "customized" | "unknown";
  updateStatus: "current" | "available" | "unknown";
  primaryAction: "none" | "update" | "register" | "protect-and-update" | "retry";
  requiresProtectiveCopy: boolean;
  addedMembers: string[];
  removedMembers: string[];
  renamedMembers?: Array<{ from: string; to: string }>;
  recommendationChangedMembers: string[];
  protectedMembers: string[];
  collidingMembers: string[];
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
}

export interface AgentOfficialUpdateResult {
  copiedTeamId: string | null;
  appliedOfficialVersion: string;
  memberChanges: {
    added: string[];
    removed: string[];
    renamed: Array<{ from: string; to: string }>;
    recommendationChanged: string[];
  };
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
  onSelectMember(memberSlug: string): void;
  onChangeMember(memberSlug: string, agentMarkdown: string): void;
  onSaveMember(memberSlug: string): void | Promise<void>;
  onCheckExternalChange?(memberSlug: string): void | Promise<void>;
  onLoadExternalVersion?(memberSlug: string): void;
  onOverwriteExternalVersion?(memberSlug: string): void | Promise<void>;
  onRetryLoad(memberSlug: string): void;
  onDiscardMember(memberSlug: string): void;
  onDiscardAll(): void;
  onSaveAll(): Promise<{ failures: AgentTeamSaveAllFailureView[] }>;
  onRecheck?(): void | Promise<void>;
  onRelocate?(): void | Promise<void>;
  onRemoveRecord?(): void | Promise<void>;
  onSaveExecutionProfile?(
    memberSlug: string,
    profile: AgentExecutionProfile,
  ): Promise<AgentExecutionProfileDocument>;
  onRestoreRecommendedProfile?(memberSlug: string): Promise<AgentExecutionProfileDocument>;
  onApplyOfficialUpdate?(): Promise<AgentOfficialUpdateResult>;
  onOpenCopiedTeam?(teamId: string): void;
  onLeave(): void;
}

export function AgentTeamDetail({
  team,
  state,
  readOnly = false,
  teamActions,
  memberSelectorActions,
  memberActions,
  onAddMember,
  onChangePrimaryAgent,
  onSelectMember,
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
  onApplyOfficialUpdate,
  onOpenCopiedTeam,
  onLeave,
}: AgentTeamDetailProps): JSX.Element {
  const { t } = useI18n();
  const pendingGuardedActionRef = useRef<(() => void | Promise<void>) | null>(null);
  const [leavePromptOpen, setLeavePromptOpen] = useState(false);
  const [externalConflictPromptOpen, setExternalConflictPromptOpen] = useState(false);
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
  const [officialUpdateStatus, setOfficialUpdateStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [officialUpdateMessage, setOfficialUpdateMessage] = useState<string | null>(null);
  const [officialUpdateCopyTeamId, setOfficialUpdateCopyTeamId] = useState<string | null>(null);
  const orderedMembers = useMemo(() => orderAgentTeamMembers(team), [team]);
  const availableMembers = orderedMembers.filter((member) => member.available !== false);
  const selectedMember = orderedMembers.find((member) => member.slug === state.selectedMemberSlug) ?? null;
  const selectedEditor = selectedMember === null ? undefined : state.memberEditors[selectedMember.slug];
  const profileEditor = selectedMember === null
    ? undefined
    : profileEditors[selectedMember.slug];
  const profileDocument = profileEditor?.document ?? null;
  const profileDraft = profileEditor?.draft ?? null;
  const profileStatus = profileEditor?.status ?? "idle";
  const profileError = profileEditor?.error ?? null;
  const primaryMember = availableMembers.find((member) => member.slug === team.primaryAgentSlug);
  const primaryAgentChangeStatus = state.primaryAgentChangeStatus ?? "idle";
  const primaryAgentChangeError = state.primaryAgentChangeError ?? null;
  const mentionMembers = useMemo(() => orderedMembers.filter((member) => member.available !== false).map((member) => ({
    slug: member.slug,
    displayName: state.memberEditors[member.slug]?.displayName || member.displayName,
  })), [orderedMembers, state.memberEditors]);
  const hasDirtyMembers = Object.values(state.memberEditors).some((editor) => editor?.isDirty === true);
  const profileDirty = profileDocument !== null
    && profileDraft !== null
    && (
      profileDraft.cli !== profileDocument.effectiveProfile.cli
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
  const canSaveCurrent = !readOnly
    && selectedEditor?.loadStatus === "ready"
    && selectedEditor.isDirty
    && selectedEditor.externalChangeStatus !== "conflict"
    && selectedEditor.saveStatus !== "saving";
  const canAddMember = !readOnly
    && team.status !== "needs-repair"
    && onAddMember !== undefined;
  const profileModelError = profileDraft !== null && profileDraft.model.trim().length === 0
    ? t("console.agentTeamDetail.enterModel")
    : null;
  const profileEffortError = profileDraft !== null && profileDraft.effort.trim().length === 0
    ? t("console.agentTeamDetail.enterEffort")
    : null;
  const profileDraftValid = profileDraft !== null
    && profileModelError === null
    && profileEffortError === null;
  const profileModelDefinition = profileDraft === null
    ? null
    : findExecutionModel(profileDraft.cli, profileDraft.model);
  const profileModelUnsupported = profileDraft !== null && profileModelDefinition === null;
  const profileEffortUnsupported = profileDraft !== null
    && !isRegisteredExecutionEffort(profileDraft.cli, profileDraft.model, profileDraft.effort);

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
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (canSaveCurrent && selectedMember !== null) {
          void onSaveMember(selectedMember.slug);
        }
      }
    };
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [canSaveCurrent, onSaveMember, selectedMember]);

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
    if (hasDirtyMembers || hasDirtyProfiles) {
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

  const saveAllAndContinue = async () => {
    if (savingAll) {
      return;
    }
    setSavingAll(true);
    try {
      for (const memberSlug of Object.keys(profileEditors)
        .filter((slug) => isProfileEditorDirty(profileEditors[slug]))) {
        const saved = await saveExecutionProfile(memberSlug);
        if (!saved) return;
      }
      const result = await onSaveAll();
      if (result.failures.length === 0) {
        continueGuardedAction();
      } else {
        pendingGuardedActionRef.current = null;
        setLeavePromptOpen(false);
      }
    } finally {
      setSavingAll(false);
    }
  };

  const applyOfficialUpdate = async () => {
    if (onApplyOfficialUpdate === undefined || officialUpdateStatus === "saving") {
      return;
    }
    setOfficialUpdateStatus("saving");
    setOfficialUpdateMessage(null);
    setOfficialUpdateCopyTeamId(null);
    try {
      const result = await onApplyOfficialUpdate();
      setOfficialUpdateStatus("saved");
      setOfficialUpdateCopyTeamId(result.copiedTeamId);
      setOfficialUpdateMessage(formatOfficialUpdateResult(t, result));
    } catch (error) {
      setOfficialUpdateStatus("failed");
      setOfficialUpdateMessage(error instanceof Error ? error.message : String(error));
    }
  };

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

  return (
    <section className="min-h-0" aria-labelledby="agent-team-detail-title" data-testid="agent-team-detail">
      <button
        type="button"
        className="mb-7 inline-flex h-7 items-center gap-1 rounded-md pr-2 text-sm text-sub hover:bg-hover hover:text-ink"
        onClick={() => requestGuardedAction(onLeave)}
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        {t("console.agentTeamDetail.back")}
      </button>

      <header className="border-b border-line pb-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h1 id="agent-team-detail-title" className="truncate text-2xl font-semibold tracking-[-0.02em] text-ink">
                {team.name?.trim() || t("console.agentTeamDetail.unnamed")}
              </h1>
              <span className="shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-[11px] font-medium text-sub">
                {team.ownership === "system"
                  ? t("console.agentTeamDetail.official")
                  : t("console.agentTeamDetail.userTeam")}
              </span>
              {team.officialManagement?.customizationStatus === "customized" ? (
                <span className="shrink-0 rounded-sm bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-sub">
                  {t("console.agentTeamDetail.customized")}
                </span>
              ) : null}
              {team.officialManagement?.updateStatus === "available" ? (
                <span className="shrink-0 rounded-sm bg-sel px-1.5 py-0.5 text-[11px] font-medium text-ink">
                  {t("console.agentTeamDetail.updateAvailable")}
                </span>
              ) : null}
              {readOnly ? (
                <span className="shrink-0 rounded-sm bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-hint">
                  {t("console.agentTeamDetail.readOnly")}
                </span>
              ) : null}
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-sub">
              {team.description?.trim() || t("console.agentTeamDetail.noDescription")}
            </p>
          </div>
          {typeof teamActions === "function" ? teamActions(requestGuardedAction) : teamActions}
        </div>

        {team.ownership === "system" && team.officialManagement?.updateStatus === "available" ? (
          <div className="mt-5 border-l-2 border-line-strong bg-sunken px-4 py-3" role="status">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink">
                  {t("console.agentTeamDetail.officialUpdateAvailable")}
                </p>
                <p className="mt-1 text-sm leading-6 text-sub">
                  {team.officialManagement.requiresProtectiveCopy
                    ? t("console.agentTeamDetail.protectBeforeUpdate")
                    : t("console.agentTeamDetail.preserveRuntimeSettings")}
                </p>
                {team.officialManagement.currentOfficialVersion !== undefined
                  && team.officialManagement.latestOfficialVersion !== undefined ? (
                    <p className="mt-1 text-xs text-hint">
                      {t("console.agentTeamDetail.versionChange", {
                        current: team.officialManagement.currentOfficialVersion,
                        latest: team.officialManagement.latestOfficialVersion,
                      })}
                    </p>
                  ) : null}
                {team.officialManagement.addedMembers.length > 0
                  || team.officialManagement.removedMembers.length > 0
                  || (team.officialManagement.renamedMembers?.length ?? 0) > 0
                  || team.officialManagement.recommendationChangedMembers.length > 0 ? (
                    <div className="mt-1 space-y-0.5 text-xs text-hint">
                      {team.officialManagement.addedMembers.length > 0
                        ? <p>{t("console.agentTeamDetail.added", {
                            agents: formatAgentSlugs(t, team.officialManagement.addedMembers),
                          })}</p>
                        : null}
                      {team.officialManagement.removedMembers.length > 0
                        ? <p>{t("console.agentTeamDetail.removed", {
                            agents: formatAgentSlugs(t, team.officialManagement.removedMembers),
                          })}</p>
                        : null}
                      {(team.officialManagement.renamedMembers?.length ?? 0) > 0
                        ? (
                            <p>
                              {t("console.agentTeamDetail.renamed", {
                                agents: team.officialManagement.renamedMembers!
                                  .map(({ from, to }) => `@${from} → @${to}`)
                                  .join(t("console.agentTeamDetail.listSeparator")),
                              })}
                            </p>
                          )
                        : null}
                      {team.officialManagement.recommendationChangedMembers.length > 0
                        ? (
                            <p>
                              {t("console.agentTeamDetail.recommendationChanged", {
                                agents: formatAgentSlugs(
                                  t,
                                  team.officialManagement.recommendationChangedMembers,
                                ),
                              })}
                            </p>
                          )
                        : null}
                    </div>
                  ) : null}
                {team.officialManagement.protectedMembers.length > 0
                  || team.officialManagement.collidingMembers.length > 0 ? (
                    <p className="mt-1 text-xs text-hint">
                      {t("console.agentTeamDetail.protectionScope", {
                        agents: formatAgentSlugs(t, [
                          ...team.officialManagement.protectedMembers,
                          ...team.officialManagement.collidingMembers,
                        ]),
                      })}
                    </p>
                  ) : null}
              </div>
              {onApplyOfficialUpdate !== undefined ? (
                <Button
                  type="button"
                  disabled={officialUpdateStatus === "saving"}
                  onClick={() => requestGuardedAction(applyOfficialUpdate)}
                >
                  {officialUpdateStatus === "saving"
                    ? t("console.agentTeamDetail.updating")
                    : team.officialManagement.requiresProtectiveCopy
                      ? t("console.agentTeamDetail.protectAndUpdate")
                      : t("console.agentTeamDetail.updateLatest")}
                </Button>
              ) : null}
            </div>
            {officialUpdateMessage !== null ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p
                  className={cn("text-sm", officialUpdateStatus === "failed" ? "text-danger" : "text-sub")}
                  role={officialUpdateStatus === "failed" ? "alert" : "status"}
                >
                  {officialUpdateMessage}
                </p>
                {officialUpdateStatus === "saved"
                  && officialUpdateCopyTeamId !== null
                  && onOpenCopiedTeam !== undefined ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onOpenCopiedTeam(officialUpdateCopyTeamId)}
                    >
                      {t("console.agentTeamDetail.openProtectedCopy")}
                    </Button>
                  ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {team.status === "needs-repair" ? (
          <div className="mt-5 border border-danger/30 bg-danger/5 px-4 py-3" role="alert" data-testid="agent-team-repair-panel">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={1.5} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-danger">
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

        <div className="mt-6 flex min-h-8 flex-wrap items-center gap-3 text-sm">
          <span className="text-hint">{t("console.agentTeamDetail.primaryAgent")}</span>
          {!readOnly ? (
            <div className="relative">
              <select
                className="h-8 min-w-40 appearance-none rounded-md border border-line bg-card py-1 pl-2.5 pr-8 text-sm text-ink transition-colors hover:bg-hover disabled:cursor-wait disabled:text-sub"
                aria-label={t("console.agentTeamDetail.primaryAgent")}
                value={primaryMember?.slug ?? ""}
                disabled={
                  onChangePrimaryAgent === undefined
                  || primaryAgentChangeStatus === "saving"
                  || availableMembers.length === 0
                }
                onChange={(event) => void onChangePrimaryAgent?.(event.currentTarget.value)}
              >
                {primaryMember === undefined ? (
                  <option value="" disabled>{t("console.agentTeamDetail.notSet")}</option>
                ) : null}
                {availableMembers.map((member) => (
                  <option key={member.slug} value={member.slug}>
                    {member.displayName || `@${member.slug}`}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-hint"
                strokeWidth={1.5}
                aria-hidden="true"
              />
            </div>
          ) : (
            <span className="rounded-md border border-line bg-card px-2.5 py-1.5 text-ink">
              {primaryMember?.displayName || t("console.agentTeamDetail.notSet")}
            </span>
          )}
          <span className="min-h-5 text-xs text-sub" aria-live="polite">
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
          </span>
        </div>
      </header>

      <div className="border-b border-line py-6">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-hint">
            {t("console.agentTeamDetail.members")}
          </h2>
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
        <div
          className="scroll-thin flex min-w-0 flex-nowrap gap-2 overflow-x-auto pb-2"
          role="tablist"
          aria-label={t("console.agentTeamDetail.members")}
          data-testid="agent-team-member-selector"
        >
          {orderedMembers.map((member) => {
            const selected = member.slug === selectedMember?.slug;
            const dirty = state.memberEditors[member.slug]?.isDirty === true;
            const primary = member.slug === team.primaryAgentSlug;
            return (
              <button
                key={member.slug}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="agent-team-member-editor"
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors",
                  selected
                    ? "border-line-strong bg-sel text-ink"
                    : "border-line bg-card text-sub hover:bg-hover hover:text-ink",
                )}
                onClick={() => onSelectMember(member.slug)}
              >
                <AgentInitialAvatar displayName={member.displayName} slug={member.slug} />
                <span>{member.displayName || `@${member.slug}`}</span>
                {primary ? (
                  <span className="text-xs text-hint">
                    {t("console.agentTeamDetail.primarySuffix")}
                  </span>
                ) : null}
                {member.available === false ? (
                  <span className="text-xs text-danger">
                    {t("console.agentTeamDetail.unavailableSuffix")}
                  </span>
                ) : null}
                {dirty ? (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-accent"
                    title={t("console.agentTeamDetail.unsaved")}
                    aria-label={t("console.agentTeamDetail.unsaved")}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
        {addMemberStatus === "failed" && orderedMembers.length > 0 ? (
          <p className="mt-2 text-sm text-danger" role="alert">
            {t("console.agentTeamDetail.addFailed", {
              error: addMemberError || t("console.agentTeamDetail.tryAgain"),
            })}
          </p>
        ) : null}
      </div>

      <div className="pt-7" id="agent-team-member-editor" role="tabpanel">
        {state.saveAllFailures.length > 0 ? (
          <div className="mb-5 border border-danger/30 bg-danger/5 px-4 py-3" role="alert">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={1.5} aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-danger">
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
          <div className="border-y border-line px-6 py-12 text-center">
            <p className="text-sm font-medium text-ink">
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
          <div className="border-y border-line py-8" role="alert">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <p className="text-sm font-medium text-danger">
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
          <div className="flex min-h-48 items-center justify-center border-y border-line text-sm text-sub" role="status">
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5} aria-hidden="true" />
            {t("console.agentTeamDetail.readingAgentFile")}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <AgentInitialAvatar
                  displayName={selectedEditor.displayName || selectedMember.displayName}
                  slug={selectedMember.slug}
                  size="heading"
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-lg font-semibold tracking-[-0.01em] text-ink">
                      {selectedEditor.displayName || selectedMember.displayName || `@${selectedMember.slug}`}
                    </h2>
                    {selectedEditor.isDirty ? (
                      <span className="text-xs font-medium text-accent">
                        {t("console.agentTeamDetail.unsaved")}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-sub">
                    {selectedEditor.description || selectedMember.description || `@${selectedMember.slug}`}
                  </p>
                </div>
              </div>
              {typeof memberActions === "function" ? memberActions(requestGuardedAction) : memberActions}
            </div>

            <div className="mt-6 border-y border-line py-5" data-testid="agent-execution-profile-editor">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-hint">
                    {t("console.agentTeamDetail.runtimeConfiguration")}
                  </h3>
                  <p className="mt-1 text-sm text-sub">
                    {t("console.agentTeamDetail.runtimeOwnership", {
                      team: team.name?.trim() || t("console.agentTeamDetail.unnamed"),
                      slug: selectedMember.slug,
                    })}
                  </p>
                </div>
                {profileDocument !== null ? (
                  <span className="rounded-sm bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-sub">
                    {profileDocument.binding.source === "recommended"
                      ? t("console.agentTeamDetail.followRecommendation")
                      : t("console.agentTeamDetail.userOverride")}
                  </span>
                ) : null}
              </div>
              {profileDraft !== null && profileDocument !== null ? (
                <>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <label className="grid gap-1.5 text-xs text-hint">
                      CLI
                      <select
                        aria-label="CLI"
                        className="h-9 rounded-md border border-line bg-card px-2 text-sm text-ink"
                        value={profileDraft.cli}
                        disabled={readOnly || profileStatus === "saving"}
                        onChange={(event) => updateProfileEditor(selectedMember.slug, {
                          draft: resolveProfileForCli(event.currentTarget.value as "codex" | "kimi"),
                          error: null,
                        })}
                      >
                        <option value="codex">Codex</option>
                        <option value="kimi">Kimi</option>
                      </select>
                    </label>
                    <label className="grid gap-1.5 text-xs text-hint">
                      Model
                      <select
                        aria-label="Model"
                        className="h-9 rounded-md border border-line bg-card px-2 text-sm text-ink"
                        value={profileDraft.model}
                        disabled={readOnly || profileStatus === "saving"}
                        aria-invalid={profileModelError !== null}
                        onChange={(event) => updateProfileEditor(selectedMember.slug, { draft: {
                          ...resolveProfileForModel(profileDraft, event.currentTarget.value),
                        }, error: null })}
                      >
                        {profileModelUnsupported ? (
                          <option value={profileDraft.model}>
                            {t("console.agentTeamDetail.legacyModelOption", { model: profileDraft.model })}
                          </option>
                        ) : null}
                        {listExecutionModels(profileDraft.cli).map((model) => (
                          <option key={model.value} value={model.value}>
                            {model.membershipRestricted
                              ? t("console.agentTeamDetail.membershipModelOption", { model: model.label })
                              : model.label}
                          </option>
                        ))}
                      </select>
                      {profileModelError !== null ? <span className="text-danger">{profileModelError}</span> : null}
                    </label>
                    <label className="grid gap-1.5 text-xs text-hint">
                      {t("console.agentTeamDetail.effort")}
                      <select
                        aria-label={t("console.agentTeamDetail.effort")}
                        className="h-9 rounded-md border border-line bg-card px-2 text-sm text-ink"
                        value={profileDraft.effort}
                        disabled={readOnly || profileStatus === "saving"}
                        aria-invalid={profileEffortError !== null}
                        onChange={(event) => updateProfileEditor(selectedMember.slug, { draft: {
                          ...profileDraft,
                          effort: event.currentTarget.value,
                        }, error: null })}
                      >
                        {profileEffortUnsupported ? (
                          <option value={profileDraft.effort}>
                            {t("console.agentTeamDetail.legacyEffortOption", { effort: profileDraft.effort })}
                          </option>
                        ) : null}
                        {profileModelDefinition?.efforts.map((effort) => (
                          <option key={effort} value={effort}>{effort}</option>
                        ))}
                      </select>
                      {profileEffortError !== null ? <span className="text-danger">{profileEffortError}</span> : null}
                    </label>
                  </div>
                  {profileModelUnsupported || profileEffortUnsupported ? (
                    <p className="mt-3 text-sm text-sub" role="status">
                      {t("console.agentTeamDetail.legacyProfileNotice")}
                    </p>
                  ) : null}
                  <p className="mt-3 text-sm text-sub">
                    {t("console.agentTeamDetail.runtimeValidationNotice")}
                  </p>
                  {!profileDraftValid ? (
                    <p className="mt-2 text-sm text-sub">
                      {t("console.agentTeamDetail.savedUnchanged")}
                    </p>
                  ) : null}
                  {profileError !== null ? <p className="mt-3 text-sm text-danger" role="alert">{profileError}</p> : null}
                  {!readOnly ? (
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
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
                      <Button
                        type="button"
                        disabled={
                          !profileDirty
                          || profileStatus === "saving"
                          || !profileDraftValid
                        }
                        onClick={() => void saveExecutionProfile(selectedMember.slug)}
                      >
                        {profileStatus === "saving"
                          ? t("console.agentTeamDetail.saving")
                          : t("console.agentTeamDetail.saveRuntime")}
                      </Button>
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

            <div className="mt-5 flex items-center justify-between gap-3">
              <label htmlFor="agent-team-markdown-editor" className="text-xs font-semibold uppercase tracking-[0.08em] text-hint">
                AGENT.md
              </label>
              <div className="flex items-center gap-1 text-xs text-hint">
                {readOnly ? <span>{t("console.agentTeamDetail.readOnlyPrefix")}</span> : null}
                <CopyableAgentSlug slug={selectedMember.slug} />
              </div>
            </div>
            <AgentMarkdownMentionEditor
              id="agent-team-markdown-editor"
              value={selectedEditor.draftMarkdown}
              members={mentionMembers}
              label={`${selectedEditor.displayName || selectedMember.displayName || selectedMember.slug} AGENT.md`}
              readOnly={readOnly}
              disabled={selectedEditor.saveStatus === "saving"}
              onValueChange={(agentMarkdown) => onChangeMember(selectedMember.slug, agentMarkdown)}
            />

            {selectedEditor.externalChangeStatus === "reloaded" ? (
              <div className="mt-3 border-l-2 border-line-strong bg-sunken px-3 py-2 text-sm text-sub" role="status">
                {t("console.agentTeamDetail.externalReloaded")}
              </div>
            ) : null}

            {selectedEditor.externalChangeStatus === "conflict" ? (
              <div className="mt-3 border border-line bg-sunken px-3 py-3" role="alert">
                <p className="text-sm font-medium text-ink">
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

            {!readOnly && selectedEditor.externalChangeStatus !== "conflict" ? (
              <div className="mt-4 flex items-center justify-end gap-2">
                {selectedEditor.saveStatus === "saving" ? (
                  <span className="mr-auto inline-flex items-center text-sm text-sub" role="status">
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5} aria-hidden="true" />
                    {t("console.agentTeamDetail.saving")}
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!selectedEditor.isDirty || selectedEditor.saveStatus === "saving"}
                  onClick={() => onDiscardMember(selectedMember.slug)}
                >
                  {t("console.agentTeamDetail.discardChanges")}
                </Button>
                <Button
                  type="button"
                  disabled={!canSaveCurrent}
                  onClick={() => void onSaveMember(selectedMember.slug)}
                >
                  {selectedEditor.saveStatus === "saving"
                    ? t("console.agentTeamDetail.savingNoEllipsis")
                    : t("console.agentTeamDetail.save")}
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
    </section>
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

function formatAgentSlugs(t: Translate, slugs: readonly string[]): string {
  return [...new Set(slugs)]
    .map((slug) => `@${slug}`)
    .join(t("console.agentTeamDetail.listSeparator"));
}

function formatOfficialUpdateResult(t: Translate, result: AgentOfficialUpdateResult): string {
  const facts = [
    result.memberChanges.added.length > 0
      ? t("console.agentTeamDetail.addedFact", {
          agents: formatAgentSlugs(t, result.memberChanges.added),
        })
      : null,
    result.memberChanges.removed.length > 0
      ? t("console.agentTeamDetail.removedFact", {
          agents: formatAgentSlugs(t, result.memberChanges.removed),
        })
      : null,
    result.memberChanges.renamed.length > 0
      ? t("console.agentTeamDetail.renamedFact", {
          agents: result.memberChanges.renamed
            .map(({ from, to }) => `@${from} → @${to}`)
            .join(t("console.agentTeamDetail.listSeparator")),
        })
      : null,
    result.memberChanges.recommendationChanged.length > 0
      ? t("console.agentTeamDetail.recommendationFact", {
          agents: formatAgentSlugs(t, result.memberChanges.recommendationChanged),
        })
      : null,
  ].filter((fact): fact is string => fact !== null);
  const copyFact = result.copiedTeamId === null
    ? ""
    : t("console.agentTeamDetail.copyPreservedFact", { id: result.copiedTeamId });
  const memberFact = facts.length === 0
    ? t("console.agentTeamDetail.noMemberChanges")
    : facts.join(t("console.agentTeamDetail.factSeparator"));
  return t("console.agentTeamDetail.updateResult", {
    copy: copyFact,
    version: result.appliedOfficialVersion,
    changes: memberFact,
  });
}

function isProfileEditorDirty(
  editor: AgentExecutionProfileEditorState | undefined,
): boolean {
  return editor?.document !== null
    && editor?.document !== undefined
    && editor.draft !== null
    && (
      editor.draft.cli !== editor.document.effectiveProfile.cli
      || editor.draft.model !== editor.document.effectiveProfile.model
      || editor.draft.effort !== editor.document.effectiveProfile.effort
    );
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
