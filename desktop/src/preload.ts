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
  TEAM_IPC_CHANNELS,
  type AgentTeamCreateRequest,
  type AgentTeamDuplicateBuiltInRequest,
  type AgentTeamDuplicateUserRequest,
  type AgentTeamListItem,
  type AgentTeamListResponse,
  type AgentTeamMemberDocument,
  type AgentTeamMemberAddRequest,
  type AgentTeamMemberAddResponse,
  type AgentTeamMemberRequest,
  type AgentTeamMemberWriteRequest,
  type AgentTeamMemberDuplicateRequest,
  type AgentTeamMemberTrashRequest,
  type AgentTeamExecutionProfileDocument,
  type AgentTeamExecutionProfileSaveRequest,
  type AgentTeamExecutionProfilesReplaceRequest,
  type AgentTeamExecutionProfilesReplaceResult,
  type AgentTeamOfficialUpdateCommitRequest,
  type AgentTeamOfficialUpdateCommitResponse,
  type AgentTeamOfficialUpdatePrepareResponse,
  type AgentTeamOfficialUpdateRequest,
  type AgentTeamPrimaryAgentWriteRequest,
  type AgentTeamUpdateInformationRequest,
  type AgentTeamTrashUserRequest,
} from "./team-ipc-contract.js";
import {
  TEAM_REPAIR_IPC_CHANNELS,
  type AgentTeamRelocateRequest,
  type AgentTeamRepairRequest,
} from "./team-repair-contract.js";
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
  prepareAgentTeamOfficialUpdate(
    request: AgentTeamOfficialUpdateRequest,
  ): Promise<AgentTeamOfficialUpdatePrepareResponse>;
  applyAgentTeamOfficialUpdate(
    request: AgentTeamOfficialUpdateCommitRequest,
  ): Promise<AgentTeamOfficialUpdateCommitResponse>;
  checkAgentTeamMemberExternalChange(
    request: AgentTeamExternalChangeRequest,
  ): Promise<AgentTeamExternalChangeResponse>;
  selectAgentTeamRelocationFolder(): Promise<string | null>;
  relocateAgentTeamRecord(request: AgentTeamRelocateRequest): Promise<AgentTeamListItem>;
  removeAgentTeamRecord(request: AgentTeamRepairRequest): Promise<void>;
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
  prepareAgentTeamOfficialUpdate(request) {
    return ipcRenderer.invoke(
      TEAM_IPC_CHANNELS.prepareOfficialUpdate,
      request,
    ) as Promise<AgentTeamOfficialUpdatePrepareResponse>;
  },
  applyAgentTeamOfficialUpdate(request) {
    return ipcRenderer.invoke(
      TEAM_IPC_CHANNELS.applyOfficialUpdate,
      request,
    ) as Promise<AgentTeamOfficialUpdateCommitResponse>;
  },
  checkAgentTeamMemberExternalChange(request) {
    return ipcRenderer.invoke(
      TEAM_EXTERNAL_CHANGE_IPC_CHANNEL,
      request,
    ) as Promise<AgentTeamExternalChangeResponse>;
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
};

contextBridge.exposeInMainWorld("moebius", api);
