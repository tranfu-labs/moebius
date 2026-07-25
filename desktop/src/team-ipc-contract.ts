import type {
  TeamDefinition,
  TeamInformation,
  TeamOwnership,
  TeamRepairIssueCode,
  TeamStatus,
} from "./team-model.js";
import type {
  ExecutionCapabilitySnapshot,
  ExecutionProfile,
  ExecutionProfileBinding,
  ExecutionProfileStatus,
} from "./team-execution-profile.js";
import type {
  OfficialTeamUpdateState,
} from "./team-official-management.js";
import type {
  AppliedOfficialTeamUpdate,
  PreparedOfficialTeamUpdate,
} from "./team-official-update.js";

export const TEAM_IPC_CHANNELS = {
  list: "agent-teams:list",
  create: "agent-teams:create",
  readMember: "agent-teams:read-member",
  writeMember: "agent-teams:write-member",
  addMember: "agent-teams:add-member",
  updateInformation: "agent-teams:update-information",
  setPrimaryAgent: "agent-teams:set-primary-agent",
  duplicateBuiltIn: "agent-teams:duplicate-built-in",
  duplicateUser: "agent-teams:duplicate-user",
  duplicateMember: "agent-teams:duplicate-member",
  trashMember: "agent-teams:trash-member",
  trashUserTeam: "agent-teams:trash-user-team",
  readExecutionProfile: "agent-teams:read-execution-profile",
  saveExecutionProfile: "agent-teams:save-execution-profile",
  restoreRecommendedProfile: "agent-teams:restore-recommended-profile",
  refreshExecutionCapabilities: "agent-teams:refresh-execution-capabilities",
  prepareOfficialUpdate: "agent-teams:prepare-official-update",
  applyOfficialUpdate: "agent-teams:apply-official-update",
} as const;

export interface AgentTeamMemberSummary {
  slug: string;
  displayName: string;
  description: string;
  available?: boolean;
  executionProfile?: {
    source: ExecutionProfileBinding["source"];
    effective: ExecutionProfile | null;
    status: ExecutionProfileStatus["status"] | "not-configured";
  };
}

export interface AgentTeamListItem {
  id: string;
  ownership: TeamOwnership;
  definition: TeamDefinition | null;
  members: AgentTeamMemberSummary[];
  status: TeamStatus;
  canCreateConversation: boolean;
  capabilities?: {
    canEditContent: boolean;
    canDeleteTeam: boolean;
  };
  issues: Array<{ code: TeamRepairIssueCode; slug?: string }>;
  onboardingOrchestration?:
    | {
        status: "ready";
        relayBeats: Array<{ speakerSlug: string; message: string }>;
      }
    | { status: "unavailable" };
  officialManagement?: OfficialTeamUpdateState;
}

export type AgentTeamListResponse =
  | { status: "loading" }
  | { status: "ready"; teams: AgentTeamListItem[] }
  | { status: "configuration-error" };

export interface AgentTeamMemberRequest {
  teamId: string;
  ownership: TeamOwnership;
  memberSlug: string;
}

export interface AgentTeamMemberWriteRequest extends AgentTeamMemberRequest {
  agentMarkdown: string;
}

export interface AgentTeamPrimaryAgentWriteRequest {
  teamId: string;
  ownership: TeamOwnership;
  primaryAgentSlug: string;
}

export interface AgentTeamDuplicateBuiltInRequest {
  teamId: string;
  ownership: "system";
}

export interface AgentTeamDuplicateUserRequest {
  teamId: string;
  ownership: "user";
}

export interface AgentTeamMemberDuplicateRequest extends AgentTeamMemberRequest {
  ownership: TeamOwnership;
}

export interface AgentTeamMemberTrashRequest extends AgentTeamMemberRequest {
  ownership: TeamOwnership;
}

export interface AgentTeamTrashUserRequest {
  teamId: string;
  ownership: "user";
}

export type AgentTeamCreateRequest = TeamInformation;

export interface AgentTeamUpdateInformationRequest extends TeamInformation {
  teamId: string;
  ownership: TeamOwnership;
}

export interface AgentTeamMemberAddRequest {
  teamId: string;
  ownership: TeamOwnership;
}

export interface AgentTeamMemberDocument extends AgentTeamMemberSummary {
  agentMarkdown: string;
}

export interface AgentTeamMemberAddResponse {
  team: AgentTeamListItem;
  member: AgentTeamMemberDocument;
}

export interface AgentTeamExecutionProfileDocument {
  teamId: string;
  ownership: TeamOwnership;
  memberSlug: string;
  binding: ExecutionProfileBinding;
  recommendation: ExecutionProfile | null;
  effectiveProfile: ExecutionProfile;
  status: ExecutionProfileStatus;
  capabilities: ExecutionCapabilitySnapshot[];
}

export interface AgentTeamExecutionProfileSaveRequest extends AgentTeamMemberRequest {
  profile: ExecutionProfile;
  capabilitySnapshotId: string;
}

export interface AgentTeamExecutionCapabilityRequest {
  cli: "codex" | "kimi";
}

export interface AgentTeamOfficialUpdateRequest {
  teamId: string;
  ownership: "system";
}

export interface AgentTeamOfficialUpdateCommitRequest {
  plan: PreparedOfficialTeamUpdate;
}

export type AgentTeamOfficialUpdatePrepareResponse = PreparedOfficialTeamUpdate;
export type AgentTeamOfficialUpdateCommitResponse = AppliedOfficialTeamUpdate & {
  copiedTeam: AgentTeamListItem | null;
};
