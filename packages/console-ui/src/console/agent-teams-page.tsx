import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  Copy,
  ExternalLink,
  FolderOpen,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";

import {
  TeamBuilderView,
  type TeamBuilderViewState,
} from "@/ai-team-builder/team-builder-view";
import { AgentMemberStack } from "@/console/agent-member-stack";
import { AgentPortrait, type PortraitId } from "@/console/agent-portrait";
import { type ExecutionEngine } from "@/console/provider-mark";
import { AgentTeamSaveFeedback, type AgentTeamSaveFeedbackView } from "@/console/agent-team-save-feedback";
import {
  AgentTeamDetail,
  type AgentExecutionProfile,
  type AgentExecutionProfileDocument,
  type AgentExecutionProviderProfile,
  type AgentTeamDetailMember,
  type AgentTeamRepairIssueView,
  type AgentTeamDetailState,
  type AgentTeamSaveAllFailureView,
} from "@/console/agent-team-detail";
import { cn } from "@/lib/utils";
import { useI18n, type Translate } from "@/i18n";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Input } from "@/ui/input";

export interface OperatorAgentTeamMember {
  slug: string;
  displayName: string;
  description: string;
  available?: boolean;
  portraitId?: string | null;
  executionProfile?: AgentTeamDetailMember["executionProfile"];
}

export interface OperatorAgentTeamRelayBeat {
  speakerSlug: string;
  message: string;
}

export type OperatorAgentTeamOnboardingOrchestration =
  | { status: "ready"; relayBeats: OperatorAgentTeamRelayBeat[] }
  | { status: "unavailable" };

export type OperatorAgentTeamInstallationSource =
  | { provider: "moebius" }
  | { provider: "github"; repository: string; defaultBranch: string };

export interface OperatorAgentTeam {
  teamKey: string;
  id: string;
  ownership: "system" | "user";
  createdAt?: string;
  installationSource?: OperatorAgentTeamInstallationSource;
  name: string | null;
  description: string | null;
  primaryAgentSlug: string | null;
  memberOrder: string[];
  onboardingOrchestration?: OperatorAgentTeamOnboardingOrchestration;
  members: OperatorAgentTeamMember[];
  status: "usable" | "unfinished-draft" | "needs-repair";
  canCreateConversation: boolean;
  canEditContent?: boolean;
  canDeleteTeam?: boolean;
  issues?: AgentTeamRepairIssueView[];
}

export type OperatorAgentTeamsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "configuration-error" }
  | {
      status: "ready";
      teams: OperatorAgentTeam[];
      registrationIssues?: Array<{
        kind: "stable-identity" | "directory";
        canPreserve: boolean;
      }>;
    };

export interface AgentTeamInformationInput {
  name: string;
  description: string;
}

type AgentTeamFileOperation =
  | { kind: "duplicate-team"; team: OperatorAgentTeam }
  | { kind: "duplicate-member"; team: OperatorAgentTeam; member: OperatorAgentTeamMember }
  | { kind: "trash-member"; team: OperatorAgentTeam; member: OperatorAgentTeamMember }
  | { kind: "trash-team"; team: OperatorAgentTeam };
type AgentTeamTrashOperation = Extract<AgentTeamFileOperation, { kind: "trash-member" | "trash-team" }>;

export interface AgentTeamBuilderController {
  state: TeamBuilderViewState | null;
  onStart: () => Promise<OperatorAgentTeam | null>;
  onSubmit: (text: string) => void | Promise<void>;
  onAdjust: (text: string) => void | Promise<void>;
  onRetry: () => Promise<OperatorAgentTeam | null>;
  onCommit: (revision: number) => Promise<OperatorAgentTeam | null>;
}

type AgentTeamsPageContentView =
  | { kind: "list" }
  | { kind: "team-detail"; teamKey: string }
  | { kind: "ai-builder" };

/**
 * The application-level teams pages all live in the same scroll surface. GitHub discovery and
 * preview use this export too, so a child route cannot quietly invent a second page inset,
 * measure, or scroll owner.
 */
export function AgentTeamsPageSurface({
  children,
  labelledBy,
  scrollContainerRef,
}: {
  children: ReactNode;
  labelledBy?: string;
  scrollContainerRef?: MutableRefObject<HTMLElement | null>;
}): JSX.Element {
  return (
    <section
      ref={scrollContainerRef}
      className="scroll-thin min-h-0 flex-1 overflow-auto px-4 pb-12 pt-16 [--page-inset-top:4rem] sm:px-8"
      aria-labelledby={labelledBy}
    >
      <div className="mx-auto max-w-[960px]">{children}</div>
    </section>
  );
}

/** Shared list/subpage heading for the Agent teams page family. */
export function AgentTeamsPageHeading({
  title,
  titleId,
  description,
  backLabel,
  onBack,
  actions,
}: {
  title: string;
  titleId: string;
  description?: string;
  backLabel: string;
  onBack?: () => void;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-ml-2 shrink-0"
          aria-label={backLabel}
          onClick={onBack}
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
        </Button>
        <div className="min-w-0">
          <h1 id={titleId} className="text-lg font-semibold leading-[1.2] tracking-[-0.02em] text-ink">
            {title}
          </h1>
          {description !== undefined ? (
            <p className="mt-2 max-w-xl text-sm leading-6 text-sub">{description}</p>
          ) : null}
        </div>
      </div>
      {actions}
    </div>
  );
}

type AgentTeamsPageView =
  | AgentTeamsPageContentView
  | {
      kind: "information-dialog";
      mode: "create";
      returnView: Extract<AgentTeamsPageContentView, { kind: "list" }>;
    }
  | {
      kind: "information-dialog";
      mode: "edit";
      team: OperatorAgentTeam;
      returnView: Extract<AgentTeamsPageContentView, { kind: "team-detail" }>;
    };

