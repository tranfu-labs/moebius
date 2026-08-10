import {
  planAgentRevisionWrite,
  type AgentRevisionAuthorKind,
} from "./agent-revision-plan.js";
import type {
  AgentMarkdownRevision,
  AgentRevisionStore,
} from "./agent-revision-store.js";
import type { AgentRevisionSummaryJobInput } from "./agent-revision-summary-job.js";

export interface AgentRevisionServicePorts {
  store: Pick<AgentRevisionStore, "listRevisions" | "createRevision">;
  summarize: (input: AgentRevisionSummaryJobInput) => Promise<void>;
}

export interface AgentRevisionService {
  /**
   * Records one revision after an AGENT.md write succeeded (team page save or a
   * Finder external change that was read in). Synchronous: computes paragraph
   * ownership and persists the revision with a `pending` summary before the
   * caller's save feedback returns. The summary job is dispatched fire-and-forget.
   */
  recordMemberRevision(input: {
    teamStableId: string;
    memberSlug: string;
    content: string;
    authorKind: AgentRevisionAuthorKind;
    authorLabel: string | null;
    now: string;
  }): Promise<AgentMarkdownRevision>;
}

export function createAgentRevisionService(ports: AgentRevisionServicePorts): AgentRevisionService {
  return {
    async recordMemberRevision(input) {
      const revisions = await ports.store.listRevisions(input.teamStableId, input.memberSlug);
      const plan = planAgentRevisionWrite({
        revisions,
        nextContent: input.content,
        authorKind: input.authorKind,
        authorLabel: input.authorLabel,
        now: input.now,
      });
      const revision = await ports.store.createRevision({
        teamStableId: input.teamStableId,
        memberSlug: input.memberSlug,
        content: input.content,
        authorKind: input.authorKind,
        authorLabel: plan.authorLabel,
        blockOwnership: plan.blockOwnership,
        summaryStatus: "pending",
        now: plan.now,
      });
      void ports.summarize({
        revisionId: revision.revisionId,
        teamStableId: input.teamStableId,
        memberSlug: input.memberSlug,
        previousContent: plan.previousContent,
        content: input.content,
      }).catch(() => undefined);
      return revision;
    },
  };
}
