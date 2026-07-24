import "@moebius/console-ui/globals.css";

import {
  OperatorConsole,
  resolveNewConversationAgentTeamKey,
  type AgentTeamInformationInput,
  type AgentTeamDetailState,
  type AgentTeamMemberEditorState,
  type AgentTeamSaveAllFailureView,
  type TeamBuilderViewState,
  type OperatorMessage,
  type OperatorAgentTeam,
  type OperatorAgentTeamsState,
  type OperatorChildSessionSummary,
  type OperatorEditAndResendTarget,
  type OperatorProject,
  type OperatorProcessOutput,
  type OperatorProcessOutputState,
  type OperatorProcessTimelineEvent,
  type OperatorRunSnapshot,
  type OperatorRunnerStatus,
  type OperatorSession,
  type OperatorSubSessionViewState,
  type RightSidebarTabsState,
  hasBlockingComposerAttachment,
  readyComposerAttachmentIds,
  type OperatorWorkspaceDiffSummary,
} from "@moebius/console-ui";
import type {
  AgentTeamDuplicateBuiltInRequest,
  AgentTeamDuplicateUserRequest,
  AgentTeamListItem,
  AgentTeamListResponse,
  AgentTeamCreateRequest,
  AgentTeamMemberAddRequest,
  AgentTeamMemberAddResponse,
  AgentTeamMemberDocument,
  AgentTeamMemberDuplicateRequest,
  AgentTeamMemberRequest,
  AgentTeamMemberWriteRequest,
  AgentTeamMemberTrashRequest,
  AgentTeamPrimaryAgentWriteRequest,
  AgentTeamUpdateInformationRequest,
  AgentTeamTrashUserRequest,
} from "../team-ipc-contract.js";
import type { AgentTeamRelocateRequest, AgentTeamRepairRequest } from "../team-repair-contract.js";
import type { AgentTeamFileManagerRequest } from "../team-file-manager-contract.js";
import type {
  LastUsedAgentTeam,
  SuccessfulConversationAgentTeamRequest,
} from "../team-conversation-preference-contract.js";
import type {
  AiTeamBuilderCommitRequest,
  AiTeamBuilderDraftRequest,
  AiTeamBuilderIpcResponse,
  AiTeamBuilderTurnRequest,
} from "../ai-team-builder/contract.js";
import type { DoctorCheck } from "../env-doctor.js";
import type { OnboardingCompletionStatus } from "../onboarding/first-run-marker.js";
import type {
  AgentTeamExternalChangeRequest,
  AgentTeamExternalChangeResponse,
} from "../team-external-change-contract.js";
import type { AiTeamBuilderState } from "../ai-team-builder/dto.js";
import { tryParseAgentMarkdownIdentity } from "../team-model.js";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  acknowledgeDisplayedResult,
  ConsoleStateActions,
  ConsoleStateCoordinator,
  loadProcessOutput,
  loadProcessOutputAppend,
  loadProjectFile,
  loadProjectFiles,
  loadSubSessionView,
  loadWorkspaceDiff,
  ProcessOutputRequestError,
  processOutputLocator,
  refreshConsoleState,
  subSessionIdFromSourceKey,
  submitSessionMessage,
  retrySessionRun,
  type ConsoleSelection,
  type SelectionMutationKind,
  type SelectionMutationToken,
} from "./state-sync.js";
import {
  isFirstRunOnboarding,
  readSidebarVisibilityPreference,
  writeSidebarVisibilityPreference,
  type SidebarVisibilityPreference,
} from "./sidebar-preference.js";
import { OnboardingRoute } from "../onboarding/onboarding-route.js";
import {
  clearConsoleSelectionPreference,
  decideConsoleSelectionCommit,
  isSameConsoleSelection,
  readConsoleSelectionPreference,
  writeConsoleSelectionPreference,
} from "./selection-preference.js";
import {
  canSubmitNewConversation,
  createNewConversationDraft,
  reduceNewConversationDraft,
  submitNewConversation,
} from "./new-conversation.js";
import {
  createConversationDraftStore,
  NEW_CONVERSATION_DRAFT_KEY,
  sessionDraftKey,
} from "./draft-store.js";
import {
  readRightSidebarVisibilityPreference,
  readRightSidebarWidthPreference,
  writeRightSidebarVisibilityPreference,
  writeRightSidebarWidthPreference,
  type RightSidebarVisibilityPreference,
} from "./right-sidebar-preference.js";
import { createRightSidebarTabsStore } from "./right-sidebar-tabs-store.js";
import {
  applyAgentTeamMemberExternalChange,
  clearAgentTeamMemberExternalChange,
  discardAgentTeamMemberDraft,
  discardAllAgentTeamDrafts,
  EMPTY_AGENT_TEAM_DRAFT_STATE,
  failAgentTeamMemberLoad,
  failAgentTeamMemberSave,
  finishAgentTeamMemberLoad,
  finishAgentTeamMemberSave,
  getAgentTeamKey,
  getDirtyAgentTeamMemberSlugs,
  getAgentTeamMemberDraft,
  isAgentTeamMemberDirty,
  loadAgentTeamMemberExternalVersion,
  reconcileAgentTeamSelection,
  removeAgentTeamDrafts,
  removeAgentTeamMemberDraft,
  saveAllAgentTeamDrafts,
  startAgentTeamMemberLoad,
  startAgentTeamMemberExternalOverwrite,
  startAgentTeamMemberSave,
  updateAgentTeamMemberDraft,
  type AgentTeamDraftState,
  type AgentTeamSaveAllFailure,
  type AgentTeamSelection,
} from "./team-state.js";
import {
  useManagedAttachmentDrafts,
  useMessagesWithAttachmentPreviews,
} from "./use-managed-attachments.js";
import { interruptLocalConsoleRun } from "./interrupt.js";
import { refillStoppedRunDraft } from "./edit-resend.js";
import type { CopySessionLogPathResult } from "../session-log-clipboard.js";

export interface DesktopApi {
  getLocalConsoleUrl?: () => Promise<string | null>;
  getLocalConsoleAttachmentCapability?: () => Promise<string | null>;
  copySessionLogPath?: (sessionId: string) => Promise<CopySessionLogPathResult>;
  onStatus?: (listener: (snapshot: DesktopStatusSnapshot) => void) => () => void;
  openStatusPage?: () => Promise<void>;
  selectProjectFolder?: () => Promise<string | null>;
  selectFolderForRepair?: (projectId: string) => Promise<string | null>;
  showInFolder?: (folderPath: string) => Promise<void>;
  readonly agentTeamFileManagerLabel?: string;
  openAgentTeamLocation?: (request: AgentTeamFileManagerRequest) => Promise<void>;
  listAgentTeams?: () => Promise<AgentTeamListResponse>;
  createAgentTeam?: (request: AgentTeamCreateRequest) => Promise<AgentTeamListItem>;
  readAgentTeamMember?: (request: AgentTeamMemberRequest) => Promise<AgentTeamMemberDocument>;
  writeAgentTeamMember?: (request: AgentTeamMemberWriteRequest) => Promise<AgentTeamMemberDocument>;
  addAgentTeamMember?: (request: AgentTeamMemberAddRequest) => Promise<AgentTeamMemberAddResponse>;
  updateAgentTeamInformation?: (request: AgentTeamUpdateInformationRequest) => Promise<AgentTeamListItem>;
  setAgentTeamPrimaryAgent?: (request: AgentTeamPrimaryAgentWriteRequest) => Promise<AgentTeamListItem>;
  duplicateBuiltInAgentTeam?: (request: AgentTeamDuplicateBuiltInRequest) => Promise<AgentTeamListItem>;
  duplicateUserAgentTeam?: (request: AgentTeamDuplicateUserRequest) => Promise<AgentTeamListItem>;
  duplicateAgentTeamMember?: (request: AgentTeamMemberDuplicateRequest) => Promise<AgentTeamMemberAddResponse>;
  trashAgentTeamMember?: (request: AgentTeamMemberTrashRequest) => Promise<AgentTeamListItem>;
  trashUserAgentTeam?: (request: AgentTeamTrashUserRequest) => Promise<void>;
  checkAgentTeamMemberExternalChange?: (
    request: AgentTeamExternalChangeRequest,
  ) => Promise<AgentTeamExternalChangeResponse>;
  selectAgentTeamRelocationFolder?: () => Promise<string | null>;
  relocateAgentTeamRecord?: (request: AgentTeamRelocateRequest) => Promise<AgentTeamListItem>;
  removeAgentTeamRecord?: (request: AgentTeamRepairRequest) => Promise<void>;
  startAiTeamBuilder?: (draftId: string) => Promise<AiTeamBuilderIpcResponse>;
  submitAiTeamBuilder?: (draftId: string, text: string) => Promise<AiTeamBuilderIpcResponse>;
  adjustAiTeamBuilder?: (draftId: string, text: string) => Promise<AiTeamBuilderIpcResponse>;
  retryAiTeamBuilder?: (draftId: string) => Promise<AiTeamBuilderIpcResponse>;
  commitAiTeamBuilder?: (
    draftId: string,
    proposalRevision: number,
  ) => Promise<AiTeamBuilderIpcResponse>;
  readLastUsedAgentTeam?: () => Promise<LastUsedAgentTeam | null>;
  recordSuccessfulConversationAgentTeam?: (
    request: SuccessfulConversationAgentTeamRequest,
  ) => Promise<LastUsedAgentTeam>;
  getOnboardingStatus?: () => Promise<OnboardingCompletionStatus>;
  completeOnboarding?: () => Promise<OnboardingCompletionStatus>;
  checkOnboardingCodex?: () => Promise<DoctorCheck>;
  copyOnboardingInstallCommand?: () => Promise<void>;
  startOnboardingTeamBuilder?: (request: AiTeamBuilderDraftRequest) => Promise<AiTeamBuilderIpcResponse>;
  submitOnboardingTeamBuilder?: (request: AiTeamBuilderTurnRequest) => Promise<AiTeamBuilderIpcResponse>;
  adjustOnboardingTeamBuilder?: (request: AiTeamBuilderTurnRequest) => Promise<AiTeamBuilderIpcResponse>;
  retryOnboardingTeamBuilder?: (request: AiTeamBuilderDraftRequest) => Promise<AiTeamBuilderIpcResponse>;
  commitOnboardingTeamBuilder?: (request: AiTeamBuilderCommitRequest) => Promise<AiTeamBuilderIpcResponse>;
  openExternalLink?: (url: string) => Promise<void>;
}

interface DesktopStatusSnapshot {
  runner: {
    status: OperatorRunnerStatus;
  };
  localConsole?: {
    status: "starting" | "running" | "error" | "stopped";
    url?: string;
    sqlitePath?: string;
    error?: string;
  };
  shellPath?: { status: "ok" | "fallback"; path: string; detail?: string } | null;
  seed?: { status: "pending" | "ok" | "error" };
}

interface LocalConsoleState {
  projects: OperatorProject[];
  project: OperatorProject;
  selectedProjectId: string;
  selectedSessionId: string;
  selectedSession: OperatorSession | null;
  messages: OperatorMessage[];
  pendingPrimaryMessages: OperatorMessage[];
  childSessions: OperatorChildSessionSummary[];
  activeRun: OperatorRunSnapshot | null;
  activeRuns: OperatorRunSnapshot[];
  workspaceDiff: OperatorWorkspaceDiffSummary;
  sqlitePath: string;
  lastError: string | null;
}

interface AgentTeamPrimaryAgentChangeState {
  teamKey: string;
  status: "saving" | "saved" | "failed";
  error: string | null;
}

const AGENT_TEAM_BUILDER_DRAFT_STORAGE_KEY = "moebius.agent-teams.ai-builder-draft";

declare global {
  interface Window {
    moebius?: DesktopApi;
    MOEBIUS_LOCAL_CONSOLE_URL?: string;
  }
}

export function App(): JSX.Element {
  return (
    <HashRouter>
      <DesktopRoutes />
    </HashRouter>
  );
}

