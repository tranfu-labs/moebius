import fs from "node:fs/promises";

import type { AgentTeamExternalChangeResponse } from "./team-external-change-contract.js";
import {
  decideExternalChange,
  parseExternalChangeRequest,
  planExternalChangeRead,
} from "./team-desktop-action-plan.js";
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
  const handlers = {
    ignored: async (): Promise<AgentTeamExternalChangeResponse> => ({ status: "ignored" }),
    read: async (): Promise<AgentTeamExternalChangeResponse> => {
      const location = await resolveRecordedTeamLocation(dataRoot, request.teamId);
      const agentMarkdown = await fs.readFile(
        getMemberAgentPath(location, request.memberSlug),
        "utf8",
      );
      const responses = {
        unchanged: (): AgentTeamExternalChangeResponse => ({ status: "unchanged" }),
        changed: (): AgentTeamExternalChangeResponse => ({
          status: "changed",
          document: {
            slug: request.memberSlug,
            agentMarkdown,
            ...parseAgentMarkdownIdentity(agentMarkdown),
          },
        }),
      };
      return responses[decideExternalChange(request.knownAgentMarkdown, agentMarkdown)]();
    },
  };
  return handlers[planExternalChangeRead(request.ownership)]();
}