export function AgentTeamsPage({
  state,
  selectedTeamKey,
  openTeamKey,
  selectedMemberSlug,
  detailState,
  useStackedRows,
  aiTeamBuilder,
  providerProfiles,
  onOpenProviderSettings,
  onRetry,
  onCreateTeam,
  onDiscoverTeams,
  onOpenGithubRepository,
  onOpenTeam,
  onCloseTeam,
  onSelectMember,
  onChangeMemberPortrait,
  onChangeMemberIdentity,
  onReorderMembers,
  onChangePrimaryAgent,
  onAddMember,
  onUpdateTeamInformation,
  onChangeMember,
  onSaveMember,
  onCheckMemberExternalChange,
  onLoadMemberExternalVersion,
  onOverwriteMemberExternalVersion,
  onRetryMember,
  onDiscardMember,
  onDiscardAll,
  onSaveAll,
  onSaveExecutionProfile,
  onRestoreRecommendedProfile,
  onRestoreRevision,
  onDuplicateBuiltInTeam,
  onRecheckTeam,
  onRelocateTeam,
  onRemoveTeamRecord,
  fileManagerActionLabel,
  onOpenLocation,
  onDuplicateUserTeam,
  onDuplicateMember,
  onTrashMember,
  onTrashUserTeam,
  onViewRegistrationConflictTeam,
  onShowRegistrationConflictLocation,
  onPreserveRegistrationConflicts,
  onBack,
}: {
  state: OperatorAgentTeamsState;
  /**
   * Which team's data the host has loaded. Deliberately **not** a request to open that team: the
   * desktop reconciles this to the first team whenever nothing else is selected, so treating it
   * as an intent would mean the page never shows its list again.
   */
  selectedTeamKey?: string | null;
  /**
   * Opens straight into a team's detail — the entry the repair red dot and the in-session team
   * error need, and what lets a story of the detail render without a staged click. Only a caller
   * that means "take the user to this team" may pass it.
   */
  openTeamKey?: string | null;
  selectedMemberSlug?: string | null;
  detailState?: AgentTeamDetailState | null;
  useStackedRows: boolean;
  aiTeamBuilder?: AgentTeamBuilderController;
  providerProfiles?: readonly AgentExecutionProviderProfile[];
  onOpenProviderSettings?: () => void;
  onRetry?: () => void;
  onCreateTeam?: (information: AgentTeamInformationInput) => Promise<OperatorAgentTeam>;
  onDiscoverTeams?: () => void;
  onOpenGithubRepository?: (teamKey: string, repository: string) => void;
  onOpenTeam?: (teamKey: string) => void;
  onCloseTeam?: () => void;
  onSelectMember?: (teamKey: string, memberSlug: string) => void;
  onChangeMemberPortrait?: (teamKey: string, memberSlug: string, portraitId: PortraitId | null) => void | Promise<void>;
  onChangeMemberIdentity?: (
    teamKey: string,
    memberSlug: string,
    identity: { displayName?: string; description?: string },
  ) => void;
  onReorderMembers?: (teamKey: string, memberSlugs: string[]) => void | Promise<void>;
  onChangePrimaryAgent?: (teamKey: string, memberSlug: string) => void | Promise<void>;
  onAddMember?: (teamKey: string) => void | Promise<void>;
  onUpdateTeamInformation?: (teamKey: string, information: AgentTeamInformationInput) => void | Promise<void>;
  onChangeMember?: (teamKey: string, memberSlug: string, agentMarkdown: string) => void;
  onSaveMember?: (teamKey: string, memberSlug: string) => void | Promise<void>;
  onCheckMemberExternalChange?: (teamKey: string, memberSlug: string) => void | Promise<void>;
  onLoadMemberExternalVersion?: (teamKey: string, memberSlug: string) => void;
  onOverwriteMemberExternalVersion?: (teamKey: string, memberSlug: string) => void | Promise<void>;
  onRetryMember?: (teamKey: string, memberSlug: string) => void;
  onDiscardMember?: (teamKey: string, memberSlug: string) => void;
  onDiscardAll?: (teamKey: string) => void;
  onSaveAll?: (teamKey: string) => Promise<{ failures: AgentTeamSaveAllFailureView[]; successCount?: number }>;
  onSaveExecutionProfile?: (
    teamKey: string,
    memberSlug: string,
    profile: AgentExecutionProfile,
  ) => Promise<AgentExecutionProfileDocument>;
  onRestoreRecommendedProfile?: (
    teamKey: string,
    memberSlug: string,
  ) => Promise<AgentExecutionProfileDocument>;
  onRestoreRevision?: (teamKey: string, memberSlug: string, revisionId: string) => void | Promise<void>;
  onDuplicateBuiltInTeam?: (teamKey: string) => Promise<string>;
  onRecheckTeam?: (teamKey: string) => void | Promise<void>;
  onRelocateTeam?: (teamKey: string) => void | Promise<void>;
  onRemoveTeamRecord?: (teamKey: string) => void | Promise<void>;
  fileManagerActionLabel?: string;
  onOpenLocation?: (teamKey: string, memberSlug?: string) => void | Promise<void>;
  onDuplicateUserTeam?: (teamKey: string) => Promise<string>;
  onDuplicateMember?: (teamKey: string, memberSlug: string) => void | Promise<void>;
  onTrashMember?: (teamKey: string, memberSlug: string) => void | Promise<void>;
  onTrashUserTeam?: (teamKey: string) => void | Promise<void>;
  onViewRegistrationConflictTeam?: () => void;
  onShowRegistrationConflictLocation?: () => void | Promise<void>;
  onPreserveRegistrationConflicts?: () => void | Promise<void>;
  onBack: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const resolvedFileManagerActionLabel = fileManagerActionLabel ?? t("console.agentTeams.openInFileManager");
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const listScrollTopRef = useRef(0);
  const pendingListScrollRestoreRef = useRef(false);
  const [view, setView] = useState<AgentTeamsPageView>(
    openTeamKey === undefined || openTeamKey === null
      ? { kind: "list" }
      : { kind: "team-detail", teamKey: openTeamKey },
  );
  /**
   * Applied on change rather than on every render, so the back button still returns to the list
   * instead of being immediately overridden by a host that keeps passing the same key.
   */
  const appliedOpenTeamKey = useRef(openTeamKey);
  if (appliedOpenTeamKey.current !== openTeamKey) {
    appliedOpenTeamKey.current = openTeamKey;
    if (openTeamKey !== undefined && openTeamKey !== null) {
      setView({ kind: "team-detail", teamKey: openTeamKey });
    }
  }
  const [duplicatingTeamKey, setDuplicatingTeamKey] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [fileManagerError, setFileManagerError] = useState<"team" | "member" | null>(null);
  const [confirmationOperation, setConfirmationOperation] = useState<AgentTeamTrashOperation | null>(null);
  const [mutationKey, setMutationKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [registrationRecoveryPending, setRegistrationRecoveryPending] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<AgentTeamSaveFeedbackView | null>(null);
  const reloadedExternalMembersRef = useRef<{ teamKey: string | null; members: Set<string> }>({
    teamKey: null,
    members: new Set(),
  });
  const contentView = view.kind === "information-dialog" ? view.returnView : view;
  const openedTeamKey = contentView.kind === "team-detail" ? contentView.teamKey : null;
  const openedTeam = state.status === "ready"
    ? state.teams.find((team) => team.teamKey === openedTeamKey)
    : undefined;
  const openedGithubRepository = githubRepository(openedTeam);
  const openedDetailState = detailState !== undefined
    && detailState !== null
    && detailState.teamKey === openedTeam?.teamKey
    ? detailState
    : null;
  const selectedMember = openedTeam?.members.find(
    (member) => member.slug === openedDetailState?.selectedMemberSlug,
  );

  useEffect(() => {
    if (openedTeam === undefined || openedDetailState === null) {
      reloadedExternalMembersRef.current = { teamKey: null, members: new Set() };
      return;
    }
    const current = new Set(Object.values(openedDetailState.memberEditors)
      .filter((editor) => editor?.externalChangeStatus === "reloaded")
      .map((editor) => editor!.memberSlug));
    const previous = reloadedExternalMembersRef.current.teamKey === openedTeam.teamKey
      ? reloadedExternalMembersRef.current.members
      : new Set<string>();
    if ([...current].some((slug) => !previous.has(slug))) {
      setSaveFeedback({
        kind: "external-loaded",
        teamName: teamName(t, openedTeam),
        savedItemCount: current.size,
        canApplyToExistingConversation: true,
      });
    }
    reloadedExternalMembersRef.current = { teamKey: openedTeam.teamKey, members: current };
  }, [openedDetailState, openedTeam, t]);

  const openTeam = (teamKey: string) => {
    listScrollTopRef.current = scrollContainerRef.current?.scrollTop ?? 0;
    setDuplicateError(null);
    setFileManagerError(null);
    setActionError(null);
    setSaveFeedback(null);
    onOpenTeam?.(teamKey);
    setView({ kind: "team-detail", teamKey });
    if (scrollContainerRef.current !== null) {
      scrollContainerRef.current.scrollTop = 0;
    }
  };

  const returnToList = () => {
    onCloseTeam?.();
    setDuplicateError(null);
    setFileManagerError(null);
    setActionError(null);
    setConfirmationOperation(null);
    pendingListScrollRestoreRef.current = true;
    setView({ kind: "list" });
  };

  const openAiBuilder = () => {
    if (aiTeamBuilder === undefined) {
      return;
    }
    listScrollTopRef.current = scrollContainerRef.current?.scrollTop ?? 0;
    setView({ kind: "ai-builder" });
    void aiTeamBuilder.onStart().then((selectedTeam) => {
      if (selectedTeam !== null) {
        setView({ kind: "team-detail", teamKey: selectedTeam.teamKey });
      }
    }).catch(() => undefined);
  };

  const returnFromAiBuilder = () => {
    pendingListScrollRestoreRef.current = true;
    setView({ kind: "list" });
  };

  useLayoutEffect(() => {
    if (!pendingListScrollRestoreRef.current || openedTeamKey !== null || scrollContainerRef.current === null) {
      return;
    }
    pendingListScrollRestoreRef.current = false;
    scrollContainerRef.current.scrollTop = listScrollTopRef.current;
  }, [openedTeamKey]);

  const duplicateBuiltInTeam = async (team: OperatorAgentTeam) => {
    if (duplicatingTeamKey !== null || onDuplicateBuiltInTeam === undefined) {
      return;
    }
    setDuplicatingTeamKey(team.teamKey);
    setDuplicateError(null);
    try {
      const copiedTeamKey = await onDuplicateBuiltInTeam(team.teamKey);
      setView({ kind: "team-detail", teamKey: copiedTeamKey });
    } catch (error) {
      setDuplicateError(error instanceof Error ? error.message : t("console.agentTeams.duplicateFailed"));
    } finally {
      setDuplicatingTeamKey(null);
    }
  };

  const openLocation = async (team: OperatorAgentTeam, memberSlug?: string) => {
    if (onOpenLocation === undefined) {
      return;
    }
    setFileManagerError(null);
    try {
      await onOpenLocation(team.teamKey, memberSlug);
    } catch {
      setFileManagerError(memberSlug === undefined ? "team" : "member");
    }
  };

  const executeFileOperation = async (operation: AgentTeamFileOperation) => {
    const operationKey = fileOperationKey(operation);
    if (mutationKey !== null) {
      return;
    }
    setMutationKey(operationKey);
    setActionError(null);
    try {
      if (operation.kind === "duplicate-team") {
        if (onDuplicateUserTeam === undefined) {
          throw new Error(t("console.agentTeams.duplicateTeamUnavailable"));
        }
        const copiedTeamKey = await onDuplicateUserTeam(operation.team.teamKey);
        setView({ kind: "team-detail", teamKey: copiedTeamKey });
      } else if (operation.kind === "duplicate-member") {
        if (onDuplicateMember === undefined) {
          throw new Error(t("console.agentTeams.duplicateAgentUnavailable"));
        }
        await onDuplicateMember(operation.team.teamKey, operation.member.slug);
        setSaveFeedback({ kind: "saved", teamName: teamName(t, operation.team), savedItemCount: 1, canApplyToExistingConversation: true });
      } else if (operation.kind === "trash-member") {
        if (onTrashMember === undefined) {
          throw new Error(t("console.agentTeams.deleteAgentUnavailable"));
        }
        await onTrashMember(operation.team.teamKey, operation.member.slug);
        setSaveFeedback({ kind: "saved", teamName: teamName(t, operation.team), savedItemCount: 1, canApplyToExistingConversation: true });
      } else {
        if (onTrashUserTeam === undefined) {
          throw new Error(t("console.agentTeams.trashTeamUnavailable"));
        }
        await onTrashUserTeam(operation.team.teamKey);
        returnToList();
      }
      setConfirmationOperation(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
      setConfirmationOperation(null);
    } finally {
      setMutationKey(null);
    }
  };

  const prepareFileOperation = (operation: AgentTeamFileOperation) => {
    if (operation.kind === "trash-member" || operation.kind === "trash-team") {
      setConfirmationOperation(operation);
      return;
    }
    void executeFileOperation(operation);
  };

  const preserveRegistrationConflicts = async () => {
    if (registrationRecoveryPending || onPreserveRegistrationConflicts === undefined) return;
    setRegistrationRecoveryPending(true);
    setActionError(null);
    try {
      await onPreserveRegistrationConflicts();
    } catch (error) {
      setActionError(error instanceof Error
        ? error.message
        : t("console.agentTeams.registrationConflictActionFailed"));
    } finally {
      setRegistrationRecoveryPending(false);
    }
  };

  return (
    <AgentTeamsPageSurface
      scrollContainerRef={scrollContainerRef}
      labelledBy={contentView.kind === "list" ? "agent-teams-title" : undefined}
    >
        {contentView.kind === "ai-builder" ? (
          <div
            className="flex min-h-[460px] w-full justify-center"
            role="region"
            aria-label={t("console.agentTeams.aiBuilder")}
            data-testid="agent-team-ai-builder-view"
          >
            {aiTeamBuilder?.state === null || aiTeamBuilder === undefined ? (
              <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-sub" role="status">
                <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.5} aria-hidden="true" />
                {t("console.agentTeams.openingAiBuilder")}
              </div>
            ) : (
              <TeamBuilderView
                state={aiTeamBuilder.state}
                contextLabel={t("console.agentTeams.title")}
                backLabel={t("console.agentTeams.back")}
                onBack={returnFromAiBuilder}
                onSubmit={aiTeamBuilder.onSubmit}
                onAdjust={aiTeamBuilder.onAdjust}
                onRetry={async () => {
                  const selectedTeam = await aiTeamBuilder.onRetry();
                  if (selectedTeam !== null) {
                    setView({ kind: "team-detail", teamKey: selectedTeam.teamKey });
                  }
                }}
                onCommit={async (revision) => {
                  const selectedTeam = await aiTeamBuilder.onCommit(revision);
                  if (selectedTeam !== null) {
                    setView({ kind: "team-detail", teamKey: selectedTeam.teamKey });
                  }
                }}
              />
            )}
          </div>
        ) : openedTeam !== undefined ? (
          <div
            className="min-h-40"
            role="region"
            aria-label={t("console.agentTeams.detailLabel", { team: teamName(t, openedTeam) })}
            data-testid="agent-team-detail-view"
            data-team-key={openedTeam.teamKey}
          >
            {openedDetailState === null ? (
              <div className="flex min-h-40 items-center justify-center text-sm text-sub" role="status">
                {t("console.agentTeams.loadingDetail")}
              </div>
            ) : (
              <>
                {saveFeedback !== null ? (
                  <div className="mb-4"><AgentTeamSaveFeedback feedback={saveFeedback} /></div>
                ) : null}
                {actionError !== null ? (
                  <div className="mb-4 border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger" role="alert">
                    {actionError}
                  </div>
                ) : null}
                {fileManagerError !== null ? (
                  <div className="mb-4 border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger" role="alert">
                    {t("console.agentTeams.fileManagerError")}
                  </div>
                ) : null}
                <AgentTeamDetail
                  team={openedTeam}
                  state={openedDetailState}
                  providerProfiles={providerProfiles}
                  onOpenProviderSettings={onOpenProviderSettings}
                  onOpenGithubRepository={onOpenGithubRepository === undefined || openedGithubRepository === null
                    ? undefined
                    : () => onOpenGithubRepository(openedTeam.teamKey, openedGithubRepository)}
                  onRestoreRevision={onRestoreRevision === undefined
                    ? undefined
                    : (memberSlug, revisionId) => onRestoreRevision(openedTeam.teamKey, memberSlug, revisionId)}
                  teamActions={(requestGuardedAction) => openedTeam.ownership === "system" ? (
                    <div className="flex max-w-sm flex-col items-end gap-2">
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          disabled={duplicatingTeamKey !== null || onDuplicateBuiltInTeam === undefined}
                          onClick={() => requestGuardedAction(() => duplicateBuiltInTeam(openedTeam))}
                        >
                          {duplicatingTeamKey === openedTeam.teamKey ? (
                            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5} aria-hidden="true" />
                          ) : null}
                          {duplicatingTeamKey === openedTeam.teamKey
                            ? t("console.agentTeams.duplicating")
                            : t("console.agentTeams.duplicateTeam")}
                        </Button>
                        {onOpenLocation !== undefined ? (
                          <TeamMoreMenu
                            triggerLabel={t("console.agentTeams.moreActions", {
                              name: teamName(t, openedTeam),
                            })}
                            fileManagerActionLabel={resolvedFileManagerActionLabel}
                            disabled={duplicatingTeamKey !== null}
                            onOpen={onOpenLocation === undefined ? undefined : () => void openLocation(openedTeam)}
                          />
                        ) : null}
                      </div>
                      {duplicateError !== null ? (
                        <p className="text-right text-sm leading-5 text-danger" role="alert">{duplicateError}</p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <TeamMoreMenu
                        triggerLabel={t("console.agentTeams.moreActions", {
                          name: teamName(t, openedTeam),
                        })}
                        fileManagerActionLabel={resolvedFileManagerActionLabel}
                        disabled={mutationKey !== null}
                        onOpen={onOpenLocation === undefined ? undefined : () => void openLocation(openedTeam)}
                        onDuplicate={onDuplicateUserTeam === undefined
                          ? undefined
                          : () => requestGuardedAction(
                              () => prepareFileOperation({ kind: "duplicate-team", team: openedTeam }),
                            )}
                        onTrash={openedTeam.canDeleteTeam === false || onTrashUserTeam === undefined
                          ? undefined
                          : () => requestGuardedAction(
                              () => prepareFileOperation({ kind: "trash-team", team: openedTeam }),
                            )}
                      />
                    </div>
                  )}
                  memberActions={(requestGuardedAction) => selectedMember !== undefined
                    && (onOpenLocation !== undefined
                      || onDuplicateMember !== undefined
                      || onTrashMember !== undefined) ? (
                    <MemberMoreMenu
                      member={selectedMember}
                      isPrimary={selectedMember.slug === openedTeam.primaryAgentSlug}
                      disabled={mutationKey !== null}
                      fileManagerActionLabel={resolvedFileManagerActionLabel}
                      onOpen={onOpenLocation === undefined
                        ? undefined
                        : () => void openLocation(openedTeam, selectedMember.slug)}
                      onDuplicate={onDuplicateMember === undefined
                        ? undefined
                        : () => requestGuardedAction(
                            () => prepareFileOperation({
                              kind: "duplicate-member",
                              team: openedTeam,
                              member: selectedMember,
                            }),
                          )}
                      onTrash={onTrashMember === undefined
                        ? undefined
                        : () => requestGuardedAction(
                            () => prepareFileOperation({
                              kind: "trash-member",
                              team: openedTeam,
                              member: selectedMember,
                            }),
                          )}
                    />
                  ) : undefined}
                  onChangePrimaryAgent={onChangePrimaryAgent === undefined
                    ? undefined
                    : async (memberSlug) => {
                        await onChangePrimaryAgent(openedTeam.teamKey, memberSlug);
                        setSaveFeedback({ kind: "saved", teamName: teamName(t, openedTeam), savedItemCount: 1, canApplyToExistingConversation: true });
                      }}
                  readOnly={openedTeam.canEditContent === false}
                  onAddMember={openedTeam.canEditContent !== false && onAddMember !== undefined
                    ? async () => {
                        await onAddMember(openedTeam.teamKey);
                        setSaveFeedback({ kind: "saved", teamName: teamName(t, openedTeam), savedItemCount: 1, canApplyToExistingConversation: true });
                      }
                    : undefined}
                  onSelectMember={(memberSlug) => onSelectMember?.(openedTeam.teamKey, memberSlug)}
                  onChangeTeamInformation={onUpdateTeamInformation === undefined
                    ? undefined
                    : async (information) => {
                      await onUpdateTeamInformation(openedTeam.teamKey, information);
                    }}
                  onChangeMemberPortrait={onChangeMemberPortrait === undefined
                    ? undefined
                    : (memberSlug, portraitId) =>
                      onChangeMemberPortrait(openedTeam.teamKey, memberSlug, portraitId)}
                  onChangeMemberIdentity={onChangeMemberIdentity === undefined
                    ? undefined
                    : (memberSlug, identity) =>
                      onChangeMemberIdentity(openedTeam.teamKey, memberSlug, identity)}
                  onReorderMembers={onReorderMembers === undefined
                    ? undefined
                    : (memberSlugs) => onReorderMembers(openedTeam.teamKey, memberSlugs)}
                  onChangeMember={(memberSlug, agentMarkdown) => onChangeMember?.(openedTeam.teamKey, memberSlug, agentMarkdown)}
                  onSaveMember={async (memberSlug) => {
                    if (onSaveMember === undefined) return;
                    // A routine save raises no banner: the header already says "saved", and the
                    // banner is reserved for one-shot file operations whose result is news.
                    await onSaveMember(openedTeam.teamKey, memberSlug);
                  }}
                  onCheckExternalChange={openedTeam.status !== "needs-repair"
                    && onCheckMemberExternalChange !== undefined
                    ? (memberSlug) => onCheckMemberExternalChange(openedTeam.teamKey, memberSlug)
                    : undefined}
                  onLoadExternalVersion={(memberSlug) => onLoadMemberExternalVersion?.(openedTeam.teamKey, memberSlug)}
                  onOverwriteExternalVersion={(memberSlug) =>
                    onOverwriteMemberExternalVersion?.(openedTeam.teamKey, memberSlug)}
                  onRetryLoad={(memberSlug) => onRetryMember?.(openedTeam.teamKey, memberSlug)}
                  onDiscardMember={(memberSlug) => onDiscardMember?.(openedTeam.teamKey, memberSlug)}
                  onDiscardAll={() => onDiscardAll?.(openedTeam.teamKey)}
                  onSaveAll={async (profileSuccessCount = 0) => {
                    const result = await (onSaveAll?.(openedTeam.teamKey) ?? Promise.resolve({ failures: [], successCount: 0 }));
                    const savedItemCount = profileSuccessCount + (result.successCount ?? 0);
                    if (savedItemCount > 0) {
                      setSaveFeedback({ kind: "saved", teamName: teamName(t, openedTeam), savedItemCount, canApplyToExistingConversation: true });
                    }
                    return result;
                  }}
                  onSaveExecutionProfile={onSaveExecutionProfile === undefined
                    ? undefined
                    : async (memberSlug, profile) => {
                      const result = await onSaveExecutionProfile(openedTeam.teamKey, memberSlug, profile);
                      return result;
                    }}
                  onRestoreRecommendedProfile={onRestoreRecommendedProfile === undefined
                    ? undefined
                    : (memberSlug) => onRestoreRecommendedProfile(openedTeam.teamKey, memberSlug)}
                  onRecheck={onRecheckTeam === undefined ? undefined : () => onRecheckTeam(openedTeam.teamKey)}
                  onRelocate={openedTeam.ownership === "user"
                    && hasTeamLocationIssue(openedTeam)
                    && onRelocateTeam !== undefined
                    ? () => onRelocateTeam(openedTeam.teamKey)
                    : undefined}
                  onRemoveRecord={openedTeam.ownership === "user"
                    && hasTeamLocationIssue(openedTeam)
                    && onRemoveTeamRecord !== undefined
                    ? () => onRemoveTeamRecord(openedTeam.teamKey)
                    : undefined}
                  onLeave={returnToList}
                />
              </>
            )}
          </div>
        ) : (
          <>
            <AgentTeamsPageHeading
              title={t("console.agentTeams.title")}
              titleId="agent-teams-title"
              description={t("console.agentTeams.description")}
              backLabel={t("console.agentTeams.returnConversation")}
              onBack={onBack}
              actions={state.status === "ready" && (onCreateTeam !== undefined || aiTeamBuilder !== undefined || onDiscoverTeams !== undefined) ? (
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {onDiscoverTeams !== undefined ? (
                    <Button type="button" variant="outline" className="shrink-0" onClick={onDiscoverTeams}>
                      <Search className="mr-1.5 h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                      {t("console.agentTeams.findExistingTeam")}
                    </Button>
                  ) : null}
                  {onCreateTeam !== undefined || aiTeamBuilder !== undefined ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" className="shrink-0">
                          <Plus className="mr-1.5 h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                          {t("console.agentTeams.newTeam")}
                          <ChevronDown className="ml-1.5 h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem disabled={aiTeamBuilder === undefined} onSelect={openAiBuilder}>
                          <Sparkles className="mr-2 h-3.5 w-3.5 text-accent" strokeWidth={1.5} aria-hidden="true" />
                          {t("console.agentTeams.buildWithAi")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={onCreateTeam === undefined}
                          onSelect={() => setView({
                            kind: "information-dialog",
                            mode: "create",
                            returnView: { kind: "list" },
                          })}
                        >
                          <Plus className="mr-2 h-3.5 w-3.5 text-sub" strokeWidth={1.5} aria-hidden="true" />
                          {t("console.agentTeams.startBlank")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              ) : null}
            />

            {state.status === "loading" ? <AgentTeamsLoading /> : null}
            {state.status === "error" ? (
              <AgentTeamsFailure
                title={t("console.agentTeams.loadFailed")}
                description={t("console.agentTeams.loadFailedDescription")}
                onRetry={onRetry}
              />
            ) : null}
            {state.status === "configuration-error" ? (
              <AgentTeamsFailure
                title={t("console.agentTeams.configurationError")}
                description={t("console.agentTeams.configurationErrorDescription")}
                onRetry={onRetry}
              />
            ) : null}
            {state.status === "ready" ? (
              <div
                className="mt-8 min-h-40"
                aria-label={t("console.agentTeams.dataLoaded")}
                data-testid="agent-teams-data-container"
                data-team-count={state.teams.length}
                data-selected-team-key={selectedTeamKey ?? undefined}
                data-selected-member-slug={selectedMemberSlug ?? undefined}
              >
                {saveFeedback !== null ? <div className="mb-6"><AgentTeamSaveFeedback feedback={saveFeedback} /></div> : null}
                {(state.registrationIssues?.length ?? 0) > 0 ? (
                  <div
                    className="mb-6 border border-warning/35 bg-warning/5 p-4"
                    role="alert"
                    data-testid="agent-team-registration-conflict"
                  >
                    <div className="flex gap-3">
                      <AlertTriangle
                        className="mt-0.5 h-4 w-4 shrink-0 text-warning"
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-normal text-ink">
                          {t("console.agentTeams.registrationConflictTitle")}
                        </p>
                        <ul className="mt-2 space-y-1 text-sm leading-5 text-sub">
                          {state.registrationIssues?.map((issue) => (
                            <li key={issue.kind}>
                              {t(issue.kind === "stable-identity"
                                ? "console.agentTeams.registrationStableIdentityConflict"
                                : "console.agentTeams.registrationDirectoryConflict")}
                            </li>
                          ))}
                        </ul>
                        {actionError !== null ? (
                          <p className="mt-3 text-sm text-danger" role="alert">{actionError}</p>
                        ) : null}
                        <div className="mt-4 flex flex-wrap gap-2">
                          {state.registrationIssues?.some((issue) => issue.kind === "stable-identity")
                            && onViewRegistrationConflictTeam !== undefined ? (
                              <Button type="button" variant="outline" size="sm" onClick={onViewRegistrationConflictTeam}>
                                {t("console.agentTeams.viewConflictingTeam")}
                              </Button>
                            ) : null}
                          {state.registrationIssues?.some((issue) => issue.kind === "directory")
                            && onShowRegistrationConflictLocation !== undefined ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void onShowRegistrationConflictLocation()}
                              >
                                <FolderOpen className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                                {t("console.agentTeams.viewConflictInFinder")}
                              </Button>
                            ) : null}
                          <Button
                            type="button"
                            size="sm"
                            disabled={registrationRecoveryPending
                              || onPreserveRegistrationConflicts === undefined
                              || state.registrationIssues?.some((issue) => !issue.canPreserve)}
                            onClick={() => void preserveRegistrationConflicts()}
                          >
                            {registrationRecoveryPending ? (
                              <LoaderCircle
                                className="mr-1.5 h-3.5 w-3.5 animate-spin"
                                strokeWidth={1.5}
                                aria-hidden="true"
                              />
                            ) : null}
                            {t(registrationRecoveryPending
                              ? "console.agentTeams.addingOfficialAssistant"
                              : "console.agentTeams.preserveAndAddOfficialAssistant")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
                {state.teams.length === 0 ? (
                  <div
                    className="rounded-xl border border-line bg-card px-5 py-10 text-center"
                    data-testid="agent-teams-empty"
                  >
                    <p className="text-sm font-normal text-ink">{t("console.agentTeams.emptyTitle")}</p>
                    <p className="mt-1.5 text-sm leading-6 text-sub">
                      {t("console.agentTeams.emptyDescription")}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-7" data-testid="agent-team-list">
                    {teamGroups(state.teams).map((group) => (
                      <section key={group.kind} data-testid="agent-team-group" data-group={group.kind}>
                        <h2 className="mb-2.5 flex items-center gap-2 text-sm font-normal text-sub">
                          {t(group.kind === "github"
                            ? "console.agentTeams.groupGithubSource"
                            : "console.agentTeams.groupLocalOnly")}
                          <span className="tabular-nums text-hint">{group.teams.length}</span>
                        </h2>
                        <div
                          className={cn(
                            "grid gap-3",
                            // Column count follows available width, not team count: a card
                            // has a minimum readable width and the container fits as many as
                            // it can. Keying off count instead let a lone team stretch to the
                            // full 960px measure, far past what its content can fill.
                            useStackedRows
                              ? "grid-cols-1"
                              : "grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))]",
                          )}
                        >
                          {group.teams.map((team) => (
                            <AgentTeamRow
                              key={team.teamKey}
                              team={team}
                              useStackedLayout={useStackedRows}
                              onOpen={() => openTeam(team.teamKey)}
                              onOpenGithubRepository={onOpenGithubRepository === undefined || githubRepository(team) === null
                                ? undefined
                                : () => onOpenGithubRepository(team.teamKey, githubRepository(team)!)}
                            />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </>
        )}
      {view.kind === "information-dialog" && view.mode === "create" && onCreateTeam !== undefined ? (
        <TeamInformationDialog
          title={t("console.agentTeams.newTeam")}
          description={t("console.agentTeams.createDescription")}
          confirmLabel={t("console.agentTeams.createTeam")}
          initialValue={{ name: "", description: "" }}
          onCancel={() => setView(view.returnView)}
          onConfirm={async (information) => {
            const team = await onCreateTeam(information);
            listScrollTopRef.current = scrollContainerRef.current?.scrollTop ?? 0;
            setView({ kind: "team-detail", teamKey: team.teamKey });
            if (scrollContainerRef.current !== null) {
              scrollContainerRef.current.scrollTop = 0;
            }
          }}
        />
      ) : null}

      {view.kind === "information-dialog" && view.mode === "edit" && onUpdateTeamInformation !== undefined ? (
        <TeamInformationDialog
          title={t("console.agentTeams.editTeam")}
          description={t("console.agentTeams.editDescription")}
          confirmLabel={t("console.agentTeams.save")}
          initialValue={{
            name: view.team.name ?? "",
            description: view.team.description ?? "",
          }}
          onCancel={() => setView(view.returnView)}
          onConfirm={async (information) => {
            await onUpdateTeamInformation(view.team.teamKey, information);
            setSaveFeedback({ kind: "saved", teamName: information.name, savedItemCount: 1, canApplyToExistingConversation: true });
            setView(view.returnView);
          }}
        />
      ) : null}

      {confirmationOperation !== null ? (
        <TrashConfirmationDialog
          operation={confirmationOperation}
          pending={mutationKey !== null}
          onCancel={() => setConfirmationOperation(null)}
          onConfirm={() => void executeFileOperation(confirmationOperation)}
        />
      ) : null}
    </AgentTeamsPageSurface>
  );
}

function TeamMoreMenu({
  triggerLabel,
  fileManagerActionLabel,
  disabled,
  onOpen,
  onDuplicate,
  onTrash,
}: {
  triggerLabel: string;
  fileManagerActionLabel: string;
  disabled: boolean;
  onOpen?: () => void;
  onDuplicate?: () => void;
  onTrash?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/*
          Icon only, matching the member's own ···. This used to also spell out "More", but all
          three entries act on the object itself — open its location, copy it, delete it — while
          "More" suggests there is more of the screen to see. It said nothing about what the menu
          was, and left two identically named buttons with different scopes on one page. Scope is
          carried by the accessible name and by placement instead.
        */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={triggerLabel}
          data-testid="agent-team-more-menu-trigger"
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onOpen !== undefined ? (
          <DropdownMenuItem onSelect={onOpen}>
            <FolderOpen className="mr-2 h-3.5 w-3.5 text-sub" strokeWidth={1.5} aria-hidden="true" />
            {fileManagerActionLabel}
          </DropdownMenuItem>
        ) : null}
        {onDuplicate !== undefined ? (
          <DropdownMenuItem onSelect={onDuplicate}>
            <Copy className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            {t("console.agentTeams.duplicateTeam")}
          </DropdownMenuItem>
        ) : null}
        {(onOpen !== undefined || onDuplicate !== undefined) && onTrash !== undefined ? <DropdownMenuSeparator /> : null}
        {onTrash !== undefined ? (
          <DropdownMenuItem className="text-danger focus:text-danger" onSelect={onTrash}>
            <Trash2 className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            {t("console.agentTeams.moveToTrash")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MemberMoreMenu({
  member,
  isPrimary,
  disabled,
  fileManagerActionLabel,
  onOpen,
  onDuplicate,
  onTrash,
}: {
  member: OperatorAgentTeamMember;
  isPrimary: boolean;
  disabled: boolean;
  fileManagerActionLabel: string;
  onOpen?: () => void;
  onDuplicate?: () => void;
  onTrash?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={t("console.agentTeams.moreActions", {
            name: member.displayName || `@${member.slug}`,
          })}
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onOpen !== undefined ? (
          <DropdownMenuItem onSelect={onOpen}>
            <FolderOpen className="mr-2 h-3.5 w-3.5 text-sub" strokeWidth={1.5} aria-hidden="true" />
            {fileManagerActionLabel}
          </DropdownMenuItem>
        ) : null}
        {onDuplicate !== undefined ? (
          <DropdownMenuItem onSelect={onDuplicate}>
            <Copy className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            {t("console.agentTeams.duplicateAgent")}
          </DropdownMenuItem>
        ) : null}
        {(onOpen !== undefined || onDuplicate !== undefined) && onTrash !== undefined ? <DropdownMenuSeparator /> : null}
        {onTrash !== undefined ? (
          <DropdownMenuItem
            disabled={isPrimary}
            className="text-danger focus:text-danger"
            onSelect={onTrash}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            {isPrimary
              ? t("console.agentTeams.deletePrimaryDisabled")
              : t("console.agentTeams.deleteAgent")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TrashConfirmationDialog({
  operation,
  pending,
  onCancel,
  onConfirm,
}: {
  operation: AgentTeamTrashOperation;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const isTeam = operation.kind === "trash-team";
  const title = isTeam
    ? t("console.agentTeams.trashTeamTitle", { team: teamName(t, operation.team) })
    : t("console.agentTeams.deleteAgentTitle", {
        agent: operation.member.displayName || `@${operation.member.slug}`,
      });
  return (
    <DialogFrame label={title} dismissible={!pending} onDismiss={onCancel}>
      <h2 className="text-base font-semibold">{title}</h2>
      {isTeam ? (
        <>
          <p className="mt-2 text-sm leading-6 text-sub">
            {t("console.agentTeams.trashTeamDetail", {
              count: operation.team.members.length,
              members: operation.team.members
                .map((member) => member.displayName || `@${member.slug}`)
                .join(t("console.agentTeams.memberSeparator"))
                || t("console.agentTeams.noMembers"),
            })}
          </p>
          <p className="mt-2 text-sm leading-6 text-sub">
            {t("console.agentTeams.trashTeamHistory")}
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm leading-6 text-sub">
            {t("console.agentTeams.trashAgentDetail")}
          </p>
          <p className="mt-2 text-sm leading-6 text-sub">
            {t("console.agentTeams.trashAgentHandoff", { slug: operation.member.slug })}
          </p>
        </>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
          {t("console.agentTeams.cancel")}
        </Button>
        <Button type="button" variant="danger" disabled={pending} onClick={onConfirm}>
          {pending
            ? t("console.agentTeams.movingToTrash")
            : isTeam
              ? t("console.agentTeams.moveToTrash")
              : t("console.agentTeams.deleteAgent")}
        </Button>
      </div>
    </DialogFrame>
  );
}

function DialogFrame({
  label,
  dismissible,
  onDismiss,
  children,
}: {
  label: string;
  dismissible: boolean;
  onDismiss: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-layer-modal-backdrop flex items-center justify-center bg-black/30 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissible) {
          onDismiss();
        }
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-line bg-card p-5 text-ink" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

function fileOperationKey(operation: AgentTeamFileOperation): string {
  return `${operation.kind}:${operation.team.teamKey}:${"member" in operation ? operation.member.slug : "team"}`;
}

function TeamInformationDialog({
  title,
  description,
  confirmLabel,
  initialValue,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  initialValue: AgentTeamInformationInput;
  onCancel: () => void;
  onConfirm: (information: AgentTeamInformationInput) => Promise<void>;
}): JSX.Element {
  const { t } = useI18n();
  const [name, setName] = useState(initialValue.name);
  const [teamDescription, setTeamDescription] = useState(initialValue.description);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = name.trim().length > 0 && teamDescription.trim().length > 0 && !pending;

  const submit = async () => {
    if (!canSubmit) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onConfirm({ name: name.trim(), description: teamDescription.trim() });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
      setPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-layer-modal-backdrop flex items-center justify-center bg-black/30 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) {
          onCancel();
        }
      }}
    >
      <form
        className="w-full max-w-md rounded-lg border border-line bg-card p-5 text-ink"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-sub">{description}</p>
        <div className="mt-5 grid gap-4">
          <label className="grid gap-1.5 text-sm font-normal text-ink">
            {t("console.agentTeams.teamName")}
            <Input
              autoFocus
              value={name}
              disabled={pending}
              maxLength={80}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-normal text-ink">
            {t("console.agentTeams.shortDescription")}
            <Input
              value={teamDescription}
              disabled={pending}
              maxLength={160}
              onChange={(event) => setTeamDescription(event.currentTarget.value)}
            />
          </label>
        </div>
        {error !== null ? <p className="mt-3 text-sm text-danger" role="alert">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
            {t("console.agentTeams.cancel")}
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {pending ? t("console.agentTeams.saving") : confirmLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}

function AgentTeamRow({
  team,
  useStackedLayout,
  onOpen,
  onOpenGithubRepository,
}: {
  team: OperatorAgentTeam;
  useStackedLayout: boolean;
  onOpen: () => void;
  onOpenGithubRepository?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const orderedMembers = orderTeamMembers(team);
  const primaryAgent = orderedMembers.find((member) => member.slug === team.primaryAgentSlug);
  const showAllMembers = team.status !== "needs-repair";
  const sourceRepository = githubRepository(team);

  return (
    <article
      className={cn(
        "group relative flex h-full w-full flex-col rounded-xl border border-line bg-card p-4 text-left",
        "transition-colors hover:bg-hover",
      )}
      data-testid="agent-team-row"
      data-team-key={team.teamKey}
      data-layout={useStackedLayout ? "narrow" : "wide"}
      data-can-create-conversation={team.canCreateConversation ? "true" : "false"}
      onClick={onOpen}
    >
      <button
        type="button"
        className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        aria-label={teamName(t, team)}
      />
      <span className="pointer-events-none relative flex min-w-0 items-start gap-3">
        {primaryAgent === undefined || team.status === "needs-repair" ? (
          <span
            aria-hidden="true"
            className="inline-flex h-14 w-14 shrink-0 rounded-lg border border-dashed border-line-strong"
          />
        ) : (
          <AgentPortrait
            size="hero"
            shape="squircle"
            displayName={primaryAgent.displayName}
            slug={primaryAgent.slug}
            portraitId={primaryAgent.portraitId}
            engine={memberEngine(primaryAgent)}
            className="rounded-lg"
            title={teamName(t, team)}
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="max-w-full truncate text-lg font-semibold leading-6 tracking-[-0.01em] text-ink">
              {teamName(t, team)}
            </span>
            {team.installationSource?.provider === "moebius"
              ? <TeamStatusBadge kind="official" />
              : null}
            {team.status === "unfinished-draft" ? <TeamStatusBadge kind="unfinished" /> : null}
            {team.status === "needs-repair" ? <TeamStatusBadge kind="needs-repair" /> : null}
          </span>
          <span className="mt-1 line-clamp-2 text-sm leading-5 text-sub">
            {teamDescription(t, team)}
          </span>
          {sourceRepository !== null ? (
            onOpenGithubRepository === undefined ? (
              <span className="mt-2 block truncate font-mono text-xs text-sub">{sourceRepository}</span>
            ) : (
              <button
                type="button"
                aria-label={t("console.agentTeams.githubRepository", { repository: sourceRepository })}
                className="pointer-events-auto relative mt-2 inline-flex max-w-full items-center gap-1 font-mono text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenGithubRepository();
                }}
              >
                <span className="truncate">{sourceRepository}</span>
                <ExternalLink className="h-3 w-3 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              </button>
            )
          ) : null}
        </span>
      </span>

      <span className="pointer-events-none relative mt-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 pt-4">
        <span data-testid="agent-team-members">
          {showAllMembers ? (
            // The primary agent already owns the big portrait above; repeating it here
            // is the same face twice in one card. This strip answers "who else".
            <AgentMemberStack
              members={withEngines(orderedMembers.filter((member) => member.slug !== team.primaryAgentSlug))}
              primarySlug={team.primaryAgentSlug}
              allMembers={withEngines(orderedMembers)}
              limit={5}
            />
          ) : (
            <span className="text-sm leading-5 text-sub">
              {t("console.agentTeams.membersUnavailable")}
            </span>
          )}
        </span>
        <span className="min-w-0 truncate text-sm text-hint">
          {teamMetaLine(t, team, primaryAgent?.displayName)}
        </span>

      </span>
    </article>
  );
}

function TeamStatusBadge({ kind }: {
  kind: "official" | "unfinished" | "needs-repair";
}): JSX.Element {
  const { t } = useI18n();
  const label = kind === "official"
    ? t("console.agentTeams.official")
    : kind === "unfinished"
      ? t("console.agentTeams.unfinished")
      : t("console.agentTeams.needsRepair");
  return (
    <span
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center rounded-full border px-2 text-xs font-normal",
        kind === "needs-repair"
          ? "border-[var(--status-danger-line)] bg-[var(--status-danger-bg)] text-danger"
          : kind === "unfinished"
            ? "border-line-strong text-hint"
            : "border-line-strong bg-sunken text-sub",
      )}
    >
      {label}
    </span>
  );
}

function orderTeamMembers(team: OperatorAgentTeam): OperatorAgentTeamMember[] {
  const membersBySlug = new Map(team.members.map((member) => [member.slug, member]));
  const orderedSlugs = [
    ...(team.primaryAgentSlug === null ? [] : [team.primaryAgentSlug]),
    ...team.memberOrder,
    ...team.members.map((member) => member.slug),
  ];
  const seen = new Set<string>();
  const orderedMembers: OperatorAgentTeamMember[] = [];
  for (const slug of orderedSlugs) {
    const member = membersBySlug.get(slug);
    if (member !== undefined && !seen.has(slug)) {
      seen.add(slug);
      orderedMembers.push(member);
    }
  }
  return orderedMembers;
}

function teamName(t: Translate, team: OperatorAgentTeam): string {
  return team.name?.trim() || t("console.agentTeams.unnamed");
}

function teamDescription(t: Translate, team: OperatorAgentTeam): string {
  if (team.description?.trim()) {
    return team.description;
  }
  if (team.status === "unfinished-draft") {
    return t("console.agentTeams.noReceivingAgent");
  }
  if (team.status === "needs-repair") {
    return t("console.agentTeams.filesUnavailable");
  }
  return t("console.agentTeams.noDescription");
}

function teamMetaLine(
  t: Translate,
  team: OperatorAgentTeam,
  primaryAgentName?: string,
): string {
  if (team.status === "needs-repair") {
    return t("console.agentTeams.cannotCreateConversation");
  }
  const count = team.members.length;
  if (primaryAgentName !== undefined) {
    return t("console.agentTeams.teamMetaPrimary", { primary: primaryAgentName, count });
  }
  if (team.status === "unfinished-draft") {
    return t("console.agentTeams.teamMetaUnset", { count });
  }
  return t("console.agentTeams.teamMetaUnavailable", { count });
}

/** The engine a member actually runs on, shaped for the avatar mark. */
function memberEngine(member: OperatorAgentTeamMember): { cli: ExecutionEngine; providerId?: string } | undefined {
  const profile = member.executionProfile?.effectiveProfile;
  if (profile === undefined) {
    return undefined;
  }
  return {
    cli: profile.cli,
    providerId: "providerId" in profile ? profile.providerId : undefined,
  };
}

function withEngines(members: readonly OperatorAgentTeamMember[]): Array<{
  slug: string;
  displayName: string;
  engine?: { cli: ExecutionEngine; providerId?: string };
}> {
  return members.map((member) => ({
    slug: member.slug,
    displayName: member.displayName,
    engine: memberEngine(member),
  }));
}

/** Teams with a recorded GitHub source first, local-only teams second; empty groups are dropped. */
function teamGroups(teams: readonly OperatorAgentTeam[]): Array<{
  kind: "github" | "local";
  teams: OperatorAgentTeam[];
}> {
  return (["github", "local"] as const)
    .map((kind) => ({
      kind,
      teams: teams.filter((team) => kind === "github"
        ? team.installationSource?.provider === "github"
        : team.installationSource?.provider !== "github"),
    }))
    .filter((group) => group.teams.length > 0);
}

function githubRepository(team: OperatorAgentTeam | undefined): string | null {
  const source = team?.installationSource;
  return source?.provider === "github" ? source.repository : null;
}

function hasTeamLocationIssue(team: OperatorAgentTeam): boolean {
  return (team.issues ?? []).some((issue) =>
    issue.code === "team-directory-missing" || issue.code === "team-directory-unreadable");
}

function AgentTeamsLoading(): JSX.Element {
  const { t } = useI18n();
  return (
    <div
      className="mt-8 overflow-hidden rounded-xl border border-line bg-card"
      role="status"
      aria-label={t("console.agentTeams.loading")}
    >
      <div className="h-[38px] border-b border-line bg-sunken" />
      <div className="divide-y divide-line">
        {[0, 1].map((index) => (
          <div
            key={index}
            className="flex animate-pulse items-start gap-4 px-5 py-3.5"
            data-testid="agent-team-loading-row"
          >
            <div className="mt-0.5 h-8 w-8 shrink-0 rounded-full bg-hover" />
            <div className="min-w-0 flex-1 space-y-2.5">
              <div className="h-5 w-36 rounded bg-hover" />
              <div className="h-3 w-64 max-w-full rounded bg-hover" />
              <div className="h-3 w-28 rounded bg-hover" />
            </div>
            <div className="flex w-[160px] shrink-0 items-center gap-1.5">
              <div className="h-7 w-7 rounded-full bg-hover" />
              <div className="h-7 w-7 rounded-full bg-hover" />
              <div className="h-7 w-7 rounded-full bg-hover" />
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">{t("console.agentTeams.readingInformation")}</span>
    </div>
  );
}

function AgentTeamsFailure({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="mt-8 rounded-lg border border-line bg-rail p-5" role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" strokeWidth={1.5} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-normal text-ink">{title}</p>
          <p className="mt-1 text-sm leading-6 text-sub">{description}</p>
          <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}>
            {t("console.agentTeams.retry")}
          </Button>
        </div>
      </div>
    </div>
  );
}
