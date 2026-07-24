import {
  relocateUserTeamRecord,
  removeUserTeamRecord,
} from "./team-record-store.js";
import { toListItem, type AgentTeamListItem } from "./team-ipc.js";
import type {
  AgentTeamRelocateRequest,
  AgentTeamRepairRequest,
} from "./team-repair-contract.js";

export * from "./team-repair-contract.js";

export async function relocateAgentTeamRecord(
  dataRoot: string,
  rawRequest: unknown,
): Promise<AgentTeamListItem> {
  const request = parseRelocateRequest(rawRequest);
  const snapshot = await relocateUserTeamRecord({
    dataRoot,
    teamId: request.teamId,
    directory: request.directory,
  });
  return toListItem(snapshot);
}

export async function removeAgentTeamRecord(dataRoot: string, rawRequest: unknown): Promise<void> {
  const request = parseRepairRequest(rawRequest);
  await removeUserTeamRecord({ dataRoot, teamId: request.teamId });
}

function parseRelocateRequest(value: unknown): AgentTeamRelocateRequest {
  const request = parseRepairRequest(value);
  if (!isPlainObject(value) || typeof value.directory !== "string" || value.directory.trim().length === 0) {
    throw new AgentTeamRepairRequestError("需要选择新的团队文件夹。");
  }
  return { ...request, directory: value.directory };
}

function parseRepairRequest(value: unknown): AgentTeamRepairRequest {
  if (!isPlainObject(value) || typeof value.teamId !== "string" || value.teamId.trim().length === 0) {
    throw new AgentTeamRepairRequestError("需要提供有效的团队记录。");
  }
  if (value.ownership !== "user") {
    throw new AgentTeamRepairRequestError("软件自带团队不能通过用户修复入口修改位置或移除记录。");
  }
  return { teamId: value.teamId, ownership: "user" };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class AgentTeamRepairRequestError extends Error {
  readonly code = "AGENT_TEAM_REPAIR_REQUEST_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "AgentTeamRepairRequestError";
  }
}
