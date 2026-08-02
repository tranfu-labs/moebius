import type { AgentTeamExternalChangeRequest } from "./team-external-change-contract.js";
import type { AgentTeamFileManagerRequest } from "./team-file-manager-contract.js";
import { AgentTeamIpcRequestError } from "./team-ipc-contract.js";
import type { AgentTeamRelocateRequest, AgentTeamRepairRequest } from "./team-repair-contract.js";

export function parseExternalChangeRequest(value: unknown): AgentTeamExternalChangeRequest {
  if (!isPlainObject(value)) {
    throw new AgentTeamIpcRequestError("An external-change request is required.");
  }
  if (typeof value.teamId !== "string" || value.teamId.trim().length === 0) {
    throw new AgentTeamIpcRequestError("A team id is required.");
  }
  if (value.ownership !== "system" && value.ownership !== "user") {
    throw new AgentTeamIpcRequestError("A valid team ownership is required.");
  }
  if (typeof value.memberSlug !== "string" || value.memberSlug.trim().length === 0) {
    throw new AgentTeamIpcRequestError("An Agent slug is required.");
  }
  if (typeof value.knownAgentMarkdown !== "string") {
    throw new AgentTeamIpcRequestError("The known AGENT.md content is required.");
  }
  return {
    teamId: value.teamId,
    ownership: value.ownership,
    memberSlug: value.memberSlug,
    knownAgentMarkdown: value.knownAgentMarkdown,
  };
}

export function planExternalChangeRead(ownership: "system" | "user"): "ignored" | "read" {
  return ownership === "system" ? "ignored" : "read";
}

export function decideExternalChange(
  knownAgentMarkdown: string,
  actualAgentMarkdown: string,
): "unchanged" | "changed" {
  return actualAgentMarkdown === knownAgentMarkdown ? "unchanged" : "changed";
}

export function parseFileManagerRequest(value: unknown): AgentTeamFileManagerRequest {
  if (!isPlainObject(value)) {
    throw new Error("An Agent team location request is required.");
  }
  if (typeof value.teamId !== "string" || value.teamId.trim().length === 0) {
    throw new Error("An Agent team id is required.");
  }
  if (value.ownership !== "system" && value.ownership !== "user") {
    throw new Error("A valid Agent team ownership is required.");
  }
  if (
    value.memberSlug !== undefined
    && (typeof value.memberSlug !== "string" || value.memberSlug.trim().length === 0)
  ) {
    throw new Error("A valid Agent slug is required.");
  }
  return {
    teamId: value.teamId,
    ownership: value.ownership,
    ...(value.memberSlug === undefined ? {} : { memberSlug: value.memberSlug }),
  };
}

export function planFileManagerTarget(memberSlug: string | undefined): "team" | "member" {
  return memberSlug === undefined ? "team" : "member";
}

export function parseRelocateRequest(value: unknown): AgentTeamRelocateRequest {
  const request = parseRepairRequest(value);
  if (!isPlainObject(value) || typeof value.directory !== "string" || value.directory.trim().length === 0) {
    throw new AgentTeamRepairRequestError("需要选择新的团队文件夹。");
  }
  return { ...request, directory: value.directory };
}

export function parseRepairRequest(value: unknown): AgentTeamRepairRequest {
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