function DesktopRoutes(): JSX.Element {
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    const readStatus = async () => {
      if (window.moebius?.getOnboardingStatus === undefined) {
        if (active) {
          setOnboardingCompleted(true);
        }
        return;
      }
      try {
        const result = await window.moebius.getOnboardingStatus();
        if (active) {
          setOnboardingCompleted(result.completed);
        }
      } catch {
        if (active) {
          setOnboardingCompleted(false);
        }
      }
    };
    void readStatus();
    return () => {
      active = false;
    };
  }, []);

  if (onboardingCompleted === null) {
    return <main className="h-screen min-h-[560px] bg-canvas" data-testid="desktop-route-loading" />;
  }

  const completeOnboarding = async (pendingAgentTeamKey: string) => {
    const result = await window.moebius?.completeOnboarding?.();
    if (result?.completed !== true) {
      throw new Error("无法保存引导完成状态。");
    }
    setOnboardingCompleted(true);
    navigate("/", {
      replace: true,
      state: { pendingAgentTeamKey } satisfies OnboardingNavigationState,
    });
  };

  return (
    <Routes>
      <Route
        path="/onboarding/*"
        element={isFirstRunOnboarding(onboardingCompleted)
          ? <OnboardingRoute onComplete={completeOnboarding} />
          : <Navigate replace to="/" />}
      />
      <Route
        path="/*"
        element={isFirstRunOnboarding(onboardingCompleted)
          ? <Navigate replace to="/onboarding" />
          : <OperatorConsoleRoute />}
      />
    </Routes>
  );
}

interface OnboardingNavigationState {
  pendingAgentTeamKey: string;
}

function OperatorConsoleRoute(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const [pendingAgentTeamKey] = useState(() => readPendingAgentTeamKey(location.state));

  useEffect(() => {
    if (readPendingAgentTeamKey(location.state) === null) {
      return;
    }
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: null },
    );
  }, [location.hash, location.pathname, location.search, location.state, navigate]);

  return <OperatorConsoleApp pendingAgentTeamKey={pendingAgentTeamKey} />;
}

function readPendingAgentTeamKey(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const key = (value as Partial<OnboardingNavigationState>).pendingAgentTeamKey;
  return typeof key === "string" && key.trim().length > 0 ? key : null;
}

