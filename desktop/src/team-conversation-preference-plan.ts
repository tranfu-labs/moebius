import type { AgentTeamListResponse, AgentTeamListItem } from "./team-ipc-contract.js";
import type {
  LastUsedAgentTeam,
  SuccessfulConversationAgentTeamRequest,
} from "./team-conversation-preference-contract.js";
import { isValidPathSegment } from "./team-model.js";

export interface LastUsedAgentTeamDocument extends LastUsedAgentTeam {
  version: 1;
}

export function parseSuccessfulConversationRequest(
  value: unknown,
): SuccessfulConversationAgentTeamRequest {
  if (!isPlainObject(value)
    || typeof value.sessionId !== "string"
    || value.sessionId.trim().length === 0) {
    throw new AgentTeamPreferenceError("只有成功创建的会话才能更新上一次使用的团队。");
  }
  return { ...parseTeamIdentity(value), sessionId: value.sessionId };
}

export function parseLastUsedAgentTeam(source: string): LastUsedAgentTeam {
  const value: unknown = JSON.parse(source);
  if (!isPlainObject(value) || value.version !== 1) {
    throw new AgentTeamPreferenceError("上一次使用的 Agent 团队记录无法读取。");
  }
  return parseTeamIdentity(value);
}

export function selectConversationAgentTeam(input: {
  sessionExists: boolean;
  listed: AgentTeamListResponse;
  request: SuccessfulConversationAgentTeamRequest;
}): AgentTeamListItem {
  if (!input.sessionExists) {
    throw new AgentTeamPreferenceError("只有成功创建且仍然存在的会话才能更新上一次使用的团队。");
  }
  const selectedTeam = input.listed.status === "ready"
    ? input.listed.teams.find((team) =>
        team.id === input.request.teamId
        && team.ownership === input.request.ownership
        && team.canCreateConversation)
    : undefined;
  if (selectedTeam === undefined) {
    throw new AgentTeamPreferenceError("所选 Agent 团队当前不能用于新建对话。");
  }
  return selectedTeam;
}

function parseTeamIdentity(value: Record<string, unknown>): LastUsedAgentTeam {
  if (typeof value.teamId !== "string"
    || !isValidPathSegment(value.teamId)
    || value.teamId.trim() !== value.teamId
    || (value.ownership !== "system" && value.ownership !== "user")) {
    throw new AgentTeamPreferenceError("Agent 团队标识无效。");
  }
  return { teamId: value.teamId, ownership: value.ownership };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class AgentTeamPreferenceError extends Error {
  readonly code = "AGENT_TEAM_PREFERENCE_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "AgentTeamPreferenceError";
  }
}
