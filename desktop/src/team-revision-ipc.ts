import type { AgentRevisionService } from "./agent-revision-service.js";
import type { AgentMarkdownRevision, AgentRevisionStore } from "./agent-revision-store.js";
import { resolveDefaultAgentProfile } from "./default-agent-plan.js";
import type { DefaultAgentConfigStore } from "./default-agent-config-store.js";
import type {
  AgentTeamDefaultAgentResponse,
  AgentTeamMemberRevisionsResponse,
  AgentTeamMemberRevisionRestoreResponse,
  AgentTeamRevisionView,
} from "./team-ipc-contract.js";
import {
  parseDefaultAgentSaveRequest,
  parseMemberRequest,
  parseMemberRevisionRestoreRequest,
} from "./team-service-plan.js";
import { resolveRecordedTeamLocation } from "./team-record-store.js";
import { resolveTeamLocation, writeMemberAgentMarkdown } from "./team-store.js";

export interface TeamRevisionIpcPorts {
  store: AgentRevisionStore;
  service: AgentRevisionService;
  defaultAgent: DefaultAgentConfigStore;
}

export function createTeamRevisionIpc(input: TeamRevisionIpcPorts & { dataRoot: string }) {
  return {
    async listMemberRevisions(raw: unknown): Promise<AgentTeamMemberRevisionsResponse> {
      const request = parseMemberRequest(raw);
      const revisions = await input.store.listRevisions(request.teamId, request.memberSlug);
      return planMemberRevisionsResponse(revisions);
    },
    async restoreMemberRevision(raw: unknown): Promise<AgentTeamMemberRevisionRestoreResponse> {
      const request = parseMemberRevisionRestoreRequest(raw);
      const target = await input.store.getRevision(request.revisionId);
      if (
        target === null
        || target.teamStableId !== request.teamId
        || target.memberSlug !== request.memberSlug
      ) {
        throw new Error("目标修订不存在或不属于这名成员。");
      }
      const location = request.ownership === "system"
        ? resolveTeamLocation({
            dataRoot: input.dataRoot,
            teamId: request.teamId,
            ownership: "system",
          })
        : await resolveRecordedTeamLocation(input.dataRoot, request.teamId);
      await writeMemberAgentMarkdown(location, request.memberSlug, target.content);
      // Restoring is itself a user change: it writes a new revision rather than
      // deleting or overwriting history.
      const revision = await input.service.recordMemberRevision({
        teamStableId: request.teamId,
        memberSlug: request.memberSlug,
        content: target.content,
        authorKind: "user",
        authorLabel: null,
        now: new Date().toISOString(),
      });
      return { agentMarkdown: target.content, revision: toRevisionView(revision, false) };
    },
    async getDefaultAgent(): Promise<AgentTeamDefaultAgentResponse> {
      const document = await input.defaultAgent.read();
      return {
        profile: resolveDefaultAgentProfile(document),
        saved: document.profile !== null,
      };
    },
    async saveDefaultAgent(raw: unknown): Promise<AgentTeamDefaultAgentResponse> {
      const profile = parseDefaultAgentSaveRequest(raw);
      const document = await input.defaultAgent.save(profile);
      return {
        profile: document.profile!,
        saved: true,
      };
    },
  };
}

export function planMemberRevisionsResponse(
  revisions: readonly AgentMarkdownRevision[],
): AgentTeamMemberRevisionsResponse {
  const latest = revisions.at(-1) ?? null;
  return {
    // The summary slot exists for every revision: pending / unavailable states
    // render a neutral placeholder (see agent-team-detail's recentChange line),
    // so the line is only absent before the member's first revision.
    recentChange: latest === null
      ? null
      : {
          summary: latest.summary,
          summaryStatus: latest.summaryStatus,
          authorLabel: latest.authorLabel ?? "",
          timeLabel: latest.createdAt,
        },
    changeMarkers: latest === null
      ? []
      : (latest.blockOwnership ?? []).map((block) => ({
          blockIndex: block.blockIndex,
          authorKind: block.authorKind,
          authorLabel: block.authorLabel,
          timeLabel: block.timeLabel,
          previousText: block.previousText,
        })),
    timeline: [...revisions].reverse().map((revision, index) =>
      toRevisionView(revision, index === revisions.length - 1)),
  };
}

function toRevisionView(
  revision: AgentMarkdownRevision,
  isEarliest: boolean,
): AgentTeamRevisionView {
  return {
    revisionId: revision.revisionId,
    authorKind: revision.authorKind,
    authorLabel: revision.authorLabel,
    summary: revision.summary,
    summaryStatus: revision.summaryStatus,
    timeLabel: revision.createdAt,
    isEarliest,
  };
}
