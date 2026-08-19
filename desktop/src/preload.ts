import { contextBridge, ipcRenderer } from "electron";
import type { DesktopStatusSnapshot } from "./status.js";
import {
  getAgentTeamFileManagerKind,
  TEAM_FILE_MANAGER_IPC_CHANNEL,
  type AgentTeamFileManagerKind,
  type AgentTeamFileManagerRequest,
} from "./team-file-manager-contract.js";
import {
  TEAM_EXTERNAL_CHANGE_IPC_CHANNEL,
  type AgentTeamExternalChangeRequest,
  type AgentTeamExternalChangeResponse,
} from "./team-external-change-contract.js";
import {
  AGENT_MARKDOWN_REVISION_SUMMARY_SETTLED_CHANNEL,
  TEAM_IPC_CHANNELS,
  type AgentMarkdownRevisionSummarySettledPayload,
  type AgentTeamCreateRequest,
  type AgentTeamDuplicateBuiltInRequest,
  type AgentTeamDuplicateUserRequest,
  type AgentTeamListItem,
  type AgentTeamListResponse,
  type AgentTeamMemberDocument,
  type AgentTeamMemberAddRequest,
  type AgentTeamMemberAddResponse,
  type AgentTeamMemberRequest,
  type AgentTeamMemberRevisionsResponse,
  type AgentTeamMemberRevisionRestoreRequest,
  type AgentTeamMemberRevisionRestoreResponse,
  type AgentTeamDefaultAgentResponse,
  type AgentTeamDefaultAgentSaveRequest,
  type AgentTeamMemberWriteRequest,
  type AgentTeamMemberDuplicateRequest,
  type AgentTeamMemberTrashRequest,
  type AgentTeamExecutionProfileDocument,
  type AgentTeamExecutionProfileSaveRequest,
  type AgentTeamExecutionProfilesReplaceRequest,
  type AgentTeamExecutionProfilesReplaceResult,
  type AgentTeamOfficialSyncRequest,
  type AgentTeamPrimaryAgentWriteRequest,
  type AgentTeamMemberOrderWriteRequest,
  type AgentTeamUpdateInformationRequest,
  type AgentTeamTrashUserRequest,
} from "./team-ipc-contract.js";
import {
  TEAM_REPAIR_IPC_CHANNELS,
  type AgentTeamRelocateRequest,
  type AgentTeamRepairRequest,
} from "./team-repair-contract.js";
import {
  GITHUB_TEAM_IPC_CHANNELS,
  type GithubTeamAuthIpcResponse,
  type GithubTeamCheckUpstreamIpcRequest,
  type GithubTeamCheckUpstreamIpcResponse,
  type GithubTeamDetachIpcRequest,
  type GithubTeamDetachIpcResponse,
  type GithubTeamInstallIpcRequest,
  type GithubTeamInstallIpcResponse,
  type GithubTeamPreviewIpcRequest,
  type GithubTeamPreviewIpcResponse,
  type GithubTeamRevertSyncIpcRequest,
  type GithubTeamRevertSyncIpcResponse,
  type GithubTeamSearchIpcRequest,
  type GithubTeamSearchIpcResponse,
  type GithubTeamSyncIpcRequest,
  type GithubTeamSyncIpcResponse,
} from "./github-team-ipc-contract.js";
import {
  TEAM_CONVERSATION_PREFERENCE_IPC_CHANNELS,
  type LastUsedAgentTeam,
  type SuccessfulConversationAgentTeamRequest,
} from "./team-conversation-preference-contract.js";
import { OPEN_EXTERNAL_LINK_IPC_CHANNEL } from "./external-link.js";
import {
  COPY_SESSION_LOG_PATH_IPC_CHANNEL,
  type CopySessionLogPathResult,
} from "./session-log-clipboard.js";
import {
  AI_TEAM_BUILDER_IPC_CHANNELS,
  type AiTeamBuilderCommitRequest,
  type AiTeamBuilderDraftRequest,
  type AiTeamBuilderIpcResponse,
  type AiTeamBuilderTurnRequest,
} from "./ai-team-builder/contract.js";
import type { DoctorCheck } from "./env-doctor.js";
import {
  ONBOARDING_IPC_CHANNELS,
} from "./onboarding/contract.js";
import type { OnboardingCompletionStatus } from "./onboarding/first-run-marker.js";
import type {
  OnboardingCli,
  OnboardingCliReadinessSnapshot,
  OnboardingCliReadinessState,
} from "./onboarding/cli-readiness-contract.js";
import type {
  OnboardingCliInstallSnapshot,
  OnboardingCliInstallState,
} from "./onboarding/cli-installer-contract.js";
import {
  LANGUAGE_PREFERENCE_IPC_CHANNELS,
  type DesktopLocale,
} from "./language-preference-contract.js";
import {
  SETTINGS_IPC_CHANNELS,
  type SettingsApplicationInfo,
  type SettingsInstallConfirmation,
  type SettingsInstallFailure,
  type SettingsUpdateCheckResult,
  type SettingsUpdateState,
  type SettingsVersionCopyResult,
} from "./settings-contract.js";
import {
  PROVIDER_PROFILE_IPC_CHANNELS,
  type ProviderProfileCreateRequest,
  type ProviderProfileCancelRequest,
  type ProviderProfileListResult,
  type ProviderProfileModelRequest,
  type ProviderProfileRenameRequest,
  type ProviderProfileRevisionRequest,
  type ProviderProfileRotateKeyRequest,
  type ProviderProfileIpcResult,
  type ProviderProfileMigrateReferencesRequest,
  type ProviderProfileRetryReferenceOperationRequest,
  type ProviderProfileEndReferencesRequest,
  type ProviderProfileSummaryDto,
  type ProviderProfileReplaceDefaultAndRemoveModelRequest,
} from "./provider-profile-contract.js";
import {
  TASK_REMINDER_IPC_CHANNELS,
  type TaskReminderReadState,
} from "./task-reminder-contract.js";
import type { PermissionModalAction } from "./permission-modal-plan.js";

