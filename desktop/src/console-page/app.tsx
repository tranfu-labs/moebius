import "@moebius/console-ui/globals.css";

import {
  I18nProvider,
  useI18n,
  OperatorConsole,
  ConversationSearch,
  type ConversationSearchResultItem,
  resolveNewConversationAgentTeamKey,
  type AgentTeamInformationInput,
  type AgentTeamDetailState,
  type AgentTeamMemberEditorState,
  type AgentTeamSaveAllFailureView,
  type TeamBuilderViewState,
  type OperatorMessage,
  type OperatorPendingDispatch,
  type OperatorMemberIdentity,
  type OperatorAgentTeam,
  type OperatorAgentTeamsState,
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
  type Locale,
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
import type { AiTeamBuilderState } from "../ai-team-builder/dto.js";
import {
  toTeamBuilderIpcViewError,
  toTeamBuilderViewState,
} from "../team-builder-view-state.js";
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
  searchConsoleSessions,
  restoreConsoleSession,
  type SessionSearchResult,
} from "./console-api-client.js";
import { ConsoleStateActions } from "./console-state-actions.js";
import { browserConsoleCommandPort } from "./console-command-client.js";
import { refreshConsoleState } from "./refresh-console-state.js";
import {
  mergeSettledProcessOutput,
  processOutputLocator,
  subSessionIdFromSourceKey,
} from "./console-process-model.js";
import {
  ConsoleStateCoordinator,
  ProcessInvocationRequestCoordinator,
  SessionViewTransitionQueue,
  type ConsoleSelection,
  type SelectionMutationKind,
  type SelectionMutationToken,
} from "./console-state-coordinator.js";
import { fetchFromBrowser as fetch } from "./browser-fetch.js";
import { managedAttachmentClient } from "./attachment-client.js";
import {
  activateConversationComposerDraft,
  clearConversationComposerDraft,
  conversationSubmissionBlockReason,
  editConversationComposerDraft,
  type ConversationComposerDraftState,
  NEW_CONVERSATION_DRAFT_KEY,
  sessionDraftKey,
} from "./conversation-draft-model.js";
import { createConversationDraftStore } from "./draft-store.js";
import {
  isFirstRunOnboarding,
  readSidebarVisibilityPreference,
  writeSidebarVisibilityPreference,
  type SidebarVisibilityPreference,
} from "./sidebar-preference.js";
import { OnboardingRoute } from "../onboarding/onboarding-route.js";
import { finishOnboardingPresentation } from "../onboarding/onboarding-completion.js";
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
  startAgentTeamMemberLoad,
  startAgentTeamMemberExternalOverwrite,
  startAgentTeamMemberSave,
  updateAgentTeamMemberDraft,
  type AgentTeamDraftState,
  type AgentTeamSaveAllFailure,
  type AgentTeamSelection,
} from "./team-state.js";
import { saveAllAgentTeamDrafts } from "./team-save-controller.js";
import {
  useManagedAttachmentDrafts,
  useMessagesWithAttachmentPreviews,
} from "./use-managed-attachments.js";
import { interruptLocalConsoleRun } from "./interrupt.js";
import { refillStoppedRunDraft } from "./edit-resend.js";
import type { CopySessionLogPathResult } from "../session-log-clipboard.js";
import type { DesktopLocale } from "../language-preference-contract.js";
import type {
  SettingsApplicationInfo,
  SettingsUpdateCheckResult,
  SettingsVersionCopyResult,
} from "../settings-contract.js";
import {
  createLanguageState,
  reduceLanguageState,
  type LanguageState,
} from "./language-state.js";
import { useDesktopSettingsBundle } from "./use-desktop-settings.js";
import { useActiveCliInstallationsBundle } from "./use-active-cli-installations.js";
import {
  createContext,
  useContext,
} from "react";

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
  return <DesktopLanguageRoot />;
}

interface DesktopLanguageContextValue extends LanguageState {
  selectLocale(locale: DesktopLocale): void;
  retry(): void;
}

const DesktopLanguageContext = createContext<DesktopLanguageContextValue | null>(null);
const FALLBACK_DESKTOP_LANGUAGE: DesktopLanguageContextValue = {
  ...createLanguageState("zh-CN"),
  selectLocale: () => undefined,
  retry: () => undefined,
};