export function OperatorConsoleApp({
  pendingAgentTeamKey: initialPendingAgentTeamKey = null,
}: {
  pendingAgentTeamKey?: string | null;
}): JSX.Element {
  const [apiBase, setApiBase] = useState<string | null>(readQueryApiBase());
  const [attachmentCapability, setAttachmentCapability] = useState<string | null>(null);
  const [initialSelectionPreference] = useState<ConsoleSelection | null>(() =>
    readConsoleSelectionPreference(window.localStorage),
  );
  const [selection, setSelection] = useState<ConsoleSelection>(
    initialSelectionPreference ?? { projectId: "local", sessionId: "default" },
  );
  const selectionRef = useRef(selection);
  const persistedSelectionRef = useRef(initialSelectionPreference);
  const startupSelectionPendingRef = useRef(true);
  const selectionPersistenceEnabledRef = useRef(false);
  const coordinatorRef = useRef(new ConsoleStateCoordinator());
  const [state, setState] = useState<LocalConsoleState | null>(null);
  const conversationDraftStoreRef = useRef(createConversationDraftStore(window.localStorage));
  const rightSidebarTabsStoreRef = useRef(createRightSidebarTabsStore(window.localStorage));
  const [rightSidebarTabs, setRightSidebarTabs] = useState<RightSidebarTabsState>(() =>
    rightSidebarTabsStoreRef.current.read(selection.sessionId),
  );
  const [processOutputs, setProcessOutputs] = useState<Record<string, OperatorProcessOutputState>>({});
  const processOutputsRef = useRef(processOutputs);
  const [subSessionViews, setSubSessionViews] = useState<Record<string, OperatorSubSessionViewState>>({});
  const [subSessionComposerValues, setSubSessionComposerValues] = useState<Record<string, string>>({});
  const [subSessionSendingId, setSubSessionSendingId] = useState<string | null>(null);
  const [composerValue, setComposerValue] = useState(() =>
    conversationDraftStoreRef.current.read(sessionDraftKey(selection.sessionId)),
  );
  const [runnerStatus, setRunnerStatus] = useState<OperatorRunnerStatus>("stopped");
  const [isSending, setIsSending] = useState(false);
  const [selectionMutationKind, setSelectionMutationKind] = useState<SelectionMutationKind | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [isProjectMutationPending, setIsProjectMutationPending] = useState(false);
  const [newConversation, dispatchNewConversation] = useReducer(reduceNewConversationDraft, null);
  const [agentTeamsState, setAgentTeamsState] = useState<OperatorAgentTeamsState>({ status: "loading" });
  const [lastUsedAgentTeamKey, setLastUsedAgentTeamKey] = useState<string | null>(null);
  const [pendingAgentTeamKey, setPendingAgentTeamKey] = useState<string | null>(
    initialPendingAgentTeamKey,
  );
  const [agentTeamSelection, setAgentTeamSelection] = useState<AgentTeamSelection | null>(null);
  const [activeAgentTeamKey, setActiveAgentTeamKey] = useState<string | null>(null);
  const [agentTeamBuilderState, setAgentTeamBuilderState] = useState<TeamBuilderViewState | null>(null);
  const agentTeamBuilderStartedRef = useRef(false);
  const agentTeamBuilderDraftIdRef = useRef<string | null>(null);
  const [agentTeamDraftState, setAgentTeamDraftState] = useState<AgentTeamDraftState>(EMPTY_AGENT_TEAM_DRAFT_STATE);
  const agentTeamDraftStateRef = useRef(agentTeamDraftState);
  const checkingAgentTeamExternalChangesRef = useRef(new Set<string>());
  const [agentTeamSaveAllFailures, setAgentTeamSaveAllFailures] = useState<AgentTeamSaveAllFailure[]>([]);
  const [primaryAgentChange, setPrimaryAgentChange] = useState<AgentTeamPrimaryAgentChangeState | null>(null);
  const [agentTeamsRefreshNonce, setAgentTeamsRefreshNonce] = useState(0);
  const [sidebarVisibilityPreference, setSidebarVisibilityPreference] = useState<SidebarVisibilityPreference>(() =>
    readSidebarVisibilityPreference(window.localStorage),
  );
  const [rightSidebarVisibilityPreference, setRightSidebarVisibilityPreference] =
    useState<RightSidebarVisibilityPreference>(() => readRightSidebarVisibilityPreference(window.localStorage));
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() =>
    readRightSidebarWidthPreference(window.localStorage),
  );
  const resultAcknowledgementsRef = useRef(new Set<string>());
  const activeRightSidebarTab = rightSidebarTabs.tabs.find(
    (tab) => tab.id === rightSidebarTabs.activeTabId,
  ) ?? null;
  const activeSubSessionId = activeRightSidebarTab?.type === "sub-session"
    ? subSessionIdFromSourceKey(activeRightSidebarTab.sourceKey)
    : null;
  const currentAttachmentDraftKey = newConversation === null
    ? sessionDraftKey(selection.sessionId)
    : NEW_CONVERSATION_DRAFT_KEY;
  const activeSubSessionDraftKey = sessionDraftKey(activeSubSessionId ?? "__inactive-sub-session__");
  const reportAttachmentError = useCallback((error: string) => setClientError(error), []);
  const managedAttachments = useManagedAttachmentDrafts({
    apiBase,
    capability: attachmentCapability,
    currentDraftKey: currentAttachmentDraftKey,
    onError: reportAttachmentError,
  });
  const managedSubSessionAttachments = useManagedAttachmentDrafts({
    apiBase,
    capability: attachmentCapability,
    currentDraftKey: activeSubSessionDraftKey,
    onError: reportAttachmentError,
  });

  const commitAgentTeamDraftState = useCallback((nextState: AgentTeamDraftState) => {
    agentTeamDraftStateRef.current = nextState;
    setAgentTeamDraftState(nextState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTimer: number | undefined;

    async function loadTeams(): Promise<void> {
      const listTeams = window.moebius?.listAgentTeams;
      if (listTeams === undefined) {
        if (!cancelled) {
          setAgentTeamsState({ status: "error" });
        }
        return;
      }

      try {
        const [result, lastUsedTeam] = await Promise.all([
          listTeams(),
          window.moebius?.readLastUsedAgentTeam?.().catch(() => null) ?? Promise.resolve(null),
        ]);
        if (cancelled) {
          return;
        }
        if (result.status === "loading") {
          setAgentTeamsState({ status: "loading" });
          loadingTimer = window.setTimeout(() => void loadTeams(), 250);
          return;
        }
        if (result.status === "configuration-error") {
          setAgentTeamsState({ status: "configuration-error" });
          setAgentTeamSelection(null);
          return;
        }

        setAgentTeamsState({ status: "ready", teams: result.teams.map(toOperatorAgentTeam) });
        setLastUsedAgentTeamKey(lastUsedTeam === null ? null : getAgentTeamIdentityKey(lastUsedTeam));
        setAgentTeamSelection((current) => reconcileAgentTeamSelection(result.teams, current));
      } catch {
        if (!cancelled) {
          setAgentTeamsState({ status: "error" });
        }
      }
    }

    setAgentTeamsState({ status: "loading" });
    void loadTeams();
    return () => {
      cancelled = true;
      if (loadingTimer !== undefined) {
        window.clearTimeout(loadingTimer);
      }
    };
  }, [agentTeamsRefreshNonce]);

  const loadAgentTeamMember = useCallback(async (teamKey: string, memberSlug: string) => {
    const current = getAgentTeamMemberDraft(agentTeamDraftStateRef.current, teamKey, memberSlug);
    if (current?.loadStatus === "ready" || current?.loadStatus === "loading") {
      return;
    }

    commitAgentTeamDraftState(startAgentTeamMemberLoad(agentTeamDraftStateRef.current, teamKey, memberSlug));
    try {
      const team = findOperatorAgentTeam(agentTeamsState, teamKey);
      const readMember = window.moebius?.readAgentTeamMember;
      if (team === undefined || readMember === undefined) {
        throw new Error("当前无法读取 Agent 内容，请稍后重试。");
      }
      const document = await readMember({ teamId: team.id, ownership: team.ownership, memberSlug });
      commitAgentTeamDraftState(finishAgentTeamMemberLoad(
        agentTeamDraftStateRef.current,
        teamKey,
        memberSlug,
        document.agentMarkdown,
      ));
    } catch (error) {
      commitAgentTeamDraftState(failAgentTeamMemberLoad(
        agentTeamDraftStateRef.current,
        teamKey,
        memberSlug,
        formatError(error),
      ));
    }
  }, [agentTeamsState, commitAgentTeamDraftState]);

  const updateAgentTeamMemberSummary = useCallback((teamKey: string, document: AgentTeamMemberDocument) => {
    setAgentTeamsState((current) => current.status !== "ready"
      ? current
      : {
          status: "ready",
          teams: current.teams.map((team) => team.teamKey !== teamKey
            ? team
            : {
                ...team,
                members: team.members.map((member) => member.slug === document.slug
                  ? {
                      slug: document.slug,
                      displayName: document.displayName,
                      description: document.description,
                    }
                  : member),
              }),
        });
  }, []);

  const checkAgentTeamMemberExternalChange = useCallback(async (teamKey: string, memberSlug: string): Promise<void> => {
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const current = getAgentTeamMemberDraft(agentTeamDraftStateRef.current, teamKey, memberSlug);
    const checkExternalChange = window.moebius?.checkAgentTeamMemberExternalChange;
    if (
      team?.ownership !== "user"
      || current?.loadStatus !== "ready"
      || current.savedMarkdown === null
      || current.saveStatus === "saving"
      || checkExternalChange === undefined
    ) {
      return;
    }

    const checkKey = `${teamKey}\u0000${memberSlug}`;
    if (checkingAgentTeamExternalChangesRef.current.has(checkKey)) {
      return;
    }
    checkingAgentTeamExternalChangesRef.current.add(checkKey);
    try {
      const result = await checkExternalChange({
        teamId: team.id,
        ownership: team.ownership,
        memberSlug,
        knownAgentMarkdown: current.savedMarkdown,
      });
      if (result.status === "unchanged") {
        commitAgentTeamDraftState(clearAgentTeamMemberExternalChange(
          agentTeamDraftStateRef.current,
          teamKey,
          memberSlug,
        ));
        return;
      }
      if (result.status !== "changed") {
        return;
      }

      const nextState = applyAgentTeamMemberExternalChange(
        agentTeamDraftStateRef.current,
        teamKey,
        memberSlug,
        result.document.agentMarkdown,
      );
      commitAgentTeamDraftState(nextState);
      if (getAgentTeamMemberDraft(nextState, teamKey, memberSlug)?.externalChangeStatus === "reloaded") {
        updateAgentTeamMemberSummary(teamKey, result.document);
      }
    } catch (error) {
      commitAgentTeamDraftState(failAgentTeamMemberLoad(
        agentTeamDraftStateRef.current,
        teamKey,
        memberSlug,
        `无法检查外部修改：${formatError(error)}`,
      ));
    } finally {
      checkingAgentTeamExternalChangesRef.current.delete(checkKey);
    }
  }, [agentTeamsState, commitAgentTeamDraftState, updateAgentTeamMemberSummary]);

  const persistAgentTeamMember = useCallback(async (
    teamKey: string,
    memberSlug: string,
    agentMarkdown: string,
  ): Promise<AgentTeamMemberDocument> => {
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const writeMember = window.moebius?.writeAgentTeamMember;
    if (team === undefined || writeMember === undefined) {
      throw new Error("当前无法保存 Agent 内容，请稍后重试。");
    }
    const document = await writeMember({
      teamId: team.id,
      ownership: team.ownership,
      memberSlug,
      agentMarkdown,
    });
    updateAgentTeamMemberSummary(teamKey, document);
    return document;
  }, [agentTeamsState, updateAgentTeamMemberSummary]);

  const saveAgentTeamMember = useCallback(async (teamKey: string, memberSlug: string): Promise<void> => {
    const current = getAgentTeamMemberDraft(agentTeamDraftStateRef.current, teamKey, memberSlug);
    if (!isAgentTeamMemberDirty(current) || current?.saveStatus === "saving") {
      return;
    }
    commitAgentTeamDraftState(startAgentTeamMemberSave(agentTeamDraftStateRef.current, teamKey, memberSlug));
    const saving = getAgentTeamMemberDraft(agentTeamDraftStateRef.current, teamKey, memberSlug);
    const requestedMarkdown = saving?.saveRequestedMarkdown;
    if (requestedMarkdown === null || requestedMarkdown === undefined) {
      return;
    }

    try {
      const document = await persistAgentTeamMember(teamKey, memberSlug, requestedMarkdown);
      commitAgentTeamDraftState(finishAgentTeamMemberSave(
        agentTeamDraftStateRef.current,
        teamKey,
        memberSlug,
        document.agentMarkdown,
      ));
      setAgentTeamSaveAllFailures((currentFailures) =>
        currentFailures.filter((failure) => failure.memberSlug !== memberSlug));
    } catch (error) {
      commitAgentTeamDraftState(failAgentTeamMemberSave(
        agentTeamDraftStateRef.current,
        teamKey,
        memberSlug,
        formatError(error),
      ));
    }
  }, [commitAgentTeamDraftState, persistAgentTeamMember]);

  const loadAgentTeamMemberExternalChange = useCallback((teamKey: string, memberSlug: string): void => {
    const current = getAgentTeamMemberDraft(agentTeamDraftStateRef.current, teamKey, memberSlug);
    if (current?.externalChangeStatus !== "conflict" || current.externalMarkdown === null) {
      return;
    }
    const externalMarkdown = current.externalMarkdown;
    commitAgentTeamDraftState(loadAgentTeamMemberExternalVersion(
      agentTeamDraftStateRef.current,
      teamKey,
      memberSlug,
    ));
    updateAgentTeamMemberSummary(teamKey, {
      slug: memberSlug,
      agentMarkdown: externalMarkdown,
      ...tryParseAgentMarkdownIdentity(externalMarkdown),
    });
  }, [commitAgentTeamDraftState, updateAgentTeamMemberSummary]);

  const overwriteAgentTeamMemberExternalChange = useCallback(async (
    teamKey: string,
    memberSlug: string,
  ): Promise<void> => {
    commitAgentTeamDraftState(startAgentTeamMemberExternalOverwrite(
      agentTeamDraftStateRef.current,
      teamKey,
      memberSlug,
    ));
    const saving = getAgentTeamMemberDraft(agentTeamDraftStateRef.current, teamKey, memberSlug);
    const requestedMarkdown = saving?.saveRequestedMarkdown;
    if (saving?.saveStatus !== "saving" || requestedMarkdown === null || requestedMarkdown === undefined) {
      return;
    }

    try {
      const document = await persistAgentTeamMember(teamKey, memberSlug, requestedMarkdown);
      commitAgentTeamDraftState(finishAgentTeamMemberSave(
        agentTeamDraftStateRef.current,
        teamKey,
        memberSlug,
        document.agentMarkdown,
      ));
    } catch (error) {
      commitAgentTeamDraftState(failAgentTeamMemberSave(
        agentTeamDraftStateRef.current,
        teamKey,
        memberSlug,
        formatError(error),
      ));
    }
  }, [commitAgentTeamDraftState, persistAgentTeamMember]);

  const saveAllDraftsAndLeave = useCallback(async (
    teamKey: string,
  ): Promise<{ failures: AgentTeamSaveAllFailureView[] }> => {
    const result = await saveAllAgentTeamDrafts({
      state: agentTeamDraftStateRef.current,
      teamKey,
      saveMember: async (memberSlug, agentMarkdown) => {
        const document = await persistAgentTeamMember(teamKey, memberSlug, agentMarkdown);
        return document.agentMarkdown;
      },
      onTransition: commitAgentTeamDraftState,
    });
    commitAgentTeamDraftState(result.state);
    setAgentTeamSaveAllFailures(result.failures);
    return { failures: result.failures };
  }, [commitAgentTeamDraftState, persistAgentTeamMember]);

  const openAgentTeam = useCallback((teamKey: string) => {
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    if (team === undefined) {
      return;
    }
    const currentMemberSlug = agentTeamSelection?.teamKey === teamKey
      && agentTeamSelection.memberSlug !== null
      && team.members.some((member) => member.slug === agentTeamSelection.memberSlug)
      ? agentTeamSelection.memberSlug
      : team.primaryAgentSlug !== null && team.members.some((member) => member.slug === team.primaryAgentSlug)
        ? team.primaryAgentSlug
        : team.members[0]?.slug ?? null;
    setActiveAgentTeamKey(teamKey);
    setAgentTeamSelection({ teamKey, memberSlug: currentMemberSlug });
    setAgentTeamSaveAllFailures([]);
    if (currentMemberSlug !== null) {
      void loadAgentTeamMember(teamKey, currentMemberSlug);
    }
  }, [agentTeamSelection, agentTeamsState, loadAgentTeamMember]);

  const selectAgentTeamMember = useCallback((teamKey: string, memberSlug: string) => {
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    if (team === undefined || !team.members.some((member) => member.slug === memberSlug)) {
      return;
    }
    setAgentTeamSelection({ teamKey, memberSlug });
    void loadAgentTeamMember(teamKey, memberSlug);
  }, [agentTeamsState, loadAgentTeamMember]);

  const changeAgentTeamPrimaryAgent = useCallback(async (teamKey: string, memberSlug: string): Promise<void> => {
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const setPrimaryAgent = window.moebius?.setAgentTeamPrimaryAgent;
    if (team === undefined || team.ownership !== "user" || setPrimaryAgent === undefined) {
      return;
    }
    if (team.primaryAgentSlug === memberSlug || !team.members.some((member) => member.slug === memberSlug)) {
      return;
    }

    setPrimaryAgentChange({ teamKey, status: "saving", error: null });
    try {
      const updatedTeam = await setPrimaryAgent({
        teamId: team.id,
        ownership: team.ownership,
        primaryAgentSlug: memberSlug,
      });
      setAgentTeamsState((current) => current.status !== "ready"
        ? current
        : {
            status: "ready",
            teams: current.teams.map((candidate) => candidate.teamKey === teamKey
              ? toOperatorAgentTeam(updatedTeam)
              : candidate),
          });
      setPrimaryAgentChange({ teamKey, status: "saved", error: null });
    } catch (error) {
      setPrimaryAgentChange({ teamKey, status: "failed", error: formatError(error) });
    }
  }, [agentTeamsState]);

  const activateCopiedAgentTeam = useCallback(async (copiedItem: AgentTeamListItem): Promise<string> => {
    const copiedTeam = toOperatorAgentTeam(copiedItem);
    setAgentTeamsState((current) => current.status !== "ready"
      ? current
      : { status: "ready", teams: [...current.teams, copiedTeam] });

    const memberSlug = copiedTeam.primaryAgentSlug !== null
      && copiedTeam.members.some((member) => member.slug === copiedTeam.primaryAgentSlug)
      ? copiedTeam.primaryAgentSlug
      : copiedTeam.members[0]?.slug ?? null;
    setActiveAgentTeamKey(copiedTeam.teamKey);
    setAgentTeamSelection({ teamKey: copiedTeam.teamKey, memberSlug });
    setAgentTeamSaveAllFailures([]);

    if (memberSlug !== null) {
      commitAgentTeamDraftState(startAgentTeamMemberLoad(
        agentTeamDraftStateRef.current,
        copiedTeam.teamKey,
        memberSlug,
      ));
      try {
        const document = await window.moebius?.readAgentTeamMember?.({
          teamId: copiedTeam.id,
          ownership: copiedTeam.ownership,
          memberSlug,
        });
        if (document === undefined) {
          throw new Error("当前无法读取复制后的 Agent 内容，请稍后重试。");
        }
        commitAgentTeamDraftState(finishAgentTeamMemberLoad(
          agentTeamDraftStateRef.current,
          copiedTeam.teamKey,
          memberSlug,
          document.agentMarkdown,
        ));
      } catch (error) {
        commitAgentTeamDraftState(failAgentTeamMemberLoad(
          agentTeamDraftStateRef.current,
          copiedTeam.teamKey,
          memberSlug,
          formatError(error),
        ));
      }
    }

    return copiedTeam.teamKey;
  }, [commitAgentTeamDraftState]);

  const getAgentTeamBuilderDraftId = useCallback((): string => {
    if (agentTeamBuilderDraftIdRef.current !== null) {
      return agentTeamBuilderDraftIdRef.current;
    }
    const stored = window.localStorage.getItem(AGENT_TEAM_BUILDER_DRAFT_STORAGE_KEY);
    const draftId = stored !== null && isSafeAiTeamBuilderDraftId(stored)
      ? stored
      : createAgentTeamBuilderDraftId();
    agentTeamBuilderDraftIdRef.current = draftId;
    window.localStorage.setItem(AGENT_TEAM_BUILDER_DRAFT_STORAGE_KEY, draftId);
    return draftId;
  }, []);

  const failAgentTeamBuilder = useCallback((
    error: { code: string; humanMessage: string; canRetry: boolean },
  ) => {
    setAgentTeamBuilderState((current) => ({
      phase: "failed",
      messages: current?.messages ?? [],
      proposal: current?.proposal ?? null,
      proposalRevision: current?.proposalRevision ?? null,
      error,
    }));
  }, []);

  const acceptAgentTeamBuilderResponse = useCallback((
    response: AiTeamBuilderIpcResponse,
  ): AiTeamBuilderState | null => {
    if (!response.ok) {
      agentTeamBuilderStartedRef.current = false;
      failAgentTeamBuilder(response.error);
      return null;
    }
    agentTeamBuilderStartedRef.current = true;
    setAgentTeamBuilderState(toTeamBuilderViewState(response.state));
    return response.state;
  }, [failAgentTeamBuilder]);

  const activateAiBuiltAgentTeam = useCallback(async (teamId: string): Promise<OperatorAgentTeam> => {
    const listTeams = window.moebius?.listAgentTeams;
    if (listTeams === undefined) {
      throw new Error("团队已经创建，但暂时无法打开详情。请重试。");
    }
    const result = await listTeams();
    if (result.status !== "ready") {
      throw new Error("团队已经创建，但暂时无法打开详情。请重试。");
    }
    const selectedItem = result.teams.find((team) => team.ownership === "user" && team.id === teamId);
    if (selectedItem === undefined) {
      throw new Error("团队已经创建，但暂时无法打开详情。请重试。");
    }
    const selectedTeam = toOperatorAgentTeam(selectedItem);
    await activateCopiedAgentTeam(selectedItem);
    setAgentTeamsState({ status: "ready", teams: result.teams.map(toOperatorAgentTeam) });
    window.localStorage.removeItem(AGENT_TEAM_BUILDER_DRAFT_STORAGE_KEY);
    agentTeamBuilderDraftIdRef.current = null;
    agentTeamBuilderStartedRef.current = false;
    return selectedTeam;
  }, [activateCopiedAgentTeam]);

  const activateSelectedAiTeamBuilderState = useCallback(async (
    builderState: AiTeamBuilderState,
  ): Promise<OperatorAgentTeam | null> => {
    if (builderState.phase !== "selected" || builderState.selectedTeamId === null) {
      return null;
    }
    try {
      return await activateAiBuiltAgentTeam(builderState.selectedTeamId);
    } catch (error) {
      agentTeamBuilderStartedRef.current = false;
      failAgentTeamBuilder({
        code: "temporarily-unavailable",
        humanMessage: formatError(error),
        canRetry: true,
      });
      return null;
    }
  }, [activateAiBuiltAgentTeam, failAgentTeamBuilder]);

  const startAgentTeamBuilder = useCallback(async (): Promise<OperatorAgentTeam | null> => {
    const start = window.moebius?.startAiTeamBuilder;
    if (start === undefined) {
      failAgentTeamBuilder({
        code: "temporarily-unavailable",
        humanMessage: "AI 团队设计器暂时不可用，请稍后重试。",
        canRetry: true,
      });
      return null;
    }
    try {
      const state = acceptAgentTeamBuilderResponse(await start(getAgentTeamBuilderDraftId()));
      return state === null ? null : activateSelectedAiTeamBuilderState(state);
    } catch {
      agentTeamBuilderStartedRef.current = false;
      failAgentTeamBuilder({
        code: "temporarily-unavailable",
        humanMessage: "AI 团队设计器暂时不可用，请稍后重试。",
        canRetry: true,
      });
      return null;
    }
  }, [
    acceptAgentTeamBuilderResponse,
    activateSelectedAiTeamBuilderState,
    failAgentTeamBuilder,
    getAgentTeamBuilderDraftId,
  ]);

  const submitAgentTeamBuilder = useCallback(async (text: string): Promise<void> => {
    const submit = window.moebius?.submitAiTeamBuilder;
    if (submit === undefined) {
      failAgentTeamBuilder({
        code: "temporarily-unavailable",
        humanMessage: "AI 团队设计器暂时不可用，请稍后重试。",
        canRetry: true,
      });
      return;
    }
    setAgentTeamBuilderState((current) => current === null
      ? current
      : { ...current, phase: "running", error: null });
    try {
      acceptAgentTeamBuilderResponse(await submit(getAgentTeamBuilderDraftId(), text));
    } catch {
      failAgentTeamBuilder({
        code: "temporarily-unavailable",
        humanMessage: "AI 团队设计器暂时不可用，已保留当前内容。",
        canRetry: true,
      });
    }
  }, [acceptAgentTeamBuilderResponse, failAgentTeamBuilder, getAgentTeamBuilderDraftId]);

  const adjustAgentTeamBuilder = useCallback(async (text: string): Promise<void> => {
    const adjust = window.moebius?.adjustAiTeamBuilder;
    if (adjust === undefined) {
      failAgentTeamBuilder({
        code: "temporarily-unavailable",
        humanMessage: "AI 团队设计器暂时不可用，请稍后重试。",
        canRetry: true,
      });
      return;
    }
    setAgentTeamBuilderState((current) => current === null
      ? current
      : { ...current, phase: "running", error: null });
    try {
      acceptAgentTeamBuilderResponse(await adjust(getAgentTeamBuilderDraftId(), text));
    } catch {
      failAgentTeamBuilder({
        code: "temporarily-unavailable",
        humanMessage: "AI 团队设计器暂时不可用，已保留当前内容。",
        canRetry: true,
      });
    }
  }, [acceptAgentTeamBuilderResponse, failAgentTeamBuilder, getAgentTeamBuilderDraftId]);

  const retryAgentTeamBuilder = useCallback(async (): Promise<OperatorAgentTeam | null> => {
    if (!agentTeamBuilderStartedRef.current) {
      return startAgentTeamBuilder();
    }
    const retry = window.moebius?.retryAiTeamBuilder;
    if (retry === undefined) {
      failAgentTeamBuilder({
        code: "temporarily-unavailable",
        humanMessage: "AI 团队设计器暂时不可用，请稍后重试。",
        canRetry: true,
      });
      return null;
    }
    setAgentTeamBuilderState((current) => current === null
      ? current
      : {
          ...current,
          phase: current.proposal === null ? "running" : "committing",
          error: null,
        });
    try {
      const state = acceptAgentTeamBuilderResponse(await retry(getAgentTeamBuilderDraftId()));
      return state === null ? null : activateSelectedAiTeamBuilderState(state);
    } catch {
      agentTeamBuilderStartedRef.current = false;
      failAgentTeamBuilder({
        code: "temporarily-unavailable",
        humanMessage: "AI 团队设计器暂时不可用，已保留当前内容。",
        canRetry: true,
      });
      return null;
    }
  }, [
    acceptAgentTeamBuilderResponse,
    activateSelectedAiTeamBuilderState,
    failAgentTeamBuilder,
    getAgentTeamBuilderDraftId,
    startAgentTeamBuilder,
  ]);

  const commitAgentTeamBuilder = useCallback(async (
    proposalRevision: number,
  ): Promise<OperatorAgentTeam | null> => {
    const commit = window.moebius?.commitAiTeamBuilder;
    if (commit === undefined) {
      failAgentTeamBuilder({
        code: "temporarily-unavailable",
        humanMessage: "AI 团队设计器暂时不可用，请稍后重试。",
        canRetry: true,
      });
      return null;
    }
    setAgentTeamBuilderState((current) => current === null
      ? current
      : { ...current, phase: "committing", error: null });
    try {
      const state = acceptAgentTeamBuilderResponse(
        await commit(getAgentTeamBuilderDraftId(), proposalRevision),
      );
      return state === null ? null : activateSelectedAiTeamBuilderState(state);
    } catch {
      failAgentTeamBuilder({
        code: "temporarily-unavailable",
        humanMessage: "团队创建失败，方案仍已保留，可以重试。",
        canRetry: true,
      });
      return null;
    }
  }, [
    acceptAgentTeamBuilderResponse,
    activateSelectedAiTeamBuilderState,
    failAgentTeamBuilder,
    getAgentTeamBuilderDraftId,
  ]);

  const duplicateBuiltInAgentTeam = useCallback(async (teamKey: string): Promise<string> => {
    const source = findOperatorAgentTeam(agentTeamsState, teamKey);
    const duplicateTeam = window.moebius?.duplicateBuiltInAgentTeam;
    if (source === undefined || source.ownership !== "system" || duplicateTeam === undefined) {
      throw new Error("当前无法复制这支内置团队，请稍后重试。");
    }

    const copiedItem = await duplicateTeam({ teamId: source.id, ownership: "system" });
    return activateCopiedAgentTeam(copiedItem);
  }, [activateCopiedAgentTeam, agentTeamsState]);

  const assertAgentTeamDraftsResolved = useCallback((teamKey: string) => {
    if (getDirtyAgentTeamMemberSlugs(agentTeamDraftStateRef.current, teamKey).length > 0) {
      throw new Error("请先保存或放弃这支团队中未保存的修改。");
    }
  }, []);

  const duplicateUserAgentTeam = useCallback(async (teamKey: string): Promise<string> => {
    assertAgentTeamDraftsResolved(teamKey);
    const source = findOperatorAgentTeam(agentTeamsState, teamKey);
    const duplicateTeam = window.moebius?.duplicateUserAgentTeam;
    if (source === undefined || source.ownership !== "user" || duplicateTeam === undefined) {
      throw new Error("当前无法复制这支用户团队，请稍后重试。");
    }
    const copiedItem = await duplicateTeam({ teamId: source.id, ownership: "user" });
    return activateCopiedAgentTeam(copiedItem);
  }, [activateCopiedAgentTeam, agentTeamsState, assertAgentTeamDraftsResolved]);

  const duplicateAgentTeamMember = useCallback(async (teamKey: string, memberSlug: string): Promise<void> => {
    assertAgentTeamDraftsResolved(teamKey);
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const duplicateMember = window.moebius?.duplicateAgentTeamMember;
    if (team === undefined || team.ownership !== "user" || duplicateMember === undefined) {
      throw new Error("当前无法复制这个 Agent，请稍后重试。");
    }
    const result = await duplicateMember({
      teamId: team.id,
      ownership: "user",
      memberSlug,
    });
    const updatedTeam = toOperatorAgentTeam(result.team);
    setAgentTeamsState((current) => current.status !== "ready"
      ? current
      : {
          status: "ready",
          teams: current.teams.map((candidate) => candidate.teamKey === teamKey ? updatedTeam : candidate),
        });
    commitAgentTeamDraftState(finishAgentTeamMemberLoad(
      agentTeamDraftStateRef.current,
      teamKey,
      result.member.slug,
      result.member.agentMarkdown,
    ));
    setAgentTeamSelection({ teamKey, memberSlug: result.member.slug });
    setAgentTeamSaveAllFailures([]);
  }, [agentTeamsState, assertAgentTeamDraftsResolved, commitAgentTeamDraftState]);

  const trashAgentTeamMember = useCallback(async (teamKey: string, memberSlug: string): Promise<void> => {
    assertAgentTeamDraftsResolved(teamKey);
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const trashMember = window.moebius?.trashAgentTeamMember;
    if (team === undefined || team.ownership !== "user" || trashMember === undefined) {
      throw new Error("当前无法删除这个 Agent，请稍后重试。");
    }
    if (team.primaryAgentSlug === memberSlug) {
      throw new Error("删除主 Agent 前，请先指定另一名有效成员作为主 Agent。");
    }
    const updatedItem = await trashMember({ teamId: team.id, ownership: "user", memberSlug });
    const updatedTeam = toOperatorAgentTeam(updatedItem);
    setAgentTeamsState((current) => current.status !== "ready"
      ? current
      : {
          status: "ready",
          teams: current.teams.map((candidate) => candidate.teamKey === teamKey ? updatedTeam : candidate),
        });
    commitAgentTeamDraftState(removeAgentTeamMemberDraft(
      agentTeamDraftStateRef.current,
      teamKey,
      memberSlug,
    ));
    const nextMemberSlug = updatedTeam.primaryAgentSlug !== null
      && updatedTeam.members.some((member) => member.slug === updatedTeam.primaryAgentSlug)
      ? updatedTeam.primaryAgentSlug
      : updatedTeam.members[0]?.slug ?? null;
    setAgentTeamSelection({ teamKey, memberSlug: nextMemberSlug });
    setAgentTeamSaveAllFailures([]);
    if (nextMemberSlug !== null) {
      void loadAgentTeamMember(teamKey, nextMemberSlug);
    }
  }, [agentTeamsState, assertAgentTeamDraftsResolved, commitAgentTeamDraftState, loadAgentTeamMember]);

  const trashUserAgentTeam = useCallback(async (teamKey: string): Promise<void> => {
    assertAgentTeamDraftsResolved(teamKey);
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const trashTeam = window.moebius?.trashUserAgentTeam;
    if (team === undefined || team.ownership !== "user" || trashTeam === undefined) {
      throw new Error("当前无法把这支团队移到系统废纸篓，请稍后重试。");
    }
    await trashTeam({ teamId: team.id, ownership: "user" });
    const remainingTeams = agentTeamsState.status === "ready"
      ? agentTeamsState.teams.filter((candidate) => candidate.teamKey !== teamKey)
      : [];
    setAgentTeamsState({ status: "ready", teams: remainingTeams });
    commitAgentTeamDraftState(removeAgentTeamDrafts(agentTeamDraftStateRef.current, teamKey));
    const fallbackTeam = remainingTeams[0];
    const fallbackMemberSlug = fallbackTeam === undefined
      ? null
      : fallbackTeam.primaryAgentSlug !== null
          && fallbackTeam.members.some((member) => member.slug === fallbackTeam.primaryAgentSlug)
        ? fallbackTeam.primaryAgentSlug
        : fallbackTeam.members[0]?.slug ?? null;
    setAgentTeamSelection(fallbackTeam === undefined
      ? null
      : { teamKey: fallbackTeam.teamKey, memberSlug: fallbackMemberSlug });
    setActiveAgentTeamKey(null);
    setAgentTeamSaveAllFailures([]);
    setPrimaryAgentChange(null);
  }, [agentTeamsState, assertAgentTeamDraftsResolved, commitAgentTeamDraftState]);

  const createAgentTeam = useCallback(async (
    information: AgentTeamInformationInput,
  ): Promise<OperatorAgentTeam> => {
    const createTeam = window.moebius?.createAgentTeam;
    if (createTeam === undefined) {
      throw new Error("当前无法创建团队，请稍后重试。");
    }
    const created = toOperatorAgentTeam(await createTeam(information));
    setAgentTeamsState((current) => current.status !== "ready"
      ? current
      : { status: "ready", teams: [...current.teams, created] });
    setActiveAgentTeamKey(created.teamKey);
    setAgentTeamSelection({ teamKey: created.teamKey, memberSlug: null });
    setAgentTeamSaveAllFailures([]);
    setPrimaryAgentChange(null);
    return created;
  }, []);

  const addAgentTeamMember = useCallback(async (teamKey: string): Promise<void> => {
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const addMember = window.moebius?.addAgentTeamMember;
    if (team === undefined || addMember === undefined) {
      throw new Error("当前无法添加 Agent，请稍后重试。");
    }
    const result = await addMember({ teamId: team.id, ownership: team.ownership });
    const updatedTeam = toOperatorAgentTeam(result.team);
    setAgentTeamsState((current) => current.status !== "ready"
      ? current
      : {
          status: "ready",
          teams: current.teams.map((candidate) => candidate.teamKey === teamKey ? updatedTeam : candidate),
        });
    commitAgentTeamDraftState(finishAgentTeamMemberLoad(
      agentTeamDraftStateRef.current,
      teamKey,
      result.member.slug,
      result.member.agentMarkdown,
    ));
    setAgentTeamSelection({ teamKey, memberSlug: result.member.slug });
    setAgentTeamSaveAllFailures([]);
  }, [agentTeamsState, commitAgentTeamDraftState]);

  const updateAgentTeamInformation = useCallback(async (
    teamKey: string,
    information: AgentTeamInformationInput,
  ): Promise<void> => {
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const updateInformation = window.moebius?.updateAgentTeamInformation;
    if (team === undefined || updateInformation === undefined) {
      throw new Error("当前无法修改团队信息，请稍后重试。");
    }
    const updatedTeam = toOperatorAgentTeam(await updateInformation({
      teamId: team.id,
      ownership: team.ownership,
      ...information,
    }));
    setAgentTeamsState((current) => current.status !== "ready"
      ? current
      : {
          status: "ready",
          teams: current.teams.map((candidate) => candidate.teamKey === teamKey ? updatedTeam : candidate),
      });
  }, [agentTeamsState]);

  const openAgentTeamLocation = useCallback(async (teamKey: string, memberSlug?: string): Promise<void> => {
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const openLocation = window.moebius?.openAgentTeamLocation;
    if (team === undefined || openLocation === undefined) {
      throw new Error("暂时无法打开这个位置，请稍后重试。");
    }
    await openLocation({
      teamId: team.id,
      ownership: team.ownership,
      ...(memberSlug === undefined ? {} : { memberSlug }),
    });
  }, [agentTeamsState]);

  const relocateAgentTeam = useCallback(async (teamKey: string): Promise<void> => {
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const selectFolder = window.moebius?.selectAgentTeamRelocationFolder;
    const relocateRecord = window.moebius?.relocateAgentTeamRecord;
    if (team === undefined || team.ownership !== "user" || selectFolder === undefined || relocateRecord === undefined) {
      throw new Error("当前无法重新定位这支团队，请稍后重试。");
    }
    const directory = await selectFolder();
    if (directory === null) {
      return;
    }
    const updated = toOperatorAgentTeam(await relocateRecord({
      teamId: team.id,
      ownership: "user",
      directory,
    }));
    setAgentTeamsState((current) => current.status !== "ready"
      ? current
      : {
          status: "ready",
          teams: current.teams.map((candidate) => candidate.teamKey === teamKey ? updated : candidate),
        });
  }, [agentTeamsState]);

  const removeAgentTeamRecord = useCallback(async (teamKey: string): Promise<void> => {
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const removeRecord = window.moebius?.removeAgentTeamRecord;
    if (team === undefined || team.ownership !== "user" || removeRecord === undefined) {
      throw new Error("当前无法移除这条团队记录，请稍后重试。");
    }
    await removeRecord({ teamId: team.id, ownership: "user" });
    setAgentTeamsState((current) => current.status !== "ready"
      ? current
      : { status: "ready", teams: current.teams.filter((candidate) => candidate.teamKey !== teamKey) });
    setActiveAgentTeamKey((current) => current === teamKey ? null : current);
    setAgentTeamSelection((current) => current?.teamKey === teamKey ? null : current);
    setAgentTeamSaveAllFailures([]);
    setPrimaryAgentChange(null);
  }, [agentTeamsState]);

  const agentTeamDetailState = useMemo<AgentTeamDetailState | null>(() => {
    if (activeAgentTeamKey === null) {
      return null;
    }
    const team = findOperatorAgentTeam(agentTeamsState, activeAgentTeamKey);
    if (team === undefined) {
      return null;
    }
    const selectedMemberSlug = agentTeamSelection?.teamKey === activeAgentTeamKey
      ? agentTeamSelection.memberSlug
      : null;
    const memberEditors: Record<string, AgentTeamMemberEditorState | undefined> = {};
    for (const member of team.members) {
      const editor = getAgentTeamMemberDraft(agentTeamDraftState, activeAgentTeamKey, member.slug);
      if (editor === undefined) {
        continue;
      }
      const identity = editor.loadStatus === "ready"
        ? tryParseAgentMarkdownIdentity(editor.draftMarkdown, {
            displayName: member.displayName,
            description: member.description,
          })
        : { displayName: member.displayName, description: member.description };
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
      };
    }
    return {
      teamKey: activeAgentTeamKey,
      selectedMemberSlug,
      memberEditors,
      saveAllFailures: agentTeamSaveAllFailures,
      primaryAgentChangeStatus: primaryAgentChange?.teamKey === activeAgentTeamKey
        ? primaryAgentChange.status
        : "idle",
      primaryAgentChangeError: primaryAgentChange?.teamKey === activeAgentTeamKey
        ? primaryAgentChange.error
        : null,
    };
  }, [
    activeAgentTeamKey,
    agentTeamDraftState,
    agentTeamSaveAllFailures,
    agentTeamSelection,
    agentTeamsState,
    primaryAgentChange,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function resolveApiBase(): Promise<void> {
      if (apiBase !== null) {
        return;
      }
      const fromWindow = window.MOEBIUS_LOCAL_CONSOLE_URL;
      if (fromWindow) {
        setApiBase(fromWindow);
        return;
      }
      const fromPreload = await window.moebius?.getLocalConsoleUrl?.();
      if (!cancelled && fromPreload) {
        setApiBase(fromPreload);
      }
    }
    void resolveApiBase();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  useEffect(() => {
    let cancelled = false;
    void window.moebius?.getLocalConsoleAttachmentCapability?.().then((capability) => {
      if (!cancelled) setAttachmentCapability(capability);
    });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  useEffect(() => {
    return window.moebius?.onStatus?.((snapshot) => {
      setRunnerStatus(snapshot.runner.status);
      if (snapshot.localConsole?.url) {
        setApiBase(snapshot.localConsole.url);
      }
      if (snapshot.localConsole?.error) {
        setClientError(snapshot.localConsole.error);
      }
    });
  }, []);

  const commitSelection = useCallback((nextSelection: ConsoleSelection) => {
    selectionRef.current = nextSelection;
    setSelection(nextSelection);
  }, []);

  const forgetPersistedSelection = useCallback(() => {
    clearConsoleSelectionPreference(window.localStorage);
    persistedSelectionRef.current = null;
  }, []);

  const rememberConfirmedSelection = useCallback((nextSelection: ConsoleSelection) => {
    if (isSameConsoleSelection(persistedSelectionRef.current, nextSelection)) {
      return;
    }
    writeConsoleSelectionPreference(window.localStorage, nextSelection);
    persistedSelectionRef.current = nextSelection;
  }, []);

  const commitConsoleState = useCallback((nextState: LocalConsoleState) => {
    const nextSelection = {
      projectId: nextState.selectedProjectId,
      sessionId: nextState.selectedSessionId,
    };
    const snapshot = {
      ...nextSelection,
      isRootSession: nextState.selectedSession !== null
        && nextState.selectedSession.parentSessionId == null,
    };
    const startupPending = startupSelectionPendingRef.current;
    const decision = decideConsoleSelectionCommit({
      startupPending,
      persistenceEnabled: selectionPersistenceEnabledRef.current,
      remembered: persistedSelectionRef.current,
      snapshot,
    });
    startupSelectionPendingRef.current = false;
    selectionPersistenceEnabledRef.current = decision.persistenceEnabled;

    if (decision.action === "remember") {
      rememberConfirmedSelection(nextSelection);
    } else if (decision.action === "forget" || decision.action === "open-new-conversation") {
      forgetPersistedSelection();
    }
    if (decision.action === "open-new-conversation") {
      dispatchNewConversation({
        type: "open",
        draft: createNewConversationDraft({
          teamKey: null,
          draft: conversationDraftStoreRef.current.read(NEW_CONVERSATION_DRAFT_KEY),
        }),
      });
    }

    setState(nextState);
  }, [forgetPersistedSelection, rememberConfirmedSelection]);

  useEffect(() => {
    setRightSidebarTabs(rightSidebarTabsStoreRef.current.read(selection.sessionId));
    processOutputsRef.current = {};
    setProcessOutputs({});
    setSubSessionViews({});
  }, [selection.sessionId]);

  const activeProcessSourceKey = activeRightSidebarTab?.type === "run-output"
    ? activeRightSidebarTab.sourceKey
    : null;

  const commitProcessOutputs = useCallback((
    update: (current: Record<string, OperatorProcessOutputState>) => Record<string, OperatorProcessOutputState>,
  ) => {
    setProcessOutputs((current) => {
      const next = update(current);
      processOutputsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    if (apiBase === null || activeProcessSourceKey === null) {
      return;
    }
    const locator = processOutputLocator(activeProcessSourceKey, selection.sessionId);
    if (locator === null) {
      return;
    }
    const { sessionId: processSessionId, runId } = locator;

    const controller = new AbortController();
    let inFlight = false;
    let timer: number | null = null;
    commitProcessOutputs((current) => ({
      ...current,
      [activeProcessSourceKey]: current[activeProcessSourceKey]?.status === "ready"
        ? current[activeProcessSourceKey]!
        : { status: "loading" },
    }));
    const refreshProcessOutput = async (): Promise<void> => {
      if (inFlight) {
        return;
      }
      inFlight = true;
      try {
        const current = processOutputsRef.current[activeProcessSourceKey];
        if (
          current?.status === "ready"
          && current.output.status !== "unavailable"
          && current.output.appendCursor !== null
        ) {
          try {
            const append = await loadProcessOutputAppend({
              apiBase,
              sessionId: processSessionId,
              runId,
              appendCursor: current.output.appendCursor,
              fetch,
              signal: controller.signal,
            });
            if (!controller.signal.aborted) {
              commitProcessOutputs((latest) => {
                const ready = latest[activeProcessSourceKey];
                return ready?.status !== "ready"
                  ? latest
                  : {
                      ...latest,
                      [activeProcessSourceKey]: {
                        ...ready,
                        output: {
                          ...ready.output,
                          events: mergeProcessEvents(ready.output.events, append.events),
                          appendCursor: append.appendCursor,
                          atLatest: append.atLatest,
                          status: append.status,
                        },
                      },
                    };
              });
            }
            return;
          } catch (error) {
            if (
              !(error instanceof ProcessOutputRequestError)
              || error.code !== "PROCESS_CURSOR_INVALID"
            ) {
              throw error;
            }
          }
        }
        const output = await loadProcessOutput({
          apiBase,
          sessionId: processSessionId,
          runId,
          fetch,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          commitProcessOutputs((latest) => {
            const ready = latest[activeProcessSourceKey];
            return {
              ...latest,
              [activeProcessSourceKey]: {
                status: "ready",
                output: ready?.status === "ready"
                  ? mergeRefreshedProcessOutput(ready.output, output)
                  : output,
              },
            };
          });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          commitProcessOutputs((current) => ({
            ...current,
            [activeProcessSourceKey]: current[activeProcessSourceKey]?.status === "ready"
              ? current[activeProcessSourceKey]!
              : { status: "error", message: formatError(error) },
          }));
        }
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) {
          timer = window.setTimeout(() => void refreshProcessOutput(), 1_000);
        }
      }
    };
    void refreshProcessOutput();
    return () => {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      controller.abort("process-output-tab-changed");
    };
  }, [activeProcessSourceKey, apiBase, commitProcessOutputs, selection.sessionId]);

  useEffect(() => {
    if (apiBase === null || activeSubSessionId === null) {
      return;
    }
    const controller = new AbortController();
    let inFlight = false;
    let timer: number | null = null;
    setSubSessionViews((current) => ({
      ...current,
      [activeSubSessionId]: current[activeSubSessionId]?.status === "ready"
        ? current[activeSubSessionId]!
        : { status: "loading" },
    }));
    const refreshSubSessionView = async (): Promise<void> => {
      if (inFlight) {
        return;
      }
      inFlight = true;
      try {
        const view = await loadSubSessionView({
          apiBase,
          sessionId: activeSubSessionId,
          fetch,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setSubSessionViews((current) => ({
            ...current,
            [activeSubSessionId]: { status: "ready", view },
          }));
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setSubSessionViews((current) => ({
            ...current,
            [activeSubSessionId]: { status: "error", message: formatError(error) },
          }));
        }
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) {
          timer = window.setTimeout(() => void refreshSubSessionView(), 1_000);
        }
      }
    };
    void refreshSubSessionView();
    return () => {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      controller.abort("sub-session-tab-changed");
    };
  }, [activeSubSessionId, apiBase]);

  const refresh = useCallback(async (
    targetSelection: ConsoleSelection,
    mutationOwner?: SelectionMutationToken,
  ): Promise<boolean> => {
    if (apiBase === null) {
      return false;
    }
    return refreshConsoleState<LocalConsoleState>({
      apiBase,
      selection: targetSelection,
      coordinator: coordinatorRef.current,
      fetch,
      readSelection: (nextState) => ({
        projectId: nextState.selectedProjectId,
        sessionId: nextState.selectedSessionId,
      }),
      commitState: commitConsoleState,
      commitSelection,
      setError: setClientError,
      mutationOwner,
    });
  }, [apiBase, commitConsoleState, commitSelection]);

  useEffect(() => {
    void refresh(selectionRef.current);
    const timer = window.setInterval(() => {
      if (!coordinatorRef.current.isSelectionMutationPending) {
        void refresh(selectionRef.current);
      }
    }, 1_000);
    return () => {
      window.clearInterval(timer);
      coordinatorRef.current.invalidateRefresh();
    };
  }, [refresh]);

  useEffect(() => {
    if (newConversation === null) {
      setComposerValue(conversationDraftStoreRef.current.read(sessionDraftKey(selection.sessionId)));
    }
  }, [newConversation, selection.sessionId]);

  useEffect(() => {
    if (apiBase === null || state === null || state.selectedSession === null || state.selectedSession.unreadSince === null) {
      return;
    }
    const { sessionId, unreadSince } = state.selectedSession;
    const latestResultIsDisplayed = state.messages.some(
      (message) => message.speaker === "agent" && message.createdAt >= unreadSince,
    );
    if (!latestResultIsDisplayed) {
      return;
    }
    const acknowledgementKey = `${sessionId}:${unreadSince}`;
    if (resultAcknowledgementsRef.current.has(acknowledgementKey)) {
      return;
    }
    resultAcknowledgementsRef.current.add(acknowledgementKey);
    void acknowledgeDisplayedResult({ apiBase, sessionId, unreadSince, fetch })
      .then(async () => {
        await refresh(selectionRef.current);
      })
      .catch((error: unknown) => {
        resultAcknowledgementsRef.current.delete(acknowledgementKey);
        setClientError(formatError(error));
      });
  }, [apiBase, refresh, state]);

  const project = state?.project ?? emptyProject;
  const projects = state?.projects ?? [project];
  const lastError = clientError ?? state?.lastError ?? null;
  const selectedSession = state?.selectedSession ?? null;
  const messages = state?.messages ?? [];
  const messagesWithPreviews = useMessagesWithAttachmentPreviews({
    messages,
    apiBase,
    capability: attachmentCapability,
  });
  const activeSubSessionState = activeSubSessionId === null ? undefined : subSessionViews[activeSubSessionId];
  const activeSubSessionMessages = activeSubSessionState?.status === "ready"
    ? activeSubSessionState.view.messages
    : NO_OPERATOR_MESSAGES;
  const activeSubSessionMessagesWithPreviews = useMessagesWithAttachmentPreviews({
    messages: activeSubSessionMessages,
    apiBase,
    capability: attachmentCapability,
  });
  const subSessionViewsWithPreviews = useMemo(() => {
    if (
      activeSubSessionId === null
      || activeSubSessionState?.status !== "ready"
    ) {
      return subSessionViews;
    }
    return {
      ...subSessionViews,
      [activeSubSessionId]: {
        status: "ready" as const,
        view: {
          ...activeSubSessionState.view,
          messages: activeSubSessionMessagesWithPreviews,
        },
      },
    };
  }, [
    activeSubSessionId,
    activeSubSessionMessagesWithPreviews,
    activeSubSessionState,
    subSessionViews,
  ]);
  const activeRun = state?.activeRun ?? null;
  const activeSubSessionComposerValue = activeSubSessionId === null
    ? ""
    : subSessionComposerValues[activeSubSessionId]
      ?? conversationDraftStoreRef.current.read(sessionDraftKey(activeSubSessionId));
  const activeRuns = state?.activeRuns ?? (activeRun === null ? [] : [activeRun]);
  const sqlitePath = state?.sqlitePath;
  const projectListState = state !== null ? "ready" : clientError === null ? "loading" : "error";

  const actions = useMemo(() => new ConsoleStateActions({
    apiBase,
    coordinator: coordinatorRef.current,
    fetch,
    getSelection: () => selectionRef.current,
    commitSelection,
    refresh,
    composerValue,
    clearComposer: (sessionId) => {
      const targetSessionId = sessionId ?? selectionRef.current.sessionId;
      conversationDraftStoreRef.current.clear(sessionDraftKey(targetSessionId));
      if (selectionRef.current.sessionId === targetSessionId) setComposerValue("");
    },
    getAttachmentIds: () => readyComposerAttachmentIds(managedAttachments.attachments),
    getResumeRunId: (sessionId) =>
      conversationDraftStoreRef.current.readResumeRunId(sessionDraftKey(sessionId)),
    clearAttachments: (sessionId) => managedAttachments.clearDraft(sessionDraftKey(sessionId)),
    clearResumeRunId: (sessionId) =>
      conversationDraftStoreRef.current.clearResumeRunId(sessionDraftKey(sessionId)),
    setMutationKind: setSelectionMutationKind,
    setSending: setIsSending,
    setError: setClientError,
    selectProjectFolder: window.moebius?.selectProjectFolder === undefined
      ? undefined
      : () => window.moebius!.selectProjectFolder!(),
  }), [apiBase, commitSelection, composerValue, managedAttachments, refresh]);

  const editAndResend = useCallback((target: OperatorEditAndResendTarget) => {
    if (state === null) {
      return;
    }
    const targetSessionId = target.sessionId;
    setClientError(null);
    void refillStoppedRunDraft({
      messages: state.messages,
      stoppedMessageId: target.stoppedMessageId,
      stoppedRunId: target.runId,
      sessionId: targetSessionId,
      replaceAttachments: managedAttachments.replaceWithMessageAttachments,
      persistBody: (body) => {
        const draftKey = sessionDraftKey(targetSessionId);
        conversationDraftStoreRef.current.write(draftKey, body);
        if (target.runId !== null) {
          conversationDraftStoreRef.current.writeResumeRunId(draftKey, target.runId);
        }
        if (selectionRef.current.sessionId === targetSessionId) {
          setComposerValue(body);
        }
      },
    }).catch((error: unknown) => setClientError(formatError(error)));
  }, [managedAttachments.replaceWithMessageAttachments, state]);

  const preferredNewConversationTeamKey = useMemo(() => resolveNewConversationAgentTeamKey(
    agentTeamsState.status === "ready" ? agentTeamsState.teams : [],
    lastUsedAgentTeamKey,
    pendingAgentTeamKey,
  ), [agentTeamsState, lastUsedAgentTeamKey, pendingAgentTeamKey]);

  useEffect(() => {
    if (
      pendingAgentTeamKey === null
      || newConversation === null
      || agentTeamsState.status !== "ready"
    ) {
      return;
    }
    const resolvedTeamKey = resolveNewConversationAgentTeamKey(
      agentTeamsState.teams,
      lastUsedAgentTeamKey,
      pendingAgentTeamKey,
    );
    if (newConversation.teamKey !== resolvedTeamKey) {
      dispatchNewConversation({ type: "select-team", teamKey: resolvedTeamKey });
    }
    setPendingAgentTeamKey(null);
  }, [agentTeamsState, lastUsedAgentTeamKey, newConversation, pendingAgentTeamKey]);

  useEffect(() => {
    if (newConversation === null || agentTeamsState.status !== "ready") {
      return;
    }
    const selectionIsUsable = agentTeamsState.teams.some(
      (team) => team.teamKey === newConversation.teamKey && team.canCreateConversation,
    );
    if (!selectionIsUsable && newConversation.teamKey !== preferredNewConversationTeamKey) {
      dispatchNewConversation({ type: "select-team", teamKey: preferredNewConversationTeamKey });
    }
  }, [agentTeamsState, newConversation, preferredNewConversationTeamKey]);

  const startNewConversation = useCallback((projectId?: string) => {
    const selectedProject = projectId === undefined
      ? undefined
      : projects.find((candidate) => candidate.projectId === projectId
        && candidate.directoryAvailable !== false
        && candidate.newConversationDisabledReason == null);
    setClientError(null);
    dispatchNewConversation({
      type: "open",
      draft: createNewConversationDraft({
        projectId: selectedProject?.projectId,
        workspaceMode: selectedProject?.worktreeMode === true ? "worktree" : "direct",
        teamKey: preferredNewConversationTeamKey,
        draft: conversationDraftStoreRef.current.read(NEW_CONVERSATION_DRAFT_KEY),
      }),
    });
  }, [preferredNewConversationTeamKey, projects]);

  const createConversation = useCallback(async (): Promise<void> => {
    if (newConversation === null || !canSubmitNewConversation({
      projectId: newConversation.projectId,
      workspaceMode: newConversation.workspaceMode,
      teamKey: newConversation.teamKey,
      draft: newConversation.draft,
      isSubmitting: newConversation.isSubmitting,
      error: newConversation.error,
      readyAttachmentCount: readyComposerAttachmentIds(managedAttachments.attachments).length,
      hasBlockingAttachments: hasBlockingComposerAttachment(managedAttachments.attachments),
    })) {
      return;
    }
    const projectId = newConversation.projectId!;
    const teamKey = newConversation.teamKey!;
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    if (team === undefined || !team.canCreateConversation) {
      dispatchNewConversation({
        type: "submit-failed",
        error: "所选 Agent 团队当前不能用于新建对话。",
      });
      return;
    }

    dispatchNewConversation({ type: "submit-started" });
    const recordSuccessfulTeam = window.moebius?.recordSuccessfulConversationAgentTeam;
    const result = await submitNewConversation({
      projectId,
      workspaceMode: newConversation.workspaceMode,
      initialMessage: newConversation.draft,
      team: { teamId: team.id, ownership: team.ownership },
      createSessionWithFirstMessage: (targetProjectId, initialMessage, selectedTeam, workspaceMode) =>
        actions.createSessionWithFirstMessage(targetProjectId, initialMessage, {
          ownership: selectedTeam.ownership,
          id: selectedTeam.teamId,
        }, workspaceMode, readyComposerAttachmentIds(managedAttachments.attachments)),
      recordSuccessfulTeam: recordSuccessfulTeam === undefined
        ? async () => undefined
        : (request) => recordSuccessfulTeam(request),
    });
    if (!result.created) {
      dispatchNewConversation({
        type: "submit-failed",
        error: "创建失败，请检查当前项目和 Agent 团队后重试。",
      });
      return;
    }

    selectionPersistenceEnabledRef.current = true;
    rememberConfirmedSelection({ projectId, sessionId: result.sessionId });
    conversationDraftStoreRef.current.clear(NEW_CONVERSATION_DRAFT_KEY);
    managedAttachments.clearDraft(NEW_CONVERSATION_DRAFT_KEY);
    setComposerValue(conversationDraftStoreRef.current.read(sessionDraftKey(result.sessionId)));
    dispatchNewConversation({ type: "close" });
    if (result.preferenceRecorded) {
      setLastUsedAgentTeamKey(team.teamKey);
      setClientError(null);
    } else {
      setClientError(`会话已创建，但无法记住本次使用的 Agent 团队：${formatError(result.preferenceError)}`);
    }
  }, [actions, agentTeamsState, managedAttachments, newConversation, rememberConfirmedSelection]);

  const showProjectInFolder = useCallback(async (folderPath: string) => {
    try {
      if (window.moebius?.showInFolder === undefined) {
        throw new Error("desktop file manager unavailable");
      }
      await window.moebius.showInFolder(folderPath);
      setClientError(null);
    } catch (error) {
      setClientError(formatError(error));
    }
  }, []);

  const renameProject = useCallback(async (projectId: string, title: string) => {
    if (apiBase === null) {
      throw new Error("local console server unavailable");
    }
    setIsProjectMutationPending(true);
    try {
      const response = await fetch(endpoint(apiBase, `/api/local-console/projects/${encodeURIComponent(projectId)}`), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "rename project failed");
      }
      await refresh(selectionRef.current);
      setClientError(null);
    } catch (error) {
      setClientError(formatError(error));
      throw error;
    } finally {
      setIsProjectMutationPending(false);
    }
  }, [apiBase, refresh]);

  const removeProject = useCallback(async (projectId: string, force: boolean) => {
    if (apiBase === null) {
      throw new Error("local console server unavailable");
    }
    setIsProjectMutationPending(true);
    const wasCurrentProject = selectionRef.current.projectId === projectId;
    try {
      const response = await fetch(endpoint(apiBase, `/api/local-console/projects/${encodeURIComponent(projectId)}`), {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "remove project failed");
      }
      if (wasCurrentProject) {
        selectionPersistenceEnabledRef.current = false;
        forgetPersistedSelection();
      }
      await refresh(selectionRef.current);
      if (wasCurrentProject) {
        startNewConversation();
      }
      setClientError(null);
    } catch (error) {
      setClientError(formatError(error));
      throw error;
    } finally {
      setIsProjectMutationPending(false);
    }
  }, [apiBase, forgetPersistedSelection, refresh, startNewConversation]);

  const selectFolderForRepair = useCallback(async (projectId: string): Promise<string | null> => {
    if (window.moebius?.selectFolderForRepair === undefined) {
      throw new Error("desktop repair folder picker unavailable");
    }
    return window.moebius.selectFolderForRepair(projectId);
  }, []);

  const repairProjectFolder = useCallback(async (projectId: string, folderPath: string) => {
    if (apiBase === null) {
      throw new Error("local console server unavailable");
    }
    setIsProjectMutationPending(true);
    try {
      const response = await fetch(endpoint(apiBase, `/api/local-console/projects/${encodeURIComponent(projectId)}`), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderPath }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "repair project folder failed");
      }
      await refresh(selectionRef.current);
      setClientError(null);
    } catch (error) {
      setClientError(formatError(error));
      throw error;
    } finally {
      setIsProjectMutationPending(false);
    }
  }, [apiBase, refresh]);

  const refreshSubSessionNow = useCallback(async (sessionId: string): Promise<void> => {
    if (apiBase === null) {
      return;
    }
    const view = await loadSubSessionView({ apiBase, sessionId, fetch });
    setSubSessionViews((current) => ({
      ...current,
      [sessionId]: { status: "ready", view },
    }));
  }, [apiBase]);

  const interrupt = useCallback(async (sessionId: string, runId: string) => {
    if (apiBase === null) {
      return;
    }
    try {
      await interruptLocalConsoleRun({
        apiBase,
        sessionId,
        runId,
        fetch,
        refresh: () => refresh(selectionRef.current),
      });
      setClientError(null);
    } catch (error) {
      setClientError(formatError(error));
    }
  }, [apiBase, refresh]);

  const sendSubSessionMessage = useCallback(async (sessionId: string) => {
    if (apiBase === null || subSessionSendingId !== null) {
      return;
    }
    const body = subSessionComposerValues[sessionId]
      ?? conversationDraftStoreRef.current.read(sessionDraftKey(sessionId));
    const attachmentIds = readyComposerAttachmentIds(managedSubSessionAttachments.attachments);
    if (body.trim() === "" && attachmentIds.length === 0) {
      return;
    }
    setSubSessionSendingId(sessionId);
    try {
      await submitSessionMessage({ apiBase, sessionId, body, attachmentIds, fetch });
      conversationDraftStoreRef.current.clear(sessionDraftKey(sessionId));
      setSubSessionComposerValues((current) => ({ ...current, [sessionId]: "" }));
      managedSubSessionAttachments.clearDraft(sessionDraftKey(sessionId));
      await Promise.all([
        refreshSubSessionNow(sessionId),
        refresh(selectionRef.current),
      ]);
      setClientError(null);
    } catch (error) {
      setClientError(formatError(error));
    } finally {
      setSubSessionSendingId(null);
    }
  }, [
    apiBase,
    managedSubSessionAttachments.attachments,
    managedSubSessionAttachments.clearDraft,
    refresh,
    refreshSubSessionNow,
    subSessionComposerValues,
    subSessionSendingId,
  ]);

  const retryRun = useCallback(async (sessionId: string, runId: string) => {
    if (apiBase === null || subSessionSendingId !== null) {
      return;
    }
    setSubSessionSendingId(sessionId);
    try {
      await retrySessionRun({ apiBase, sessionId, runId, fetch });
      await Promise.all([
        refreshSubSessionNow(sessionId),
        refresh(selectionRef.current),
      ]);
      setClientError(null);
    } catch (error) {
      setClientError(formatError(error));
    } finally {
      setSubSessionSendingId(null);
    }
  }, [apiBase, refresh, refreshSubSessionNow, subSessionSendingId]);

  const interruptSubSession = useCallback(async (sessionId: string, runId: string) => {
    if (apiBase === null) {
      return;
    }
    try {
      await interruptLocalConsoleRun({
        apiBase,
        sessionId,
        runId,
        fetch,
        refresh: async () => {
          await Promise.all([
            refreshSubSessionNow(sessionId),
            refresh(selectionRef.current),
          ]);
        },
      });
      setClientError(null);
    } catch (error) {
      setClientError(formatError(error));
    }
  }, [apiBase, refresh, refreshSubSessionNow]);

  const openDiagnostics = useMemo(() => {
    if (window.moebius?.openStatusPage === undefined) {
      return undefined;
    }
    return () => {
      void window.moebius?.openStatusPage?.();
    };
  }, []);

  const setSidebarOpen = useCallback((open: boolean) => {
    const preference = open ? "open" : "closed";
    setSidebarVisibilityPreference(preference);
    writeSidebarVisibilityPreference(window.localStorage, preference);
  }, []);

  const setRightSidebarOpen = useCallback((open: boolean) => {
    const preference = open ? "open" : "closed";
    setRightSidebarVisibilityPreference(preference);
    writeRightSidebarVisibilityPreference(window.localStorage, preference);
  }, []);

  const changeRightSidebarWidth = useCallback((width: number) => {
    setRightSidebarWidth(width);
    writeRightSidebarWidthPreference(window.localStorage, width);
  }, []);

  const changeRightSidebarTabs = useCallback((nextState: RightSidebarTabsState) => {
    const sessionId = selectionRef.current.sessionId;
    rightSidebarTabsStoreRef.current.write(sessionId, nextState);
    setRightSidebarTabs(nextState);
  }, []);

  const readWorkspaceDiff = useCallback((sessionId: string) => {
    if (apiBase === null) {
      return Promise.reject(new Error("local console is unavailable"));
    }
    return loadWorkspaceDiff({ apiBase, sessionId, fetch });
  }, [apiBase]);

  const readProjectFiles = useCallback((sessionId: string) => {
    if (apiBase === null) {
      return Promise.reject(new Error("local console is unavailable"));
    }
    return loadProjectFiles({ apiBase, sessionId, fetch });
  }, [apiBase]);

  const readProjectFile = useCallback((sessionId: string, filePath: string) => {
    if (apiBase === null) {
      return Promise.reject(new Error("local console is unavailable"));
    }
    return loadProjectFile({ apiBase, sessionId, filePath, fetch });
  }, [apiBase]);

  const loadPreviousProcessOutput = useCallback((sourceKey: string, cursor: string) => {
    if (apiBase === null) {
      return;
    }
    const selectedSessionId = selectionRef.current.sessionId;
    const locator = processOutputLocator(sourceKey, selectedSessionId);
    const ready = processOutputsRef.current[sourceKey];
    if (locator === null || ready?.status !== "ready" || ready.loadingPrevious === true) {
      return;
    }
    const { sessionId, runId } = locator;
    commitProcessOutputs((current) => ({
      ...current,
      [sourceKey]: current[sourceKey]?.status === "ready"
        ? { ...current[sourceKey], loadingPrevious: true }
        : current[sourceKey] ?? { status: "idle" },
    }));
    void loadProcessOutput({
      apiBase,
      sessionId,
      runId,
      cursor,
      fetch,
    }).then((page) => {
      if (selectionRef.current.sessionId !== selectedSessionId) {
        return;
      }
      commitProcessOutputs((current) => {
        const currentReady = current[sourceKey];
        if (currentReady?.status !== "ready") {
          return current;
        }
        return {
          ...current,
          [sourceKey]: {
            status: "ready",
            loadingPrevious: false,
            output: {
              ...currentReady.output,
              attempts: page.attempts,
              events: mergeProcessEvents(page.events, currentReady.output.events),
              previousCursor: page.previousCursor,
            },
          },
        };
      });
    }).catch((error: unknown) => {
      if (selectionRef.current.sessionId !== selectedSessionId) {
        return;
      }
      commitProcessOutputs((current) => {
        const currentReady = current[sourceKey];
        return currentReady?.status !== "ready"
          ? current
          : {
              ...current,
              [sourceKey]: { ...currentReady, loadingPrevious: false },
            };
      });
      setClientError(formatError(error));
    });
  }, [apiBase, commitProcessOutputs]);

  return (
    <OperatorConsole
      project={project}
      projects={projects}
      selectedProjectId={selection.projectId}
      selectedSessionId={selection.sessionId}
      selectedSession={selectedSession}
      messages={messagesWithPreviews}
      pendingPrimaryMessages={state?.pendingPrimaryMessages ?? []}
      childSessions={state?.childSessions ?? []}
      subSessionViews={subSessionViewsWithPreviews}
      subSessionComposerValue={activeSubSessionComposerValue}
      subSessionComposerAttachments={managedSubSessionAttachments.attachments}
      activeRun={activeRun}
      activeRuns={activeRuns}
      workspaceDiff={state?.workspaceDiff ?? { available: false, fileCount: null, reason: "unavailable" }}
      composerValue={composerValue}
      composerAttachments={managedAttachments.attachments}
      runnerStatus={runnerStatus}
      sqlitePath={sqlitePath}
      lastError={lastError}
      projectListState={projectListState}
      agentTeamsState={agentTeamsState}
      lastUsedAgentTeamKey={lastUsedAgentTeamKey}
      conversationAgentTeamKey={selectedSession?.agentTeamOwnership != null && selectedSession.agentTeamId != null
        ? `${selectedSession.agentTeamOwnership}:${selectedSession.agentTeamId}`
        : null}
      selectedAgentTeamKey={agentTeamSelection?.teamKey}
      selectedAgentTeamMemberSlug={agentTeamSelection?.memberSlug}
      agentTeamDetailState={agentTeamDetailState}
      agentTeamBuilder={{
        state: agentTeamBuilderState,
        onStart: startAgentTeamBuilder,
        onSubmit: submitAgentTeamBuilder,
        onAdjust: adjustAgentTeamBuilder,
        onRetry: retryAgentTeamBuilder,
        onCommit: commitAgentTeamBuilder,
      }}
      newConversation={newConversation === null ? null : {
        selectedProjectId: newConversation.projectId,
        selectedWorkspaceMode: newConversation.workspaceMode,
        selectedTeamKey: newConversation.teamKey,
        draft: newConversation.draft,
        isSubmitting: newConversation.isSubmitting,
        error: newConversation.error ?? clientError,
      }}
      onComposerChange={(value) => {
        conversationDraftStoreRef.current.write(sessionDraftKey(selectionRef.current.sessionId), value);
        setComposerValue(value);
      }}
      onComposerFilesAdded={managedAttachments.addFiles}
      onComposerAttachmentRemove={managedAttachments.remove}
      onComposerAttachmentRetry={managedAttachments.retry}
      onSend={actions.sendMessage}
      onSubSessionComposerChange={(sessionId, value) => {
        conversationDraftStoreRef.current.write(sessionDraftKey(sessionId), value);
        setSubSessionComposerValues((current) => ({ ...current, [sessionId]: value }));
      }}
      onSubSessionComposerFilesAdded={managedSubSessionAttachments.addFiles}
      onSubSessionComposerAttachmentRemove={managedSubSessionAttachments.remove}
      onSubSessionComposerAttachmentRetry={managedSubSessionAttachments.retry}
      onSubSessionSend={(sessionId) => {
        void sendSubSessionMessage(sessionId);
      }}
      onSubSessionRetry={(sessionId, runId) => {
        void retryRun(sessionId, runId);
      }}
      onSubSessionInterrupt={(sessionId, runId) => {
        void interruptSubSession(sessionId, runId);
      }}
      onStartNewConversation={startNewConversation}
      onNewConversationProjectChange={(projectId) => {
        setClientError(null);
        dispatchNewConversation({ type: "select-project", projectId });
        const selectedProject = projects.find((candidate) => candidate.projectId === projectId);
        dispatchNewConversation({
          type: "select-workspace",
          workspaceMode: selectedProject?.worktreeMode === true ? "worktree" : "direct",
        });
      }}
      onNewConversationWorkspaceChange={(workspaceMode) => {
        dispatchNewConversation({ type: "select-workspace", workspaceMode });
      }}
      onNewConversationTeamChange={(teamKey) => {
        dispatchNewConversation({ type: "select-team", teamKey });
      }}
      onNewConversationDraftChange={(value) => {
        conversationDraftStoreRef.current.write(NEW_CONVERSATION_DRAFT_KEY, value);
        dispatchNewConversation({ type: "edit-draft", draft: value });
      }}
      onSubmitNewConversation={() => void createConversation()}
      onAddNewConversationProject={() => {
        void actions.addProject(projects.map((candidate) => candidate.projectId)).then((added) => {
          if (added !== null) {
            setClientError(null);
            dispatchNewConversation({ type: "select-project", projectId: added.projectId });
            dispatchNewConversation({ type: "select-workspace", workspaceMode: "direct" });
          }
        });
      }}
      onReorderProjects={actions.reorderProjects}
      onChangeSessionWorkspace={actions.changeSessionWorkspace}
      onChangeSessionTeam={(sessionId, team) => actions.changeSessionTeam(sessionId, {
        ownership: team.ownership,
        id: team.id,
      })}
      onSelectSession={(nextSelection) => {
        selectionPersistenceEnabledRef.current = true;
        dispatchNewConversation({ type: "close" });
        setComposerValue(conversationDraftStoreRef.current.read(sessionDraftKey(nextSelection.sessionId)));
        setRightSidebarTabs(rightSidebarTabsStoreRef.current.read(nextSelection.sessionId));
        actions.selectSession(nextSelection);
      }}
      onChangeSessionProject={actions.rebindSessionProject}
      onShowProjectInFolder={showProjectInFolder}
      onRenameProject={renameProject}
      onRemoveProject={removeProject}
      onSelectFolderForRepair={selectFolderForRepair}
      onRepairProjectFolder={repairProjectFolder}
      onArchiveSession={actions.archiveSession}
      onCopySessionLogPath={async (sessionId) => {
        const copySessionLogPath = window.moebius?.copySessionLogPath;
        if (copySessionLogPath === undefined) {
          return { ok: false, reason: "service-unavailable" };
        }
        return copySessionLogPath(sessionId);
      }}
      onInterrupt={interrupt}
      onRetryRun={(sessionId, runId) => {
        void retryRun(sessionId, runId);
      }}
      onEditAndResend={editAndResend}
      onOpenDiagnostics={openDiagnostics}
      onOpenExternalLink={window.moebius?.openExternalLink === undefined
        ? undefined
        : (url) => {
          void window.moebius?.openExternalLink?.(url).catch((error: unknown) => {
            setClientError(error instanceof Error ? error.message : String(error));
          });
        }}
      onRetryProjectList={() => {
        setClientError(null);
        void refresh(selectionRef.current);
      }}
      onRetryAgentTeams={() => setAgentTeamsRefreshNonce((current) => current + 1)}
      onCreateAgentTeam={createAgentTeam}
      onOpenAgentTeam={openAgentTeam}
      onCloseAgentTeam={() => {
        setActiveAgentTeamKey(null);
        setAgentTeamSaveAllFailures([]);
        setPrimaryAgentChange(null);
      }}
      onSelectAgentTeamMember={selectAgentTeamMember}
      onChangeAgentTeamPrimaryAgent={changeAgentTeamPrimaryAgent}
      onAddAgentTeamMember={addAgentTeamMember}
      onUpdateAgentTeamInformation={updateAgentTeamInformation}
      onChangeAgentTeamMember={(teamKey, memberSlug, agentMarkdown) => {
        commitAgentTeamDraftState(updateAgentTeamMemberDraft(
          agentTeamDraftStateRef.current,
          teamKey,
          memberSlug,
          agentMarkdown,
        ));
      }}
      onSaveAgentTeamMember={saveAgentTeamMember}
      onCheckAgentTeamMemberExternalChange={checkAgentTeamMemberExternalChange}
      onLoadAgentTeamMemberExternalVersion={loadAgentTeamMemberExternalChange}
      onOverwriteAgentTeamMemberExternalVersion={overwriteAgentTeamMemberExternalChange}
      onRetryAgentTeamMember={(teamKey, memberSlug) => {
        void loadAgentTeamMember(teamKey, memberSlug);
      }}
      onDiscardAgentTeamMember={(teamKey, memberSlug) => {
        commitAgentTeamDraftState(discardAgentTeamMemberDraft(
          agentTeamDraftStateRef.current,
          teamKey,
          memberSlug,
        ));
      }}
      onDiscardAllAgentTeamDrafts={(teamKey) => {
        commitAgentTeamDraftState(discardAllAgentTeamDrafts(agentTeamDraftStateRef.current, teamKey));
        setAgentTeamSaveAllFailures([]);
      }}
      onSaveAllAgentTeamDrafts={saveAllDraftsAndLeave}
      onDuplicateBuiltInAgentTeam={duplicateBuiltInAgentTeam}
      onRecheckAgentTeam={() => setAgentTeamsRefreshNonce((current) => current + 1)}
      onRelocateAgentTeam={relocateAgentTeam}
      onRemoveAgentTeamRecord={removeAgentTeamRecord}
      agentTeamFileManagerLabel={window.moebius?.agentTeamFileManagerLabel ?? "在文件管理器中打开"}
      onOpenAgentTeamLocation={openAgentTeamLocation}
      onDuplicateUserAgentTeam={duplicateUserAgentTeam}
      onDuplicateAgentTeamMember={duplicateAgentTeamMember}
      onTrashAgentTeamMember={trashAgentTeamMember}
      onTrashUserAgentTeam={trashUserAgentTeam}
      isSending={isSending}
      isSubSessionSending={subSessionSendingId !== null}
      isSelectionMutationPending={selectionMutationKind !== null}
      isSessionProjectUpdating={selectionMutationKind === "rebind-session"}
      isProjectMutationPending={isProjectMutationPending}
      sidebarOpen={sidebarVisibilityPreference === "open"}
      onSidebarOpenChange={setSidebarOpen}
      rightSidebarOpen={rightSidebarVisibilityPreference === "open"}
      rightSidebarWidth={rightSidebarWidth}
      rightSidebarTabs={rightSidebarTabs}
      processOutputs={processOutputs}
      onRightSidebarOpenChange={setRightSidebarOpen}
      onRightSidebarWidthChange={changeRightSidebarWidth}
      onRightSidebarTabsChange={changeRightSidebarTabs}
      onLoadWorkspaceDiff={readWorkspaceDiff}
      onLoadProjectFiles={readProjectFiles}
      onLoadProjectFile={readProjectFile}
      onLoadProcessOutputPrevious={loadPreviousProcessOutput}
    />
  );
}

function mergeRefreshedProcessOutput(
  current: OperatorProcessOutput,
  incoming: OperatorProcessOutput,
): OperatorProcessOutput {
  if (
    current.status === "unavailable"
    || incoming.status === "unavailable"
    || incoming.attempts.length <= current.attempts.length
  ) {
    return incoming;
  }
  return {
    ...incoming,
    events: mergeProcessEvents(current.events, incoming.events),
    previousCursor: current.previousCursor,
  };
}

function mergeProcessEvents(
  before: readonly OperatorProcessTimelineEvent[],
  after: readonly OperatorProcessTimelineEvent[],
): OperatorProcessTimelineEvent[] {
  const seen = new Set<string>();
  return [...before, ...after].filter((event) => {
    if (seen.has(event.key)) {
      return false;
    }
    seen.add(event.key);
    return true;
  });
}

function toTeamBuilderViewState(state: AiTeamBuilderState): TeamBuilderViewState {
  return {
    phase: state.phase,
    messages: state.messages.map((message) => ({ ...message })),
    proposal: state.proposal === null
      ? null
      : {
          team: { ...state.proposal.team },
          members: state.proposal.members.map((member) => ({
            ...member,
            responsibilities: [...member.responsibilities],
            handoffs: [...member.handoffs],
          })),
          primaryAgentSlug: state.proposal.primaryAgentSlug,
          relayBeats: state.proposal.relayBeats.map((beat) => ({ ...beat })),
        },
    proposalRevision: state.proposalRevision,
    error: state.error === null ? null : { ...state.error },
  };
}

function createAgentTeamBuilderDraftId(): string {
  const suffix = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `agent-teams-${suffix}`;
}

function isSafeAiTeamBuilderDraftId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value);
}

