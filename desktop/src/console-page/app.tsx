import "@moebius/console-ui/globals.css";

import {
  useI18n,
  OperatorConsole,
  resolveNewConversationAgentTeamKey,
  type AgentTeamSaveAllFailureView,
  type OperatorMessage,
  type OperatorPendingDispatch,
  type OperatorMemberIdentity,
  type OperatorAgentTeam,
  type AnalysisPanelEntry,
  type OperatorChildSessionSummary,
  type OperatorEditAndResendTarget,
  type OperatorProject,
  type OperatorProcessOutput,
  type OperatorProcessOutputState,
  type OperatorProcessInvocationState,
  type OperatorProcessTimelineEvent,
  type OperatorRunSnapshot,
  type OperatorRunnerStatus,
  type OperatorSession,
  type OperatorSubSessionViewState,
  type RightSidebarTabsState,
  type TranslationKey,
  type ExecutionRegistryState,
  hasBlockingComposerAttachment,
  readyComposerAttachmentIds,
  type OperatorWorkspaceDiffSummary,
  processInvocationKey,
  openRightSidebarSourceTab,
  createRunOutputSourceKey,
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
  AgentTeamExecutionProfileDocument,
  AgentTeamExecutionProfileSaveRequest,
  AgentTeamOfficialUpdateCommitRequest,
  AgentTeamOfficialUpdateCommitResponse,
  AgentTeamOfficialUpdatePrepareResponse,
  AgentTeamOfficialUpdateRequest,
  AgentTeamPrimaryAgentWriteRequest,
  AgentTeamUpdateInformationRequest,
  AgentTeamTrashUserRequest,
} from "../team-ipc-contract.js";
import type { AgentTeamRelocateRequest, AgentTeamRepairRequest } from "../team-repair-contract.js";
import type {
  AgentTeamFileManagerKind,
  AgentTeamFileManagerRequest,
} from "../team-file-manager-contract.js";
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
  OnboardingCli,
  OnboardingCliReadinessSnapshot,
  OnboardingCliReadinessState,
} from "../onboarding/cli-readiness-contract.js";
import type {
  OnboardingCliInstallSnapshot,
  OnboardingCliInstallState,
} from "../onboarding/cli-installer-contract.js";
import type {
  AgentTeamExternalChangeRequest,
  AgentTeamExternalChangeResponse,
} from "../team-external-change-contract.js";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  loadProcessOutput,
  loadProcessOutputUpdate,
  loadProcessDebugInvocation,
  loadFileReference,
  loadProjectFile,
  loadProjectFiles,
  loadSubSessionView,
  loadExecutionProfileRegistry,
  loadWorkspaceDiff,
  submitSessionMessage,
  retryPendingSessionMessage,
  updatePendingSessionMessage,
  removePendingSessionMessage,
  retrySessionRun,
  createSidebarConversationSession,
  loadSessionReferenceText,
  restoreConsoleSession,
  type SessionSearchResult,
} from "./console-api-client.js";
import { ConsoleStateActions } from "./console-state-actions.js";
import { browserConsoleCommandPort } from "./console-command-client.js";
import { refreshConsoleState } from "./refresh-console-state.js";
import {
  mergeProcessEvents,
  mergeRefreshedProcessOutput,
  mergeSettledProcessOutput,
  processOutputLocator,
  subSessionIdFromSourceKey,
} from "./console-process-model.js";
import {
  planAnalysisRootSession,
  planCanonicalConversationTabTitles,
  planConversationProjectContext,
  planConversationTabDiscriminators,
} from "./console-presentation-model.js";
import {
  planAgentTeamFileManagerTranslationKey,
  planFindOperatorAgentTeam,
  planAgentTeamDetailState,
} from "./agent-team-console-model.js";
import {
  EMPTY_CONSOLE_PROJECT,
  NO_OPERATOR_MESSAGES,
} from "./console-default-state.js";
import { planConsoleEndpoint } from "./console-state-plan.js";
import {
  ConsoleStateCoordinator,
  ProcessInvocationRequestCoordinator,
  type ConsoleSelection,
  type SelectionMutationKind,
} from "./console-state-coordinator.js";
import { fetchFromBrowser as fetch } from "./browser-fetch.js";
import { managedAttachmentClient } from "./attachment-client.js";
import {
  activateConversationComposerDraft,
  clearConversationComposerDraft,
  editConversationComposerDraft,
  type ConversationComposerDraftState,
  NEW_CONVERSATION_DRAFT_KEY,
  sessionDraftKey,
} from "./conversation-draft-model.js";
import { createConversationDraftStore } from "./draft-store.js";
import {
  readSidebarVisibilityPreference,
  writeSidebarVisibilityPreference,
  type SidebarVisibilityPreference,
} from "./sidebar-preference.js";
import {
  clearConsoleSelectionPreference,
  decideConsoleSelectionCommit,
  isSameConsoleSelection,
  readConsoleSelectionPreference,
  writeConsoleSelectionPreference,
} from "./selection-preference.js";
import {
  createNewConversationDraft,
  reduceNewConversationDraft,
} from "./new-conversation.js";
import {
  readRightSidebarVisibilityPreference,
  readRightSidebarWidthPreference,
  writeRightSidebarVisibilityPreference,
  writeRightSidebarWidthPreference,
  type RightSidebarVisibilityPreference,
} from "./right-sidebar-preference.js";
import {
  conversationDraftTabSourceKey,
  conversationTabSourceKey,
  createRightSidebarTabsStore,
  parseConversationTabSourceKey,
} from "./right-sidebar-tabs-store.js";
import {
  createSidebarConversationDraft,
  createSidebarConversationDraftStore,
  sidebarConversationDraftRequiresDiscardConfirmation,
  type SidebarConversationDraftAttachmentPresence,
  type SidebarConversationDraft,
} from "./sidebar-conversation-drafts.js";
import {
  createConsolePresentationRouteStore,
  ordinaryPresentationRoute,
  sidebarPresentationRoute,
  type ConsolePresentationRoute,
} from "./presentation-route.js";
import { createConversationReadingPositionStore } from "./conversation-reading-position.js";
import {
  discardAgentTeamMemberDraft,
  discardAllAgentTeamDrafts,
  getAgentTeamKey,
  updateAgentTeamMemberDraft,
} from "./team-state.js";
import {
  useManagedAttachmentDrafts,
} from "./use-managed-attachments.js";
import { useMessagesWithAttachmentPreviews } from "./use-message-attachment-previews.js";
import { interruptLocalConsoleRun } from "./interrupt.js";
import { refillStoppedRunDraft } from "./edit-resend.js";
import type { CopySessionLogPathResult } from "../session-log-clipboard.js";
import type { DesktopLocale } from "../language-preference-contract.js";
import type {
  SettingsApplicationInfo,
  SettingsUpdateCheckResult,
  SettingsVersionCopyResult,
} from "../settings-contract.js";
import { useDesktopSettingsBundle } from "./use-desktop-settings.js";
import { useActiveCliInstallationsBundle } from "./use-active-cli-installations.js";
import { useAgentTeamConsole } from "./use-agent-team-console.js";
import { browserConversationSearchPort } from "./conversation-search-browser-client.js";
import { ConversationSearchOverlay } from "./conversation-search-overlay.js";
import { useConversationSearch } from "./use-conversation-search.js";
import { useConversationNavigation } from "./use-conversation-navigation.js";
import { useConversationTransition } from "./use-conversation-transition.js";
import { useNewConversationSubmission } from "./use-new-conversation-submission.js";
import { useConsoleStateSync } from "./use-console-state-sync.js";
import { browserConsoleStateSyncPort } from "./console-state-sync-browser-port.js";
import {
  DesktopApplicationRoot,
  useDesktopLanguage,
} from "./desktop-application-root.js";

export interface DesktopApi {
  readLanguagePreference?: () => Promise<DesktopLocale>;
  saveLanguagePreference?: (locale: DesktopLocale) => Promise<DesktopLocale>;
  onLanguagePreferenceChanged?: (
    listener: (locale: DesktopLocale) => void,
  ) => () => void;
  getLocalConsoleUrl?: () => Promise<string | null>;
  getLocalConsoleAttachmentCapability?: () => Promise<string | null>;
  copySessionLogPath?: (sessionId: string) => Promise<CopySessionLogPathResult>;
  readApplicationInfo?: () => Promise<SettingsApplicationInfo>;
  checkForUpdates?: () => Promise<SettingsUpdateCheckResult>;
  copyVersionInfo?: () => Promise<SettingsVersionCopyResult>;
  onStatus?: (listener: (snapshot: DesktopStatusSnapshot) => void) => () => void;
  openStatusPage?: () => Promise<void>;
  selectProjectFolder?: () => Promise<string | null>;
  selectFolderForRepair?: (projectId: string) => Promise<string | null>;
  showInFolder?: (folderPath: string) => Promise<void>;
  readonly agentTeamFileManagerKind?: AgentTeamFileManagerKind;
  openAgentTeamLocation?: (request: AgentTeamFileManagerRequest) => Promise<void>;
  listAgentTeams?: () => Promise<AgentTeamListResponse>;
  resolveAgentTeamSeedConflict?: () => Promise<AgentTeamListResponse>;
  showAgentTeamSeedConflictLocation?: () => Promise<void>;
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
  readAgentTeamExecutionProfile?: (
    request: AgentTeamMemberRequest,
  ) => Promise<AgentTeamExecutionProfileDocument>;
  saveAgentTeamExecutionProfile?: (
    request: AgentTeamExecutionProfileSaveRequest,
  ) => Promise<AgentTeamExecutionProfileDocument>;
  restoreAgentTeamRecommendedProfile?: (
    request: AgentTeamMemberRequest,
  ) => Promise<AgentTeamExecutionProfileDocument>;
  prepareAgentTeamOfficialUpdate?: (
    request: AgentTeamOfficialUpdateRequest,
  ) => Promise<AgentTeamOfficialUpdatePrepareResponse>;
  applyAgentTeamOfficialUpdate?: (
    request: AgentTeamOfficialUpdateCommitRequest,
  ) => Promise<AgentTeamOfficialUpdateCommitResponse>;
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
  getOnboardingCliReadinessState?: () => Promise<OnboardingCliReadinessState>;
  checkOnboardingCliReadiness?: (cli: OnboardingCli) => Promise<OnboardingCliReadinessSnapshot>;
  getOnboardingCliInstallState?: () => Promise<OnboardingCliInstallState>;
  onOnboardingCliInstallSnapshot?: (
    listener: (snapshot: OnboardingCliInstallSnapshot) => void,
  ) => () => void;
  startOnboardingCliInstall?: (cli: OnboardingCli) => Promise<OnboardingCliInstallSnapshot>;
  startOnboardingClaudeUpdate?: () => Promise<OnboardingCliInstallSnapshot>;
  cancelOnboardingCliInstall?: (cli: OnboardingCli) => Promise<OnboardingCliInstallSnapshot>;
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
  pendingDispatchMessages?: OperatorPendingDispatch[];
  pendingPrimaryMessages: OperatorMessage[];
  childSessions: OperatorChildSessionSummary[];
  memberIdentities: OperatorMemberIdentity[];
  activeRun: OperatorRunSnapshot | null;
  activeRuns: OperatorRunSnapshot[];
  workspaceDiff: OperatorWorkspaceDiffSummary;
  sqlitePath: string;
  lastError: string | null;
}

declare global {
  interface Window {
    moebius?: DesktopApi;
    MOEBIUS_LOCAL_CONSOLE_URL?: string;
  }
}

export function App(): JSX.Element {
  return <DesktopApplicationRoot operatorConsole={OperatorConsoleApp} />;
}


