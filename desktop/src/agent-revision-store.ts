import { randomUUID } from "node:crypto";

import { runSqliteStateCommand } from "../../src/sqlite-state.js";
import type { AgentMarkdownBlockOwnership } from "./agent-revision-plan.js";

export type AgentRevisionAuthorKind = "user" | "official" | "agent";
export type AgentRevisionSummaryStatus = "pending" | "ready" | "unavailable";

export interface AgentMarkdownRevision {
  revisionId: string;
  teamStableId: string;
  memberSlug: string;
  content: string;
  authorKind: AgentRevisionAuthorKind;
  authorLabel: string | null;
  /** Presentation-only paragraph ownership of this revision (see `agent-revision-plan.ts`). */
  blockOwnership: AgentMarkdownBlockOwnership[] | null;
  summary: string | null;
  summaryStatus: AgentRevisionSummaryStatus;
  batchId: string | null;
  createdAt: string;
}

export interface AgentRevisionStore {
  createRevision(input: {
    teamStableId: string;
    memberSlug: string;
    content: string;
    authorKind: AgentRevisionAuthorKind;
    authorLabel?: string | null;
    blockOwnership: AgentMarkdownBlockOwnership[] | null;
    summaryStatus: "pending" | "unavailable";
    batchId?: string | null;
    now: string;
  }): Promise<AgentMarkdownRevision>;
  /** Oldest first; the caller decides ordering for presentation. */
  listRevisions(teamStableId: string, memberSlug: string): Promise<AgentMarkdownRevision[]>;
  getRevision(revisionId: string): Promise<AgentMarkdownRevision | null>;
  updateSummary(revisionId: string, summary: string | null, summaryStatus: "ready" | "unavailable"): Promise<AgentMarkdownRevision>;
}

export function createAgentRevisionStore(input: { sqlitePath: string }): AgentRevisionStore {
  const run = <T>(command: Parameters<typeof runSqliteStateCommand<T>>[0]["command"]) =>
    runSqliteStateCommand<T>({ sqlitePath: input.sqlitePath, command });
  return {
    async createRevision(createInput) {
      return await run<AgentMarkdownRevision>({
        kind: "agent-revision-create",
        revisionId: randomUUID(),
        teamStableId: createInput.teamStableId,
        memberSlug: createInput.memberSlug,
        content: createInput.content,
        authorKind: createInput.authorKind,
        authorLabel: createInput.authorLabel ?? null,
        blockOwnershipJson: createInput.blockOwnership === null
          ? null
          : JSON.stringify(createInput.blockOwnership),
        summaryStatus: createInput.summaryStatus,
        batchId: createInput.batchId ?? null,
        now: createInput.now,
      });
    },
    async listRevisions(teamStableId, memberSlug) {
      return await run<AgentMarkdownRevision[]>({
        kind: "agent-revision-list",
        teamStableId,
        memberSlug,
      });
    },
    async getRevision(revisionId) {
      return await run<AgentMarkdownRevision | null>({
        kind: "agent-revision-get",
        revisionId,
      });
    },
    async updateSummary(revisionId, summary, summaryStatus) {
      return await run<AgentMarkdownRevision>({
        kind: "agent-revision-update-summary",
        revisionId,
        summary,
        summaryStatus,
        now: new Date().toISOString(),
      });
    },
  };
}
