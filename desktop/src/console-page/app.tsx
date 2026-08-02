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
  type OperatorChildSessionSummary,
  type OperatorEditAndResendTarget,
  type OperatorProject,
  type OperatorProcessOutput,
  type OperatorProcessTimelineEvent,
  type OperatorRunSnapshot,
  type OperatorRunnerStatus,
  type OperatorSession,
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
  loadExecutionProfileRegistry,
  restoreConsoleSession,
  type SessionSearchResult,
} from "./console-api-client.js";
import { ConsoleStateActions } from "./console-state-actions.js";
import { browserConsoleCommandPort } from "./console-command-client.js";
import {
  planCanonicalConversationTabTitles,
  planConversationProjectContext,
  planConversationTabDiscriminators,
} from "./console-presentation-model.js";
import {
  planAgentTeamFileManagerTranslationKey,
  planGeneralAssistantTeamKey,
  planAgentTeamDetailState,
} from "./agent-team-console-model.js";
import {
  EMPTY_CONSOLE_PROJECT,
  NO_OPERATOR_MESSAGES,
} from "./console-default-state.js";
import {
  ConsoleStateCoordinator,
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
  conversationTabSourceKey,
  createRightSidebarTabsStore,
  parseConversationTabSourceKey,
} from "./right-sidebar-tabs-store.js";
import {
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
import { useMessagesWithAttachmentPreviews } from "./use-message-attachment-previews.js";
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
import { useConsoleStateSync } from "./use-console-state-sync.js";
import { browserConsoleStateSyncPort } from "./console-state-sync-browser-port.js";
import { useConsoleAttachmentDrafts } from "./use-console-attachment-drafts.js";
import { browserConversationViewSyncPort } from "./conversation-view-browser-port.js";
import { browserProcessDataSyncPort } from "./process-data-browser-port.js";
import { useRightSidebarConsole } from "./use-right-sidebar-console.js";
import { browserProjectFilePort } from "./project-file-browser-port.js";
import type { LocalConsoleState } from "./console-state-contract.js";
import { browserConversationAnalysisReferencePort } from "./conversation-analysis-browser-port.js";
import { useConversationConsole } from "./use-conversation-console.js";
import { browserProjectMutationPort } from "./project-mutation-browser-port.js";
import { useProjectMutations } from "./use-project-mutations.js";
import { browserSessionRunPort } from "./session-run-browser-port.js";
import { browserSidebarMessagePort } from "./sidebar-message-browser-port.js";
import { useSessionConsole } from "./use-session-console.js";
import { browserSidebarDraftPort } from "./sidebar-draft-browser-port.js";
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
  const rightSidebarTabsStore = useMemo(
    () => createRightSidebarTabsStore(window.localStorage),
    [],
  );
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
  const [sidebarConversationComposerValues, setSidebarConversationComposerValues] =
    useState<Record<string, string>>({});
  const [sidebarConversationSendingId, setSidebarConversationSendingId] = useState<string | null>(null);
  const [updatingConversationTitleSessionIds, setUpdatingConversationTitleSessionIds] =
    useState<Set<string>>(() => new Set());
  const sourceMigrationRef = useRef<string | null>(null);
  const [subSessionComposerValues, setSubSessionComposerValues] = useState<Record<string, string>>({});
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
  const resultAcknowledgementsRef = useRef(new Set<string>());
  const rightSidebarBundle = useRightSidebarConsole(
    window.localStorage, rightSidebarTabsStore, apiBase,
    presentationRoute?.hostSessionId ?? selection.sessionId,
    selection.sessionId, state?.selectedSession ?? null, selection.projectId,
    planGeneralAssistantTeamKey(agentTeamCatalogBundle.state), sidebarConversationDraftStoreRef.current,
    setSidebarConversationDrafts, browserConversationViewSyncPort, browserProcessDataSyncPort,
    browserProjectFilePort, processInvocationKey, setClientError,
  );
  const rightSidebarTabsBundle = rightSidebarBundle.tabs;
  const rightSidebarTabs = rightSidebarTabsBundle.state;
  const activeSubSessionId = rightSidebarBundle.active.subSessionId;
  const activeConversationLocator = rightSidebarBundle.active.conversation;
  const activeSidebarConversationSessionId = activeConversationLocator?.kind === "session"
    ? activeConversationLocator.sessionId
    : null;
  const activeSidebarConversationDraftId = activeConversationLocator?.kind === "draft"
    ? activeConversationLocator.draftId
    : null;
  const activeSidebarConversationDraft = activeSidebarConversationDraftId === null
    ? null
    : sidebarConversationDrafts.find((draft) => draft.draftId === activeSidebarConversationDraftId) ?? null;
  const conversationViewsBundle = rightSidebarBundle.conversationViews;
  const subSessionViews = conversationViewsBundle.subSessionViews;
  const sidebarConversationViews = conversationViewsBundle.sidebarConversationViews;
  const setSidebarConversationViews = conversationViewsBundle.setSidebarConversationViews;
  const refreshSubSessionNow = conversationViewsBundle.refreshSubSessionNow;
  const processDataBundle = rightSidebarBundle.processData;
  const processOutputs = processDataBundle.outputs;
  const processInvocationStates = processDataBundle.invocations;
  const readProcessDebugInvocation = processDataBundle.readInvocation;
  const loadPreviousProcessOutput = processDataBundle.loadPrevious;
  const readWorkspaceDiff = rightSidebarBundle.files.readWorkspaceDiff;
  const readProjectFiles = rightSidebarBundle.files.readProjectFiles;
  const readProjectFile = rightSidebarBundle.files.readProjectFile;
  const readFileReference = rightSidebarBundle.files.readFileReference;
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
  const attachmentDraftsBundle = useConsoleAttachmentDrafts(
    managedAttachmentClient, apiBase, attachmentCapability, currentAttachmentDraftKey,
    activeSubSessionDraftKey, activeSidebarConversationAttachmentDraftKey,
    reportAttachmentError, recordSidebarDraftAttachmentPresence,
  );
  const managedAttachments = attachmentDraftsBundle.main;
  const managedSubSessionAttachments = attachmentDraftsBundle.subSession;
  const managedSidebarConversationAttachments = attachmentDraftsBundle.sidebar;

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

  const setRightSidebarOpen = rightSidebarTabsBundle.setOpen;

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

  const conversationControllersBundle = useConversationConsole(
    composerDraft, selection, projects, actions, setClientError, t, coordinatorRef.current,
    selectionRef, selectionPersistenceEnabledRef, dispatchNewConversation, commitPresentationRoute,
    activateComposerDraft, rightSidebarTabsBundle, openRightSidebarSourceTab, newConversation,
    agentTeamCatalogBundle, managedAttachments,
    readyComposerAttachmentIds(managedAttachments.attachments),
    hasBlockingComposerAttachment(managedAttachments.attachments), rememberConfirmedSelection,
    conversationDraftStoreRef.current, window.moebius, language.activeLocale,
    (sessionId, messageId) => conversationReadingPositionStoreRef.current.write(sessionId, messageId),
    apiBase, stateRef, presentationRouteRef, sidebarConversationDraftStoreRef.current,
    setSidebarConversationDrafts, commitConsoleState, commitSelection,
    browserConversationAnalysisReferencePort, fetch, setSessionAnalysisNotice,
  );
  const conversationTransitionBundle = conversationControllersBundle.transition;
  const conversationNavigationBundle = conversationControllersBundle.navigation;
  const newConversationSubmissionBundle = conversationControllersBundle.submission;
  const analysisNavigationBundle = conversationControllersBundle.analysisNavigation;
  const analyzeConversation = conversationControllersBundle.analysis.analyze;
  const lastError = conversationTransitionBundle.transitionError ?? clientError ?? state?.lastError ?? null;
  const analysisEntriesFor = analysisNavigationBundle.entriesFor;
  const analysisPanelOpenBySession = analysisNavigationBundle.openBySession;
  const setAnalysisPanelOpen = analysisNavigationBundle.setPanelOpen;
  const openAnalysisPanelEntry = analysisNavigationBundle.openEntry;
  const openConversationReference = analysisNavigationBundle.openReference;
  const conversationMessageNavigation = analysisNavigationBundle.messageNavigation;

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

  const projectMutationsBundle = useProjectMutations(
    apiBase, projects, presentationRoute, selectionRef, selectionPersistenceEnabledRef,
    forgetPersistedSelection, refresh, commitPresentationRoute, setRightSidebarOpen,
    rightSidebarTabsBundle.store, rightSidebarTabsBundle.showHost, startNewConversation,
    window.moebius, browserProjectMutationPort, setClientError,
  );
  const isProjectMutationPending = projectMutationsBundle.isPending;
  const showProjectInFolder = projectMutationsBundle.showProjectInFolder;
  const renameProject = projectMutationsBundle.renameProject;
  const removeProject = projectMutationsBundle.removeProject;
  const selectFolderForRepair = projectMutationsBundle.selectFolderForRepair;
  const repairProjectFolder = projectMutationsBundle.repairProjectFolder;

  const sessionControllersBundle = useSessionConsole(
    apiBase, subSessionComposerValues, setSubSessionComposerValues,
    managedSubSessionAttachments, conversationDraftStoreRef.current,
    selectionRef, refresh, refreshSubSessionNow, browserSessionRunPort,
    sidebarConversationSendingId, setSidebarConversationSendingId,
    sidebarConversationComposerValues, setSidebarConversationComposerValues,
    managedSidebarConversationAttachments, projects, agentTeamCatalogBundle,
    sidebarConversationDraftStoreRef.current, setSidebarConversationDrafts,
    rightSidebarTabsBundle, presentationRouteRef, commitPresentationRoute,
    window.moebius, browserSidebarDraftPort, t, sidebarConversationViews,
    setSidebarConversationViews, browserSidebarMessagePort, setClientError,
  );
  const sessionRunActionsBundle = sessionControllersBundle.runs;
  const interrupt = sessionRunActionsBundle.interrupt;
  const sendSubSessionMessage = sessionRunActionsBundle.sendSubSessionMessage;
  const retryRun = sessionRunActionsBundle.retryRun;
  const interruptSubSession = sessionRunActionsBundle.interruptSubSession;
  const sidebarMessageActionsBundle = sessionControllersBundle.sidebarMessages;
  const sendSidebarConversationMessage = sidebarMessageActionsBundle.sendMessage;
  const retryPendingMessage = sidebarMessageActionsBundle.retryPendingMessage;
  const editPendingMessage = sidebarMessageActionsBundle.editPendingMessage;
  const removePendingMessage = sidebarMessageActionsBundle.removePendingMessage;
  const updateSidebarConversationDraft = sessionControllersBundle.sidebarDrafts.updateDraft;
  const submitSidebarConversationDraft = sessionControllersBundle.sidebarDrafts.submitDraft;

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
      rightSidebarTabsBundle.showHost(target.sessionId);
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
          rightSidebarTabsBundle.store.read(origin.sessionId),
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
        rightSidebarTabsBundle.store.write(origin.sessionId, tabs);
        rightSidebarTabsBundle.commitCurrent(tabs);
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
          analysisNavigationBundle.handleMessageNavigation(requestId);
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
          rightSidebarTabsBundle.changeTabs(openRightSidebarSourceTab(rightSidebarTabs, intent.kind === "workspace-diff"
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
    rightSidebarTabsBundle,
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
        analysisNavigationBundle.handleMessageNavigation(requestId);
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
          rightSidebarTabsBundle.store.removeSession(archivedSessionId);
        }
        rightSidebarTabsBundle.store.clearHosts(archivedSessionIds);
        if (presentationRoute?.selectedSessionId === sessionId) {
          const next = selectionRef.current;
          commitPresentationRoute(ordinaryPresentationRoute(next));
          rightSidebarTabsBundle.showHost(next.sessionId);
        } else {
          rightSidebarTabsBundle.showHost(activeHostSessionId);
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
          rightSidebarTabsBundle.store.renameConversation(session.id, title.trim());
          const hostSessionId = presentationRouteRef.current?.hostSessionId
            ?? selectionRef.current.sessionId;
          rightSidebarTabsBundle.showHost(hostSessionId);
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
      isSubSessionSending={sessionRunActionsBundle.isSending}
      isSelectionMutationPending={selectionMutationKind !== null}
      isSessionProjectUpdating={selectionMutationKind === "rebind-session"}
      isProjectMutationPending={isProjectMutationPending}
      sidebarOpen={sidebarVisibilityPreference === "open"}
      onSidebarOpenChange={setSidebarOpen}
      rightSidebarOpen={rightSidebarTabsBundle.visibilityPreference === "open"}
      rightSidebarWidth={rightSidebarTabsBundle.width}
      rightSidebarTabs={resolvedRightSidebarTabs.state}
      rightSidebarTabDiscriminators={rightSidebarTabDiscriminators}
      rightSidebarUpdatingTabIds={rightSidebarUpdatingTabIds}
      onRetryRightSidebarTitles={() => {
        setClientError(null);
        void refresh(selectionRef.current);
      }}
      rightSidebarFocusTabId={
        selectedSession !== null
        && rightSidebarTabsBundle.focusRequest?.hostSessionId === selectedSession.sessionId
          ? rightSidebarTabsBundle.focusRequest.tabId
          : null
      }
      onRightSidebarFocusHandled={(tabId) => {
        rightSidebarTabsBundle.handleFocus(tabId);
      }}
      rightSidebarContentSlots={{
        conversation: renderSidebarConversation,
      }}
      processOutputs={processOutputs}
      processInvocationStates={processInvocationStates}
      onLoadProcessInvocation={readProcessDebugInvocation}
      onRightSidebarOpenChange={setRightSidebarOpen}
      onRightSidebarWidthChange={rightSidebarTabsBundle.changeWidth}
      onRightSidebarTabsChange={rightSidebarTabsBundle.changeTabs}
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
