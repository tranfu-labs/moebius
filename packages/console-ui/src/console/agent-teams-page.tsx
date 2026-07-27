import {
  AlertTriangle,
  ChevronDown,
  Copy,
  FolderOpen,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import {
  TeamBuilderView,
  type TeamBuilderViewState,
} from "@/ai-team-builder/team-builder-view";
import { AgentInitialAvatar } from "@/console/agent-initial-avatar";
import {
  AgentTeamDetail,
  type AgentExecutionProfile,
  type AgentExecutionProfileDocument,
  type AgentOfficialUpdateResult,
  type AgentOfficialManagementState,
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
  executionProfile?: AgentTeamDetailMember["executionProfile"];
}

export interface OperatorAgentTeamRelayBeat {
  speakerSlug: string;
  message: string;
}

export type OperatorAgentTeamOnboardingOrchestration =
  | { status: "ready"; relayBeats: OperatorAgentTeamRelayBeat[] }
  | { status: "unavailable" };

export interface OperatorAgentTeam {
  teamKey: string;
  id: string;
  ownership: "system" | "user";
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
  officialManagement?: AgentOfficialManagementState;
}

export type OperatorAgentTeamsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "configuration-error" }
  | { status: "ready"; teams: OperatorAgentTeam[] };

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
  selectedMemberSlug,
  detailState,
  useStackedRows,
  aiTeamBuilder,
  onRetry,
  onCreateTeam,
  onOpenTeam,
  onCloseTeam,
  onSelectMember,
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
  onApplyOfficialUpdate,
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
  onBack,
}: {
  state: OperatorAgentTeamsState;
  selectedTeamKey?: string | null;
  selectedMemberSlug?: string | null;
  detailState?: AgentTeamDetailState | null;
  useStackedRows: boolean;
  aiTeamBuilder?: AgentTeamBuilderController;
  onRetry?: () => void;
  onCreateTeam?: (information: AgentTeamInformationInput) => Promise<OperatorAgentTeam>;
  onOpenTeam?: (teamKey: string) => void;
  onCloseTeam?: () => void;
  onSelectMember?: (teamKey: string, memberSlug: string) => void;
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
  onSaveAll?: (teamKey: string) => Promise<{ failures: AgentTeamSaveAllFailureView[] }>;
  onSaveExecutionProfile?: (
    teamKey: string,
    memberSlug: string,
    profile: AgentExecutionProfile,
  ) => Promise<AgentExecutionProfileDocument>;
  onRestoreRecommendedProfile?: (
    teamKey: string,
    memberSlug: string,
  ) => Promise<AgentExecutionProfileDocument>;
  onApplyOfficialUpdate?: (teamKey: string) => Promise<AgentOfficialUpdateResult>;
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
  onBack: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const resolvedFileManagerActionLabel = fileManagerActionLabel ?? t("console.agentTeams.openInFileManager");
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const listScrollTopRef = useRef(0);
  const pendingListScrollRestoreRef = useRef(false);
  const [view, setView] = useState<AgentTeamsPageView>({ kind: "list" });
  const [duplicatingTeamKey, setDuplicatingTeamKey] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [fileManagerError, setFileManagerError] = useState<"team" | "member" | null>(null);
  const [confirmationOperation, setConfirmationOperation] = useState<AgentTeamTrashOperation | null>(null);
  const [mutationKey, setMutationKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const contentView = view.kind === "information-dialog" ? view.returnView : view;
  const openedTeamKey = contentView.kind === "team-detail" ? contentView.teamKey : null;
  const openedTeam = state.status === "ready"
    ? state.teams.find((team) => team.teamKey === openedTeamKey)
    : undefined;
  const openedDetailState = detailState !== undefined
    && detailState !== null
    && detailState.teamKey === openedTeam?.teamKey
    ? detailState
    : null;
  const selectedMember = openedTeam?.members.find(
    (member) => member.slug === openedDetailState?.selectedMemberSlug,
  );

  const openTeam = (teamKey: string) => {
    listScrollTopRef.current = scrollContainerRef.current?.scrollTop ?? 0;
    setDuplicateError(null);
    setFileManagerError(null);
    setActionError(null);
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
      } else if (operation.kind === "trash-member") {
        if (onTrashMember === undefined) {
          throw new Error(t("console.agentTeams.deleteAgentUnavailable"));
        }
        await onTrashMember(operation.team.teamKey, operation.member.slug);
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

  return (
    <section
      ref={scrollContainerRef}
      className="scroll-thin min-h-0 flex-1 overflow-auto px-4 pb-12 pt-16 sm:px-8"
      aria-labelledby={contentView.kind === "list" ? "agent-teams-title" : undefined}
    >
      <div className="mx-auto max-w-[960px]">
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
                  teamActions={(requestGuardedAction) => openedTeam.ownership === "system" ? (
                    <div className="flex max-w-sm flex-col items-end gap-2">
                      <div className="flex items-center gap-2">
                        {openedTeam.canEditContent !== false && onUpdateTeamInformation !== undefined ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => requestGuardedAction(() => setView({
                                kind: "information-dialog",
                                mode: "edit",
                                team: openedTeam,
                                returnView: { kind: "team-detail", teamKey: openedTeam.teamKey },
                              }))}
                          >
                            {t("console.agentTeams.editInformation")}
                          </Button>
                        ) : null}
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
                            onOpen={() => void openLocation(openedTeam)}
                          />
                        ) : null}
                      </div>
                      {duplicateError !== null ? (
                        <p className="text-right text-sm leading-5 text-danger" role="alert">{duplicateError}</p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {openedTeam.canEditContent !== false && onUpdateTeamInformation !== undefined ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => requestGuardedAction(() => setView({
                              kind: "information-dialog",
                              mode: "edit",
                              team: openedTeam,
                              returnView: { kind: "team-detail", teamKey: openedTeam.teamKey },
                            }))}
                        >
                          {t("console.agentTeams.editInformation")}
                        </Button>
                      ) : null}
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
                    : (memberSlug) => onChangePrimaryAgent(openedTeam.teamKey, memberSlug)}
                  readOnly={openedTeam.canEditContent === false}
                  onAddMember={openedTeam.canEditContent !== false && onAddMember !== undefined
                    ? () => onAddMember(openedTeam.teamKey)
                    : undefined}
                  onSelectMember={(memberSlug) => onSelectMember?.(openedTeam.teamKey, memberSlug)}
                  onChangeMember={(memberSlug, agentMarkdown) => onChangeMember?.(openedTeam.teamKey, memberSlug, agentMarkdown)}
                  onSaveMember={(memberSlug) => onSaveMember?.(openedTeam.teamKey, memberSlug)}
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
                  onSaveAll={() => onSaveAll?.(openedTeam.teamKey) ?? Promise.resolve({ failures: [] })}
                  onSaveExecutionProfile={onSaveExecutionProfile === undefined
                    ? undefined
                    : (memberSlug, profile) =>
                      onSaveExecutionProfile(openedTeam.teamKey, memberSlug, profile)}
                  onRestoreRecommendedProfile={onRestoreRecommendedProfile === undefined
                    ? undefined
                    : (memberSlug) => onRestoreRecommendedProfile(openedTeam.teamKey, memberSlug)}
                  onApplyOfficialUpdate={openedTeam.ownership === "system" && onApplyOfficialUpdate !== undefined
                    ? () => onApplyOfficialUpdate(openedTeam.teamKey)
                    : undefined}
                  onOpenCopiedTeam={(teamId) => {
                    const teamKey = `user:${teamId}`;
                    if (state.status !== "ready"
                      || !state.teams.some((team) => team.teamKey === teamKey)) {
                      return;
                    }
                    setView({ kind: "team-detail", teamKey });
                    onOpenTeam?.(teamKey);
                  }}
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
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 text-xs font-medium text-hint">{t("console.agentTeams.appManagement")}</p>
                <h1 id="agent-teams-title" className="text-2xl font-semibold tracking-[-0.02em] text-ink">
                  {t("console.agentTeams.title")}
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-sub">
                  {t("console.agentTeams.description")}
                </p>
              </div>
              {state.status === "ready" && (onCreateTeam !== undefined || aiTeamBuilder !== undefined) ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" className="mt-6 shrink-0">
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
                <div className="divide-y divide-line border-y border-line" data-testid="agent-team-list">
                  {state.teams.map((team) => (
                    <AgentTeamRow
                      key={team.teamKey}
                      team={team}
                      useStackedLayout={useStackedRows}
                      onOpen={() => openTeam(team.teamKey)}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            <Button type="button" variant="outline" className="mt-6" onClick={onBack}>
              {t("console.agentTeams.returnConversation")}
            </Button>
          </>
        )}
      </div>

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
    </section>
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
        <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={triggerLabel}>
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          {t("console.agentTeams.more")}
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissible) {
          onDismiss();
        }
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-line bg-card p-5 text-ink" role="dialog" aria-modal="true" aria-label={label}>
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) {
          onCancel();
        }
      }}
    >
      <form
        className="w-full max-w-md rounded-xl border border-line bg-card p-5 text-ink"
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
          <label className="grid gap-1.5 text-sm font-medium text-ink">
            {t("console.agentTeams.teamName")}
            <Input
              autoFocus
              value={name}
              disabled={pending}
              maxLength={80}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-ink">
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
}: {
  team: OperatorAgentTeam;
  useStackedLayout: boolean;
  onOpen: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const orderedMembers = orderTeamMembers(team);
  const visibleMemberLimit = 3;
  const visibleMembers = orderedMembers.slice(0, visibleMemberLimit);
  const hiddenMemberCount = Math.max(0, orderedMembers.length - visibleMembers.length);
  const primaryAgent = orderedMembers.find((member) => member.slug === team.primaryAgentSlug);

  return (
    <button
      type="button"
      className={cn(
        "group grid w-full text-left transition-colors hover:bg-hover focus-visible:bg-hover",
        useStackedLayout
          ? "grid-cols-1"
          : "grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]",
      )}
      data-testid="agent-team-row"
      data-team-key={team.teamKey}
      data-layout={useStackedLayout ? "narrow" : "wide"}
      data-can-create-conversation={team.canCreateConversation ? "true" : "false"}
      onClick={onOpen}
    >
      <span className="min-w-0 px-5 py-5">
        <span className="flex min-w-0 items-start gap-2">
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">
            {teamName(t, team)}
          </span>
          <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
            {team.ownership === "system" ? <TeamStatusBadge kind="official" /> : null}
            {team.officialManagement?.customizationStatus === "customized"
              ? <TeamStatusBadge kind="customized" />
              : null}
            {team.officialManagement?.updateStatus === "available"
              ? <TeamStatusBadge kind="update" />
              : null}
            {team.status === "unfinished-draft" ? <TeamStatusBadge kind="unfinished" /> : null}
            {team.status === "needs-repair" ? <TeamStatusBadge kind="needs-repair" /> : null}
          </span>
        </span>
        <span className="mt-2 block line-clamp-2 text-sm leading-5 text-sub">
          {teamDescription(t, team)}
        </span>
        <span className="mt-3 block text-xs text-hint">
          {teamMemberSummary(t, team, primaryAgent?.displayName)}
        </span>
      </span>

      <span
        className={cn(
          "flex min-w-0 items-center gap-2 px-5 py-5",
          useStackedLayout ? "border-t border-line pt-4" : "border-l border-line",
        )}
        data-testid="agent-team-members"
      >
        {team.status === "needs-repair" ? (
          <span className="text-sm text-sub">{t("console.agentTeams.membersUnavailable")}</span>
        ) : visibleMembers.map((member) => {
          const isPrimary = member.slug === team.primaryAgentSlug;
          return (
            <span
              key={member.slug}
              className="inline-flex h-8 w-28 shrink-0 items-center rounded-md border border-line bg-canvas px-2 text-xs font-normal text-ink"
              title={member.displayName}
            >
              <AgentInitialAvatar displayName={member.displayName} slug={member.slug} className="mr-1.5" />
              <span className="min-w-0 flex-1 truncate">{member.displayName}</span>
              {isPrimary ? (
                <span className="ml-1 whitespace-nowrap text-hint">
                  {t("console.agentTeams.primarySuffix")}
                </span>
              ) : null}
            </span>
          );
        })}
        {team.status !== "needs-repair" && hiddenMemberCount > 0 ? (
          <span
            className="inline-flex h-8 shrink-0 items-center rounded-md border border-line bg-canvas px-2.5 text-xs font-normal text-sub"
            aria-label={t("console.agentTeams.moreMembers", { count: hiddenMemberCount })}
          >
            ＋{hiddenMemberCount}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function TeamStatusBadge({ kind }: {
  kind: "official" | "customized" | "update" | "unfinished" | "needs-repair";
}): JSX.Element {
  const { t } = useI18n();
  const label = kind === "official"
    ? t("console.agentTeams.official")
    : kind === "customized"
      ? t("console.agentTeams.customized")
      : kind === "update"
        ? t("console.agentTeams.updateAvailable")
        : kind === "unfinished"
          ? t("console.agentTeams.unfinished")
          : t("console.agentTeams.needsRepair");
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-sm border px-1.5 text-[11px] font-medium",
        kind === "needs-repair"
          ? "border-[var(--status-danger-line)] bg-[var(--status-danger-bg)] text-danger"
          : kind === "unfinished" || kind === "customized"
            ? "border-line-strong bg-sunken text-sub"
            : "border-line bg-canvas text-sub",
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

function teamMemberSummary(
  t: Translate,
  team: OperatorAgentTeam,
  primaryAgentName?: string,
): string {
  if (team.status === "needs-repair") {
    return t("console.agentTeams.cannotCreateConversation");
  }
  if (primaryAgentName !== undefined) {
    return t("console.agentTeams.memberSummaryPrimary", {
      count: team.members.length,
      primary: primaryAgentName,
    });
  }
  if (team.status === "unfinished-draft") {
    return t("console.agentTeams.memberSummaryUnset", { count: team.members.length });
  }
  return t("console.agentTeams.memberSummaryUnavailable", { count: team.members.length });
}

function hasTeamLocationIssue(team: OperatorAgentTeam): boolean {
  return (team.issues ?? []).some((issue) =>
    issue.code === "team-directory-missing" || issue.code === "team-directory-unreadable");
}

function AgentTeamsLoading(): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="mt-8 space-y-4" role="status" aria-label={t("console.agentTeams.loading")}>
      {[0, 1].map((index) => (
        <div
          key={index}
          className="grid min-h-28 animate-pulse grid-cols-[minmax(0,1fr)_minmax(180px,0.65fr)] overflow-hidden rounded-xl border border-line"
          data-testid="agent-team-loading-row"
        >
          <div className="space-y-3 border-r border-line p-5">
            <div className="h-4 w-32 rounded bg-hover" />
            <div className="h-3 w-48 max-w-full rounded bg-hover" />
            <div className="h-3 w-24 rounded bg-hover" />
          </div>
          <div className="flex items-center gap-2 p-5">
            <div className="h-9 w-16 rounded-md bg-hover" />
            <div className="h-9 w-16 rounded-md bg-hover" />
            <div className="h-9 w-16 rounded-md bg-hover" />
          </div>
        </div>
      ))}
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
    <div className="mt-8 rounded-xl border border-line bg-rail p-5" role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" strokeWidth={1.5} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{title}</p>
          <p className="mt-1 text-sm leading-6 text-sub">{description}</p>
          <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}>
            {t("console.agentTeams.retry")}
          </Button>
        </div>
      </div>
    </div>
  );
}
