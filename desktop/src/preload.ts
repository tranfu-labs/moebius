import { contextBridge, ipcRenderer } from "electron";
import type { DesktopStatusSnapshot } from "./status.js";
import {
  getAgentTeamFileManagerLabel,
  TEAM_FILE_MANAGER_IPC_CHANNEL,
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

export interface MoebiusDesktopApi {
  onStatus(listener: (snapshot: DesktopStatusSnapshot) => void): () => void;
  getLocalConsoleUrl(): Promise<string | null>;
  getLocalConsoleAttachmentCapability(): Promise<string | null>;
  copySessionLogPath(sessionId: string): Promise<CopySessionLogPathResult>;
  openObserver(): Promise<void>;
  openStatusPage(): Promise<void>;
  openDataRoot(): Promise<void>;
  checkUpdates(): Promise<void>;
  selectProjectFolder(): Promise<string | null>;
  selectFolderForRepair(projectId: string): Promise<string | null>;
  showInFolder(folderPath: string): Promise<void>;
  readonly agentTeamFileManagerLabel: string;
  openAgentTeamLocation(request: AgentTeamFileManagerRequest): Promise<void>;
  listAgentTeams(): Promise<AgentTeamListResponse>;
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
  startOnboardingTeamBuilder(request: AiTeamBuilderDraftRequest): Promise<AiTeamBuilderIpcResponse>;
  submitOnboardingTeamBuilder(request: AiTeamBuilderTurnRequest): Promise<AiTeamBuilderIpcResponse>;
  adjustOnboardingTeamBuilder(request: AiTeamBuilderTurnRequest): Promise<AiTeamBuilderIpcResponse>;
  retryOnboardingTeamBuilder(request: AiTeamBuilderDraftRequest): Promise<AiTeamBuilderIpcResponse>;
  commitOnboardingTeamBuilder(request: AiTeamBuilderCommitRequest): Promise<AiTeamBuilderIpcResponse>;
  openExternalLink(url: string): Promise<void>;
}

const api: MoebiusDesktopApi = {
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
  openObserver() {
    return ipcRenderer.invoke("action:open-observer") as Promise<void>;
  },
  openStatusPage() {
    return ipcRenderer.invoke("action:open-status-page") as Promise<void>;
  },
  openDataRoot() {
    return ipcRenderer.invoke("action:open-data-root") as Promise<void>;
  },
  checkUpdates() {
    return ipcRenderer.invoke("action:check-updates") as Promise<void>;
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
  agentTeamFileManagerLabel: getAgentTeamFileManagerLabel(process.platform),
  openAgentTeamLocation(request) {
    return ipcRenderer.invoke(TEAM_FILE_MANAGER_IPC_CHANNEL, request) as Promise<void>;
  },
  listAgentTeams() {
    return ipcRenderer.invoke(TEAM_IPC_CHANNELS.list) as Promise<AgentTeamListResponse>;
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