function DesktopLanguageRoot(): JSX.Element {
  const [state, dispatch] = useReducer(
    reduceLanguageState,
    readInitialLocale(),
    createLanguageState,
  );
  const requestIdRef = useRef(0);

  const save = useCallback((locale: DesktopLocale) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    dispatch({ type: "select", locale, requestId });
    const savePreference = window.moebius?.saveLanguagePreference;
    if (savePreference === undefined) {
      dispatch({ type: "saved", locale, requestId });
      return;
    }
    void savePreference(locale).then((savedLocale) => {
      dispatch({ type: "saved", locale: savedLocale, requestId });
    }).catch(() => {
      dispatch({ type: "failed", requestId });
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = state.activeLocale;
  }, [state.activeLocale]);

  useEffect(() => {
    void window.moebius?.readLanguagePreference?.().then((locale) => {
      dispatch({ type: "external", locale });
    }).catch(() => undefined);
    return window.moebius?.onLanguagePreferenceChanged?.((locale) => {
      dispatch({ type: "external", locale });
    });
  }, []);

  const value = useMemo<DesktopLanguageContextValue>(() => ({
    ...state,
    selectLocale: save,
    retry: () => {
      if (state.pendingLocale !== null) {
        save(state.pendingLocale);
      }
    },
  }), [save, state]);

  return (
    <DesktopLanguageContext.Provider value={value}>
      <I18nProvider locale={state.activeLocale as Locale}>
        <HashRouter>
          <DesktopRoutes />
        </HashRouter>
      </I18nProvider>
    </DesktopLanguageContext.Provider>
  );
}

function useDesktopLanguage(): DesktopLanguageContextValue {
  return useContext(DesktopLanguageContext) ?? FALLBACK_DESKTOP_LANGUAGE;
}

function readInitialLocale(): DesktopLocale {
  const value = new URLSearchParams(window.location.search).get("locale");
  return value === "en" ? "en" : "zh-CN";
}

function DesktopRoutes(): JSX.Element {
  const { t } = useI18n();
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
      throw new Error(t("desktop.error.onboardingSave"));
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
          ? (
              <OnboardingRoute
                onComplete={(teamKey) => finishOnboardingPresentation({
                  mode: "first-run",
                  teamKey,
                  onFirstRunComplete: completeOnboarding,
                })}
              />
            )
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
  const [replayingOnboarding, setReplayingOnboarding] = useState(false);
  const replayReturnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (readPendingAgentTeamKey(location.state) === null) {
      return;
    }
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: null },
    );
  }, [location.hash, location.pathname, location.search, location.state, navigate]);

  const finishReplay = useCallback(() => {
    setReplayingOnboarding(false);
    window.requestAnimationFrame(() => replayReturnFocusRef.current?.focus());
  }, []);

  const startReplay = useCallback(() => {
    replayReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setReplayingOnboarding(true);
  }, []);

  return (
    <>
      <div
        className={replayingOnboarding ? "hidden" : "contents"}
        aria-hidden={replayingOnboarding ? "true" : undefined}
        data-testid="operator-console-preserved-during-onboarding-replay"
      >
        <OperatorConsoleApp
          pendingAgentTeamKey={pendingAgentTeamKey}
          onReplayOnboarding={startReplay}
        />
      </div>
      {replayingOnboarding ? (
        <OnboardingRoute
          mode="replay"
          onExit={finishReplay}
          onComplete={() => finishOnboardingPresentation({
            mode: "replay",
            onReplayComplete: finishReplay,
          })}
        />
      ) : null}
    </>
  );
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
  onReplayOnboarding,
}: {
  pendingAgentTeamKey?: string | null;
  onReplayOnboarding?: () => void;
}): JSX.Element {
  const language = useDesktopLanguage();
  const { t } = useI18n();
  const [apiBase, setApiBase] = useState<string | null>(readQueryApiBase());
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
  const [conversationSearchState, setConversationSearchState] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    results: SessionSearchResult[];
    error: string | null;
    conditionKey: string | null;
  }>({ status: "idle", results: [], error: null, conditionKey: null });
  const conversationSearchRequestRef = useRef<AbortController | null>(null);
  const conversationSearchInputRef = useRef<{
    query: string;
    includeArchived: boolean;
  } | null>(null);
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
  const sessionViewTransitionQueueRef = useRef(new SessionViewTransitionQueue());
  const sessionViewTransitionPendingRef = useRef(false);
  const [sessionViewTransitionPending, setSessionViewTransitionPending] = useState(false);
  const [sessionViewTransitionError, setSessionViewTransitionError] = useState<string | null>(null);
  const [runnerStatus, setRunnerStatus] = useState<OperatorRunnerStatus>("stopped");
  const [isSending, setIsSending] = useState(false);
  const [selectionMutationKind, setSelectionMutationKind] = useState<SelectionMutationKind | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const settingsBundle = useDesktopSettingsBundle(window.moebius);
  const [isProjectMutationPending, setIsProjectMutationPending] = useState(false);
  const [newConversation, dispatchNewConversation] = useReducer(reduceNewConversationDraft, null);
  const [agentTeamsState, setAgentTeamsState] = useState<OperatorAgentTeamsState>({ status: "loading" });
  const cliInstallationsBundle = useActiveCliInstallationsBundle(window.moebius);
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

        setAgentTeamsState({
          status: "ready",
          teams: result.teams.map(toOperatorAgentTeam),
          registrationIssues: result.registrationIssues,
        });
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
        throw new Error(t("desktop.error.agentRead"));
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
  }, [agentTeamsState, commitAgentTeamDraftState, t]);

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
      team === undefined
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
        t("desktop.error.externalCheck", { error: formatError(error) }),
      ));
    } finally {
      checkingAgentTeamExternalChangesRef.current.delete(checkKey);
    }
  }, [agentTeamsState, commitAgentTeamDraftState, t, updateAgentTeamMemberSummary]);

  const persistAgentTeamMember = useCallback(async (
    teamKey: string,
    memberSlug: string,
    agentMarkdown: string,
  ): Promise<AgentTeamMemberDocument> => {
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const writeMember = window.moebius?.writeAgentTeamMember;
    if (team === undefined || writeMember === undefined) {
      throw new Error(t("desktop.error.agentSave"));
    }
    const document = await writeMember({
      teamId: team.id,
      ownership: team.ownership,
      memberSlug,
      agentMarkdown,
    });
    updateAgentTeamMemberSummary(teamKey, document);
    return document;
  }, [agentTeamsState, t, updateAgentTeamMemberSummary]);

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

  const viewAgentTeamRegistrationConflict = useCallback(() => {
    openAgentTeam("user:general-assistant");
  }, [openAgentTeam]);

  const showAgentTeamRegistrationConflictLocation = useCallback(async (): Promise<void> => {
    const showLocation = window.moebius?.showAgentTeamSeedConflictLocation;
    if (showLocation === undefined) {
      throw new Error(t("desktop.error.openLocation"));
    }
    await showLocation();
  }, [t]);

  const preserveAgentTeamRegistrationConflicts = useCallback(async (): Promise<void> => {
    const resolveConflict = window.moebius?.resolveAgentTeamSeedConflict;
    if (resolveConflict === undefined) {
      throw new Error(t("console.agentTeams.registrationConflictActionFailed"));
    }
    const result = await resolveConflict();
    if (result.status !== "ready") {
      throw new Error(t("console.agentTeams.registrationConflictActionFailed"));
    }
    setAgentTeamsState({
      status: "ready",
      teams: result.teams.map(toOperatorAgentTeam),
      registrationIssues: result.registrationIssues,
    });
    setAgentTeamSelection((current) => reconcileAgentTeamSelection(result.teams, current));
  }, [t]);

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
    if (team === undefined || setPrimaryAgent === undefined) {
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

  const saveAgentExecutionProfile = useCallback(async (
    teamKey: string,
    memberSlug: string,
    profile: { cli: "codex" | "claude" | "kimi"; model: string; effort: string },
  ) => {
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const saveProfile = window.moebius?.saveAgentTeamExecutionProfile;
    if (team === undefined || saveProfile === undefined) {
      throw new Error(t("desktop.error.profileSave"));
    }
    const document = await saveProfile({
      teamId: team.id,
      ownership: team.ownership,
      memberSlug,
      profile,
    });
    setAgentTeamsRefreshNonce((current) => current + 1);
    return document;
  }, [agentTeamsState, t]);

  const restoreAgentRecommendedProfile = useCallback(async (teamKey: string, memberSlug: string) => {
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const restore = window.moebius?.restoreAgentTeamRecommendedProfile;
    if (team === undefined || restore === undefined) {
      throw new Error(t("desktop.error.profileRestore"));
    }
    const document = await restore({
      teamId: team.id,
      ownership: team.ownership,
      memberSlug,
    });
    setAgentTeamsRefreshNonce((current) => current + 1);
    return document;
  }, [agentTeamsState, t]);

  const applyOfficialAgentTeamUpdate = useCallback(async (teamKey: string) => {
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const prepare = window.moebius?.prepareAgentTeamOfficialUpdate;
    const apply = window.moebius?.applyAgentTeamOfficialUpdate;
    if (team === undefined || team.ownership !== "system" || prepare === undefined || apply === undefined) {
      throw new Error(t("desktop.error.officialUpdate"));
    }
    const plan = await prepare({ teamId: team.id, ownership: "system" });
    const result = await apply({ plan });
    if (result.copiedTeam !== null) {
      const copiedTeam = toOperatorAgentTeam(result.copiedTeam);
      setAgentTeamsState((current) => current.status !== "ready"
        ? current
        : {
            status: "ready",
            teams: current.teams.some((candidate) => candidate.teamKey === copiedTeam.teamKey)
              ? current.teams
              : [...current.teams, copiedTeam],
          });
    }
    setAgentTeamsRefreshNonce((current) => current + 1);
    return {
      copiedTeamId: result.copiedTeamId,
      appliedOfficialVersion: result.appliedOfficialVersion,
      memberChanges: result.memberChanges,
    };
  }, [agentTeamsState, t]);

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
          throw new Error(t("desktop.error.duplicateRead"));
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
  }, [commitAgentTeamDraftState, t]);

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
      failAgentTeamBuilder(toTeamBuilderIpcViewError(response.error, t));
      return null;
    }
    agentTeamBuilderStartedRef.current = true;
    setAgentTeamBuilderState(toTeamBuilderViewState(response.state, t));
    return response.state;
  }, [failAgentTeamBuilder, t]);

  const activateAiBuiltAgentTeam = useCallback(async (teamId: string): Promise<OperatorAgentTeam> => {
    const listTeams = window.moebius?.listAgentTeams;
    if (listTeams === undefined) {
      throw new Error(t("desktop.error.teamCreatedDetail"));
    }
    const result = await listTeams();
    if (result.status !== "ready") {
      throw new Error(t("desktop.error.teamCreatedDetail"));
    }
    const selectedItem = result.teams.find((team) => team.ownership === "user" && team.id === teamId);
    if (selectedItem === undefined) {
      throw new Error(t("desktop.error.teamCreatedDetail"));
    }
    const selectedTeam = toOperatorAgentTeam(selectedItem);
    await activateCopiedAgentTeam(selectedItem);
    setAgentTeamsState({ status: "ready", teams: result.teams.map(toOperatorAgentTeam) });
    window.localStorage.removeItem(AGENT_TEAM_BUILDER_DRAFT_STORAGE_KEY);
    agentTeamBuilderDraftIdRef.current = null;
    agentTeamBuilderStartedRef.current = false;
    return selectedTeam;
  }, [activateCopiedAgentTeam, t]);

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
        humanMessage: t("desktop.error.builderUnavailable"),
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
        humanMessage: t("desktop.error.builderUnavailable"),
        canRetry: true,
      });
      return null;
    }
  }, [
    acceptAgentTeamBuilderResponse,
    activateSelectedAiTeamBuilderState,
    failAgentTeamBuilder,
    getAgentTeamBuilderDraftId,
    t,
  ]);

  const submitAgentTeamBuilder = useCallback(async (text: string): Promise<void> => {
    const submit = window.moebius?.submitAiTeamBuilder;
    if (submit === undefined) {
      failAgentTeamBuilder({
        code: "temporarily-unavailable",
        humanMessage: t("desktop.error.builderUnavailable"),
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
        humanMessage: t("desktop.error.builderPreserved"),
        canRetry: true,
      });
    }
  }, [acceptAgentTeamBuilderResponse, failAgentTeamBuilder, getAgentTeamBuilderDraftId, t]);

  const adjustAgentTeamBuilder = useCallback(async (text: string): Promise<void> => {
    const adjust = window.moebius?.adjustAiTeamBuilder;
    if (adjust === undefined) {
      failAgentTeamBuilder({
        code: "temporarily-unavailable",
        humanMessage: t("desktop.error.builderUnavailable"),
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
        humanMessage: t("desktop.error.builderPreserved"),
        canRetry: true,
      });
    }
  }, [acceptAgentTeamBuilderResponse, failAgentTeamBuilder, getAgentTeamBuilderDraftId, t]);

  const retryAgentTeamBuilder = useCallback(async (): Promise<OperatorAgentTeam | null> => {
    if (!agentTeamBuilderStartedRef.current) {
      return startAgentTeamBuilder();
    }
    const retry = window.moebius?.retryAiTeamBuilder;
    if (retry === undefined) {
      failAgentTeamBuilder({
        code: "temporarily-unavailable",
        humanMessage: t("desktop.error.builderUnavailable"),
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
        humanMessage: t("desktop.error.builderPreserved"),
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
    t,
  ]);

  const commitAgentTeamBuilder = useCallback(async (
    proposalRevision: number,
  ): Promise<OperatorAgentTeam | null> => {
    const commit = window.moebius?.commitAiTeamBuilder;
    if (commit === undefined) {
      failAgentTeamBuilder({
        code: "temporarily-unavailable",
        humanMessage: t("desktop.error.builderUnavailable"),
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
        humanMessage: t("desktop.error.teamCreatePreserved"),
        canRetry: true,
      });
      return null;
    }
  }, [
    acceptAgentTeamBuilderResponse,
    activateSelectedAiTeamBuilderState,
    failAgentTeamBuilder,
    getAgentTeamBuilderDraftId,
    t,
  ]);

  const duplicateBuiltInAgentTeam = useCallback(async (teamKey: string): Promise<string> => {
    const source = findOperatorAgentTeam(agentTeamsState, teamKey);
    const duplicateTeam = window.moebius?.duplicateBuiltInAgentTeam;
    if (source === undefined || source.ownership !== "system" || duplicateTeam === undefined) {
      throw new Error(t("desktop.error.duplicateBuiltIn"));
    }

    const copiedItem = await duplicateTeam({ teamId: source.id, ownership: "system" });
    return activateCopiedAgentTeam(copiedItem);
  }, [activateCopiedAgentTeam, agentTeamsState, t]);

  const assertAgentTeamDraftsResolved = useCallback((teamKey: string) => {
    if (getDirtyAgentTeamMemberSlugs(agentTeamDraftStateRef.current, teamKey).length > 0) {
      throw new Error(t("desktop.error.unsavedTeam"));
    }
  }, [t]);

  const duplicateUserAgentTeam = useCallback(async (teamKey: string): Promise<string> => {
    assertAgentTeamDraftsResolved(teamKey);
    const source = findOperatorAgentTeam(agentTeamsState, teamKey);
    const duplicateTeam = window.moebius?.duplicateUserAgentTeam;
    if (source === undefined || source.ownership !== "user" || duplicateTeam === undefined) {
      throw new Error(t("desktop.error.duplicateUserTeam"));
    }
    const copiedItem = await duplicateTeam({ teamId: source.id, ownership: "user" });
    return activateCopiedAgentTeam(copiedItem);
  }, [activateCopiedAgentTeam, agentTeamsState, assertAgentTeamDraftsResolved, t]);

  const duplicateAgentTeamMember = useCallback(async (teamKey: string, memberSlug: string): Promise<void> => {
    assertAgentTeamDraftsResolved(teamKey);
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const duplicateMember = window.moebius?.duplicateAgentTeamMember;
    if (team === undefined || duplicateMember === undefined) {
      throw new Error(t("desktop.error.duplicateAgent"));
    }
    const result = await duplicateMember({
      teamId: team.id,
      ownership: team.ownership,
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
  }, [agentTeamsState, assertAgentTeamDraftsResolved, commitAgentTeamDraftState, t]);

  const trashAgentTeamMember = useCallback(async (teamKey: string, memberSlug: string): Promise<void> => {
    assertAgentTeamDraftsResolved(teamKey);
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const trashMember = window.moebius?.trashAgentTeamMember;
    if (team === undefined || trashMember === undefined) {
      throw new Error(t("desktop.error.deleteAgent"));
    }
    if (team.primaryAgentSlug === memberSlug) {
      throw new Error(t("desktop.error.deletePrimary"));
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
  }, [agentTeamsState, assertAgentTeamDraftsResolved, commitAgentTeamDraftState, loadAgentTeamMember, t]);

  const trashUserAgentTeam = useCallback(async (teamKey: string): Promise<void> => {
    assertAgentTeamDraftsResolved(teamKey);
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const trashTeam = window.moebius?.trashUserAgentTeam;
    if (team === undefined || team.ownership !== "user" || trashTeam === undefined) {
      throw new Error(t("desktop.error.trashTeam"));
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
  }, [agentTeamsState, assertAgentTeamDraftsResolved, commitAgentTeamDraftState, t]);

  const createAgentTeam = useCallback(async (
    information: AgentTeamInformationInput,
  ): Promise<OperatorAgentTeam> => {
    const createTeam = window.moebius?.createAgentTeam;
    if (createTeam === undefined) {
      throw new Error(t("desktop.error.createTeam"));
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
  }, [t]);

  const addAgentTeamMember = useCallback(async (teamKey: string): Promise<void> => {
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const addMember = window.moebius?.addAgentTeamMember;
    if (team === undefined || addMember === undefined) {
      throw new Error(t("desktop.error.addAgent"));
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
  }, [agentTeamsState, commitAgentTeamDraftState, t]);

  const updateAgentTeamInformation = useCallback(async (
    teamKey: string,
    information: AgentTeamInformationInput,
  ): Promise<void> => {
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const updateInformation = window.moebius?.updateAgentTeamInformation;
    if (team === undefined || updateInformation === undefined) {
      throw new Error(t("desktop.error.updateTeam"));
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
  }, [agentTeamsState, t]);

  const openAgentTeamLocation = useCallback(async (teamKey: string, memberSlug?: string): Promise<void> => {
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const openLocation = window.moebius?.openAgentTeamLocation;
    if (team === undefined || openLocation === undefined) {
      throw new Error(t("desktop.error.openLocation"));
    }
    await openLocation({
      teamId: team.id,
      ownership: team.ownership,
      ...(memberSlug === undefined ? {} : { memberSlug }),
    });
  }, [agentTeamsState, t]);

  const relocateAgentTeam = useCallback(async (teamKey: string): Promise<void> => {
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const selectFolder = window.moebius?.selectAgentTeamRelocationFolder;
    const relocateRecord = window.moebius?.relocateAgentTeamRecord;
    if (team === undefined || team.ownership !== "user" || selectFolder === undefined || relocateRecord === undefined) {
      throw new Error(t("desktop.error.relocateTeam"));
    }
    const directory = await selectFolder();
    if (directory === null) {
      return;
    }
    const updated = toOperatorAgentTeam(await relocateRecord({
      teamId: team.id,
      ownership: team.ownership,
      directory,
    }));
    setAgentTeamsState((current) => current.status !== "ready"
      ? current
      : {
          status: "ready",
          teams: current.teams.map((candidate) => candidate.teamKey === teamKey ? updated : candidate),
        });
  }, [agentTeamsState, t]);

  const removeAgentTeamRecord = useCallback(async (teamKey: string): Promise<void> => {
    const team = findOperatorAgentTeam(agentTeamsState, teamKey);
    const removeRecord = window.moebius?.removeAgentTeamRecord;
    if (team === undefined || team.ownership !== "user" || removeRecord === undefined) {
      throw new Error(t("desktop.error.removeTeamRecord"));
    }
    await removeRecord({ teamId: team.id, ownership: "user" });
    setAgentTeamsState((current) => current.status !== "ready"
      ? current
      : { status: "ready", teams: current.teams.filter((candidate) => candidate.teamKey !== teamKey) });
    setActiveAgentTeamKey((current) => current === teamKey ? null : current);
    setAgentTeamSelection((current) => current?.teamKey === teamKey ? null : current);
    setAgentTeamSaveAllFailures([]);
    setPrimaryAgentChange(null);
  }, [agentTeamsState, t]);

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
    if (newConversation?.isOpen !== true) {
      activateComposerDraft(selection.sessionId);
    }
  }, [activateComposerDraft, newConversation?.isOpen, selection.sessionId]);

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
  const lastError = sessionViewTransitionError ?? clientError ?? state?.lastError ?? null;
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
  const resolvedRightSidebarTabs = resolveCanonicalConversationTabTitles(
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
  const rightSidebarTabDiscriminators = conversationTabDiscriminators(
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

  const queueSessionViewTransition = useCallback((
    previousSessionId: string,
    viewedSessionId: string,
  ) => {
    const queue = sessionViewTransitionQueueRef.current;
    sessionViewTransitionPendingRef.current = true;
    setSessionViewTransitionPending(true);
    setSessionViewTransitionError(null);
    const ticket = queue.enqueue(async () => {
      const error = await actions.transitionSessionView(previousSessionId, viewedSessionId);
      if (error !== null) {
        setSessionViewTransitionError(error);
      }
    });
    void ticket.completion.finally(() => {
      if (!queue.isLatest(ticket.generation)) {
        return;
      }
      sessionViewTransitionPendingRef.current = queue.isPending;
      setSessionViewTransitionPending(queue.isPending);
    });
  }, [actions]);

  const composerSubmissionBlock = conversationSubmissionBlockReason({
    ownerKey: composerDraft.key,
    selectedSessionId: selection.sessionId,
    transitionPending: sessionViewTransitionPending,
  });
  const composerSubmissionBlockText = composerSubmissionBlock === "transition-pending"
    ? t("desktop.composer.transitionPending")
    : composerSubmissionBlock === "owner-mismatch"
      ? t("desktop.composer.ownerMismatch")
      : null;
  const sendMainComposer = useCallback(() => {
    const reason = conversationSubmissionBlockReason({
      ownerKey: composerDraftRef.current.key,
      selectedSessionId: selectionRef.current.sessionId,
      transitionPending: sessionViewTransitionPendingRef.current,
    });
    if (reason !== null) {
      const message = reason === "transition-pending"
        ? t("desktop.composer.transitionPending")
        : t("desktop.composer.ownerMismatch");
      setClientError(message);
      return;
    }
    void actions.sendMessage();
  }, [actions, t]);

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
    const root = resolveAnalysisRootSession(allSidebarSessions, target.sessionId);
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
    const root = resolveAnalysisRootSession(allSidebarSessions, target.sessionId);
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
    agentTeamsState.status === "ready" ? agentTeamsState.teams : [],
    lastUsedAgentTeamKey,
    pendingAgentTeamKey,
  ), [agentTeamsState, lastUsedAgentTeamKey, pendingAgentTeamKey]);

  useEffect(() => {
    if (
      pendingAgentTeamKey === null
      || newConversation === null
      || !newConversation.isOpen
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
    if (newConversation === null || !newConversation.isOpen || agentTeamsState.status !== "ready") {
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

  const createConversation = useCallback(async (): Promise<void> => {
    if (newConversation === null || !newConversation.isOpen || !canSubmitNewConversation({
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
        error: t("desktop.error.teamUnavailable"),
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
        error: t("desktop.error.conversationCreate"),
      });
      return;
    }

    const createdSelection = { projectId, sessionId: result.sessionId };
    selectionPersistenceEnabledRef.current = true;
    rememberConfirmedSelection(createdSelection);
    commitPresentationRoute(ordinaryPresentationRoute(createdSelection));
    conversationDraftStoreRef.current.clear(NEW_CONVERSATION_DRAFT_KEY);
    managedAttachments.clearDraft(NEW_CONVERSATION_DRAFT_KEY);
    activateComposerDraft(result.sessionId);
    dispatchNewConversation({ type: "consume" });
    if (result.preferenceRecorded) {
      setLastUsedAgentTeamKey(team.teamKey);
      setClientError(null);
    } else {
      setClientError(t("desktop.error.preferenceRecord", {
        error: formatError(result.preferenceError),
      }));
    }
  }, [
    actions,
    activateComposerDraft,
    agentTeamsState,
    commitPresentationRoute,
    managedAttachments,
    newConversation,
    rememberConfirmedSelection,
    t,
  ]);

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
      const response = await fetch(endpoint(apiBase, `/api/local-console/projects/${encodeURIComponent(projectId)}`), {
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
      const generalAssistant = agentTeamsState.status === "ready"
        ? agentTeamsState.teams.find((team) =>
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
  }, [agentTeamsState, presentationRoute?.hostSessionId, state?.selectedSession]);

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
    const sourceRootSession = resolveAnalysisRootSession(
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
    const generalAssistant = agentTeamsState.status === "ready"
      ? agentTeamsState.teams.find((team) =>
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
    agentTeamsState,
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
    const team = findOperatorAgentTeam(agentTeamsState, draft.context.teamKey);
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
          : conversationProjectContext(createdProject),
      });
      const directParent = allSidebarSessions.find((session) => session.sessionId === draft.hostSessionId);
      const root = directParent === undefined
        ? null
        : resolveAnalysisRootSession(allSidebarSessions, directParent.sessionId);
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
        setLastUsedAgentTeamKey(team.teamKey);
      }
      setClientError(null);
    } catch (error) {
      setClientError(formatError(error));
    } finally {
      setSidebarConversationSendingId(null);
    }
  }, [
    agentTeamsState,
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

  const executeConversationSearch = useCallback((input: {
    query: string;
    includeArchived: boolean;
  }) => {
    if (apiBase === null) return;
    conversationSearchInputRef.current = input;
    conversationSearchRequestRef.current?.abort("search-condition-changed");
    const controller = new AbortController();
    conversationSearchRequestRef.current = controller;
    const conditionKey = `${input.query.trim().normalize("NFKC").toLowerCase()}\u0000${String(input.includeArchived)}`;
    setConversationSearchState({
      status: "loading",
      results: [],
      error: null,
      conditionKey,
    });
    void searchConsoleSessions({
      apiBase,
      query: input.query,
      includeArchived: input.includeArchived,
      fetch,
      signal: controller.signal,
    }).then((results) => {
      if (conversationSearchRequestRef.current !== controller || controller.signal.aborted) return;
      setConversationSearchState({ status: "ready", results, error: null, conditionKey });
    }).catch((error: unknown) => {
      if (conversationSearchRequestRef.current !== controller || controller.signal.aborted) return;
      setConversationSearchState({
        status: "error",
        results: [],
        error: formatError(error),
        conditionKey,
      });
    });
  }, [apiBase]);

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
            conversationContext: conversationProjectContext(
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
          agentTeamsState={agentTeamsState}
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
        agentTeamsState={agentTeamsState}
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
    agentTeamsState,
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
      renderSearchOverlay={(close) => {
        const items: ConversationSearchResultItem[] = conversationSearchState.results.map((result) => ({
          sessionId: result.session.sessionId,
          projectId: result.project.projectId,
          projectTitle: result.project.title,
          title: result.session.title,
          archived: result.archived,
        }));
        const original = (item: ConversationSearchResultItem) =>
          conversationSearchState.results.find((result) => result.session.sessionId === item.sessionId);
        const closeSearch = () => {
          conversationSearchRequestRef.current?.abort("search-closed");
          conversationSearchRequestRef.current = null;
          conversationSearchInputRef.current = null;
          setConversationSearchState({ status: "idle", results: [], error: null, conditionKey: null });
          close();
        };
        return (
          <ConversationSearch
            results={items}
            status={conversationSearchState.status}
            error={conversationSearchState.error}
            onSearch={executeConversationSearch}
            onClose={closeSearch}
            onOpen={(item) => {
              const result = original(item);
              if (result !== undefined) {
                void openSearchedSession(result, false).then((opened) => {
                  if (opened) closeSearch();
                });
              }
            }}
            onRestoreAndOpen={(item) => {
              const result = original(item);
              if (result !== undefined) {
                void openSearchedSession(result, true).then((opened) => {
                  if (opened) closeSearch();
                });
              }
            }}
          />
        );
      }}
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
      conversationNotice={sessionViewTransitionError ?? sessionAnalysisNotice ?? (presentationRoute?.notice === "source-unavailable"
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
      composerSubmissionBlockReason={composerSubmissionBlockText}
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
      onSend={sendMainComposer}
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
        if (coordinatorRef.current.isSelectionMutationPending) {
          return;
        }
        const previousSessionId = selectionRef.current.sessionId;
        selectionPersistenceEnabledRef.current = true;
        dispatchNewConversation({ type: "hide" });
        const target = projects
          .flatMap((candidate) => candidate.sessions)
          .find((session) => session.sessionId === nextSelection.sessionId);
        const origin = target?.originSessionId == null
          ? undefined
          : projects
            .flatMap((candidate) => candidate.sessions)
            .find((session) => session.sessionId === target.originSessionId);
        if (target?.originSessionId != null && origin !== undefined) {
          const route = sidebarPresentationRoute({
            sidebarProjectId: target.projectId,
            sidebarSessionId: target.sessionId,
            originSessionId: origin.sessionId,
            originAvailable: true,
          });
          commitPresentationRoute(route);
          activateComposerDraft(origin.sessionId);
          actions.selectSession({ projectId: origin.projectId, sessionId: origin.sessionId });
          const tabs = openRightSidebarSourceTab(
            rightSidebarTabsStoreRef.current.read(origin.sessionId),
            {
              id: `conversation-${target.sessionId}`,
              type: "conversation",
              title: target.title,
              sourceKey: conversationTabSourceKey(target.sessionId),
              conversationContext: conversationProjectContext(
                projects.find((project) => project.projectId === target.projectId),
                target,
              ),
              conversationCreatedAt: target.createdAt,
            },
          );
          rightSidebarTabsStoreRef.current.write(origin.sessionId, tabs);
          setRightSidebarTabs(tabs);
          setRightSidebarOpen(true);
          queueSessionViewTransition(previousSessionId, target.sessionId);
          return;
        }
        const route = target?.originSessionId != null
          ? sidebarPresentationRoute({
              sidebarProjectId: target.projectId,
              sidebarSessionId: target.sessionId,
              originSessionId: target.originSessionId,
              originAvailable: false,
            })
          : ordinaryPresentationRoute(nextSelection);
        commitPresentationRoute(route);
        activateComposerDraft(nextSelection.sessionId);
        actions.selectSession(nextSelection);
        setRightSidebarTabs(rightSidebarTabsStoreRef.current.read(nextSelection.sessionId));
        if (target?.originSessionId != null) {
          setRightSidebarOpen(false);
        }
        queueSessionViewTransition(previousSessionId, nextSelection.sessionId);
      }}
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
        const searchInput = conversationSearchInputRef.current;
        setUpdatingConversationTitleSessionIds((current) => new Set(current).add(session.id));
        conversationSearchRequestRef.current?.abort("conversation-title-mutation-started");
        conversationSearchRequestRef.current = null;
        setConversationSearchState((current) => ({
          ...current,
          status: current.conditionKey === null ? "idle" : "loading",
          results: [],
          error: null,
        }));
        try {
          await actions.renameSession(session, title);
          rightSidebarTabsStoreRef.current.renameConversation(session.id, title.trim());
          const hostSessionId = presentationRouteRef.current?.hostSessionId
            ?? selectionRef.current.sessionId;
          setRightSidebarTabs(rightSidebarTabsStoreRef.current.read(hostSessionId));
          if (searchInput !== null) executeConversationSearch(searchInput);
        } catch (error) {
          if (searchInput !== null) executeConversationSearch(searchInput);
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
      onSaveAgentExecutionProfile={saveAgentExecutionProfile}
      onRestoreAgentRecommendedProfile={restoreAgentRecommendedProfile}
      onApplyOfficialAgentTeamUpdate={applyOfficialAgentTeamUpdate}
      onDuplicateBuiltInAgentTeam={duplicateBuiltInAgentTeam}
      onRecheckAgentTeam={() => setAgentTeamsRefreshNonce((current) => current + 1)}
      onRelocateAgentTeam={relocateAgentTeam}
      onRemoveAgentTeamRecord={removeAgentTeamRecord}
      agentTeamFileManagerLabel={t(agentTeamFileManagerTranslationKey(
        window.moebius?.agentTeamFileManagerKind ?? "file-manager",
      ))}
      onOpenAgentTeamLocation={openAgentTeamLocation}
      onDuplicateUserAgentTeam={duplicateUserAgentTeam}
      onDuplicateAgentTeamMember={duplicateAgentTeamMember}
      onTrashAgentTeamMember={trashAgentTeamMember}
      onTrashUserAgentTeam={trashUserAgentTeam}
      onViewAgentTeamRegistrationConflict={viewAgentTeamRegistrationConflict}
      onShowAgentTeamRegistrationConflictLocation={showAgentTeamRegistrationConflictLocation}
      onPreserveAgentTeamRegistrationConflicts={preserveAgentTeamRegistrationConflicts}
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

function conversationTabDiscriminators(
  tabsState: RightSidebarTabsState,
  projects: readonly OperatorProject[],
  updatingTabIds: ReadonlySet<string>,
  labels: {
    fallback: string;
    sameMomentIndex(index: number): string;
  },
): Record<string, string> {
  const titleCounts = new Map<string, number>();
  for (const tab of tabsState.tabs) {
    if (tab.type === "conversation") {
      titleCounts.set(tab.title, (titleCounts.get(tab.title) ?? 0) + 1);
    }
  }
  const candidates = tabsState.tabs.flatMap((tab) => {
    if (
      tab.type !== "conversation"
      || ((titleCounts.get(tab.title) ?? 0) < 2 && !updatingTabIds.has(tab.id))
    ) {
      return [];
    }
    const locator = parseConversationTabSourceKey(tab.sourceKey);
    const session = locator?.kind === "session"
      ? projects.flatMap((project) => project.sessions).find(
          (candidate) => candidate.sessionId === locator.sessionId,
        )
      : undefined;
    const project = session === undefined
      ? undefined
      : projects.find((candidate) => candidate.projectId === session.projectId);
    const base = conversationProjectContext(project, session)
      ?? tab.conversationContext
      ?? labels.fallback;
    const createdAt = session?.createdAt ?? tab.conversationCreatedAt ?? null;
    return [{
      tabId: tab.id,
      base,
      minute: createdAt?.replace("T", " ").slice(0, 16) ?? null,
      stableKey: `${createdAt ?? ""}\u0000${tab.sourceKey ?? tab.id}`,
    }];
  });
  const baseCounts = new Map<string, number>();
  for (const entry of candidates) {
    baseCounts.set(entry.base, (baseCounts.get(entry.base) ?? 0) + 1);
  }
  const withMinute = candidates.map((entry) => ({
    ...entry,
    candidate: (baseCounts.get(entry.base) ?? 0) > 1 && entry.minute !== null
      ? `${entry.base} · ${entry.minute}`
      : entry.base,
  }));
  const candidateCounts = new Map<string, number>();
  for (const entry of withMinute) {
    candidateCounts.set(entry.candidate, (candidateCounts.get(entry.candidate) ?? 0) + 1);
  }
  const result: Record<string, string> = {};
  const collisions = new Map<string, typeof withMinute>();
  for (const entry of withMinute) {
    if ((candidateCounts.get(entry.candidate) ?? 0) === 1) {
      result[entry.tabId] = entry.candidate;
      continue;
    }
    const group = collisions.get(entry.candidate) ?? [];
    group.push(entry);
    collisions.set(entry.candidate, group);
  }
  for (const group of collisions.values()) {
    group.sort((left, right) => left.stableKey.localeCompare(right.stableKey));
    group.forEach((entry, index) => {
      result[entry.tabId] = `${entry.candidate} · ${labels.sameMomentIndex(index + 1)}`;
    });
  }
  return result;
}

function conversationProjectContext(
  project: OperatorProject | undefined,
  session?: OperatorSession,
): string | undefined {
  if (project === undefined) return undefined;
  const context = [
    project.title,
    session?.branchName ?? project.branchName ?? null,
  ].filter((value): value is string => value !== null && value.trim() !== "").join(" · ");
  return context === "" ? undefined : context;
}

function resolveCanonicalConversationTabTitles(
  tabsState: RightSidebarTabsState,
  projects: readonly OperatorProject[],
): { state: RightSidebarTabsState; unresolvedTabIds: string[] } {
  const sessions = new Map(
    projects.flatMap((project) =>
      project.sessions.map((session) => [
        session.sessionId,
        { project, session },
      ] as const)),
  );
  const unresolvedTabIds: string[] = [];
  return {
    state: {
      ...tabsState,
      tabs: tabsState.tabs.map((tab) => {
        if (tab.type !== "conversation") return tab;
        const locator = parseConversationTabSourceKey(tab.sourceKey);
        if (locator?.kind !== "session") return tab;
        const resolved = sessions.get(locator.sessionId);
        if (resolved === undefined) {
          unresolvedTabIds.push(tab.id);
          return tab;
        }
        const conversationContext = conversationProjectContext(
          resolved.project,
          resolved.session,
        );
        if (
          resolved.session.title === tab.title
          && conversationContext === tab.conversationContext
          && resolved.session.createdAt === tab.conversationCreatedAt
        ) {
          return tab;
        }
        return {
          ...tab,
          title: resolved.session.title,
          conversationContext,
          conversationCreatedAt: resolved.session.createdAt,
        };
      }),
    },
    unresolvedTabIds,
  };
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

function agentTeamFileManagerTranslationKey(kind: AgentTeamFileManagerKind): TranslationKey {
  if (kind === "finder") {
    return "desktop.fileManager.finder";
  }
  if (kind === "windows-explorer") {
    return "desktop.fileManager.windowsExplorer";
  }
  return "desktop.fileManager.generic";
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

function resolveAnalysisRootSession(
  sessions: readonly OperatorSession[],
  sessionId: string,
): OperatorSession | null {
  const byId = new Map(sessions.map((session) => [session.sessionId, session]));
  const visited = new Set<string>();
  let current = byId.get(sessionId);
  while (current !== undefined && current.analysisParentSessionId != null) {
    if (visited.has(current.sessionId)) return null;
    visited.add(current.sessionId);
    current = byId.get(current.analysisParentSessionId);
  }
  return current ?? null;
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
