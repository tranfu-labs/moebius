import fs from "node:fs/promises";

import {
  type AgentTeamExternalChangeRequest,
  type AgentTeamExternalChangeResponse,
} from "./team-external-change-contract.js";
import { AgentTeamIpcRequestError } from "./team-ipc.js";
import { parseAgentMarkdownIdentity } from "./team-model.js";
import { resolveRecordedTeamLocation } from "./team-record-store.js";
import { getMemberAgentPath, resolveTeamLocation } from "./team-store.js";

export * from "./team-external-change-contract.js";

/**
 * Reads only the requested AGENT.md. Referenced files and the rest of the team
 * directory deliberately do not participate in external-change detection.
 */
export async function checkAgentTeamMemberExternalChange(
  dataRoot: string,
  rawRequest: unknown,
): Promise<AgentTeamExternalChangeResponse> {
  const request = parseExternalChangeRequest(rawRequest);
  if (request.ownership === "system") {
    return { status: "ignored" };
  }

  const location = await resolveRecordedTeamLocation(dataRoot, request.teamId);
  const agentMarkdown = await fs.readFile(getMemberAgentPath(location, request.memberSlug), "utf8");
  if (agentMarkdown === request.knownAgentMarkdown) {
    return { status: "unchanged" };
  }

  return {
    status: "changed",
    document: {
      slug: request.memberSlug,
      agentMarkdown,
      ...parseAgentMarkdownIdentity(agentMarkdown),
    },
  };
}

function parseExternalChangeRequest(value: unknown): AgentTeamExternalChangeRequest {
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
