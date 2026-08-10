import type {
  AgentTeamCreateRequest,
  AgentTeamDefaultAgentResponse,
  AgentTeamDefaultAgentSaveRequest,
  AgentTeamDuplicateBuiltInRequest,
  AgentTeamDuplicateUserRequest,
  AgentTeamExecutionProfileDocument,
  AgentTeamExecutionProfileSaveRequest,
  AgentTeamExecutionProfilesReplaceRequest,
  AgentTeamExecutionProfilesReplaceResult,
  AgentTeamListItem,
  AgentTeamListResponse,
  AgentTeamMemberAddRequest,
  AgentTeamMemberAddResponse,
  AgentTeamMemberDocument,
  AgentTeamMemberDuplicateRequest,
  AgentTeamMemberRevisionsResponse,
  AgentTeamMemberRevisionRestoreRequest,
  AgentTeamMemberRevisionRestoreResponse,
  AgentTeamMemberRequest,
  AgentTeamMemberTrashRequest,
  AgentTeamMemberWriteRequest,
  AgentTeamOfficialUpdateCommitRequest,
  AgentTeamOfficialUpdateCommitResponse,
  AgentTeamOfficialUpdatePrepareResponse,
  AgentTeamOfficialUpdateRequest,
  AgentTeamPrimaryAgentWriteRequest,
  AgentTeamTrashUserRequest,
  AgentTeamUpdateInformationRequest,
  AgentMarkdownRevisionSummarySettledPayload,
} from "../team-ipc-contract.js";
import type { AgentTeamRelocateRequest, AgentTeamRepairRequest } from "../team-repair-contract.js";
import type { AgentTeamFileManagerKind, AgentTeamFileManagerRequest } from "../team-file-manager-contract.js";
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
import type { CopySessionLogPathResult } from "../session-log-clipboard.js";
import type { DesktopLocale } from "../language-preference-contract.js";
import type {
  SettingsApplicationInfo,
  SettingsUpdateCheckResult,
  SettingsUpdateState,
  SettingsVersionCopyResult,
} from "../settings-contract.js";
import type {
  ProviderProfileCreateRequest,
  ProviderProfileCancelRequest,
  ProviderProfileIpcResult,
  ProviderProfileMigrateReferencesRequest,
  ProviderProfileRetryReferenceOperationRequest,
  ProviderProfileEndReferencesRequest,
  ProviderProfileListResult,
  ProviderProfileModelRequest,
  ProviderProfileRenameRequest,
  ProviderProfileRevisionRequest,
  ProviderProfileRotateKeyRequest,
  ProviderProfileSummaryDto,
  ProviderProfileReplaceDefaultAndRemoveModelRequest,
} from "../provider-profile-contract.js";
export interface DesktopStatusSnapshot {
  localConsole?: {
    status: "starting" | "running" | "error" | "stopped";
    url?: string;
    sqlitePath?: string;
    error?: string;
  };
  shellPath?: { status: "ok" | "fallback"; path: string; detail?: string } | null;
  seed?: { status: "pending" | "ok" | "error" };
}

