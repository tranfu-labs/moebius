/**
 * Presentation-only paragraph ownership for AGENT.md revisions.
 *
 * IMPORTANT boundary (see `openspec/changes/agent-md-revision-and-default-agent/design.md`
 * 「权衡」): block splitting here exists ONLY so the editor can render change markers and
 * inline "previous text". It MUST stay an independent implementation from
 * `packages/console-ui`'s `computeMarkdownBlocks` — duplication is deliberate — and its
 * output MUST NOT be consumed by any merge logic (merge always operates on whole files).
 * Splitting mistakes cost a misplaced marker, never a wrong merge.
 */

export interface AgentMarkdownBlock {
  start: number;
  end: number;
}

/**
 * Splits Markdown into paragraph blocks separated by one or more blank lines.
 * Semantics mirror `packages/console-ui/src/console/agent-markdown-mention-editor.tsx`
 * `computeMarkdownBlocks`: no heading assumptions — a document with no blank line
 * (e.g. `seeds/general-assistant`'s headless `AGENT.md`) yields exactly one block.
 */
export function computeAgentMarkdownBlocks(value: string): AgentMarkdownBlock[] {
  const blocks: AgentMarkdownBlock[] = [];
  const boundary = /\n[ \t]*\n+/gu;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(value)) !== null) {
    blocks.push({ start: cursor, end: match.index });
    cursor = match.index + match[0].length;
  }
  blocks.push({ start: cursor, end: value.length });
  return blocks;
}

export type AgentRevisionAuthorKind = "user" | "official" | "agent";

export interface AgentMarkdownBlockOwnership {
  blockIndex: number;
  authorKind: AgentRevisionAuthorKind;
  authorLabel: string;
  timeLabel: string;
  /** The block's text in the previous revision, when this revision changed it. */
  previousText: string | null;
}

export interface AgentRevisionOwnershipPlan {
  blocks: AgentMarkdownBlockOwnership[];
}

/**
 * Given the previous revision's content + ownership table (or a plain baseline
 * with NO known owners) and the next full content, assigns each paragraph
 * block its author for the new revision:
 * - blocks whose text is unchanged carry the previous author forward;
 * - blocks whose text is unchanged but have NO known owner (a baseline, or an
 *   ownership-unknown starting revision) stay ownerless — they render without
 *   a marker and never turn into "changed" on a later save;
 * - changed blocks (including newly inserted ones) take this revision's author
 *   and keep the previous text for inline expansion.
 * The very first revision of a brand-new member (no baseline, no previous
 * revision) owns everything.
 */
export function planAgentRevisionOwnership(input: {
  previous: { content: string; ownership: AgentMarkdownBlockOwnership[] | null } | null;
  nextContent: string;
  authorKind: AgentRevisionAuthorKind;
  authorLabel: string;
  timeLabel: string;
}): AgentRevisionOwnershipPlan {
  const nextBlocks = computeAgentMarkdownBlocks(input.nextContent);
  if (input.previous === null) {
    return {
      blocks: nextBlocks.flatMap((block, blockIndex) => {
        // Skip zero-length trailing blocks (see the empty-block note below).
        if (input.nextContent.slice(block.start, block.end).length === 0) {
          return [];
        }
        return [{
          blockIndex,
          authorKind: input.authorKind,
          authorLabel: input.authorLabel,
          timeLabel: input.timeLabel,
          previousText: null,
        }];
      }),
    };
  }
  const previousBlocks = computeAgentMarkdownBlocks(input.previous.content);
  const previous = input.previous;
  const blocks: AgentMarkdownBlockOwnership[] = [];
  for (const [blockIndex, block] of nextBlocks.entries()) {
    const nextText = input.nextContent.slice(block.start, block.end);
    // An empty trailing block (the editor serialization can end with a blank
    // line, which the boundary regex turns into a zero-length block) can never
    // be a real change: skipping it keeps the mechanical summary count equal
    // to the marker bands the user actually sees.
    if (nextText.length === 0) {
      continue;
    }
    const previousBlock = previousBlocks[blockIndex];
    const previousText = previousBlock === undefined
      ? null
      : previous.content.slice(previousBlock.start, previousBlock.end);
    // A paragraph moving from "last block" to "intermediate block" (a new
    // paragraph appended below it) changes only its trailing line break — the
    // block-boundary artifact, not a content change. Normalize it for the
    // equality comparison so the marker never fires on an untouched paragraph.
    if (
      previousBlock !== undefined
      && stripTrailingLineBreaks(previousText ?? "") === stripTrailingLineBreaks(nextText)
    ) {
      // Ownership entries are COMPACT (a baseline leaves ownerless blocks out),
      // so the array index does not equal the block index — look up by field.
      const previousOwnership = previous.ownership?.find((entry) => entry.blockIndex === blockIndex);
      if (previousOwnership !== undefined) {
        blocks.push({ ...previousOwnership, blockIndex });
      }
      // Unchanged with no known owner (baseline / ownership-unknown starting
      // revision): stays ownerless, i.e. no marker and no fake author.
      continue;
    }
    blocks.push({
      blockIndex,
      authorKind: input.authorKind,
      authorLabel: input.authorLabel,
      timeLabel: input.timeLabel,
      previousText,
    });
  }
  return { blocks };
}

