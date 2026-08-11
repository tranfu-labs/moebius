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
  memberRevisionsList: "agent-teams:member-revisions:list",
  memberRevisionRestore: "agent-teams:member-revisions:restore",
  defaultAgentGet: "agent-teams:default-agent:get",
  defaultAgentSave: "agent-teams:default-agent:save",
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

export interface AgentTeamMemberRevisionsRequest extends AgentTeamMemberRequest {
  teamId: string;
  ownership: TeamOwnership;
  memberSlug: string;
}

export interface AgentTeamRevisionView {
  revisionId: string;
  authorKind: "user" | "official" | "agent";
  /** Official version label when the author is official; null otherwise. */
  authorLabel: string | null;
  summary: string | null;
  summaryStatus: "pending" | "ready" | "unavailable";
  timeLabel: string;
  /**
   * True only for the CURRENT (newest) revision. The current version has no
   * restore action — restoring to it would be a no-op that still spawns a
   * duplicate revision; EVERY historical revision, including the earliest,
   * can be restored to (PRD: 「当前版本无回退，所有历史版本可回退」).
   */
  isLatest: boolean;
}

export interface AgentTeamChangeMarkerView {
  blockIndex: number;
  authorKind: "user" | "official" | "agent";
  authorLabel: string;
  timeLabel: string;
  previousText: string | null;
}

export interface AgentTeamMemberRevisionsResponse {
  /**
   * Latest revision's one-line summary slot — present whenever the member has
   * at least one revision, NEVER dropped because the summary text is missing
   * (the PRD's "最近变化" line must stay常驻). `summary` is null while the
   * background summary job is pending or has failed; the view renders a neutral
   * placeholder from `summaryStatus` (pending / unavailable), carrying the same
   * author + time shape as the ready line.
   */
  recentChange: {
    summary: string | null;
    summaryStatus: "pending" | "ready" | "unavailable";
    authorLabel: string;
    timeLabel: string;
  } | null;
  /** Latest revision's paragraph ownership — presentation only, see `agent-revision-plan.ts`. */
  changeMarkers: AgentTeamChangeMarkerView[];
  /** Newest first. */
  timeline: AgentTeamRevisionView[];
}

export interface AgentTeamMemberRevisionRestoreRequest extends AgentTeamMemberRevisionsRequest {
  revisionId: string;
}

export interface AgentTeamMemberRevisionRestoreResponse {
  agentMarkdown: string;
  /** The new revision created by the restore itself (author = user). */
  revision: AgentTeamRevisionView;
}

export interface AgentTeamDefaultAgentResponse {
  profile: ExecutionProfile;
  /** False until the user saves a choice; the UI shows the built-in recommendation. */
  saved: boolean;
}

export interface AgentTeamDefaultAgentSaveRequest {
  profile: ExecutionProfile;
}

/**
 * Main-process → renderer push: the background summary job reached a terminal
 * state (`ready` or `unavailable`) for one revision. The console refreshes the
 * member's revisions in place (idempotent: a repeated delivery for the same
 * terminal state never produces a new state object) so the "最近变化" line
 * settles without any user action. `createdAt` lets the renderer tell "event
 * for an older revision" (skip) from "event newer than the loaded view"
 * (refresh — the view is stale, e.g. a save refresh still in flight).
 */
export const AGENT_MARKDOWN_REVISION_SUMMARY_SETTLED_CHANNEL = "agent-markdown:revision-summary-settled";

export interface AgentMarkdownRevisionSummarySettledPayload {
  teamStableId: string;
  memberSlug: string;
  revisionId: string;
  /** Revision timestamp; absent only on the exceptional store-failure path. */
  createdAt?: string;
}

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