export interface DesktopApi {
  readLanguagePreference?: () => Promise<DesktopLocale>;
  saveLanguagePreference?: (locale: DesktopLocale) => Promise<DesktopLocale>;
  onLanguagePreferenceChanged?: (listener: (locale: DesktopLocale) => void) => () => void;
  getLocalConsoleUrl?: () => Promise<string | null>;
  getLocalConsoleAttachmentCapability?: () => Promise<string | null>;
  copySessionLogPath?: (sessionId: string) => Promise<CopySessionLogPathResult>;
  readApplicationInfo?: () => Promise<SettingsApplicationInfo>;
  checkForUpdates?: () => Promise<SettingsUpdateCheckResult>;
  readUpdateState?: () => Promise<SettingsUpdateState>;
  onUpdateState?: (listener: (state: SettingsUpdateState) => void) => () => void;
  installUpdate?: () => Promise<void>;
  copyVersionInfo?: () => Promise<SettingsVersionCopyResult>;
  listProviderProfiles?: () => Promise<ProviderProfileListResult>;
  createProviderProfile?: (request: ProviderProfileCreateRequest) => Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  retryCreateProviderProfileSave?: (request: ProviderProfileCancelRequest) => Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  discardCreateProviderProfileSave?: (request: ProviderProfileCancelRequest) => Promise<ProviderProfileIpcResult<null>>;
  rotateProviderProfileKey?: (request: ProviderProfileRotateKeyRequest) => Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  addProviderProfileModel?: (request: ProviderProfileModelRequest) => Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  setProviderProfileDefaultModel?: (request: ProviderProfileModelRequest) => Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  removeProviderProfileModel?: (request: ProviderProfileModelRequest) => Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  replaceProviderProfileDefaultAndRemoveModel?: (request: ProviderProfileReplaceDefaultAndRemoveModelRequest) => Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  renameProviderProfile?: (request: ProviderProfileRenameRequest) => Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  disableProviderProfile?: (request: ProviderProfileRevisionRequest) => Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  enableProviderProfile?: (request: ProviderProfileRevisionRequest) => Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  deleteProviderProfile?: (request: ProviderProfileRevisionRequest) => Promise<ProviderProfileIpcResult<null>>;
  migrateProviderProfileReferences?: (request: ProviderProfileMigrateReferencesRequest) => Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  retryProviderProfileReferenceOperation?: (request: ProviderProfileRetryReferenceOperationRequest) => Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  endProviderProfileReferences?: (request: ProviderProfileEndReferencesRequest) => Promise<ProviderProfileIpcResult<ProviderProfileSummaryDto>>;
  cancelProviderProfileOperation?: (request: ProviderProfileCancelRequest) => Promise<ProviderProfileIpcResult<null>>;
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
  readAgentTeamExecutionProfile?: (request: AgentTeamMemberRequest) => Promise<AgentTeamExecutionProfileDocument>;
  saveAgentTeamExecutionProfile?: (
    request: AgentTeamExecutionProfileSaveRequest,
  ) => Promise<AgentTeamExecutionProfileDocument>;
  replaceUnavailableAgentTeamExecutionProfiles?: (
    request: AgentTeamExecutionProfilesReplaceRequest,
  ) => Promise<AgentTeamExecutionProfilesReplaceResult>;
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
  listAgentTeamMemberRevisions?: (
    request: AgentTeamMemberRequest,
  ) => Promise<AgentTeamMemberRevisionsResponse>;
  restoreAgentTeamMemberRevision?: (
    request: AgentTeamMemberRevisionRestoreRequest,
  ) => Promise<AgentTeamMemberRevisionRestoreResponse>;
  onAgentMarkdownRevisionSummarySettled?: (
    listener: (payload: AgentMarkdownRevisionSummarySettledPayload) => void,
  ) => () => void;
  getDefaultAgent?: () => Promise<AgentTeamDefaultAgentResponse>;
  saveDefaultAgent?: (request: AgentTeamDefaultAgentSaveRequest) => Promise<AgentTeamDefaultAgentResponse>;
  selectAgentTeamRelocationFolder?: () => Promise<string | null>;
  relocateAgentTeamRecord?: (request: AgentTeamRelocateRequest) => Promise<AgentTeamListItem>;
  removeAgentTeamRecord?: (request: AgentTeamRepairRequest) => Promise<void>;
  startAiTeamBuilder?: (draftId: string) => Promise<AiTeamBuilderIpcResponse>;
  submitAiTeamBuilder?: (draftId: string, text: string) => Promise<AiTeamBuilderIpcResponse>;
  adjustAiTeamBuilder?: (draftId: string, text: string) => Promise<AiTeamBuilderIpcResponse>;
  retryAiTeamBuilder?: (draftId: string) => Promise<AiTeamBuilderIpcResponse>;
  commitAiTeamBuilder?: (draftId: string, proposalRevision: number) => Promise<AiTeamBuilderIpcResponse>;
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

declare global {
  interface Window {
    moebius?: DesktopApi;
    MOEBIUS_LOCAL_CONSOLE_URL?: string;
  }
}
