import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  LastUsedAgentTeam,
  SuccessfulConversationAgentTeamRequest,
} from "./team-conversation-preference-contract.js";
import { listAgentTeams } from "./team-ipc.js";
import { isValidPathSegment } from "./team-model.js";

export const LAST_USED_AGENT_TEAM_FILE = "last-used-team.json";

export * from "./team-conversation-preference-contract.js";

interface LastUsedAgentTeamDocument extends LastUsedAgentTeam {
  version: 1;
}

export async function readLastUsedAgentTeam(dataRoot: string): Promise<LastUsedAgentTeam | null> {
  try {
    return parseLastUsedAgentTeam(await fs.readFile(getPreferencePath(dataRoot), "utf8"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError || error instanceof AgentTeamPreferenceError) {
      return null;
    }
    throw error;
  }
}

export async function recordSuccessfulConversationAgentTeam(
  dataRoot: string,
  rawRequest: unknown,
  sessionExists: (sessionId: string) => Promise<boolean>,
): Promise<LastUsedAgentTeam> {
  const request = parseSuccessfulConversationRequest(rawRequest);
  if (!(await sessionExists(request.sessionId))) {
    throw new AgentTeamPreferenceError("只有成功创建且仍然存在的会话才能更新上一次使用的团队。");
  }
  const listed = await listAgentTeams({ dataRoot, seedPending: false });
  const selectedTeam = listed.status === "ready"
    ? listed.teams.find((team) =>
        team.id === request.teamId
        && team.ownership === request.ownership
        && team.canCreateConversation,
      )
    : undefined;
  if (selectedTeam === undefined) {
    throw new AgentTeamPreferenceError("所选 Agent 团队当前不能用于新建对话。");
  }

  const document: LastUsedAgentTeamDocument = {
    version: 1,
    teamId: selectedTeam.id,
    ownership: selectedTeam.ownership,
  };
  await writePreference(dataRoot, document);
  return { teamId: document.teamId, ownership: document.ownership };
}

export class AgentTeamPreferenceError extends Error {
  readonly code = "AGENT_TEAM_PREFERENCE_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "AgentTeamPreferenceError";
  }
}

function parseSuccessfulConversationRequest(value: unknown): SuccessfulConversationAgentTeamRequest {
  if (!isPlainObject(value)
    || typeof value.sessionId !== "string"
    || value.sessionId.trim().length === 0) {
    throw new AgentTeamPreferenceError("只有成功创建的会话才能更新上一次使用的团队。");
  }
  const team = parseTeamIdentity(value);
  return { ...team, sessionId: value.sessionId };
}

function parseLastUsedAgentTeam(source: string): LastUsedAgentTeam {
  const value: unknown = JSON.parse(source);
  if (!isPlainObject(value) || value.version !== 1) {
    throw new AgentTeamPreferenceError("上一次使用的 Agent 团队记录无法读取。");
  }
  return parseTeamIdentity(value);
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

function getPreferencePath(dataRoot: string): string {
  return path.join(path.resolve(dataRoot), LAST_USED_AGENT_TEAM_FILE);
}

async function writePreference(dataRoot: string, document: LastUsedAgentTeamDocument): Promise<void> {
  const preferencePath = getPreferencePath(dataRoot);
  await fs.mkdir(path.dirname(preferencePath), { recursive: true });
  const temporaryPath = `${preferencePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, preferencePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