function stripTrailingLineBreaks(value: string): string {
  return value.replace(/\n+$/u, "");
}

export interface AgentRevisionWritePlan {
  /** Content of the previous revision for the summary job's before/after view. */
  previousContent: string | null;
  authorLabel: string;
  blockOwnership: AgentMarkdownBlockOwnership[];
  now: string;
}

export interface AgentMarkdownRevisionTimelineSlice {
  timeline: readonly {
    revisionId: string;
    summaryStatus: "pending" | "ready" | "unavailable";
    timeLabel: string;
  }[];
}

/**
 * Decides whether a summary-settled push must refresh a member's revisions,
 * and which member that is. Returns `null` unless the refresh would surface
 * something the loaded view does not already show, which keeps repeated or
 * stale deliveries free of side effects (the 655b940b restore-explosion
 * lesson: a state change that loops back into another state change is a
 * feedback loop; identical terminal state must never produce a new state
 * object):
 *
 * - the team catalog is materialized and contains the event's team,
 * - the member's revisions are currently loaded (a member that was never
 *   opened — or whose entry is null mid-reload — has nothing visible to
 *   update; its in-flight or later load already carries the terminal state),
 * - the loaded view does not already reflect the event:
 *   - the loaded timeline is empty (the event's revision exists in the store
 *     while the view still shows "no revisions"),
 *   - the event's revision IS the loaded latest and it is still `pending`
 *     (redelivery of an already-settled revision is a no-op),
 *   - the event's revision is NEWER than the loaded latest (the view is
 *     stale — e.g. a save refresh still in flight when the job settled;
 *     dropping the event here would leave the line pending forever).
 *
 * An event for an OLDER revision than the loaded latest is skipped: the newer
 * revision's own job emits its own event.
 */
export function planSummarySettledTarget(input: {
  catalog:
    | { status: "ready"; teams: readonly { id: string; teamKey: string }[] }
    | { status: "loading" }
    | { status: "error" }
    | { status: "configuration-error" };
  revisions: Readonly<Record<string, Readonly<Record<string, AgentMarkdownRevisionTimelineSlice | null | undefined>>>>;
  payload: { teamStableId: string; memberSlug: string; revisionId: string; createdAt?: string };
}): { teamKey: string; memberSlug: string } | null {
  if (input.catalog.status !== "ready") {
    return null;
  }
  const team = input.catalog.teams.find((candidate) => candidate.id === input.payload.teamStableId);
  if (team === undefined) {
    return null;
  }
  const loaded = input.revisions[team.teamKey]?.[input.payload.memberSlug];
  if (loaded === null || loaded === undefined) {
    return null;
  }
  const latest = loaded.timeline[0];
  if (latest === undefined) {
    return { teamKey: team.teamKey, memberSlug: input.payload.memberSlug };
  }
  if (latest.revisionId === input.payload.revisionId) {
    return latest.summaryStatus === "pending"
      ? { teamKey: team.teamKey, memberSlug: input.payload.memberSlug }
      : null;
  }
  if (
    input.payload.createdAt !== undefined
    && input.payload.createdAt > latest.timeLabel
  ) {
    return { teamKey: team.teamKey, memberSlug: input.payload.memberSlug };
  }
  return null;
}

/**
 * Plans the durable write of one revision from the member's existing revision
 * list: normalizes optional inputs, derives paragraph ownership from the latest
 * revision — or, for the FIRST revision of a member whose file already had
 * persisted content (the pre-write disk text, or the app's last known content
 * for an external change), from that baseline — and decides the summary job's
 * previous-content input. The baseline MUST be the persisted content from
 * BEFORE this write: comparing the first revision against it makes markers and
 * the mechanical summary reflect only what actually changed, instead of
 * claiming the whole document is new (the product-review 4-blocker). Pure; the
 * service only executes the plan and never branches on optional shapes itself.
 */
export function planAgentRevisionWrite(input: {
  revisions: readonly {
    content: string;
    blockOwnership: AgentMarkdownBlockOwnership[] | null;
  }[];
  nextContent: string;
  authorKind: AgentRevisionAuthorKind;
  authorLabel: string | null;
  now: string;
  /** Pre-write persisted content; used only when the member has no revision yet. */
  baselineContent?: string | null;
}): AgentRevisionWritePlan {
  const previous = input.revisions.at(-1) ?? null;
  const baseline = previous === null
    && input.baselineContent !== null
    && input.baselineContent !== undefined
    ? { content: input.baselineContent, ownership: null as AgentMarkdownBlockOwnership[] | null }
    : null;
  const authorLabel = input.authorLabel ?? "";
  const ownership = planAgentRevisionOwnership({
    previous: previous === null
      ? baseline
      : { content: previous.content, ownership: previous.blockOwnership },
    nextContent: input.nextContent,
    authorKind: input.authorKind,
    authorLabel,
    timeLabel: input.now,
  });
  return {
    previousContent: (previous ?? baseline)?.content ?? null,
    authorLabel,
    blockOwnership: ownership.blocks,
    now: input.now,
  };
}
