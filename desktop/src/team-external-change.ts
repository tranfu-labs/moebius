import fs from "node:fs/promises";

import type { AgentTeamExternalChangeResponse } from "./team-external-change-contract.js";
import {
  decideExternalChange,
  parseExternalChangeRequest,
  planExternalChangeRead,
} from "./team-desktop-action-plan.js";
import { parseAgentMarkdownIdentity } from "./team-model.js";
import { resolveRecordedTeamLocation } from "./team-record-store.js";
import { getMemberAgentPath } from "./team-store.js";
import type { AgentRevisionService } from "./agent-revision-service.js";

export * from "./team-external-change-contract.js";

/**
 * Reads only the requested AGENT.md. Referenced files and the rest of the team
 * directory deliberately do not participate in external-change detection. When
 * a Finder change is detected (and therefore read in as the effective content),
 * the change is recorded as a `user`-authored revision, equivalent to an
 * in-app save.
 */
export async function checkAgentTeamMemberExternalChange(
  dataRoot: string,
  rawRequest: unknown,
  revisionService?: AgentRevisionService,
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
        changed: (): AgentTeamExternalChangeResponse => {
          void revisionService?.recordMemberRevision({
            teamStableId: location.id,
            memberSlug: request.memberSlug,
            content: agentMarkdown,
            authorKind: "user",
            authorLabel: null,
            now: new Date().toISOString(),
          }).catch(() => undefined);
          return {
            status: "changed",
            document: {
              slug: request.memberSlug,
              agentMarkdown,
              ...parseAgentMarkdownIdentity(agentMarkdown),
            },
          };
        },
      };
      return responses[decideExternalChange(request.knownAgentMarkdown, agentMarkdown)]();
    },
  };
  return handlers[planExternalChangeRead(request.ownership)]();
}