export function OperatorConsoleApp({
  pendingAgentTeamKey: initialPendingAgentTeamKey = null,
  onReplayOnboarding,
}: {
  pendingAgentTeamKey?: string | null;
  onReplayOnboarding?: () => void;
}): JSX.Element {
  const language = useDesktopLanguage();
  const { t } = useI18n();
  const [apiBase, setApiBase] = useState<string | null>(readQueryApiBase());
  const conversationSearchBundle = useConversationSearch(
    { apiBase, port: browserConversationSearchPort },
  );
  const [executionRegistryState, setExecutionRegistryState] =
    useState<ExecutionRegistryState>({ status: "loading" });
  const [executionRegistryReload, setExecutionRegistryReload] = useState(0);
  const [attachmentCapability, setAttachmentCapability] = useState<string | null>(null);
  const [sessionAnalysisNotice, setSessionAnalysisNotice] = useState<string | null>(null);
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
  const stateRef = useRef<LocalConsoleState | null>(null);
  const conversationDraftStoreRef = useRef(createConversationDraftStore(window.localStorage));
  const rightSidebarTabsStoreRef = useRef(createRightSidebarTabsStore(window.localStorage));
  const sidebarConversationDraftStoreRef = useRef(
    createSidebarConversationDraftStore(window.localStorage),
  );
  const presentationRouteStoreRef = useRef(createConsolePresentationRouteStore(window.localStorage));
  const [presentationRoute, setPresentationRoute] = useState<ConsolePresentationRoute | null>(() =>
    presentationRouteStoreRef.current.read(),
  );
  const presentationRouteRef = useRef<ConsolePresentationRoute | null>(presentationRoute);
  const [sidebarConversationDrafts, setSidebarConversationDrafts] = useState<SidebarConversationDraft[]>(() =>
    sidebarConversationDraftStoreRef.current.list(),
  );
  const conversationReadingPositionStoreRef = useRef(
    createConversationReadingPositionStore(window.localStorage),
  );
  const [rightSidebarTabs, setRightSidebarTabs] = useState<RightSidebarTabsState>(() =>
    rightSidebarTabsStoreRef.current.read(
      presentationRouteStoreRef.current.read()?.hostSessionId ?? selection.sessionId,
    ),
  );
  const [rightSidebarFocusRequest, setRightSidebarFocusRequest] = useState<{
    hostSessionId: string;
    tabId: string;
  } | null>(null);
  const [conversationMessageNavigation, setConversationMessageNavigation] = useState<{
    sessionId: string;
    messageId: number;
    requestId: number;
  } | null>(null);
  const conversationMessageNavigationIdRef = useRef(0);
  const [processOutputs, setProcessOutputs] = useState<Record<string, OperatorProcessOutputState>>({});
  const processOutputsRef = useRef(processOutputs);
  const [processInvocationStates, setProcessInvocationStates] = useState<
    Record<string, OperatorProcessInvocationState>
  >({});
  const processInvocationStatesRef = useRef(processInvocationStates);
  const processInvocationRequestsRef = useRef(new ProcessInvocationRequestCoordinator());
  const [subSessionViews, setSubSessionViews] = useState<Record<string, OperatorSubSessionViewState>>({});
  const [sidebarConversationViews, setSidebarConversationViews] =
    useState<Record<string, OperatorSubSessionViewState>>({});
  const [sidebarConversationComposerValues, setSidebarConversationComposerValues] =
    useState<Record<string, string>>({});
  const [sidebarConversationSendingId, setSidebarConversationSendingId] = useState<string | null>(null);
  const [updatingConversationTitleSessionIds, setUpdatingConversationTitleSessionIds] =
    useState<Set<string>>(() => new Set());
  const sourceMigrationRef = useRef<string | null>(null);
  const [subSessionComposerValues, setSubSessionComposerValues] = useState<Record<string, string>>({});
  const [subSessionSendingId, setSubSessionSendingId] = useState<string | null>(null);
  const [composerDraft, setComposerDraft] = useState<ConversationComposerDraftState>(() => {
    const key = sessionDraftKey(selection.sessionId);
    return { key, value: conversationDraftStoreRef.current.read(key) };
  });
  const composerDraftRef = useRef(composerDraft);
  const commitComposerDraft = useCallback((next: ConversationComposerDraftState) => {
    composerDraftRef.current = next;
    setComposerDraft(next);
  }, []);
  const activateComposerDraft = useCallback((sessionId: string) => {
    const key = sessionDraftKey(sessionId);
    commitComposerDraft(activateConversationComposerDraft(
      composerDraftRef.current,
      key,
      conversationDraftStoreRef.current.read(key),
    ));
  }, [commitComposerDraft]);
  const clearComposerDraft = useCallback((sessionId: string) => {
    const key = sessionDraftKey(sessionId);
    conversationDraftStoreRef.current.clear(key);
    commitComposerDraft(clearConversationComposerDraft(composerDraftRef.current, key));
  }, [commitComposerDraft]);
  const [runnerStatus, setRunnerStatus] = useState<OperatorRunnerStatus>("stopped");
  const [isSending, setIsSending] = useState(false);
  const [selectionMutationKind, setSelectionMutationKind] = useState<SelectionMutationKind | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const settingsBundle = useDesktopSettingsBundle(window.moebius);
  const [isProjectMutationPending, setIsProjectMutationPending] = useState(false);
  const [newConversation, dispatchNewConversation] = useReducer(reduceNewConversationDraft, null);
  const agentTeamControllersBundle = useAgentTeamConsole(
    window.moebius, window.localStorage, createAgentTeamBuilderDraftId, t,
  );
  const agentTeamCatalogBundle = agentTeamControllersBundle.catalog;
  const agentTeamMemberBundle = agentTeamControllersBundle.member;
  const agentTeamNavigationBundle = agentTeamControllersBundle.navigation;
  const agentTeamProfileBundle = agentTeamControllersBundle.profile;
  const agentTeamRegistrationBundle = agentTeamControllersBundle.registration;
  const agentTeamCopyBundle = agentTeamControllersBundle.copy;
  const agentTeamMemberMutationBundle = agentTeamControllersBundle.memberMutations;
  const agentTeamRecordMutationBundle = agentTeamControllersBundle.recordMutations;
  const agentTeamBuilderBundle = agentTeamControllersBundle.builder;
  const cliInstallationsBundle = useActiveCliInstallationsBundle(window.moebius);
  const [pendingAgentTeamKey, setPendingAgentTeamKey] = useState<string | null>(
    initialPendingAgentTeamKey,
  );
  const [sidebarVisibilityPreference, setSidebarVisibilityPreference] = useState<SidebarVisibilityPreference>(() =>
    readSidebarVisibilityPreference(window.localStorage),
  );
  const [rightSidebarVisibilityPreference, setRightSidebarVisibilityPreference] =
    useState<RightSidebarVisibilityPreference>(() => readRightSidebarVisibilityPreference(window.localStorage));
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() =>
    readRightSidebarWidthPreference(window.localStorage),
  );
  const [analysisPanelOpenBySession, setAnalysisPanelOpenBySession] =
    useState<Record<string, boolean>>({});
  const resultAcknowledgementsRef = useRef(new Set<string>());
  const activeRightSidebarTab = rightSidebarTabs.tabs.find(
    (tab) => tab.id === rightSidebarTabs.activeTabId,
  ) ?? null;
  const activeSubSessionId = activeRightSidebarTab?.type === "sub-session"
    ? subSessionIdFromSourceKey(activeRightSidebarTab.sourceKey)
    : null;
  const activeConversationLocator = activeRightSidebarTab?.type === "conversation"
    ? parseConversationTabSourceKey(activeRightSidebarTab.sourceKey)
    : null;
  const activeSidebarConversationSessionId = activeConversationLocator?.kind === "session"
    ? activeConversationLocator.sessionId
    : null;
  const activeSidebarConversationDraftId = activeConversationLocator?.kind === "draft"
    ? activeConversationLocator.draftId
    : null;
  const activeSidebarConversationDraft = activeSidebarConversationDraftId === null
    ? null
    : sidebarConversationDrafts.find((draft) => draft.draftId === activeSidebarConversationDraftId) ?? null;
  const currentAttachmentDraftKey = newConversation?.isOpen !== true
    ? composerDraft.key
    : NEW_CONVERSATION_DRAFT_KEY;
  const activeSubSessionDraftKey = sessionDraftKey(activeSubSessionId ?? "__inactive-sub-session__");
  const activeSidebarConversationAttachmentDraftKey = activeSidebarConversationDraft?.attachmentDraftKey
    ?? (activeSidebarConversationSessionId === null
      ? "draft:sidebar:__inactive__"
      : sessionDraftKey(activeSidebarConversationSessionId));
  const reportAttachmentError = useCallback((error: string) => setClientError(error), []);
  const recordSidebarDraftAttachmentPresence = useCallback((
    draftKey: string,
    presence: SidebarConversationDraftAttachmentPresence,
  ) => {
    if (!sidebarConversationDraftStoreRef.current.setManagedAttachmentPresence(draftKey, presence)) {
      return;
    }
    setSidebarConversationDrafts(sidebarConversationDraftStoreRef.current.list());
  }, []);
  const managedAttachments = useManagedAttachmentDrafts({
    client: managedAttachmentClient,
    apiBase,
    capability: attachmentCapability,
    currentDraftKey: currentAttachmentDraftKey,
    onError: reportAttachmentError,
  });
  const managedSubSessionAttachments = useManagedAttachmentDrafts({
    client: managedAttachmentClient,
    apiBase,
    capability: attachmentCapability,
    currentDraftKey: activeSubSessionDraftKey,
    onError: reportAttachmentError,
  });
  const managedSidebarConversationAttachments = useManagedAttachmentDrafts({
    client: managedAttachmentClient,
    apiBase,
    capability: attachmentCapability,
    currentDraftKey: activeSidebarConversationAttachmentDraftKey,
    onError: reportAttachmentError,
    onDraftAttachmentPresenceChange: recordSidebarDraftAttachmentPresence,
  });

  useEffect(() => {
    stateRef.current = state;
    if (state === null) return;
    conversationReadingPositionStoreRef.current.retain(
      state.projects.flatMap((candidate) =>
        candidate.sessions
          .filter((session) => session.parentSessionId == null)
          .map((session) => session.sessionId)),
    );
  }, [state]);
  const agentTeamDetailState = useMemo(() => planAgentTeamDetailState({
    activeTeamKey: agentTeamNavigationBundle.activeTeamKey,
    catalog: agentTeamCatalogBundle.state,
    selection: agentTeamCatalogBundle.selection,
    drafts: agentTeamMemberBundle.drafts,
    saveAllFailures: agentTeamMemberBundle.saveAllFailures,
    primaryAgentChange: agentTeamProfileBundle.primaryAgentChange,
  }), [
    agentTeamNavigationBundle.activeTeamKey,
    agentTeamMemberBundle.drafts,
    agentTeamMemberBundle.saveAllFailures,
    agentTeamCatalogBundle.selection,
    agentTeamCatalogBundle.state,
    agentTeamProfileBundle.primaryAgentChange,
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
    if (apiBase === null) {
      setExecutionRegistryState({ status: "loading" });
      return;
    }
    const controller = new AbortController();
    setExecutionRegistryState({ status: "loading" });
    void loadExecutionProfileRegistry({
      apiBase,
      fetch: window.fetch.bind(window),
      signal: controller.signal,
    }).then((registry) => {
      if (!controller.signal.aborted) {
        setExecutionRegistryState({ status: "ready", registry });
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setExecutionRegistryState({ status: "error", message: "" });
      }
    });
    return () => controller.abort();
  }, [apiBase, executionRegistryReload]);

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

  const commitPresentationRoute = useCallback((route: ConsolePresentationRoute) => {
    presentationRouteStoreRef.current.write(route);
    presentationRouteRef.current = route;
    setPresentationRoute(route);
  }, []);

  const setRightSidebarOpen = useCallback((open: boolean) => {
    const preference = open ? "open" : "closed";
    setRightSidebarVisibilityPreference(preference);
    writeRightSidebarVisibilityPreference(window.localStorage, preference);
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
        && nextState.selectedSession.parentSessionId == null
        && nextState.selectedSession.analysisParentSessionId == null,
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

    stateRef.current = nextState;
    setState(nextState);
  }, [forgetPersistedSelection, rememberConfirmedSelection]);

  useEffect(() => {
    processInvocationRequestsRef.current.abortAll();
    setRightSidebarTabs(rightSidebarTabsStoreRef.current.read(
      presentationRoute?.hostSessionId ?? selection.sessionId,
    ));
    processOutputsRef.current = {};
    setProcessOutputs({});
    processInvocationStatesRef.current = {};
    setProcessInvocationStates({});
    setSubSessionViews({});
  }, [presentationRoute?.hostSessionId, selection.sessionId]);

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

  const commitProcessInvocationStates = useCallback((
    update: (
      current: Record<string, OperatorProcessInvocationState>,
    ) => Record<string, OperatorProcessInvocationState>,
  ) => {
    setProcessInvocationStates((current) => {
      const next = update(current);
      processInvocationStatesRef.current = next;
      return next;
    });
  }, []);

  const readProcessDebugInvocation = useCallback((sessionId: string, runId: string) => {
    if (apiBase === null) {
      return;
    }
    const key = processInvocationKey(sessionId, runId);
    const current = processInvocationStatesRef.current[key];
    if (current?.status === "loading" || current?.status === "ready") {
      return;
    }
    const controller = processInvocationRequestsRef.current.begin(key);
    commitProcessInvocationStates((states) => ({
      ...states,
      [key]: { status: "loading" },
    }));
    void loadProcessDebugInvocation({
      apiBase,
      sessionId,
      runId,
      fetch,
      signal: controller.signal,
    }).then((invocation) => {
      if (!processInvocationRequestsRef.current.finish(key, controller)) {
        return;
      }
      commitProcessInvocationStates((states) => ({
        ...states,
        [key]: { status: "ready", invocation },
      }));
    }).catch((error: unknown) => {
      if (!processInvocationRequestsRef.current.finish(key, controller)) {
        return;
      }
      commitProcessInvocationStates((states) => ({
        ...states,
        [key]: { status: "error", message: formatError(error) },
      }));
    });
  }, [apiBase, commitProcessInvocationStates]);

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
          const update = await loadProcessOutputUpdate({
            apiBase,
            sessionId: processSessionId,
            runId,
            appendCursor: current.output.appendCursor,
            currentStatus: current.output.status,
            fetch,
            signal: controller.signal,
          });
          if (!controller.signal.aborted) {
            commitProcessOutputs((latest) => {
              const ready = latest[activeProcessSourceKey];
              if (ready?.status !== "ready") {
                return latest;
              }
              const output = update.kind === "append"
                ? {
                    ...ready.output,
                    events: mergeProcessEvents(ready.output.events, update.append.events),
                    appendCursor: update.append.appendCursor,
                    atLatest: update.append.atLatest,
                    status: update.append.status,
                  }
                : update.reason === "settled"
                  ? mergeSettledProcessOutput(ready.output, update.output)
                  : mergeRefreshedProcessOutput(ready.output, update.output);
              return {
                ...latest,
                [activeProcessSourceKey]: {
                  ...ready,
                  output,
                },
              };
            });
          }
          return;
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

  useEffect(() => {
    if (
      apiBase === null
      || activeSidebarConversationSessionId === null
    ) {
      return;
    }
    const sessionId = activeSidebarConversationSessionId;
    const controller = new AbortController();
    let timer: number | null = null;
    let inFlight = false;
    setSidebarConversationViews((current) => ({
      ...current,
      [sessionId]: current[sessionId]?.status === "ready"
        ? current[sessionId]!
        : { status: "loading" },
    }));
    const refreshView = async (): Promise<void> => {
      if (inFlight) return;
      inFlight = true;
      try {
        const view = await loadSubSessionView({
          apiBase,
          sessionId,
          fetch,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setSidebarConversationViews((current) => ({
            ...current,
            [sessionId]: { status: "ready", view },
          }));
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setSidebarConversationViews((current) => ({
            ...current,
            [sessionId]: { status: "error", message: formatError(error) },
          }));
        }
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) {
          timer = window.setTimeout(() => void refreshView(), 1_000);
        }
      }
    };
    void refreshView();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      controller.abort("sidebar-conversation-tab-changed");
    };
  }, [activeSidebarConversationSessionId, apiBase]);

  const stateSyncBundle = useConsoleStateSync(
    apiBase, state, coordinatorRef.current, selectionRef, commitConsoleState, commitSelection,
    setClientError, newConversation?.isOpen === true, selection.sessionId, activateComposerDraft,
    resultAcknowledgementsRef, browserConsoleStateSyncPort,
  );
  const refresh = stateSyncBundle.refresh;

  const project = state?.project ?? EMPTY_CONSOLE_PROJECT;
  const projects = state?.projects ?? [project];
  const selectedSession = state?.selectedSession ?? null;
  const messages = state?.messages ?? [];
  const messagesWithPreviews = useMessagesWithAttachmentPreviews({
    client: managedAttachmentClient,
    messages,
    apiBase,
    capability: attachmentCapability,
  });
  const activeSubSessionState = activeSubSessionId === null ? undefined : subSessionViews[activeSubSessionId];
  const activeSubSessionMessages = activeSubSessionState?.status === "ready"
    ? activeSubSessionState.view.messages
    : NO_OPERATOR_MESSAGES;
  const activeSubSessionMessagesWithPreviews = useMessagesWithAttachmentPreviews({
    client: managedAttachmentClient,
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
  const resolvedRightSidebarTabs = planCanonicalConversationTabTitles(
    rightSidebarTabs,
    state?.projects ?? [],
  );
  const rightSidebarUpdatingTabIds = resolvedRightSidebarTabs.unresolvedTabIds.concat(
    resolvedRightSidebarTabs.state.tabs.flatMap((tab) => {
      if (tab.type !== "conversation") return [];
      const locator = parseConversationTabSourceKey(tab.sourceKey);
      return locator?.kind === "session"
        && updatingConversationTitleSessionIds.has(locator.sessionId)
        ? [tab.id]
        : [];
    }),
  );
  const rightSidebarTabDiscriminators = planConversationTabDiscriminators(
    resolvedRightSidebarTabs.state,
    state?.projects ?? [],
    new Set(rightSidebarUpdatingTabIds),
    {
      fallback: t("console.rightSidebar.conversationDiscriminatorFallback"),
      sameMomentIndex: (index) => t("console.rightSidebar.sameMomentIndex", { index }),
    },
  );
  const commitSidebarSessionMetadata = useCallback((updated: OperatorSession) => {
    const current = stateRef.current;
    if (current === null) return;
    const mergeSessions = (sessions: OperatorSession[]) => sessions.map((session) =>
      session.sessionId === updated.sessionId ? { ...session, ...updated } : session);
    const projects = current.projects.map((candidate) => ({
      ...candidate,
      sessions: mergeSessions(candidate.sessions),
    }));
    const nextState: LocalConsoleState = {
      ...current,
      projects,
      project: {
        ...current.project,
        sessions: mergeSessions(current.project.sessions),
      },
      selectedSession: current.selectedSession?.sessionId === updated.sessionId
        ? { ...current.selectedSession, ...updated }
        : current.selectedSession,
    };
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  const actions = useMemo(() => new ConsoleStateActions({
    apiBase,
    commands: browserConsoleCommandPort,
    coordinator: coordinatorRef.current,
    t,
    getSelection: () => selectionRef.current,
    commitSelection,
    refresh,
    composerValue: composerDraft.value,
    clearComposer: (sessionId) => {
      const targetSessionId = sessionId ?? selectionRef.current.sessionId;
      clearComposerDraft(targetSessionId);
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
    commitSessionMetadata: commitSidebarSessionMetadata,
    selectProjectFolder: window.moebius?.selectProjectFolder === undefined
      ? undefined
      : () => window.moebius!.selectProjectFolder!(),
  }), [
    apiBase,
    commitSelection,
    commitSidebarSessionMetadata,
    clearComposerDraft,
    composerDraft.value,
    managedAttachments,
    refresh,
    t,
  ]);

  const conversationTransitionBundle = useConversationTransition(
    composerDraft.key, selection.sessionId, actions, setClientError, t,
  );
  const conversationNavigationBundle = useConversationNavigation(
    projects, coordinatorRef.current, selectionRef, selectionPersistenceEnabledRef, dispatchNewConversation,
    commitPresentationRoute, activateComposerDraft, actions, rightSidebarTabsStoreRef.current,
    openRightSidebarSourceTab, setRightSidebarTabs, setRightSidebarOpen, conversationTransitionBundle,
  );
  const newConversationSubmissionBundle = useNewConversationSubmission(
    newConversation, dispatchNewConversation, agentTeamCatalogBundle, managedAttachments,
    readyComposerAttachmentIds(managedAttachments.attachments),
    hasBlockingComposerAttachment(managedAttachments.attachments), actions,
    selectionPersistenceEnabledRef, rememberConfirmedSelection, commitPresentationRoute,
    conversationDraftStoreRef.current, activateComposerDraft, window.moebius, setClientError, t,
  );
  const lastError = conversationTransitionBundle.transitionError ?? clientError ?? state?.lastError ?? null;

  const allSidebarSessions = useMemo(
    () => projects.flatMap((candidate) => candidate.sessions),
    [projects],
  );
  const analysisEntriesFor = useCallback((parentSessionId: string): AnalysisPanelEntry[] => {
    const children = allSidebarSessions
      .filter((session) => session.analysisParentSessionId === parentSessionId)
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) || left.sessionId.localeCompare(right.sessionId));
    const titleCounts = new Map<string, number>();
    for (const child of children) {
      titleCounts.set(child.title, (titleCounts.get(child.title) ?? 0) + 1);
    }
    const formatter = new Intl.DateTimeFormat(language.activeLocale, {
      dateStyle: "short",
      timeStyle: "medium",
    });
    const baseLabels = children.map((child) =>
      titleCounts.get(child.title) === 1 ? null : formatter.format(new Date(child.createdAt)));
    const labelCounts = new Map<string, number>();
    children.forEach((child, index) => {
      const label = baseLabels[index];
      if (label === null) return;
      const key = `${child.title}\u0000${label}`;
      labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
    });
    const labelOccurrences = new Map<string, number>();
    return children.map((child, index) => {
      const label = baseLabels[index];
      if (label === null) {
        return { sessionId: child.sessionId, title: child.title };
      }
      const key = `${child.title}\u0000${label}`;
      const occurrence = (labelOccurrences.get(key) ?? 0) + 1;
      labelOccurrences.set(key, occurrence);
      return {
        sessionId: child.sessionId,
        title: child.title,
        createdLabel: (labelCounts.get(key) ?? 0) > 1
          ? `${label} · ${occurrence <= 26 ? String.fromCharCode(64 + occurrence) : `#${String(occurrence)}`}`
          : label,
      };
    });
  }, [allSidebarSessions, language.activeLocale]);
  const setAnalysisPanelOpen = useCallback((sessionId: string, open: boolean) => {
    setAnalysisPanelOpenBySession((current) => ({
      ...current,
      [sessionId]: open,
    }));
  }, []);
  const openAnalysisPanelEntry = useCallback((
    parentSessionId: string,
    entry: AnalysisPanelEntry,
  ) => {
    const target = allSidebarSessions.find((session) =>
      session.sessionId === entry.sessionId
      && session.analysisParentSessionId === parentSessionId);
    if (target === undefined) {
      setClientError(t("console.sessionAnalysis.sourceMissing"));
      return;
    }
    const root = planAnalysisRootSession(allSidebarSessions, target.sessionId);
    if (root === null) {
      setClientError(t("console.sessionAnalysis.openFailed"));
      return;
    }
    const nextTabs = openRightSidebarSourceTab(
      rightSidebarTabsStoreRef.current.read(root.sessionId),
      {
        id: `conversation-${target.sessionId}`,
        type: "conversation",
        title: target.title,
        sourceKey: conversationTabSourceKey(target.sessionId),
      },
    );
    rightSidebarTabsStoreRef.current.write(root.sessionId, nextTabs);
    if (selectionRef.current.sessionId !== root.sessionId) {
      void actions.selectSession({
        projectId: root.projectId,
        sessionId: root.sessionId,
      });
    }
    commitPresentationRoute(ordinaryPresentationRoute({
      projectId: root.projectId,
      sessionId: root.sessionId,
    }));
    setRightSidebarTabs(nextTabs);
    setRightSidebarOpen(true);
    if (nextTabs.activeTabId !== null) {
      setRightSidebarFocusRequest({
        hostSessionId: root.sessionId,
        tabId: nextTabs.activeTabId,
      });
    }
    setClientError(null);
  }, [
    actions,
    allSidebarSessions,
    commitPresentationRoute,
    setRightSidebarOpen,
    t,
  ]);
  const openConversationReference = useCallback((reference:
    | { scope: "conversation"; sessionId: string }
    | { scope: "message"; sessionId: string; messageId: number }
  ) => {
    const target = allSidebarSessions.find((session) => session.sessionId === reference.sessionId);
    if (target === undefined) {
      setClientError(t("console.sessionAnalysis.sourceUnavailable"));
      return;
    }
    const root = planAnalysisRootSession(allSidebarSessions, target.sessionId);
    if (root === null) {
      setClientError(t("console.sessionAnalysis.openFailed"));
      return;
    }
    if (reference.scope === "message") {
      conversationReadingPositionStoreRef.current.write(target.sessionId, reference.messageId);
      conversationMessageNavigationIdRef.current += 1;
      setConversationMessageNavigation({
        sessionId: target.sessionId,
        messageId: reference.messageId,
        requestId: conversationMessageNavigationIdRef.current,
      });
    }
    if (target.analysisParentSessionId == null) {
      commitPresentationRoute(ordinaryPresentationRoute({
        projectId: root.projectId,
        sessionId: root.sessionId,
      }));
      void actions.selectSession({
        projectId: root.projectId,
        sessionId: root.sessionId,
      });
      setClientError(null);
      return;
    }
    const nextTabs = openRightSidebarSourceTab(
      rightSidebarTabsStoreRef.current.read(root.sessionId),
      {
        id: `conversation-${target.sessionId}`,
        type: "conversation",
        title: target.title,
        sourceKey: conversationTabSourceKey(target.sessionId),
      },
    );
    rightSidebarTabsStoreRef.current.write(root.sessionId, nextTabs);
    commitPresentationRoute(ordinaryPresentationRoute({
      projectId: root.projectId,
      sessionId: root.sessionId,
    }));
    if (selectionRef.current.sessionId !== root.sessionId) {
      void actions.selectSession({
        projectId: root.projectId,
        sessionId: root.sessionId,
      });
    }
    setRightSidebarTabs(nextTabs);
    setRightSidebarOpen(true);
    setClientError(null);
  }, [
    actions,
    allSidebarSessions,
    commitPresentationRoute,
    setRightSidebarOpen,
    t,
  ]);

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
        if (composerDraftRef.current.key === draftKey) {
          commitComposerDraft(editConversationComposerDraft(composerDraftRef.current, body));
        }
      },
    }).catch((error: unknown) => setClientError(formatError(error)));
  }, [commitComposerDraft, managedAttachments.replaceWithMessageAttachments, state]);

  const preferredNewConversationTeamKey = useMemo(() => resolveNewConversationAgentTeamKey(
    agentTeamCatalogBundle.state.status === "ready" ? agentTeamCatalogBundle.state.teams : [],
    agentTeamCatalogBundle.lastUsedTeamKey,
    pendingAgentTeamKey,
  ), [agentTeamCatalogBundle.state, agentTeamCatalogBundle.lastUsedTeamKey, pendingAgentTeamKey]);

  useEffect(() => {
    if (
      pendingAgentTeamKey === null
      || newConversation === null
      || !newConversation.isOpen
      || agentTeamCatalogBundle.state.status !== "ready"
    ) {
      return;
    }
    const resolvedTeamKey = resolveNewConversationAgentTeamKey(
      agentTeamCatalogBundle.state.teams,
      agentTeamCatalogBundle.lastUsedTeamKey,
      pendingAgentTeamKey,
    );
    if (newConversation.teamKey !== resolvedTeamKey) {
      dispatchNewConversation({ type: "select-team", teamKey: resolvedTeamKey });
    }
    setPendingAgentTeamKey(null);
  }, [agentTeamCatalogBundle.state, agentTeamCatalogBundle.lastUsedTeamKey, newConversation, pendingAgentTeamKey]);

  useEffect(() => {
    if (newConversation === null || !newConversation.isOpen || agentTeamCatalogBundle.state.status !== "ready") {
      return;
    }
    const selectionIsUsable = agentTeamCatalogBundle.state.teams.some(
      (team) => team.teamKey === newConversation.teamKey && team.canCreateConversation,
    );
    if (!selectionIsUsable && newConversation.teamKey !== preferredNewConversationTeamKey) {
      dispatchNewConversation({ type: "select-team", teamKey: preferredNewConversationTeamKey });
    }
  }, [agentTeamCatalogBundle.state, newConversation, preferredNewConversationTeamKey]);

  const startNewConversation = useCallback((projectId?: string) => {
    const selectedProject = projectId === undefined
      ? undefined
      : projects.find((candidate) => candidate.projectId === projectId
        && candidate.directoryAvailable !== false
        && candidate.newConversationDisabledReason == null);
    setClientError(null);
    if (newConversation !== null) {
      const draftProjectIsAvailable = newConversation.projectId === null
        || projects.some((candidate) => candidate.projectId === newConversation.projectId
          && candidate.directoryAvailable !== false
          && candidate.newConversationDisabledReason == null);
      const nextProject = selectedProject
        ?? (draftProjectIsAvailable
          ? projects.find((candidate) => candidate.projectId === newConversation.projectId)
          : undefined);
      if (newConversation.projectId !== (nextProject?.projectId ?? null)) {
        dispatchNewConversation({ type: "select-project", projectId: nextProject?.projectId ?? null });
        dispatchNewConversation({
          type: "select-workspace",
          workspaceMode: nextProject?.worktreeMode === true ? "worktree" : "direct",
        });
      }
      dispatchNewConversation({ type: "show" });
      return;
    }
    dispatchNewConversation({
      type: "open",
      draft: createNewConversationDraft({
        projectId: selectedProject?.projectId,
        workspaceMode: selectedProject?.worktreeMode === true ? "worktree" : "direct",
        teamKey: preferredNewConversationTeamKey,
        draft: conversationDraftStoreRef.current.read(NEW_CONVERSATION_DRAFT_KEY),
      }),
    });
  }, [newConversation, preferredNewConversationTeamKey, projects]);

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
      const response = await fetch(planConsoleEndpoint(apiBase, `/api/local-console/projects/${encodeURIComponent(projectId)}`), {
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
    const removingSessionIds = new Set(
      state?.projects.find((candidate) => candidate.projectId === projectId)
        ?.sessions.map((session) => session.sessionId) ?? [],
    );
    const routeBeforeRemoval = presentationRoute;
    const migratingSidebarSession = routeBeforeRemoval === null
      || routeBeforeRemoval.rightConversationSessionId === null
      || !removingSessionIds.has(routeBeforeRemoval.mainSessionId)
      || removingSessionIds.has(routeBeforeRemoval.rightConversationSessionId)
      ? undefined
      : state?.projects
        .flatMap((candidate) => candidate.sessions)
        .find((session) => session.sessionId === routeBeforeRemoval.rightConversationSessionId);
    try {
      const response = await fetch(planConsoleEndpoint(apiBase, `/api/local-console/projects/${encodeURIComponent(projectId)}`), {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const body = await response.json() as { error?: string; archivedSessionIds?: string[] };
      if (!response.ok) {
        throw new Error(body.error ?? "remove project failed");
      }
      if (wasCurrentProject) {
        selectionPersistenceEnabledRef.current = false;
        forgetPersistedSelection();
      }
      const archivedSessionIds = body.archivedSessionIds ?? [...removingSessionIds];
      for (const sessionId of archivedSessionIds) {
        rightSidebarTabsStoreRef.current.removeSession(sessionId);
      }
      rightSidebarTabsStoreRef.current.clearHosts(archivedSessionIds);
      if (migratingSidebarSession !== undefined) {
        const migrated = await refresh({
          projectId: migratingSidebarSession.projectId,
          sessionId: migratingSidebarSession.sessionId,
        });
        if (migrated) {
          commitPresentationRoute(sidebarPresentationRoute({
            sidebarProjectId: migratingSidebarSession.projectId,
            sidebarSessionId: migratingSidebarSession.sessionId,
            originSessionId: migratingSidebarSession.originSessionId ?? routeBeforeRemoval!.mainSessionId,
            originAvailable: false,
          }));
          setRightSidebarOpen(false);
          setRightSidebarTabs(rightSidebarTabsStoreRef.current.read(migratingSidebarSession.sessionId));
        }
      } else {
        await refresh(selectionRef.current);
      }
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
  }, [
    apiBase,
    commitPresentationRoute,
    forgetPersistedSelection,
    presentationRoute,
    refresh,
    setRightSidebarOpen,
    startNewConversation,
    state?.projects,
  ]);

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
      const response = await fetch(planConsoleEndpoint(apiBase, `/api/local-console/projects/${encodeURIComponent(projectId)}`), {
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

  const retryRun = useCallback(async (
    sessionId: string,
    runId: string,
    executionOverride?: { cli: "codex" | "claude" | "kimi"; model: string; effort: string },
  ) => {
    if (apiBase === null || subSessionSendingId !== null) {
      throw new Error("retry unavailable");
    }
    setSubSessionSendingId(sessionId);
    try {
      await retrySessionRun({
        apiBase,
        sessionId,
        runId,
        fetch,
        ...(executionOverride === undefined ? {} : { executionOverride }),
      });
      await Promise.all([
        refreshSubSessionNow(sessionId),
        refresh(selectionRef.current),
      ]);
      setClientError(null);
    } catch (error) {
      setClientError(formatError(error));
      throw error;
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

  useEffect(() => {
    if (
      state === null
      || presentationRoute?.rightConversationSessionId === null
      || presentationRoute === null
    ) {
      return;
    }
    const sessions = state.projects.flatMap((candidate) => candidate.sessions);
    const sourceAvailable = sessions.some(
      (session) => session.sessionId === presentationRoute.mainSessionId,
    );
    if (sourceAvailable) return;
    const target = sessions.find(
      (session) => session.sessionId === presentationRoute.rightConversationSessionId,
    );
    if (target === undefined || sourceMigrationRef.current === target.sessionId) return;
    sourceMigrationRef.current = target.sessionId;
    void refresh({ projectId: target.projectId, sessionId: target.sessionId }).then((migrated) => {
      if (!migrated) return;
      commitPresentationRoute(sidebarPresentationRoute({
        sidebarProjectId: target.projectId,
        sidebarSessionId: target.sessionId,
        originSessionId: target.originSessionId ?? presentationRoute.mainSessionId,
        originAvailable: false,
      }));
      setRightSidebarOpen(false);
      setRightSidebarTabs(rightSidebarTabsStoreRef.current.read(target.sessionId));
    }).finally(() => {
      sourceMigrationRef.current = null;
    });
  }, [
    commitPresentationRoute,
    presentationRoute,
    refresh,
    setRightSidebarOpen,
    state,
  ]);

  const changeRightSidebarWidth = useCallback((width: number) => {
    setRightSidebarWidth(width);
    writeRightSidebarWidthPreference(window.localStorage, width);
  }, []);

  const changeRightSidebarTabs = useCallback((nextState: RightSidebarTabsState) => {
    const hostSessionId = presentationRoute?.hostSessionId ?? selectionRef.current.sessionId;
    let resolvedState = nextState;
    const unresolvedConversation = nextState.tabs.find(
      (tab) => tab.type === "conversation" && tab.sourceKey === null,
    );
    if (unresolvedConversation !== undefined) {
      const selected = state?.selectedSession ?? null;
      const generalAssistant = agentTeamCatalogBundle.state.status === "ready"
        ? agentTeamCatalogBundle.state.teams.find((team) =>
            team.ownership === "system" && team.id === "general-assistant")
        : undefined;
      const draft = createSidebarConversationDraft({
        draftId: crypto.randomUUID(),
        hostSessionId,
        originSessionId: selected?.sessionId ?? null,
        entryTemplate: null,
        context: {
          projectId: selected?.projectId ?? selectionRef.current.projectId,
          workspaceMode: selected?.workspaceMode ?? "direct",
          teamKey: generalAssistant?.teamKey ?? null,
        },
        now: new Date().toISOString(),
      });
      sidebarConversationDraftStoreRef.current.write(draft);
      setSidebarConversationDrafts(sidebarConversationDraftStoreRef.current.list());
      resolvedState = {
        ...nextState,
        tabs: nextState.tabs.map((tab) => tab.id === unresolvedConversation.id
          ? { ...tab, sourceKey: conversationDraftTabSourceKey(draft.draftId) }
          : tab),
      };
    }
    rightSidebarTabsStoreRef.current.write(hostSessionId, resolvedState);
    setRightSidebarTabs(resolvedState);
  }, [agentTeamCatalogBundle.state, presentationRoute?.hostSessionId, state?.selectedSession]);

  const analyzeConversation = useCallback(async (input:
    | {
        kind: "message";
        sessionId: string;
        runId: string | null;
        messageId: number | null;
      }
    | {
        kind: "conversation";
        sessionId: string;
        projectId: string;
      }
  ) => {
    if (apiBase === null) return;
    const currentState = stateRef.current;
    if (currentState === null) {
      setClientError(t("console.sessionAnalysis.sourceMissing"));
      setSessionAnalysisNotice(t("console.sessionAnalysis.openFailed"));
      return;
    }
    const sourceSession = currentState.projects
      .flatMap((project) => project.sessions)
      .find((session) => session.sessionId === input.sessionId);
    if (sourceSession === undefined) {
      setClientError(t("console.sessionAnalysis.sourceMissing"));
      setSessionAnalysisNotice(t("console.sessionAnalysis.openFailed"));
      return;
    }
    const sourceRootSession = planAnalysisRootSession(
      currentState.projects.flatMap((project) => project.sessions),
      sourceSession.sessionId,
    );
    if (sourceRootSession === null) {
      setClientError(t("console.sessionAnalysis.sourceMissing"));
      setSessionAnalysisNotice(t("console.sessionAnalysis.openFailed"));
      return;
    }
    if (input.kind === "conversation" && sourceSession.analysisRecordAvailable === false) {
      setClientError(t("console.sessionAnalysis.recordUnavailable"));
      setSessionAnalysisNotice(t("console.sessionAnalysis.recordUnavailable"));
      return;
    }
    const targetSelection = {
      projectId: sourceSession.projectId,
      sessionId: sourceSession.sessionId,
    };
    const shouldLoadTarget = input.kind === "conversation"
      && currentState.selectedSessionId !== input.sessionId;
    const shouldCommitConversationRoute = input.kind === "conversation"
      && presentationRouteRef.current?.selectedSessionId !== input.sessionId;
    const mutation = shouldLoadTarget || shouldCommitConversationRoute
      ? coordinatorRef.current.beginSelectionMutation("analyze-conversation")
      : null;
    if ((shouldLoadTarget || shouldCommitConversationRoute) && mutation === null) {
      setClientError(t("console.sessionAnalysis.navigationBusy"));
      setSessionAnalysisNotice(t("console.sessionAnalysis.navigationBusy"));
      return;
    }
    const generalAssistant = agentTeamCatalogBundle.state.status === "ready"
      ? agentTeamCatalogBundle.state.teams.find((team) =>
          team.ownership === "system" && team.id === "general-assistant")
      : undefined;
    try {
      const reference = await loadSessionReferenceText({
        apiBase,
        sessionId: input.sessionId,
        scope: input.kind,
        runId: input.kind === "message" ? input.runId : null,
        messageId: input.kind === "message" ? input.messageId : null,
        fetch,
      });
      let preparedState: LocalConsoleState | null = null;
      if (shouldLoadTarget) {
        const loaded = await refreshConsoleState<LocalConsoleState>({
          apiBase,
          selection: targetSelection,
          coordinator: coordinatorRef.current,
          fetch,
          readSelection: (nextState) => ({
            projectId: nextState.selectedProjectId,
            sessionId: nextState.selectedSessionId,
          }),
          commitState: (nextState) => {
            preparedState = nextState;
          },
          commitSelection: () => undefined,
          setError: setClientError,
          mutationOwner: mutation ?? undefined,
        });
        if (!loaded || preparedState === null) {
          setSessionAnalysisNotice(t("console.sessionAnalysis.openFailed"));
          return;
        }
        const preparedSource = (preparedState as LocalConsoleState).projects
          .flatMap((project) => project.sessions)
          .find((session) => session.sessionId === input.sessionId);
        if (preparedSource === undefined) {
          throw new Error(t("console.sessionAnalysis.sourceMissing"));
        }
      }
      const existing = sidebarConversationDraftStoreRef.current.findMergeable({
        hostSessionId: input.sessionId,
        originSessionId: input.sessionId,
        initialProjectId: sourceSession.projectId,
        initialWorkspaceMode: sourceSession.workspaceMode,
        entryTemplate: "session-analysis",
      });
      const draft = existing ?? createSidebarConversationDraft({
        draftId: crypto.randomUUID(),
        hostSessionId: input.sessionId,
        originSessionId: input.sessionId,
        entryTemplate: "session-analysis",
        context: {
          projectId: sourceSession.projectId,
          workspaceMode: sourceSession.workspaceMode,
          teamKey: generalAssistant?.teamKey ?? null,
        },
        now: new Date().toISOString(),
      });
      const nextDraft: SidebarConversationDraft = {
        ...draft,
        textFragments: [
          ...draft.textFragments,
          {
            ...reference.fragment,
            label: t("console.sessionAnalysis.fragmentLabel", {
              index: draft.textFragments.length + 1,
            }),
          },
        ],
        updatedAt: new Date().toISOString(),
      };
      sidebarConversationDraftStoreRef.current.write(nextDraft);
      setSidebarConversationDrafts(sidebarConversationDraftStoreRef.current.list());
      const nextTabs = openRightSidebarSourceTab(
        rightSidebarTabsStoreRef.current.read(sourceRootSession.sessionId),
        {
          id: `conversation-draft-${nextDraft.draftId}`,
          type: "conversation",
          title: t("console.sessionAnalysis.newConversation"),
          sourceKey: conversationDraftTabSourceKey(nextDraft.draftId),
        },
      );
      if (input.kind === "conversation") {
        selectionPersistenceEnabledRef.current = true;
        dispatchNewConversation({ type: "hide" });
        if (preparedState !== null) {
          commitConsoleState(preparedState);
        }
        commitSelection(targetSelection);
        rememberConfirmedSelection(targetSelection);
        commitPresentationRoute(ordinaryPresentationRoute(targetSelection));
        activateComposerDraft(input.sessionId);
      }
      rightSidebarTabsStoreRef.current.write(sourceRootSession.sessionId, nextTabs);
      setRightSidebarTabs(nextTabs);
      setRightSidebarOpen(true);
      setClientError(null);
      setSessionAnalysisNotice(null);
    } catch (error) {
      setClientError(formatError(error));
      setSessionAnalysisNotice(t("console.sessionAnalysis.openFailed"));
    } finally {
      if (mutation !== null) {
        coordinatorRef.current.endSelectionMutation(mutation);
      }
    }
  }, [
    agentTeamCatalogBundle.state,
    apiBase,
    activateComposerDraft,
    commitConsoleState,
    commitSelection,
    commitPresentationRoute,
    rememberConfirmedSelection,
    setRightSidebarOpen,
    t,
  ]);

  const updateSidebarConversationDraft = useCallback((
    draftId: string,
    update: (draft: SidebarConversationDraft) => SidebarConversationDraft,
  ) => {
    const current = sidebarConversationDraftStoreRef.current.read(draftId);
    if (current === null) return;
    sidebarConversationDraftStoreRef.current.write(update(current));
    setSidebarConversationDrafts(sidebarConversationDraftStoreRef.current.list());
  }, []);

  const submitSidebarConversationDraft = useCallback(async (draftId: string) => {
    const draft = sidebarConversationDraftStoreRef.current.read(draftId);
    if (
      apiBase === null
      || draft === null
      || draft.body.trim() === ""
      || draft.context.projectId === null
      || draft.context.teamKey === null
      || sidebarConversationSendingId !== null
      || hasBlockingComposerAttachment(managedSidebarConversationAttachments.attachments)
    ) {
      return;
    }
    const team = planFindOperatorAgentTeam(agentTeamCatalogBundle.state, draft.context.teamKey);
    if (team === undefined || !team.canCreateConversation) {
      setClientError(t("desktop.error.teamUnavailable"));
      return;
    }
    setSidebarConversationSendingId(draftId);
    try {
      const created = await createSidebarConversationSession({
        apiBase,
        projectId: draft.context.projectId,
        initialMessage: draft.body,
        agentTeam: { ownership: team.ownership, id: team.id },
        workspaceMode: draft.context.workspaceMode,
        attachmentIds: readyComposerAttachmentIds(managedSidebarConversationAttachments.attachments),
        attachmentDraftKey: draft.attachmentDraftKey,
        originSessionId: draft.originSessionId,
        analysisParentSessionId: draft.hostSessionId,
        entryTemplate: draft.entryTemplate,
        writePolicy: draft.writePolicy,
        textFragments: draft.textFragments,
        fetch,
      });
      const createdTitle = created.title
        ?? draft.body.trim().replace(/\s+/gu, " ").slice(0, 32);
      const createdProject = stateRef.current?.projects.find(
        (project) => project.projectId === draft.context.projectId,
      );
      rightSidebarTabsStoreRef.current.promoteConversationDraft({
        draftId,
        sessionId: created.sessionId,
        title: createdTitle,
        conversationContext: createdProject === undefined
          ? undefined
          : planConversationProjectContext(createdProject),
      });
      const directParent = allSidebarSessions.find((session) => session.sessionId === draft.hostSessionId);
      const root = directParent === undefined
        ? null
        : planAnalysisRootSession(allSidebarSessions, directParent.sessionId);
      const tabHostSessionId = root?.sessionId ?? draft.hostSessionId;
      const nextTabs = rightSidebarTabsStoreRef.current.read(tabHostSessionId);
      const currentHostSessionId = presentationRouteRef.current?.hostSessionId
        ?? selectionRef.current.sessionId;
      if (currentHostSessionId === tabHostSessionId) {
        setRightSidebarTabs(nextTabs);
      }
      sidebarConversationDraftStoreRef.current.remove(draftId);
      setSidebarConversationDrafts(sidebarConversationDraftStoreRef.current.list());
      managedSidebarConversationAttachments.clearDraft(draft.attachmentDraftKey);
      setSidebarConversationComposerValues((current) => ({
        ...current,
        [created.sessionId]: "",
      }));
      commitPresentationRoute(root === null
        ? sidebarPresentationRoute({
            sidebarProjectId: draft.context.projectId,
            sidebarSessionId: created.sessionId,
            originSessionId: draft.originSessionId,
            originAvailable: draft.originSessionId !== null,
          })
        : {
            version: 1,
            projectId: root.projectId,
            selectedSessionId: created.sessionId,
            mainSessionId: root.sessionId,
            rightConversationSessionId: created.sessionId,
            hostSessionId: root.sessionId,
            notice: null,
          });
      await refresh(selectionRef.current);
      const recordSuccessfulTeam = window.moebius?.recordSuccessfulConversationAgentTeam;
      if (recordSuccessfulTeam !== undefined) {
        await recordSuccessfulTeam({
          ownership: team.ownership,
          teamId: team.id,
          sessionId: created.sessionId,
        });
        agentTeamCatalogBundle.setLastUsedTeamKey(team.teamKey);
      }
      setClientError(null);
    } catch (error) {
      setClientError(formatError(error));
    } finally {
      setSidebarConversationSendingId(null);
    }
  }, [
    agentTeamCatalogBundle.state,
    allSidebarSessions,
    apiBase,
    commitPresentationRoute,
    managedSidebarConversationAttachments.attachments,
    managedSidebarConversationAttachments.clearDraft,
    refresh,
    sidebarConversationSendingId,
    t,
  ]);

  const sendSidebarConversationMessage = useCallback(async (sessionId: string) => {
    const body = sidebarConversationComposerValues[sessionId]
      ?? conversationDraftStoreRef.current.read(sessionDraftKey(sessionId));
    if (
      apiBase === null
      || sidebarConversationSendingId !== null
      || (body.trim() === "" && readyComposerAttachmentIds(managedSidebarConversationAttachments.attachments).length === 0)
    ) {
      return;
    }
    setSidebarConversationSendingId(sessionId);
    try {
      await submitSessionMessage({
        apiBase,
        sessionId,
        body,
        attachmentIds: readyComposerAttachmentIds(managedSidebarConversationAttachments.attachments),
        fetch,
      });
      conversationDraftStoreRef.current.clear(sessionDraftKey(sessionId));
      setSidebarConversationComposerValues((current) => ({ ...current, [sessionId]: "" }));
      managedSidebarConversationAttachments.clearDraft(sessionDraftKey(sessionId));
      const view = await loadSubSessionView({ apiBase, sessionId, fetch });
      setSidebarConversationViews((current) => ({
        ...current,
        [sessionId]: { status: "ready", view },
      }));
      await refresh(selectionRef.current);
      setClientError(null);
    } catch (error) {
      setClientError(formatError(error));
    } finally {
      setSidebarConversationSendingId(null);
    }
  }, [
    apiBase,
    managedSidebarConversationAttachments.attachments,
    managedSidebarConversationAttachments.clearDraft,
    refresh,
    sidebarConversationComposerValues,
    sidebarConversationSendingId,
  ]);

  const refreshSessionAfterPendingMutation = useCallback(async (sessionId: string) => {
    await refresh(selectionRef.current);
    if (sidebarConversationViews[sessionId] !== undefined && apiBase !== null) {
      const view = await loadSubSessionView({ apiBase, sessionId, fetch });
      setSidebarConversationViews((current) => ({
        ...current,
        [sessionId]: { status: "ready", view },
      }));
    }
  }, [apiBase, refresh, sidebarConversationViews]);

  const retryPendingMessage = useCallback(async (sessionId: string, messageId: number) => {
    if (apiBase === null) return;
    try {
      await retryPendingSessionMessage({ apiBase, sessionId, messageId, fetch });
      await refreshSessionAfterPendingMutation(sessionId);
      setClientError(null);
    } catch (error) {
      setClientError(formatError(error));
    }
  }, [apiBase, refreshSessionAfterPendingMutation]);

  const editPendingMessage = useCallback(async (sessionId: string, messageId: number, body: string) => {
    if (apiBase === null) return;
    try {
      await updatePendingSessionMessage({ apiBase, sessionId, messageId, body, fetch });
      await refreshSessionAfterPendingMutation(sessionId);
      setClientError(null);
    } catch (error) {
      setClientError(formatError(error));
    }
  }, [apiBase, refreshSessionAfterPendingMutation]);

  const removePendingMessage = useCallback(async (sessionId: string, messageId: number) => {
    if (apiBase === null) return;
    try {
      await removePendingSessionMessage({ apiBase, sessionId, messageId, fetch });
      await refreshSessionAfterPendingMutation(sessionId);
      setClientError(null);
    } catch (error) {
      setClientError(formatError(error));
    }
  }, [apiBase, refreshSessionAfterPendingMutation]);

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

  const readFileReference = useCallback((
    sessionId: string,
    filePath: string,
    line: number,
    column: number | null,
  ) => {
    if (apiBase === null) {
      return Promise.reject(new Error("local console is unavailable"));
    }
    return loadFileReference({ apiBase, sessionId, filePath, line, column, fetch });
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

  const openSearchedSession = useCallback(async (
    result: SessionSearchResult,
    restore: boolean,
  ) => {
    if (apiBase === null) return false;
    try {
      const target = restore
        ? await restoreConsoleSession({
            apiBase,
            sessionId: result.session.sessionId,
            fetch,
          })
        : result.session;
      const currentState = stateRef.current;
      const origin = target.originSessionId == null
        ? undefined
        : currentState?.projects
          .flatMap((candidate) => candidate.sessions)
          .find((session) => session.sessionId === target.originSessionId);
      if (origin !== undefined && result.originAvailable) {
        const route = sidebarPresentationRoute({
          sidebarProjectId: target.projectId,
          sidebarSessionId: target.sessionId,
          originSessionId: origin.sessionId,
          originAvailable: true,
        });
        commitPresentationRoute(route);
        const tabs = openRightSidebarSourceTab(
          rightSidebarTabsStoreRef.current.read(origin.sessionId),
          {
            id: `conversation-${target.sessionId}`,
            type: "conversation",
            title: target.title,
            sourceKey: conversationTabSourceKey(target.sessionId),
            conversationContext: planConversationProjectContext(
              currentState?.projects.find((project) => project.projectId === target.projectId),
              target,
            ),
            conversationCreatedAt: target.createdAt,
          },
        );
        rightSidebarTabsStoreRef.current.write(origin.sessionId, tabs);
        setRightSidebarTabs(tabs);
        setRightSidebarOpen(true);
        actions.selectSession({ projectId: origin.projectId, sessionId: origin.sessionId });
      } else {
        commitPresentationRoute(sidebarPresentationRoute({
          sidebarProjectId: target.projectId,
          sidebarSessionId: target.sessionId,
          originSessionId: target.originSessionId ?? null,
          originAvailable: false,
        }));
        setRightSidebarOpen(false);
        actions.selectSession({ projectId: target.projectId, sessionId: target.sessionId });
      }
      return true;
    } catch (error) {
      setClientError(formatError(error));
      return false;
    }
  }, [apiBase, commitPresentationRoute, setRightSidebarOpen]);

  const renderSidebarConversation = useCallback(() => {
    if (activeSidebarConversationDraft !== null) {
      const draft = activeSidebarConversationDraft;
      const draftProject = projects.find((candidate) => candidate.projectId === draft.context.projectId) ?? project;
      const promptSuggestions = draft.entryTemplate === "session-analysis"
        ? [
            {
              id: "unexpected-agent-run",
              label: t("console.sessionAnalysis.unexpectedLabel"),
              prompt: t("console.sessionAnalysis.unexpectedPrompt"),
            },
            {
              id: "long-agent-run",
              label: t("console.sessionAnalysis.slowLabel"),
              prompt: t("console.sessionAnalysis.slowPrompt"),
            },
          ]
        : [];
      return (
        <OperatorConsole
          presentation="conversation"
          project={draftProject}
          projects={projects}
          selectedProjectId={draft.context.projectId ?? draftProject.projectId}
          selectedSessionId={draft.hostSessionId}
          selectedSession={null}
          messages={[]}
          activeRun={null}
          composerValue=""
          composerAttachments={managedSidebarConversationAttachments.attachments}
          agentTeamsState={agentTeamCatalogBundle.state}
          executionRegistryState={executionRegistryState}
          onReloadExecutionRegistry={() => setExecutionRegistryReload((value) => value + 1)}
          newConversation={{
            selectedProjectId: draft.context.projectId,
            selectedWorkspaceMode: draft.context.workspaceMode,
            selectedTeamKey: draft.context.teamKey,
            draft: draft.body,
            isSubmitting: sidebarConversationSendingId === draft.draftId,
            error: null,
            textFragments: draft.textFragments,
            promptSuggestions,
          }}
          onComposerChange={() => undefined}
          onComposerFilesAdded={managedSidebarConversationAttachments.addFiles}
          onComposerAttachmentRemove={managedSidebarConversationAttachments.remove}
          onComposerAttachmentRetry={managedSidebarConversationAttachments.retry}
          onSend={() => undefined}
          onSelectSession={() => undefined}
          onInterrupt={() => undefined}
          onNewConversationProjectChange={(projectId) => {
            const nextProject = projects.find((candidate) => candidate.projectId === projectId);
            updateSidebarConversationDraft(draft.draftId, (current) => ({
              ...current,
              context: {
                ...current.context,
                projectId,
                workspaceMode: nextProject?.worktreeMode === true ? "worktree" : "direct",
              },
              updatedAt: new Date().toISOString(),
            }));
          }}
          onNewConversationWorkspaceChange={(workspaceMode) =>
            updateSidebarConversationDraft(draft.draftId, (current) => ({
              ...current,
              context: { ...current.context, workspaceMode },
              updatedAt: new Date().toISOString(),
            }))}
          onNewConversationTeamChange={(teamKey) =>
            updateSidebarConversationDraft(draft.draftId, (current) => ({
              ...current,
              context: { ...current.context, teamKey },
              updatedAt: new Date().toISOString(),
            }))}
          onNewConversationDraftChange={(body) =>
            updateSidebarConversationDraft(draft.draftId, (current) => ({
              ...current,
              body,
              updatedAt: new Date().toISOString(),
            }))}
          onNewConversationTextFragmentRemove={(fragmentId) =>
            updateSidebarConversationDraft(draft.draftId, (current) => ({
              ...current,
              textFragments: current.textFragments.filter((fragment) => fragment.id !== fragmentId),
              updatedAt: new Date().toISOString(),
            }))}
          onNewConversationPromptSuggestionSelect={(suggestion) =>
            updateSidebarConversationDraft(draft.draftId, (current) => ({
              ...current,
              body: current.body.trim() === ""
                ? suggestion.prompt
                : `${current.body.trimEnd()}\n${suggestion.prompt}`,
              updatedAt: new Date().toISOString(),
            }))}
          onSubmitNewConversation={() => void submitSidebarConversationDraft(draft.draftId)}
          onAddNewConversationProject={() => void actions.addProject(
            projects.map((candidate) => candidate.projectId),
          )}
        />
      );
    }

    if (activeSidebarConversationSessionId === null) {
      return null;
    }
    const viewState = sidebarConversationViews[activeSidebarConversationSessionId];
    if (viewState?.status !== "ready") {
      return (
        <div className="grid min-h-full place-items-center p-6 text-sm text-sub" role="status">
            {viewState?.status === "error"
              ? viewState.message
              : t("console.sessionAnalysis.loadingConversation")}
        </div>
      );
    }
    const view = viewState.view;
    const conversationProject = projects.find((candidate) =>
      candidate.projectId === view.session.projectId) ?? project;
    const composerValue = sidebarConversationComposerValues[view.session.sessionId]
      ?? conversationDraftStoreRef.current.read(sessionDraftKey(view.session.sessionId));
    return (
      <OperatorConsole
        presentation="conversation"
        project={conversationProject}
        projects={projects}
        selectedProjectId={view.session.projectId}
        selectedSessionId={view.session.sessionId}
        selectedSession={view.session}
        analysisPanel={{
          open: analysisPanelOpenBySession[view.session.sessionId] === true,
          state: {
            status: "ready",
            entries: analysisEntriesFor(view.session.sessionId),
          },
          onOpenChange: (open) => setAnalysisPanelOpen(view.session.sessionId, open),
          onOpenEntry: (entry) => openAnalysisPanelEntry(view.session.sessionId, entry),
        }}
        messages={view.messages}
        pendingDispatchMessages={view.pendingDispatchMessages ?? []}
        initialReadingMessageId={conversationReadingPositionStoreRef.current.read(view.session.sessionId)}
        messageNavigationRequest={conversationMessageNavigation?.sessionId === view.session.sessionId
          ? {
              messageId: conversationMessageNavigation.messageId,
              requestId: conversationMessageNavigation.requestId,
            }
          : null}
        onMessageNavigationHandled={(requestId) => {
          setConversationMessageNavigation((current) =>
            current?.requestId === requestId ? null : current);
        }}
        onReadingMessageChange={(sessionId, messageId) => {
          conversationReadingPositionStoreRef.current.write(sessionId, messageId);
        }}
        pendingPrimaryMessages={view.pendingPrimaryMessages ?? []}
        memberIdentities={view.memberIdentities ?? []}
        activeRun={view.activeRun}
        activeRuns={view.activeRuns ?? (view.activeRun === null ? [] : [view.activeRun])}
        workspaceDiff={view.workspaceDiff ?? { available: false, fileCount: null, reason: "unavailable" }}
        composerValue={composerValue}
        executionRegistryState={executionRegistryState}
        onReloadExecutionRegistry={() => setExecutionRegistryReload((value) => value + 1)}
        composerAttachments={managedSidebarConversationAttachments.attachments}
        agentTeamsState={agentTeamCatalogBundle.state}
        conversationAgentTeamKey={view.session.agentTeamOwnership != null && view.session.agentTeamId != null
          ? `${view.session.agentTeamOwnership}:${view.session.agentTeamId}`
          : null}
        isSending={sidebarConversationSendingId === view.session.sessionId}
        onComposerChange={(value) => {
          conversationDraftStoreRef.current.write(sessionDraftKey(view.session.sessionId), value);
          setSidebarConversationComposerValues((current) => ({
            ...current,
            [view.session.sessionId]: value,
          }));
        }}
        onComposerFilesAdded={managedSidebarConversationAttachments.addFiles}
        onComposerAttachmentRemove={managedSidebarConversationAttachments.remove}
        onComposerAttachmentRetry={managedSidebarConversationAttachments.retry}
        onSend={() => void sendSidebarConversationMessage(view.session.sessionId)}
        onSelectSession={() => undefined}
        onInterrupt={(sessionId, runId) => void interruptSubSession(sessionId, runId)}
        onRetryRun={(sessionId, runId, executionOverride) =>
          retryRun(sessionId, runId, executionOverride)}
        onRetryPendingMessage={(sessionId, messageId) => void retryPendingMessage(sessionId, messageId)}
        onEditPendingMessage={(sessionId, messageId, body) => void editPendingMessage(sessionId, messageId, body)}
        onRemovePendingMessage={(sessionId, messageId) => void removePendingMessage(sessionId, messageId)}
        onAnalyzeConversation={(input) => void analyzeConversation({
          kind: "message",
          ...input,
        })}
        onOpenConversationReference={openConversationReference}
        onChangeSessionWorkspace={actions.changeSessionWorkspace}
        onChangeSessionTeam={(sessionId, team) => actions.changeSessionTeam(sessionId, {
          ownership: team.ownership,
          id: team.id,
        })}
        onOpenEvidence={(intent) => {
          changeRightSidebarTabs(openRightSidebarSourceTab(rightSidebarTabs, intent.kind === "workspace-diff"
            ? {
                id: `sidebar-workspace-${intent.sessionId}`,
                type: "workspace-diff",
                title: "builtin:workspace-diff",
                sourceKey: `workspace-diff:${intent.sessionId}`,
              }
            : {
                id: `sidebar-run-${intent.runId}`,
                type: "run-output",
                title: intent.role ?? t("console.sessionAnalysis.fullOutput"),
                sourceKey: createRunOutputSourceKey(intent.sessionId, intent.runId, intent.stepId),
              }));
        }}
        onLoadWorkspaceDiff={readWorkspaceDiff}
        onLoadProjectFiles={readProjectFiles}
        onLoadProjectFile={readProjectFile}
        onLoadFileReference={readFileReference}
      />
    );
  }, [
    activeSidebarConversationDraft,
    activeSidebarConversationSessionId,
    agentTeamCatalogBundle.state,
    analysisEntriesFor,
    analysisPanelOpenBySession,
    analyzeConversation,
    changeRightSidebarTabs,
    conversationMessageNavigation,
    executionRegistryState,
    interruptSubSession,
    managedSidebarConversationAttachments.addFiles,
    managedSidebarConversationAttachments.attachments,
    managedSidebarConversationAttachments.remove,
    managedSidebarConversationAttachments.retry,
    project,
    projects,
    openAnalysisPanelEntry,
    openConversationReference,
    readFileReference,
    readProjectFile,
    readProjectFiles,
    readWorkspaceDiff,
    retryRun,
    rightSidebarTabs,
    sendSidebarConversationMessage,
    retryPendingMessage,
    editPendingMessage,
    removePendingMessage,
    sidebarConversationComposerValues,
    sidebarConversationSendingId,
    sidebarConversationViews,
    setAnalysisPanelOpen,
    submitSidebarConversationDraft,
    t,
    updateSidebarConversationDraft,
  ]);

  return (
    <OperatorConsole
      executionRegistryState={executionRegistryState}
      onReloadExecutionRegistry={() => setExecutionRegistryReload((value) => value + 1)}
      activeLocale={language.activeLocale}
      pendingLocale={language.pendingLocale}
      languageSaveStatus={language.status}
      {...settingsBundle}
      onSelectLocale={language.selectLocale}
      onRetryLocaleSave={language.retry}
      renderSearchOverlay={(close) => (
        <ConversationSearchOverlay
          {...conversationSearchBundle}
          closeHost={close}
          onOpen={openSearchedSession}
        />
      )}
      onUpdateClaude={() => {
        const update = window.moebius?.startOnboardingClaudeUpdate;
        if (update === undefined) {
          setClientError(t("desktop.error.builderUnavailable"));
          return;
        }
        void update().catch((error) => {
          setClientError(formatError(error));
        });
      }}
      project={project}
      projects={projects}
      selectedProjectId={selection.projectId}
      selectedSessionId={selection.sessionId}
      navigationSessionId={presentationRoute?.selectedSessionId}
      selectedSession={selectedSession}
      analysisPanel={selectedSession === null
        ? undefined
        : {
            open: analysisPanelOpenBySession[selectedSession.sessionId] === true,
            state: {
              status: "ready",
              entries: analysisEntriesFor(selectedSession.sessionId),
            },
            onOpenChange: (open) => setAnalysisPanelOpen(selectedSession.sessionId, open),
            onOpenEntry: (entry) => openAnalysisPanelEntry(selectedSession.sessionId, entry),
          }}
      conversationNotice={conversationTransitionBundle.transitionError ?? sessionAnalysisNotice ?? (presentationRoute?.notice === "source-unavailable"
        ? t("console.sessionAnalysis.sourceUnavailable")
        : null)}
      messages={messagesWithPreviews}
      initialReadingMessageId={selectedSession === null
        ? null
        : conversationReadingPositionStoreRef.current.read(selectedSession.sessionId)}
      messageNavigationRequest={
        selectedSession !== null
        && conversationMessageNavigation?.sessionId === selectedSession.sessionId
          ? {
              messageId: conversationMessageNavigation.messageId,
              requestId: conversationMessageNavigation.requestId,
            }
          : null
      }
      onMessageNavigationHandled={(requestId) => {
        setConversationMessageNavigation((current) =>
          current?.requestId === requestId ? null : current);
      }}
      onReadingMessageChange={(sessionId, messageId) => {
        conversationReadingPositionStoreRef.current.write(sessionId, messageId);
      }}
      pendingDispatchMessages={state?.pendingDispatchMessages ?? []}
      pendingPrimaryMessages={state?.pendingPrimaryMessages ?? []}
      childSessions={state?.childSessions ?? []}
      memberIdentities={state?.memberIdentities ?? []}
      subSessionViews={subSessionViewsWithPreviews}
      subSessionComposerValue={activeSubSessionComposerValue}
      subSessionComposerAttachments={managedSubSessionAttachments.attachments}
      activeRun={activeRun}
      activeRuns={activeRuns}
      workspaceDiff={state?.workspaceDiff ?? { available: false, fileCount: null, reason: "unavailable" }}
      composerValue={composerDraft.value}
      composerAttachments={managedAttachments.attachments}
      composerSubmissionBlockReason={conversationTransitionBundle.submissionBlockText}
      runnerStatus={runnerStatus}
      sqlitePath={sqlitePath}
      lastError={lastError}
      projectListState={projectListState}
      agentTeamsState={agentTeamCatalogBundle.state}
      lastUsedAgentTeamKey={agentTeamCatalogBundle.lastUsedTeamKey}
      conversationAgentTeamKey={selectedSession?.agentTeamOwnership != null && selectedSession.agentTeamId != null
        ? `${selectedSession.agentTeamOwnership}:${selectedSession.agentTeamId}`
        : null}
      selectedAgentTeamKey={agentTeamCatalogBundle.selection?.teamKey}
      selectedAgentTeamMemberSlug={agentTeamCatalogBundle.selection?.memberSlug}
      agentTeamDetailState={agentTeamDetailState}
      agentTeamBuilder={agentTeamBuilderBundle}
      newConversation={newConversation?.isOpen !== true ? null : {
        selectedProjectId: newConversation.projectId,
        selectedWorkspaceMode: newConversation.workspaceMode,
        selectedTeamKey: newConversation.teamKey,
        draft: newConversation.draft,
        isSubmitting: newConversation.isSubmitting,
        error: sessionAnalysisNotice ?? newConversation.error ?? clientError,
      }}
      {...cliInstallationsBundle}
      onComposerChange={(value) => {
        const current = composerDraftRef.current;
        conversationDraftStoreRef.current.write(current.key, value);
        commitComposerDraft(editConversationComposerDraft(current, value));
      }}
      onComposerFilesAdded={managedAttachments.addFiles}
      onComposerAttachmentRemove={managedAttachments.remove}
      onComposerAttachmentRetry={managedAttachments.retry}
      onSend={conversationTransitionBundle.sendMainComposer}
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
      onSubSessionRetry={(sessionId, runId, executionOverride) =>
        retryRun(sessionId, runId, executionOverride)}
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
      onSubmitNewConversation={() => void newConversationSubmissionBundle.createConversation()}
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
      onSelectSession={conversationNavigationBundle.selectConversation}
      onChangeSessionProject={actions.rebindSessionProject}
      onShowProjectInFolder={showProjectInFolder}
      onRenameProject={renameProject}
      onRemoveProject={removeProject}
      onSelectFolderForRepair={selectFolderForRepair}
      onRepairProjectFolder={repairProjectFolder}
      onArchiveSession={async (sessionId, projectId) => {
        const archivedSessionIds = await actions.archiveSession(sessionId, projectId);
        if (archivedSessionIds === null) return;
        const activeHostSessionId = presentationRouteRef.current?.hostSessionId
          ?? selectionRef.current.sessionId;
        for (const archivedSessionId of archivedSessionIds) {
          rightSidebarTabsStoreRef.current.removeSession(archivedSessionId);
        }
        rightSidebarTabsStoreRef.current.clearHosts(archivedSessionIds);
        if (presentationRoute?.selectedSessionId === sessionId) {
          const next = selectionRef.current;
          commitPresentationRoute(ordinaryPresentationRoute(next));
          setRightSidebarTabs(rightSidebarTabsStoreRef.current.read(next.sessionId));
        } else {
          setRightSidebarTabs(rightSidebarTabsStoreRef.current.read(activeHostSessionId));
        }
      }}
      onCopySessionLogPath={async (sessionId) => {
        const copySessionLogPath = window.moebius?.copySessionLogPath;
        if (copySessionLogPath === undefined) {
          return { ok: false, reason: "service-unavailable" };
        }
        return copySessionLogPath(sessionId);
      }}
      onUpdateSessionReadState={async (session, _projectId, action) => {
        await actions.updateSessionReadState(session, action);
      }}
      onSetSessionPinned={async (session, _projectId, pinned) => {
        await actions.setSessionPinned(session, pinned);
      }}
      onRenameSession={async (session, _projectId, title) => {
        const resumeSearch = conversationSearchBundle.suspendForMutation();
        setUpdatingConversationTitleSessionIds((current) => new Set(current).add(session.id));
        try {
          await actions.renameSession(session, title);
          rightSidebarTabsStoreRef.current.renameConversation(session.id, title.trim());
          const hostSessionId = presentationRouteRef.current?.hostSessionId
            ?? selectionRef.current.sessionId;
          setRightSidebarTabs(rightSidebarTabsStoreRef.current.read(hostSessionId));
          resumeSearch();
        } catch (error) {
          resumeSearch();
          throw error;
        } finally {
          setUpdatingConversationTitleSessionIds((current) => {
            const next = new Set(current);
            next.delete(session.id);
            return next;
          });
        }
      }}
      onInterrupt={interrupt}
      onRetryRun={(sessionId, runId, executionOverride) =>
        retryRun(sessionId, runId, executionOverride)}
      onRetryPendingMessage={(sessionId, messageId) => void retryPendingMessage(sessionId, messageId)}
      onEditPendingMessage={(sessionId, messageId, body) => void editPendingMessage(sessionId, messageId, body)}
      onRemovePendingMessage={(sessionId, messageId) => void removePendingMessage(sessionId, messageId)}
      onAnalyzeSession={(input) => {
        void analyzeConversation({
          kind: "conversation",
          ...input,
        });
      }}
      onAnalyzeConversation={(input) => {
        void analyzeConversation({
          kind: "message",
          ...input,
        });
      }}
      onEditAndResend={editAndResend}
      onOpenDiagnostics={openDiagnostics}
      onReplayOnboarding={onReplayOnboarding}
      onOpenExternalLink={window.moebius?.openExternalLink === undefined
        ? undefined
        : (url) => {
          void window.moebius?.openExternalLink?.(url).catch((error: unknown) => {
            setClientError(error instanceof Error ? error.message : String(error));
          });
        }}
      onOpenConversationReference={openConversationReference}
      onRetryProjectList={() => {
        setClientError(null);
        void refresh(selectionRef.current);
      }}
      onRetryAgentTeams={agentTeamCatalogBundle.refresh}
      onCreateAgentTeam={agentTeamRecordMutationBundle.createTeam}
      onOpenAgentTeam={agentTeamNavigationBundle.open}
      onCloseAgentTeam={() => {
        agentTeamNavigationBundle.close();
        agentTeamProfileBundle.clearPrimaryAgentChange();
      }}
      onSelectAgentTeamMember={agentTeamNavigationBundle.selectMember}
      onChangeAgentTeamPrimaryAgent={agentTeamProfileBundle.changePrimaryAgent}
      onAddAgentTeamMember={agentTeamMemberMutationBundle.addMember}
      onUpdateAgentTeamInformation={agentTeamRecordMutationBundle.updateInformation}
      onChangeAgentTeamMember={(teamKey, memberSlug, agentMarkdown) => {
        agentTeamMemberBundle.commitDrafts(updateAgentTeamMemberDraft(
          agentTeamMemberBundle.draftsRef.current,
          teamKey,
          memberSlug,
          agentMarkdown,
        ));
      }}
      onSaveAgentTeamMember={agentTeamMemberBundle.saveMember}
      onCheckAgentTeamMemberExternalChange={agentTeamMemberBundle.checkExternalChange}
      onLoadAgentTeamMemberExternalVersion={agentTeamMemberBundle.loadExternalVersion}
      onOverwriteAgentTeamMemberExternalVersion={agentTeamMemberBundle.overwriteExternal}
      onRetryAgentTeamMember={(teamKey, memberSlug) => {
        void agentTeamMemberBundle.loadMember(teamKey, memberSlug);
      }}
      onDiscardAgentTeamMember={(teamKey, memberSlug) => {
        agentTeamMemberBundle.commitDrafts(discardAgentTeamMemberDraft(
          agentTeamMemberBundle.draftsRef.current,
          teamKey,
          memberSlug,
        ));
      }}
      onDiscardAllAgentTeamDrafts={(teamKey) => {
        agentTeamMemberBundle.commitDrafts(discardAllAgentTeamDrafts(agentTeamMemberBundle.draftsRef.current, teamKey));
        agentTeamMemberBundle.setSaveAllFailures([]);
      }}
      onSaveAllAgentTeamDrafts={agentTeamMemberBundle.saveAll}
      onSaveAgentExecutionProfile={agentTeamProfileBundle.saveExecutionProfile}
      onRestoreAgentRecommendedProfile={agentTeamProfileBundle.restoreRecommendedProfile}
      onApplyOfficialAgentTeamUpdate={agentTeamProfileBundle.applyOfficialUpdate}
      onDuplicateBuiltInAgentTeam={agentTeamCopyBundle.duplicateBuiltIn}
      onRecheckAgentTeam={agentTeamCatalogBundle.refresh}
      onRelocateAgentTeam={agentTeamRecordMutationBundle.relocateTeam}
      onRemoveAgentTeamRecord={agentTeamRecordMutationBundle.removeRecord}
      agentTeamFileManagerLabel={t(planAgentTeamFileManagerTranslationKey(
        window.moebius?.agentTeamFileManagerKind ?? "file-manager",
      ))}
      onOpenAgentTeamLocation={agentTeamRecordMutationBundle.openLocation}
      onDuplicateUserAgentTeam={agentTeamCopyBundle.duplicateUser}
      onDuplicateAgentTeamMember={agentTeamMemberMutationBundle.duplicateMember}
      onTrashAgentTeamMember={agentTeamMemberMutationBundle.trashMember}
      onTrashUserAgentTeam={agentTeamRecordMutationBundle.trashTeam}
      onViewAgentTeamRegistrationConflict={agentTeamRegistrationBundle.viewConflict}
      onShowAgentTeamRegistrationConflictLocation={agentTeamRegistrationBundle.showConflictLocation}
      onPreserveAgentTeamRegistrationConflicts={agentTeamRegistrationBundle.preserveConflicts}
      isSending={isSending}
      isSubSessionSending={subSessionSendingId !== null}
      isSelectionMutationPending={selectionMutationKind !== null}
      isSessionProjectUpdating={selectionMutationKind === "rebind-session"}
      isProjectMutationPending={isProjectMutationPending}
      sidebarOpen={sidebarVisibilityPreference === "open"}
      onSidebarOpenChange={setSidebarOpen}
      rightSidebarOpen={rightSidebarVisibilityPreference === "open"}
      rightSidebarWidth={rightSidebarWidth}
      rightSidebarTabs={resolvedRightSidebarTabs.state}
      rightSidebarTabDiscriminators={rightSidebarTabDiscriminators}
      rightSidebarUpdatingTabIds={rightSidebarUpdatingTabIds}
      onRetryRightSidebarTitles={() => {
        setClientError(null);
        void refresh(selectionRef.current);
      }}
      rightSidebarFocusTabId={
        selectedSession !== null
        && rightSidebarFocusRequest?.hostSessionId === selectedSession.sessionId
          ? rightSidebarFocusRequest.tabId
          : null
      }
      onRightSidebarFocusHandled={(tabId) => {
        setRightSidebarFocusRequest((current) => current?.tabId === tabId ? null : current);
      }}
      rightSidebarContentSlots={{
        conversation: renderSidebarConversation,
      }}
      processOutputs={processOutputs}
      processInvocationStates={processInvocationStates}
      onLoadProcessInvocation={readProcessDebugInvocation}
      onRightSidebarOpenChange={setRightSidebarOpen}
      onRightSidebarWidthChange={changeRightSidebarWidth}
      onRightSidebarTabsChange={changeRightSidebarTabs}
      onBeforeCloseRightSidebarTab={(tab) => {
        const locator = tab.type === "conversation"
          ? parseConversationTabSourceKey(tab.sourceKey)
          : null;
        if (locator?.kind !== "draft") return true;
        const draft = sidebarConversationDraftStoreRef.current.read(locator.draftId);
        if (draft === null) return true;
        const hasAttachments = managedSidebarConversationAttachments
          .hasDraftAttachments(draft.attachmentDraftKey);
        if (
          sidebarConversationDraftRequiresDiscardConfirmation(draft, hasAttachments)
            && !window.confirm(t("console.sessionAnalysis.discardDraft"))
        ) {
          return false;
        }
        sidebarConversationDraftStoreRef.current.remove(draft.draftId);
        setSidebarConversationDrafts(sidebarConversationDraftStoreRef.current.list());
        managedSidebarConversationAttachments.clearDraft(draft.attachmentDraftKey);
        return true;
      }}
      onLoadWorkspaceDiff={readWorkspaceDiff}
      onLoadProjectFiles={readProjectFiles}
      onLoadProjectFile={readProjectFile}
      onLoadFileReference={readFileReference}
      onLoadProcessOutputPrevious={loadPreviousProcessOutput}
    />
  );
}

function createAgentTeamBuilderDraftId(): string {
  const suffix = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `agent-teams-${suffix}`;
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
