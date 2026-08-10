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
 * Given the previous revision's content + ownership table and the next full
 * content, assigns each paragraph block its author for the new revision:
 * blocks whose text is unchanged carry the previous author forward; changed
 * blocks (including newly inserted ones) take this revision's author and keep
 * the previous text for inline expansion. First revision owns everything.
 */
export function planAgentRevisionOwnership(input: {
  previous: { content: string; ownership: AgentMarkdownBlockOwnership[] } | null;
  nextContent: string;
  authorKind: AgentRevisionAuthorKind;
  authorLabel: string;
  timeLabel: string;
}): AgentRevisionOwnershipPlan {
  const nextBlocks = computeAgentMarkdownBlocks(input.nextContent);
  if (input.previous === null) {
    return {
      blocks: nextBlocks.map((block, blockIndex) => ({
        blockIndex,
        authorKind: input.authorKind,
        authorLabel: input.authorLabel,
        timeLabel: input.timeLabel,
        previousText: null,
      })),
    };
  }
  const previousBlocks = computeAgentMarkdownBlocks(input.previous.content);
  const previous = input.previous;
  return {
    blocks: nextBlocks.map((block, blockIndex) => {
      const previousBlock = previousBlocks[blockIndex];
      const previousOwnership = previous.ownership[blockIndex];
      const nextText = input.nextContent.slice(block.start, block.end);
      const previousText = previousBlock === undefined
        ? null
        : previous.content.slice(previousBlock.start, previousBlock.end);
      if (previousBlock !== undefined && previousText === nextText) {
        return previousOwnership === undefined
          ? {
              blockIndex,
              authorKind: input.authorKind,
              authorLabel: input.authorLabel,
              timeLabel: input.timeLabel,
              previousText: null,
            }
          : { ...previousOwnership, blockIndex };
      }
      return {
        blockIndex,
        authorKind: input.authorKind,
        authorLabel: input.authorLabel,
        timeLabel: input.timeLabel,
        previousText,
      };
    }),
  };
}

export interface AgentRevisionWritePlan {
  /** Content of the previous revision for the summary job's before/after view. */
  previousContent: string | null;
  authorLabel: string;
  blockOwnership: AgentMarkdownBlockOwnership[];
  now: string;
}

/**
 * Plans the durable write of one revision from the member's existing revision
 * list: normalizes optional inputs, derives paragraph ownership from the latest
 * revision (or the whole document for the first revision) and decides the
 * summary job's previous-content input. Pure; the service only executes the
 * plan and never branches on optional shapes itself.
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
}): AgentRevisionWritePlan {
  const previous = input.revisions.at(-1) ?? null;
  const authorLabel = input.authorLabel ?? "";
  const ownership = planAgentRevisionOwnership({
    previous: previous === null
      ? null
      : { content: previous.content, ownership: previous.blockOwnership ?? [] },
    nextContent: input.nextContent,
    authorKind: input.authorKind,
    authorLabel,
    timeLabel: input.now,
  });
  return {
    previousContent: previous?.content ?? null,
    authorLabel,
    blockOwnership: ownership.blocks,
    now: input.now,
  };
}