const emptyProject: OperatorProject = {
  projectId: "local",
  sourceType: "local-folder",
  title: "moebius",
  folderPath: "",
  worktreeMode: false,
  workspaceCwd: null,
  workspaceMode: null,
  worktreePath: null,
  worktreeUnavailableReason: null,
  workspaceUpdatedAt: null,
  branchName: null,
  isGitRepository: false,
  directoryAvailable: true,
  directoryUnavailableReason: null,
  sessions: [],
  runningCount: 0,
  waitingCount: 0,
  stuckCount: 0,
  errorCount: 0,
};

const NO_OPERATOR_MESSAGES: OperatorMessage[] = [];

function endpoint(base: string, path: string): URL {
  return new URL(path.replace(/^\//u, ""), base.endsWith("/") ? base : `${base}/`);
}

function toOperatorAgentTeam(team: AgentTeamListItem): OperatorAgentTeam {
  return {
    teamKey: getAgentTeamKey(team),
    id: team.id,
    ownership: team.ownership,
    name: team.definition?.name ?? null,
    description: team.definition?.description ?? null,
    primaryAgentSlug: team.definition?.primaryAgentSlug ?? null,
    memberOrder: team.definition?.memberOrder ?? [],
    members: team.members.map((member) => ({ ...member, available: member.available !== false })),
    status: team.status,
    canCreateConversation: team.canCreateConversation,
    issues: team.issues,
  };
}

function getAgentTeamIdentityKey(team: LastUsedAgentTeam): string {
  return `${team.ownership}:${team.teamId}`;
}

function findOperatorAgentTeam(state: OperatorAgentTeamsState, teamKey: string): OperatorAgentTeam | undefined {
  return state.status === "ready"
    ? state.teams.find((team) => team.teamKey === teamKey)
    : undefined;
}

function readQueryApiBase(): string | null {
  const value = new URLSearchParams(window.location.search).get("api");
  return value?.trim() || null;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const rootElement = document.getElementById("root");
if (rootElement !== null) {
  createRoot(rootElement).render(<App />);
}
