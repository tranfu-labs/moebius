import type {
  TeamDefinition,
  TeamInformation,
  TeamOwnership,
  TeamRepairIssueCode,
  TeamStatus,
} from "./team-model.js";
import type {
  ExecutionProfile,
  ExecutionProfileBinding,
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
  resolveSeedConflict: "agent-teams:resolve-seed-conflict",
  showSeedConflictLocation: "agent-teams:show-seed-conflict-location",
  create: "agent-teams:create",
  readMember: "agent-teams:read-member",
  writeMember: "agent-teams:write-member",
  addMember: "agent-teams:add-member",
  updateInformation: "agent-teams:update-information",
  setPrimaryAgent: "agent-teams:set-primary-agent",
  reorderMembers: "agent-teams:reorder-members",
  duplicateBuiltIn: "agent-teams:duplicate-built-in",
  duplicateUser: "agent-teams:duplicate-user",
  duplicateMember: "agent-teams:duplicate-member",
  trashMember: "agent-teams:trash-member",
  trashUserTeam: "agent-teams:trash-user-team",
  readExecutionProfile: "agent-teams:read-execution-profile",
  saveExecutionProfile: "agent-teams:save-execution-profile",
  replaceUnavailableExecutionProfiles: "agent-teams:replace-unavailable-execution-profiles",
  restoreRecommendedProfile: "agent-teams:restore-recommended-profile",
  prepareOfficialUpdate: "agent-teams:prepare-official-update",
  applyOfficialUpdate: "agent-teams:apply-official-update",
} as const;

export interface AgentTeamRegistrationIssue {
  kind: "stable-identity" | "directory";
  canPreserve: boolean;
}

export interface AgentTeamExecutionProfileSummary {
  binding: ExecutionProfileBinding;
  recommendation: ExecutionProfile | null;
  effectiveProfile: ExecutionProfile;
}

export interface AgentTeamMemberSummary {
  slug: string;
  displayName: string;
  description: string;
  available?: boolean;
  executionProfile?: AgentTeamExecutionProfileSummary;
  /** Chosen face id; absent or null keeps the slug-derived default. */
  portraitId?: string | null;
}

export interface AgentTeamListItem {
  id: string;
  ownership: TeamOwnership;
  createdAt?: string;
  officialSourceName?: string;
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
  | {
      status: "ready";
      teams: AgentTeamListItem[];
      registrationIssues?: AgentTeamRegistrationIssue[];
    }
  | { status: "configuration-error" };

export interface AgentTeamMemberRequest {
  teamId: string;
  ownership: TeamOwnership;
  memberSlug: string;
}

export interface AgentTeamMemberWriteRequest extends AgentTeamMemberRequest {
  /** Full AGENT.md content; present when the write is a markdown save. */
  agentMarkdown?: string;
  /**
   * Present when the write is a portrait choice; `null` removes the explicit choice so the
   * member falls back to its slug-derived default face. Exactly one of `agentMarkdown` and
   * `portraitId` must be present (see `parseMemberWriteRequest`).
   */
  portraitId?: string | null;
}

export interface AgentTeamPrimaryAgentWriteRequest {
  teamId: string;
  ownership: TeamOwnership;
  primaryAgentSlug: string;
}

export interface AgentTeamMemberOrderWriteRequest {
  teamId: string;
  ownership: TeamOwnership;
  /** New full member order; the first entry is the primary Agent. */
  memberOrder: string[];
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

export interface AgentTeamExecutionProfileDocument extends AgentTeamExecutionProfileSummary {
  teamId: string;
  ownership: TeamOwnership;
  memberSlug: string;
}

export interface AgentTeamExecutionProfileSaveRequest extends AgentTeamMemberRequest {
  profile: ExecutionProfile;
}

export interface AgentTeamExecutionProfilesReplaceRequest {
  teamId: string;
  ownership: TeamOwnership;
  memberSlugs: string[];
  profile: ExecutionProfile;
}

export interface AgentTeamExecutionProfilesReplaceResult {
  teamId: string;
  ownership: TeamOwnership;
  memberSlugs: string[];
  profile: ExecutionProfile;
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

export class AgentTeamIpcRequestError extends Error {
  constructor(
    message: string,
    readonly code:
      | "AGENT_TEAM_IPC_REQUEST_INVALID"
      | "CAPABILITY_SNAPSHOT_STALE"
      | "EXECUTION_PROFILE_UNAVAILABLE" = "AGENT_TEAM_IPC_REQUEST_INVALID",
  ) {
    super(message);
    this.name = "AgentTeamIpcRequestError";
  }
}