export interface MoebiusDesktopApi {
  readLanguagePreference(): Promise<DesktopLocale>;
  saveLanguagePreference(locale: DesktopLocale): Promise<DesktopLocale>;
  onLanguagePreferenceChanged(listener: (locale: DesktopLocale) => void): () => void;
  onStatus(listener: (snapshot: DesktopStatusSnapshot) => void): () => void;
  getLocalConsoleUrl(): Promise<string | null>;
  getLocalConsoleAttachmentCapability(): Promise<string | null>;
  copySessionLogPath(sessionId: string): Promise<CopySessionLogPathResult>;
  openStatusPage(): Promise<void>;
  openDataRoot(): Promise<void>;
  readApplicationInfo(): Promise<SettingsApplicationInfo>;
  checkForUpdates(): Promise<SettingsUpdateCheckResult>;
  readUpdateState(): Promise<SettingsUpdateState>;
  onUpdateState(listener: (state: SettingsUpdateState) => void): () => void;
  installUpdate(): Promise<void>;
  readRunningTaskCount(): Promise<number>;
  remindLater(): Promise<SettingsUpdateState>;
  skipVersion(): Promise<SettingsUpdateState>;
  onInstallConfirmation(listener: (confirmation: SettingsInstallConfirmation) => void): () => void;
  onInstallFailure(listener: (failure: SettingsInstallFailure) => void): () => void;
  respondInstallConfirmation(requestId: number, approved: boolean): Promise<void>;
  copyVersionInfo(): Promise<SettingsVersionCopyResult>;
  listProviderProfiles(): Promise<ProviderProfileListResult>;
  createProviderProfile(request: ProviderProfileCreateRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  retryCreateProviderProfileSave(request: ProviderProfileCancelRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  discardCreateProviderProfileSave(request: ProviderProfileCancelRequest): Promise<ProviderProfileIpcResult<null>>;
  rotateProviderProfileKey(request: ProviderProfileRotateKeyRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  addProviderProfileModel(request: ProviderProfileModelRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  setProviderProfileDefaultModel(request: ProviderProfileModelRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  removeProviderProfileModel(request: ProviderProfileModelRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  replaceProviderProfileDefaultAndRemoveModel(request: ProviderProfileReplaceDefaultAndRemoveModelRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  renameProviderProfile(request: ProviderProfileRenameRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  disableProviderProfile(request: ProviderProfileRevisionRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  enableProviderProfile(request: ProviderProfileRevisionRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  deleteProviderProfile(request: ProviderProfileRevisionRequest): Promise<ProviderProfileIpcResult<null>>;
  migrateProviderProfileReferences(request: ProviderProfileMigrateReferencesRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  retryProviderProfileReferenceOperation(request: ProviderProfileRetryReferenceOperationRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  endProviderProfileReferences(request: ProviderProfileEndReferencesRequest): Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  cancelProviderProfileOperation(request: ProviderProfileCancelRequest): Promise<ProviderProfileIpcResult<null>>;
  selectProjectFolder(): Promise<string | null>;
  selectFolderForRepair(projectId: string): Promise<string | null>;
  showInFolder(folderPath: string): Promise<void>;
  readonly agentTeamFileManagerKind: AgentTeamFileManagerKind;
  openAgentTeamLocation(request: AgentTeamFileManagerRequest): Promise<void>;
  listAgentTeams(): Promise<AgentTeamListResponse>;
  resolveAgentTeamSeedConflict(): Promise<AgentTeamListResponse>;
  showAgentTeamSeedConflictLocation(): Promise<void>;
  createAgentTeam(request: AgentTeamCreateRequest): Promise<AgentTeamListItem>;
  readAgentTeamMember(request: AgentTeamMemberRequest): Promise<AgentTeamMemberDocument>;
  writeAgentTeamMember(request: AgentTeamMemberWriteRequest): Promise<AgentTeamMemberDocument>;
  addAgentTeamMember(request: AgentTeamMemberAddRequest): Promise<AgentTeamMemberAddResponse>;
  updateAgentTeamInformation(request: AgentTeamUpdateInformationRequest): Promise<AgentTeamListItem>;
  setAgentTeamPrimaryAgent(request: AgentTeamPrimaryAgentWriteRequest): Promise<AgentTeamListItem>;
  reorderAgentTeamMembers(request: AgentTeamMemberOrderWriteRequest): Promise<AgentTeamListItem>;
  duplicateBuiltInAgentTeam(request: AgentTeamDuplicateBuiltInRequest): Promise<AgentTeamListItem>;
  duplicateUserAgentTeam(request: AgentTeamDuplicateUserRequest): Promise<AgentTeamListItem>;
  duplicateAgentTeamMember(request: AgentTeamMemberDuplicateRequest): Promise<AgentTeamMemberAddResponse>;
  trashAgentTeamMember(request: AgentTeamMemberTrashRequest): Promise<AgentTeamListItem>;
  trashUserAgentTeam(request: AgentTeamTrashUserRequest): Promise<void>;
  readAgentTeamExecutionProfile(request: AgentTeamMemberRequest): Promise<AgentTeamExecutionProfileDocument>;
  saveAgentTeamExecutionProfile(
    request: AgentTeamExecutionProfileSaveRequest,
  ): Promise<AgentTeamExecutionProfileDocument>;
  replaceUnavailableAgentTeamExecutionProfiles(
    request: AgentTeamExecutionProfilesReplaceRequest,
  ): Promise<AgentTeamExecutionProfilesReplaceResult>;
  restoreAgentTeamRecommendedProfile(
    request: AgentTeamMemberRequest,
  ): Promise<AgentTeamExecutionProfileDocument>;
  revertAgentTeamOfficialSync(request: AgentTeamOfficialSyncRequest): Promise<AgentTeamListItem>;
  retryAgentTeamOfficialSync(request: AgentTeamOfficialSyncRequest): Promise<AgentTeamListItem>;
  dismissAgentTeamOfficialSyncBanner(request: AgentTeamOfficialSyncRequest): Promise<void>;
  markAgentTeamOfficialSyncSeen(request: AgentTeamOfficialSyncRequest): Promise<void>;
  checkAgentTeamMemberExternalChange(
    request: AgentTeamExternalChangeRequest,
  ): Promise<AgentTeamExternalChangeResponse>;
  listAgentTeamMemberRevisions(
    request: AgentTeamMemberRequest,
  ): Promise<AgentTeamMemberRevisionsResponse>;
  restoreAgentTeamMemberRevision(
    request: AgentTeamMemberRevisionRestoreRequest,
  ): Promise<AgentTeamMemberRevisionRestoreResponse>;
  onAgentMarkdownRevisionSummarySettled(
    listener: (payload: AgentMarkdownRevisionSummarySettledPayload) => void,
  ): () => void;
  getDefaultAgent(): Promise<AgentTeamDefaultAgentResponse>;
  saveDefaultAgent(
    request: AgentTeamDefaultAgentSaveRequest,
  ): Promise<AgentTeamDefaultAgentResponse>;
  selectAgentTeamRelocationFolder(): Promise<string | null>;
  relocateAgentTeamRecord(request: AgentTeamRelocateRequest): Promise<AgentTeamListItem>;
  removeAgentTeamRecord(request: AgentTeamRepairRequest): Promise<void>;
  readGithubTeamAuthStatus(): Promise<GithubTeamAuthIpcResponse>;
  searchGithubTeams(request: GithubTeamSearchIpcRequest): Promise<GithubTeamSearchIpcResponse>;
  previewGithubTeam(request: GithubTeamPreviewIpcRequest): Promise<GithubTeamPreviewIpcResponse>;
  installGithubTeam(request: GithubTeamInstallIpcRequest): Promise<GithubTeamInstallIpcResponse>;
  detachGithubTeamUpstream(request: GithubTeamDetachIpcRequest): Promise<GithubTeamDetachIpcResponse>;
  checkGithubTeamUpstream(request: GithubTeamCheckUpstreamIpcRequest): Promise<GithubTeamCheckUpstreamIpcResponse>;
  syncGithubTeamUpstream(request: GithubTeamSyncIpcRequest): Promise<GithubTeamSyncIpcResponse>;
  revertGithubTeamSync(request: GithubTeamRevertSyncIpcRequest): Promise<GithubTeamRevertSyncIpcResponse>;
  startAiTeamBuilder(draftId: string): Promise<AiTeamBuilderIpcResponse>;
  submitAiTeamBuilder(draftId: string, text: string): Promise<AiTeamBuilderIpcResponse>;
  adjustAiTeamBuilder(draftId: string, text: string): Promise<AiTeamBuilderIpcResponse>;
  retryAiTeamBuilder(draftId: string): Promise<AiTeamBuilderIpcResponse>;
  commitAiTeamBuilder(draftId: string, proposalRevision: number): Promise<AiTeamBuilderIpcResponse>;
  readLastUsedAgentTeam(): Promise<LastUsedAgentTeam | null>;
  recordSuccessfulConversationAgentTeam(
    request: SuccessfulConversationAgentTeamRequest,
  ): Promise<LastUsedAgentTeam>;
  getOnboardingStatus(): Promise<OnboardingCompletionStatus>;
  completeOnboarding(): Promise<OnboardingCompletionStatus>;
  checkOnboardingCodex(): Promise<DoctorCheck>;
  copyOnboardingInstallCommand(): Promise<void>;
  getOnboardingCliReadinessState(): Promise<OnboardingCliReadinessState>;
  checkOnboardingCliReadiness(cli: OnboardingCli): Promise<OnboardingCliReadinessSnapshot>;
  getOnboardingCliInstallState(): Promise<OnboardingCliInstallState>;
  onOnboardingCliInstallSnapshot(
    listener: (snapshot: OnboardingCliInstallSnapshot) => void,
  ): () => void;
  startOnboardingCliInstall(cli: OnboardingCli): Promise<OnboardingCliInstallSnapshot>;
  startOnboardingClaudeUpdate(): Promise<OnboardingCliInstallSnapshot>;
  cancelOnboardingCliInstall(cli: OnboardingCli): Promise<OnboardingCliInstallSnapshot>;
  startOnboardingTeamBuilder(request: AiTeamBuilderDraftRequest): Promise<AiTeamBuilderIpcResponse>;
  submitOnboardingTeamBuilder(request: AiTeamBuilderTurnRequest): Promise<AiTeamBuilderIpcResponse>;
  adjustOnboardingTeamBuilder(request: AiTeamBuilderTurnRequest): Promise<AiTeamBuilderIpcResponse>;
  retryOnboardingTeamBuilder(request: AiTeamBuilderDraftRequest): Promise<AiTeamBuilderIpcResponse>;
  commitOnboardingTeamBuilder(request: AiTeamBuilderCommitRequest): Promise<AiTeamBuilderIpcResponse>;
  openExternalLink(url: string): Promise<void>;
  readTaskReminderState(): Promise<TaskReminderReadState>;
  setTaskReminderEnabled(enabled: boolean): Promise<{ ok: boolean }>;
  applyTaskReminderModalAction(action: PermissionModalAction): Promise<{
    ok: boolean;
    state: import("./permission-modal-plan.js").PermissionModalState | null;
  }>;
  recheckTaskReminderChannel(): Promise<"ok" | "anomaly" | "unknown">;
  openTaskReminderSystemSettings(): Promise<{ ok: boolean }>;
  onTaskReminderClicked(listener: (payload: {
    sessionId: string;
    roundId: number;
    terminalMessageId: number | null;
  }) => void): () => void;
  /** Notification click was located and consumed by the renderer (cold-start recovery reconciliation). */
  consumeTaskReminderClick(): Promise<{ ok: boolean }>;
  /** Task-reminder state change push subscription (modal open / channel status); re-read on signal. */
  onTaskReminderStateChanged(listener: () => void): () => void;
  /** Refresh the Dock badge from current session state (after read/archive/restore changes). */
  refreshTaskReminderDock(): Promise<{ ok: boolean; count: number }>;
}

const api: MoebiusDesktopApi = {
  readLanguagePreference() {
    return ipcRenderer.invoke(LANGUAGE_PREFERENCE_IPC_CHANNELS.read) as Promise<DesktopLocale>;
  },
  saveLanguagePreference(locale) {
    return ipcRenderer.invoke(LANGUAGE_PREFERENCE_IPC_CHANNELS.save, locale) as Promise<DesktopLocale>;
  },
  onLanguagePreferenceChanged(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, locale: DesktopLocale): void => {
      listener(locale);
    };
    ipcRenderer.on(LANGUAGE_PREFERENCE_IPC_CHANNELS.changed, wrapped);
    return () => {
      ipcRenderer.off(LANGUAGE_PREFERENCE_IPC_CHANNELS.changed, wrapped);
    };
  },
  onStatus(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, snapshot: DesktopStatusSnapshot): void => {
      listener(snapshot);
    };
    ipcRenderer.on("status:snapshot", wrapped);
    return () => {
      ipcRenderer.off("status:snapshot", wrapped);
    };
  },
  getLocalConsoleUrl() {
    return ipcRenderer.invoke("local-console:get-url") as Promise<string | null>;
  },
  getLocalConsoleAttachmentCapability() {
    return ipcRenderer.invoke("local-console:get-attachment-capability") as Promise<string | null>;
  },
  copySessionLogPath(sessionId) {
    return ipcRenderer.invoke(COPY_SESSION_LOG_PATH_IPC_CHANNEL, sessionId) as Promise<CopySessionLogPathResult>;
  },
  openStatusPage() {
    return ipcRenderer.invoke("action:open-status-page") as Promise<void>;
  },
  openDataRoot() {
    return ipcRenderer.invoke("action:open-data-root") as Promise<void>;
  },
  readApplicationInfo() {
    return ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.readApplicationInfo) as Promise<SettingsApplicationInfo>;
  },
  checkForUpdates() {
    return ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.checkForUpdates) as Promise<SettingsUpdateCheckResult>;
  },
  readUpdateState() {
    return ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.readUpdateState) as Promise<SettingsUpdateState>;
  },
  onUpdateState(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, state: SettingsUpdateState): void => {
      listener(state);
    };
    ipcRenderer.on(SETTINGS_IPC_CHANNELS.updateState, wrapped);
    return () => {
      ipcRenderer.off(SETTINGS_IPC_CHANNELS.updateState, wrapped);
    };
  },
  installUpdate() {
    return ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.installUpdate) as Promise<void>;
  },
  readRunningTaskCount() {
    return ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.readRunningTaskCount) as Promise<number>;
  },
  remindLater() {
    return ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.remindLater) as Promise<SettingsUpdateState>;
  },
  skipVersion() {
    return ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.skipVersion) as Promise<SettingsUpdateState>;
  },
  onInstallConfirmation(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, confirmation: SettingsInstallConfirmation): void => {
      listener(confirmation);
    };
    ipcRenderer.on(SETTINGS_IPC_CHANNELS.installConfirmation, wrapped);
    return () => {
      ipcRenderer.off(SETTINGS_IPC_CHANNELS.installConfirmation, wrapped);
    };
  },
  onInstallFailure(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, failure: SettingsInstallFailure): void => {
      listener(failure);
    };
    ipcRenderer.on(SETTINGS_IPC_CHANNELS.installFailure, wrapped);
    return () => {
      ipcRenderer.off(SETTINGS_IPC_CHANNELS.installFailure, wrapped);
    };
  },
  respondInstallConfirmation(requestId, approved) {
    return ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.respondInstallConfirmation, {
      requestId,
      approved,
    }) as Promise<void>;
  },
  copyVersionInfo() {
    return ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.copyVersionInfo) as Promise<SettingsVersionCopyResult>;
  },
  listProviderProfiles() {
    return ipcRenderer.invoke(PROVIDER_PROFILE_IPC_CHANNELS.list) as Promise<ProviderProfileListResult>;
  },
  createProviderProfile(request) {
    return ipcRenderer.invoke(PROVIDER_PROFILE_IPC_CHANNELS.create, request) as Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  },
  retryCreateProviderProfileSave(request) {
    return ipcRenderer.invoke(PROVIDER_PROFILE_IPC_CHANNELS.retryCreateSave, request) as Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  },
  discardCreateProviderProfileSave(request) {
    return ipcRenderer.invoke(PROVIDER_PROFILE_IPC_CHANNELS.discardCreateSave, request) as Promise<ProviderProfileIpcResult<null>>;
  },
  rotateProviderProfileKey(request) {
    return ipcRenderer.invoke(PROVIDER_PROFILE_IPC_CHANNELS.rotateKey, request) as Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  },
  addProviderProfileModel(request) {
    return ipcRenderer.invoke(PROVIDER_PROFILE_IPC_CHANNELS.addModel, request) as Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  },
  setProviderProfileDefaultModel(request) {
    return ipcRenderer.invoke(PROVIDER_PROFILE_IPC_CHANNELS.setDefaultModel, request) as Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  },
  removeProviderProfileModel(request) {
    return ipcRenderer.invoke(PROVIDER_PROFILE_IPC_CHANNELS.removeModel, request) as Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  },
  replaceProviderProfileDefaultAndRemoveModel(request) {
    return ipcRenderer.invoke(PROVIDER_PROFILE_IPC_CHANNELS.replaceDefaultAndRemoveModel, request) as Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  },
  renameProviderProfile(request) {
    return ipcRenderer.invoke(PROVIDER_PROFILE_IPC_CHANNELS.rename, request) as Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  },
  disableProviderProfile(request) {
    return ipcRenderer.invoke(PROVIDER_PROFILE_IPC_CHANNELS.disable, request) as Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  },
  enableProviderProfile(request) {
    return ipcRenderer.invoke(PROVIDER_PROFILE_IPC_CHANNELS.enable, request) as Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  },
  deleteProviderProfile(request) {
    return ipcRenderer.invoke(PROVIDER_PROFILE_IPC_CHANNELS.delete, request) as Promise<ProviderProfileIpcResult<null>>;
  },
  migrateProviderProfileReferences(request) {
    return ipcRenderer.invoke(PROVIDER_PROFILE_IPC_CHANNELS.migrateReferences, request) as Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  },
  retryProviderProfileReferenceOperation(request) {
    return ipcRenderer.invoke(PROVIDER_PROFILE_IPC_CHANNELS.retryReferenceOperation, request) as Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  },
  endProviderProfileReferences(request) {
    return ipcRenderer.invoke(PROVIDER_PROFILE_IPC_CHANNELS.endReferences, request) as Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  },
  cancelProviderProfileOperation(request) {
    return ipcRenderer.invoke(PROVIDER_PROFILE_IPC_CHANNELS.cancel, request) as Promise<ProviderProfileIpcResult<null>>;
  },
  selectProjectFolder() {
    return ipcRenderer.invoke("project:select-folder") as Promise<string | null>;
  },
  selectFolderForRepair(projectId) {
    return ipcRenderer.invoke("project:select-folder-for-repair", projectId) as Promise<string | null>;
  },
  showInFolder(folderPath) {
    return ipcRenderer.invoke("project:show-in-folder", folderPath) as Promise<void>;
  },
  agentTeamFileManagerKind: getAgentTeamFileManagerKind(process.platform),
  openAgentTeamLocation(request) {
    return ipcRenderer.invoke(TEAM_FILE_MANAGER_IPC_CHANNEL, request) as Promise<void>;
  },
  listAgentTeams() {
    return ipcRenderer.invoke(TEAM_IPC_CHANNELS.list) as Promise<AgentTeamListResponse>;
  },
  resolveAgentTeamSeedConflict() {
    return ipcRenderer.invoke(TEAM_IPC_CHANNELS.resolveSeedConflict) as Promise<AgentTeamListResponse>;
  },
  showAgentTeamSeedConflictLocation() {
    return ipcRenderer.invoke(TEAM_IPC_CHANNELS.showSeedConflictLocation) as Promise<void>;
  },
  createAgentTeam(request) {
    return ipcRenderer.invoke(TEAM_IPC_CHANNELS.create, request) as Promise<AgentTeamListItem>;
  },
  readAgentTeamMember(request) {
    return ipcRenderer.invoke(TEAM_IPC_CHANNELS.readMember, request) as Promise<AgentTeamMemberDocument>;
  },
  writeAgentTeamMember(request) {
    return ipcRenderer.invoke(TEAM_IPC_CHANNELS.writeMember, request) as Promise<AgentTeamMemberDocument>;
  },
  addAgentTeamMember(request) {
    return ipcRenderer.invoke(TEAM_IPC_CHANNELS.addMember, request) as Promise<AgentTeamMemberAddResponse>;
  },
  updateAgentTeamInformation(request) {
    return ipcRenderer.invoke(TEAM_IPC_CHANNELS.updateInformation, request) as Promise<AgentTeamListItem>;
  },
  setAgentTeamPrimaryAgent(request) {
    return ipcRenderer.invoke(TEAM_IPC_CHANNELS.setPrimaryAgent, request) as Promise<AgentTeamListItem>;
  },
  reorderAgentTeamMembers(request) {
    return ipcRenderer.invoke(TEAM_IPC_CHANNELS.reorderMembers, request) as Promise<AgentTeamListItem>;
  },
  duplicateBuiltInAgentTeam(request) {
    return ipcRenderer.invoke(TEAM_IPC_CHANNELS.duplicateBuiltIn, request) as Promise<AgentTeamListItem>;
  },
  duplicateUserAgentTeam(request) {
    return ipcRenderer.invoke(TEAM_IPC_CHANNELS.duplicateUser, request) as Promise<AgentTeamListItem>;
  },
  duplicateAgentTeamMember(request) {
    return ipcRenderer.invoke(TEAM_IPC_CHANNELS.duplicateMember, request) as Promise<AgentTeamMemberAddResponse>;
  },
  trashAgentTeamMember(request) {
    return ipcRenderer.invoke(TEAM_IPC_CHANNELS.trashMember, request) as Promise<AgentTeamListItem>;
  },
  trashUserAgentTeam(request) {
    return ipcRenderer.invoke(TEAM_IPC_CHANNELS.trashUserTeam, request) as Promise<void>;
  },
  readAgentTeamExecutionProfile(request) {
    return ipcRenderer.invoke(
      TEAM_IPC_CHANNELS.readExecutionProfile,
      request,
    ) as Promise<AgentTeamExecutionProfileDocument>;
  },
  saveAgentTeamExecutionProfile(request) {
    return ipcRenderer.invoke(
      TEAM_IPC_CHANNELS.saveExecutionProfile,
      request,
    ) as Promise<AgentTeamExecutionProfileDocument>;
  },
  replaceUnavailableAgentTeamExecutionProfiles(request) {
    return ipcRenderer.invoke(
      TEAM_IPC_CHANNELS.replaceUnavailableExecutionProfiles,
      request,
    ) as Promise<AgentTeamExecutionProfilesReplaceResult>;
  },
  restoreAgentTeamRecommendedProfile(request) {
    return ipcRenderer.invoke(
      TEAM_IPC_CHANNELS.restoreRecommendedProfile,
      request,
    ) as Promise<AgentTeamExecutionProfileDocument>;
  },
  revertAgentTeamOfficialSync(request) {
    return ipcRenderer.invoke(
      TEAM_IPC_CHANNELS.officialSyncRevert,
      request,
    ) as Promise<AgentTeamListItem>;
  },
  retryAgentTeamOfficialSync(request) {
    return ipcRenderer.invoke(
      TEAM_IPC_CHANNELS.officialSyncRetry,
      request,
    ) as Promise<AgentTeamListItem>;
  },
  dismissAgentTeamOfficialSyncBanner(request) {
    return ipcRenderer.invoke(
      TEAM_IPC_CHANNELS.officialSyncDismissBanner,
      request,
    ) as Promise<void>;
  },
  markAgentTeamOfficialSyncSeen(request) {
    return ipcRenderer.invoke(
      TEAM_IPC_CHANNELS.officialSyncMarkSeen,
      request,
    ) as Promise<void>;
  },
  checkAgentTeamMemberExternalChange(request) {
    return ipcRenderer.invoke(
      TEAM_EXTERNAL_CHANGE_IPC_CHANNEL,
      request,
    ) as Promise<AgentTeamExternalChangeResponse>;
  },
  listAgentTeamMemberRevisions(request) {
    return ipcRenderer.invoke(
      TEAM_IPC_CHANNELS.memberRevisionsList,
      request,
    ) as Promise<AgentTeamMemberRevisionsResponse>;
  },
  restoreAgentTeamMemberRevision(request) {
    return ipcRenderer.invoke(
      TEAM_IPC_CHANNELS.memberRevisionRestore,
      request,
    ) as Promise<AgentTeamMemberRevisionRestoreResponse>;
  },
  onAgentMarkdownRevisionSummarySettled(listener) {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      payload: AgentMarkdownRevisionSummarySettledPayload,
    ): void => {
      listener(payload);
    };
    ipcRenderer.on(AGENT_MARKDOWN_REVISION_SUMMARY_SETTLED_CHANNEL, wrapped);
    return () => {
      ipcRenderer.off(AGENT_MARKDOWN_REVISION_SUMMARY_SETTLED_CHANNEL, wrapped);
    };
  },
  getDefaultAgent() {
    return ipcRenderer.invoke(
      TEAM_IPC_CHANNELS.defaultAgentGet,
    ) as Promise<AgentTeamDefaultAgentResponse>;
  },
  saveDefaultAgent(request) {
    return ipcRenderer.invoke(
      TEAM_IPC_CHANNELS.defaultAgentSave,
      request,
    ) as Promise<AgentTeamDefaultAgentResponse>;
  },
  selectAgentTeamRelocationFolder() {
    return ipcRenderer.invoke(TEAM_REPAIR_IPC_CHANNELS.selectRelocationFolder) as Promise<string | null>;
  },
  relocateAgentTeamRecord(request) {
    return ipcRenderer.invoke(TEAM_REPAIR_IPC_CHANNELS.relocate, request) as Promise<AgentTeamListItem>;
  },
  removeAgentTeamRecord(request) {
    return ipcRenderer.invoke(TEAM_REPAIR_IPC_CHANNELS.removeRecord, request) as Promise<void>;
  },
  readGithubTeamAuthStatus() {
    return ipcRenderer.invoke(GITHUB_TEAM_IPC_CHANNELS.authStatus) as Promise<GithubTeamAuthIpcResponse>;
  },
  searchGithubTeams(request) {
    return ipcRenderer.invoke(GITHUB_TEAM_IPC_CHANNELS.search, request) as Promise<GithubTeamSearchIpcResponse>;
  },
  previewGithubTeam(request) {
    return ipcRenderer.invoke(GITHUB_TEAM_IPC_CHANNELS.preview, request) as Promise<GithubTeamPreviewIpcResponse>;
  },
  installGithubTeam(request) {
    return ipcRenderer.invoke(GITHUB_TEAM_IPC_CHANNELS.install, request) as Promise<GithubTeamInstallIpcResponse>;
  },
  detachGithubTeamUpstream(request) {
    return ipcRenderer.invoke(GITHUB_TEAM_IPC_CHANNELS.detach, request) as Promise<GithubTeamDetachIpcResponse>;
  },
  checkGithubTeamUpstream(request) {
    return ipcRenderer.invoke(GITHUB_TEAM_IPC_CHANNELS.checkUpstream, request) as Promise<GithubTeamCheckUpstreamIpcResponse>;
  },
  syncGithubTeamUpstream(request) {
    return ipcRenderer.invoke(GITHUB_TEAM_IPC_CHANNELS.sync, request) as Promise<GithubTeamSyncIpcResponse>;
  },
  revertGithubTeamSync(request) {
    return ipcRenderer.invoke(GITHUB_TEAM_IPC_CHANNELS.revertSync, request) as Promise<GithubTeamRevertSyncIpcResponse>;
  },
  startAiTeamBuilder(draftId) {
    return ipcRenderer.invoke(
      AI_TEAM_BUILDER_IPC_CHANNELS.start,
      { draftId },
    ) as Promise<AiTeamBuilderIpcResponse>;
  },
  submitAiTeamBuilder(draftId, text) {
    return ipcRenderer.invoke(
      AI_TEAM_BUILDER_IPC_CHANNELS.submit,
      { draftId, text },
    ) as Promise<AiTeamBuilderIpcResponse>;
  },
  adjustAiTeamBuilder(draftId, text) {
    return ipcRenderer.invoke(
      AI_TEAM_BUILDER_IPC_CHANNELS.adjust,
      { draftId, text },
    ) as Promise<AiTeamBuilderIpcResponse>;
  },
  retryAiTeamBuilder(draftId) {
    return ipcRenderer.invoke(
      AI_TEAM_BUILDER_IPC_CHANNELS.retry,
      { draftId },
    ) as Promise<AiTeamBuilderIpcResponse>;
  },
  commitAiTeamBuilder(draftId, proposalRevision) {
    return ipcRenderer.invoke(
      AI_TEAM_BUILDER_IPC_CHANNELS.commit,
      { draftId, proposalRevision },
    ) as Promise<AiTeamBuilderIpcResponse>;
  },
  readLastUsedAgentTeam() {
    return ipcRenderer.invoke(
      TEAM_CONVERSATION_PREFERENCE_IPC_CHANNELS.readLastUsed,
    ) as Promise<LastUsedAgentTeam | null>;
  },
  recordSuccessfulConversationAgentTeam(request) {
    return ipcRenderer.invoke(
      TEAM_CONVERSATION_PREFERENCE_IPC_CHANNELS.recordSuccessful,
      request,
    ) as Promise<LastUsedAgentTeam>;
  },
  getOnboardingStatus() {
    return ipcRenderer.invoke(
      ONBOARDING_IPC_CHANNELS.status,
    ) as Promise<OnboardingCompletionStatus>;
  },
  completeOnboarding() {
    return ipcRenderer.invoke(
      ONBOARDING_IPC_CHANNELS.complete,
    ) as Promise<OnboardingCompletionStatus>;
  },
  checkOnboardingCodex() {
    return ipcRenderer.invoke(ONBOARDING_IPC_CHANNELS.checkCodex) as Promise<DoctorCheck>;
  },
  copyOnboardingInstallCommand() {
    return ipcRenderer.invoke(ONBOARDING_IPC_CHANNELS.copyInstallCommand) as Promise<void>;
  },
  getOnboardingCliReadinessState() {
    return ipcRenderer.invoke(
      ONBOARDING_IPC_CHANNELS.cliReadinessState,
    ) as Promise<OnboardingCliReadinessState>;
  },
  checkOnboardingCliReadiness(cli) {
    return ipcRenderer.invoke(
      ONBOARDING_IPC_CHANNELS.cliReadinessCheck,
      { cli },
    ) as Promise<OnboardingCliReadinessSnapshot>;
  },
  getOnboardingCliInstallState() {
    return ipcRenderer.invoke(
      ONBOARDING_IPC_CHANNELS.cliInstallState,
    ) as Promise<OnboardingCliInstallState>;
  },
  onOnboardingCliInstallSnapshot(listener) {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      snapshot: OnboardingCliInstallSnapshot,
    ): void => {
      listener(snapshot);
    };
    ipcRenderer.on(ONBOARDING_IPC_CHANNELS.cliInstallSnapshot, wrapped);
    return () => {
      ipcRenderer.off(ONBOARDING_IPC_CHANNELS.cliInstallSnapshot, wrapped);
    };
  },
  startOnboardingCliInstall(cli) {
    return ipcRenderer.invoke(
      ONBOARDING_IPC_CHANNELS.cliInstallStart,
      { cli },
    ) as Promise<OnboardingCliInstallSnapshot>;
  },
  startOnboardingClaudeUpdate() {
    return ipcRenderer.invoke(
      ONBOARDING_IPC_CHANNELS.claudeUpdateStart,
    ) as Promise<OnboardingCliInstallSnapshot>;
  },
  cancelOnboardingCliInstall(cli) {
    return ipcRenderer.invoke(
      ONBOARDING_IPC_CHANNELS.cliInstallCancel,
      { cli },
    ) as Promise<OnboardingCliInstallSnapshot>;
  },
  startOnboardingTeamBuilder(request) {
    return ipcRenderer.invoke(
      ONBOARDING_IPC_CHANNELS.teamBuilderStart,
      request,
    ) as Promise<AiTeamBuilderIpcResponse>;
  },
  submitOnboardingTeamBuilder(request) {
    return ipcRenderer.invoke(
      ONBOARDING_IPC_CHANNELS.teamBuilderSubmit,
      request,
    ) as Promise<AiTeamBuilderIpcResponse>;
  },
  adjustOnboardingTeamBuilder(request) {
    return ipcRenderer.invoke(
      ONBOARDING_IPC_CHANNELS.teamBuilderAdjust,
      request,
    ) as Promise<AiTeamBuilderIpcResponse>;
  },
  retryOnboardingTeamBuilder(request) {
    return ipcRenderer.invoke(
      ONBOARDING_IPC_CHANNELS.teamBuilderRetry,
      request,
    ) as Promise<AiTeamBuilderIpcResponse>;
  },
  commitOnboardingTeamBuilder(request) {
    return ipcRenderer.invoke(
      ONBOARDING_IPC_CHANNELS.teamBuilderCommit,
      request,
    ) as Promise<AiTeamBuilderIpcResponse>;
  },
  openExternalLink(url) {
    return ipcRenderer.invoke(OPEN_EXTERNAL_LINK_IPC_CHANNEL, url) as Promise<void>;
  },
  readTaskReminderState() {
    return ipcRenderer.invoke(TASK_REMINDER_IPC_CHANNELS.readState) as Promise<TaskReminderReadState>;
  },
  setTaskReminderEnabled(enabled) {
    return ipcRenderer.invoke(TASK_REMINDER_IPC_CHANNELS.setEnabled, enabled) as Promise<{ ok: boolean }>;
  },
  applyTaskReminderModalAction(action) {
    return ipcRenderer.invoke(TASK_REMINDER_IPC_CHANNELS.modalAction, action) as Promise<{
      ok: boolean;
      state: import("./permission-modal-plan.js").PermissionModalState | null;
    }>;
  },
  recheckTaskReminderChannel() {
    return ipcRenderer.invoke(TASK_REMINDER_IPC_CHANNELS.recheckChannel) as Promise<"ok" | "anomaly" | "unknown">;
  },
  openTaskReminderSystemSettings() {
    return ipcRenderer.invoke(TASK_REMINDER_IPC_CHANNELS.openSystemSettings) as Promise<{ ok: boolean }>;
  },
  consumeTaskReminderClick() {
    return ipcRenderer.invoke(TASK_REMINDER_IPC_CHANNELS.clickConsumed) as Promise<{ ok: boolean }>;
  },
  refreshTaskReminderDock() {
    return ipcRenderer.invoke(TASK_REMINDER_IPC_CHANNELS.refreshDock) as Promise<{ ok: boolean; count: number }>;
  },
  onTaskReminderStateChanged(listener) {
    const wrapped = (): void => {
      listener();
    };
    ipcRenderer.on(TASK_REMINDER_IPC_CHANNELS.stateChanged, wrapped);
    return () => {
      ipcRenderer.off(TASK_REMINDER_IPC_CHANNELS.stateChanged, wrapped);
    };
  },
  onTaskReminderClicked(listener) {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      payload: { sessionId: string; roundId: number; terminalMessageId: number | null },
    ): void => {
      listener(payload);
    };
    ipcRenderer.on(TASK_REMINDER_IPC_CHANNELS.clicked, wrapped);
    return () => {
      ipcRenderer.off(TASK_REMINDER_IPC_CHANNELS.clicked, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("moebius", api);
