import { Check, Copy } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

import { cn } from "@/lib/utils";
import { useI18n, type Translate } from "@/i18n";

export interface AgentMentionMember {
  slug: string;
  displayName: string;
}

export interface AgentMentionTrigger {
  start: number;
  end: number;
  query: string;
}

export type AgentMentionSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; member: AgentMentionMember };

/**
 * Marks one paragraph block (see `computeMarkdownBlocks`) as changed by a
 * revision. `blockIndex` is presentation-only — see the design tradeoffs
 * section of `openspec/changes/agent-md-revision-and-default-agent/`: block
 * splitting here MUST NOT be reused as a merge unit, only for where the
 * marker renders.
 */
export interface AgentMarkdownChangeMarker {
  blockIndex: number;
  authorKind: "user" | "official" | "agent";
  authorLabel: string;
  timeLabel: string;
  previousText?: string | null;
}

export interface AgentMarkdownMentionEditorProps {
  id?: string;
  value: string;
  members: readonly AgentMentionMember[];
  label: string;
  readOnly?: boolean;
  disabled?: boolean;
  /** Presentational change markers keyed by paragraph block index; omit entirely to keep today's plain rendering. */
  changeMarkers?: readonly AgentMarkdownChangeMarker[];
  onValueChange(value: string): void;
}

/**
 * Splits Markdown into paragraph blocks separated by one or more blank lines.
 * Does not assume any heading structure — a document with no blank line
 * (e.g. `seeds/general-assistant`'s headless `AGENT.md`) yields exactly one
 * block. Presentation-only; see `AgentMarkdownChangeMarker` above.
 */
export function computeMarkdownBlocks(value: string): Array<{ start: number; end: number }> {
  const blocks: Array<{ start: number; end: number }> = [];
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

const slugQueryPattern = /^[A-Za-z0-9._-]*$/u;
const slugBoundaryPattern = /[A-Za-z0-9._-]/u;

export function findAgentMentionTrigger(text: string, cursor: number): AgentMentionTrigger | null {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const beforeCursor = text.slice(0, safeCursor);
  const atIndex = beforeCursor.lastIndexOf("@");
  if (atIndex < 0 || !hasMentionBoundaryBefore(text, atIndex)) {
    return null;
  }

  const query = beforeCursor.slice(atIndex + 1);
  if (!slugQueryPattern.test(query)) {
    return null;
  }

  return { start: atIndex, end: safeCursor, query: query.toLocaleLowerCase() };
}

export function matchingAgentMentionMembers(
  members: readonly AgentMentionMember[],
  query: string,
): AgentMentionMember[] {
  const normalizedQuery = query.toLocaleLowerCase();
  return members.filter((member) => member.slug.toLocaleLowerCase().startsWith(normalizedQuery));
}

export function insertAgentMention(
  text: string,
  cursor: number,
  memberSlug: string,
): { value: string; cursor: number } {
  const trigger = findAgentMentionTrigger(text, cursor);
  if (trigger === null) {
    return { value: text, cursor };
  }

  const nextCharacter = text[trigger.end];
  const trailingSpace = nextCharacter === undefined || !/\s/u.test(nextCharacter) ? " " : "";
  const replacement = `@${memberSlug}${trailingSpace}`;
  return {
    value: `${text.slice(0, trigger.start)}${replacement}${text.slice(trigger.end)}`,
    cursor: trigger.start + replacement.length,
  };
}

export function segmentAgentMentions(
  text: string,
  members: readonly AgentMentionMember[],
): AgentMentionSegment[] {
  const candidates = [...members]
    .filter((member) => member.slug.length > 0)
    .sort((left, right) => right.slug.length - left.slug.length);
  const segments: AgentMentionSegment[] = [];
  let textStart = 0;
  let cursor = 0;

  while (cursor < text.length) {
    if (text[cursor] !== "@" || !hasMentionBoundaryBefore(text, cursor)) {
      cursor += 1;
      continue;
    }

    const member = candidates.find((candidate) => {
      const end = cursor + candidate.slug.length + 1;
      return text.startsWith(`@${candidate.slug}`, cursor) && hasMentionBoundaryAfter(text, end);
    });
    if (member === undefined) {
      cursor += 1;
      continue;
    }

    if (cursor > textStart) {
      segments.push({ kind: "text", text: text.slice(textStart, cursor) });
    }
    segments.push({ kind: "mention", member });
    cursor += member.slug.length + 1;
    textStart = cursor;
  }

  if (textStart < text.length || segments.length === 0) {
    segments.push({ kind: "text", text: text.slice(textStart) });
  }
  return segments;
}

export function AgentMarkdownMentionEditor({
  id,
  value,
  members,
  label,
  readOnly = false,
  disabled = false,
  changeMarkers,
  onValueChange,
}: AgentMarkdownMentionEditorProps): JSX.Element {
  const { t } = useI18n();
  const editorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mirrorTextRef = useRef<HTMLSpanElement>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const composingRef = useRef(false);
  const listboxId = useId();
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const [activeIndex, setActiveIndex] = useState(0);
  const [closedTriggerKey, setClosedTriggerKey] = useState<string | null>(null);
  const [expandedBlocks, setExpandedBlocks] = useState<ReadonlySet<number>>(new Set());
  const [anchorRects, setAnchorRects] = useState<ReadonlyMap<number, { top: number; height: number }>>(new Map());
  const [mirrorContentTop, setMirrorContentTop] = useState(0);
  const blocks = useMemo(() => computeMarkdownBlocks(value), [value]);
  const trigger = findAgentMentionTrigger(value, caret);
  const triggerKey = trigger === null ? null : `${trigger.start}:${trigger.end}:${trigger.query}`;
  const matches = trigger === null ? [] : matchingAgentMentionMembers(members, trigger.query);
  const panelOpen = focused
    && !readOnly
    && !disabled
    && trigger !== null
    && matches.length > 0
    && closedTriggerKey !== triggerKey;

  useEffect(() => {
    setActiveIndex(0);
  }, [triggerKey, matches.length]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (editor === null || pendingCaretRef.current === null) {
      return;
    }
    const nextCaret = pendingCaretRef.current;
    pendingCaretRef.current = null;
    editor.focus();
    setEditorCaret(editor, nextCaret);
  }, [members, value]);

  // The editable region renders exactly ONE text node (`{value}`): Chromium
  // merges adjacent text nodes inside contentEditable and detaches
  // contentEditable=false children while editing, both of which make React's
  // next commit throw "removeChild is not a child of this node" and unmount
  // the whole tree (Electron 38 / Chromium 136, React 18). Block geometry for
  // the marker overlay is therefore measured on an invisible, non-editable
  // MIRROR of the content instead of anchors inside the editable region.
  useLayoutEffect(() => {
    const editor = editorRef.current;
    const mirrorText = mirrorTextRef.current;
    if (editor === null || mirrorText === null || changeMarkers === undefined) {
      setAnchorRects(new Map());
      return;
    }
    const measure = () => {
      const textNode = mirrorText.firstChild;
      if (textNode === null || textNode.nodeType !== Node.TEXT_NODE) {
        setAnchorRects(new Map());
        return;
      }
      const mirrorRect = mirrorText.getBoundingClientRect();
      const editorRect = editor.getBoundingClientRect();
      const mirrorTop = mirrorRect.top - editorRect.top;
      const range = document.createRange();
      const firstRect = measureRangeTop(range, textNode, 0);
      if (firstRect === null) {
        // jsdom: no layout, all rects are 0×0 — use a line-index estimate so
        // the overlay still renders in unit tests.
        setMirrorContentTop(mirrorTop);
        setAnchorRects(new Map(
          blocks.map((block, blockIndex) => {
            if (block.end <= block.start) {
              return null;
            }
            return [blockIndex, estimateBlockMetrics(value, block)] as const;
          }).filter((entry): entry is readonly [number, { top: number; height: number }] => entry !== null),
        ));
        return;
      }
      const next = new Map<number, { top: number; height: number }>();
      blocks.forEach((block, blockIndex) => {
        if (block.end <= block.start) {
          return;
        }
        const probeOffset = Math.min(block.start, block.end - 1);
        const blockRect = measureRangeTop(range, textNode, probeOffset);
        // jsdom has no layout (all rects are 0×0): fall back to a line-index
        // estimate so the overlay still renders in unit tests. In real
        // browsers this branch only fires for offsets sitting on a newline.
        if (blockRect === null) {
          next.set(blockIndex, estimateBlockMetrics(value, block));
          return;
        }
        next.set(blockIndex, {
          top: blockRect - firstRect,
          height: measureRangeHeight(range, textNode, probeOffset, block.end),
        });
      });
      setMirrorContentTop(mirrorTop);
      setAnchorRects(next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(editor);
    observer.observe(mirrorText);
    return () => observer.disconnect();
  }, [blocks, changeMarkers, value]);

  const updateCaret = () => {
    const editor = editorRef.current;
    const selection = editor === null ? null : getEditorSelection(editor);
    if (selection !== null) {
      setCaret(selection.end);
    }
  };

  const commitValue = (nextValue: string, nextCaret: number) => {
    pendingCaretRef.current = nextCaret;
    setCaret(nextCaret);
    setClosedTriggerKey(null);
    onValueChange(nextValue);
  };

  const selectMember = (member: AgentMentionMember) => {
    const next = insertAgentMention(value, caret, member.slug);
    if (next.value !== value) {
      commitValue(next.value, next.cursor);
    }
  };

  const replaceSelection = (insertedText: string) => {
    const editor = editorRef.current;
    const selection = editor === null ? null : getEditorSelection(editor);
    const start = selection?.start ?? caret;
    const end = selection?.end ?? caret;
    const nextValue = `${value.slice(0, start)}${insertedText}${value.slice(end)}`;
    commitValue(nextValue, start + insertedText.length);
  };

  const handleInput = (event: FormEvent<HTMLDivElement>) => {
    if (composingRef.current) {
      return;
    }
    const editor = event.currentTarget;
    const nextValue = serializeMentionEditor(editor);
    const selection = getEditorSelection(editor);
    commitValue(nextValue, selection?.end ?? nextValue.length);
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    if (readOnly || disabled) {
      return;
    }
    event.preventDefault();
    replaceSelection(event.clipboardData.getData("text/plain"));
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (panelOpen && event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % matches.length);
      return;
    }
    if (panelOpen && event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + matches.length) % matches.length);
      return;
    }
    if (panelOpen && event.key === "Enter") {
      event.preventDefault();
      const member = matches[activeIndex];
      if (member !== undefined) {
        selectMember(member);
      }
      return;
    }
    if (panelOpen && event.key === "Escape") {
      event.preventDefault();
      setClosedTriggerKey(triggerKey);
      return;
    }
    if (!readOnly && !disabled && event.key === "Enter") {
      event.preventDefault();
      replaceSelection("\n");
    }
  };

  return (
    <div ref={containerRef} className="relative mt-2">
      <div
        id={id}
        ref={editorRef}
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        aria-autocomplete="list"
        aria-expanded={panelOpen}
        aria-controls={panelOpen ? listboxId : undefined}
        aria-activedescendant={panelOpen ? `${listboxId}-${activeIndex}` : undefined}
        aria-readonly={readOnly}
        aria-disabled={disabled}
        contentEditable={!readOnly && !disabled}
        suppressContentEditableWarning
        spellCheck={false}
        data-raw-markdown={value}
        className={cn(
          "min-h-[300px] w-full overflow-y-auto whitespace-pre-wrap break-words border border-line-strong bg-input px-4 py-3 font-sans text-sm leading-6 text-ink outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/10",
          (readOnly || disabled) && "cursor-not-allowed bg-sunken text-sub",
        )}
        onInput={handleInput}
        onCompositionStart={() => {
          composingRef.current = true;
          pendingCaretRef.current = null;
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          const editor = event.currentTarget;
          const nextValue = serializeMentionEditor(editor);
          const selection = getEditorSelection(editor);
          commitValue(nextValue, selection?.end ?? nextValue.length);
        }}
        onPaste={handlePaste}
        onFocus={() => {
          setFocused(true);
          updateCaret();
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setFocused(false);
          }
        }}
        onClick={updateCaret}
        onKeyDown={handleKeyDown}
        onKeyUp={updateCaret}
      >
        {value}
      </div>

      {/* Invisible non-editable mirror used ONLY for measuring block geometry
          (see the measurement comment above). It mirrors the editor's content
          layout so Range rects line up with the real text; it is never
          interactive and never contains contentEditable=false nodes. */}
      <div
        aria-hidden="true"
        className="invisible pointer-events-none absolute inset-x-0 top-0 w-full whitespace-pre-wrap break-words bg-input px-4 py-3 font-sans text-sm leading-6 text-ink"
      >
        <span ref={mirrorTextRef}>{value}</span>
      </div>

      {changeMarkers !== undefined && anchorRects.size > 0 ? (
        <ChangeMarkerOverlay
          editorRef={editorRef}
          blocks={blocks}
          markers={changeMarkers}
          anchorRects={anchorRects}
          mirrorContentTop={mirrorContentTop}
          expandedBlocks={expandedBlocks}
          onToggleExpanded={(blockIndex) => setExpandedBlocks((current) => {
            const next = new Set(current);
            if (next.has(blockIndex)) next.delete(blockIndex); else next.add(blockIndex);
            return next;
          })}
          renderPreviousText={t}
        />
      ) : null}

      {panelOpen ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={t("console.mentionEditor.completions")}
          className="absolute left-2 top-full z-40 mt-2 w-[min(360px,calc(100%-1rem))] rounded-lg border border-line bg-sunken p-1.5"
        >
          {matches.map((member, index) => (
            <button
              key={member.slug}
              id={`${listboxId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={cn(
                "flex w-full items-center justify-between gap-4 rounded-lg px-2.5 py-2 text-left hover:bg-hover",
                index === activeIndex && "bg-sel",
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                selectMember(member);
              }}
            >
              <span className="truncate text-sm font-normal text-ink">{member.displayName || `@${member.slug}`}</span>
              <span className="shrink-0 text-xs text-hint">@{member.slug}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface ChangeMarkerOverlayProps {
  editorRef: RefObject<HTMLDivElement | null>;
  blocks: ReadonlyArray<{ start: number; end: number }>;
  markers: readonly AgentMarkdownChangeMarker[];
  anchorRects: ReadonlyMap<number, { top: number; height: number }>;
  /** Distance from the editor's border-box top to the mirror text's first line. */
  mirrorContentTop: number;
  expandedBlocks: ReadonlySet<number>;
  onToggleExpanded(blockIndex: number): void;
  renderPreviousText: Translate;
}

/**
 * Renders change markers OUTSIDE the contentEditable region. Block vertical
 * positions come from the mirror measurement (see the measurement comment in
 * `AgentMarkdownMentionEditor`); scrolling only shifts the markers by the
 * editor's scrollTop, so marker updates never re-render the editable tree.
 */
function ChangeMarkerOverlay({
  editorRef,
  blocks,
  markers,
  anchorRects,
  mirrorContentTop,
  expandedBlocks,
  onToggleExpanded,
  renderPreviousText: t,
}: ChangeMarkerOverlayProps): JSX.Element {
  const [scrollTop, setScrollTop] = useState(0);
  const [editorHeight, setEditorHeight] = useState(0);
  const scrollFrameRef = useRef<number | null>(null);
  const [overlayTop, setOverlayTop] = useState(0);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null) {
      return;
    }
    const measureEditor = () => {
      const rect = editor.getBoundingClientRect();
      setEditorHeight(rect.height);
      setOverlayTop(rect.top);
    };
    measureEditor();
    const handleScroll = () => {
      if (scrollFrameRef.current !== null) {
        return;
      }
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        setScrollTop(editor.scrollTop);
      });
    };
    editor.addEventListener("scroll", handleScroll);
    window.addEventListener("resize", handleScroll);
    return () => {
      editor.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, [editorRef]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {blocks.map((block, blockIndex) => {
        const marker = markers.find((candidate) => candidate.blockIndex === blockIndex);
        if (marker === undefined) return null;
        const rect = anchorRects.get(blockIndex);
        if (rect === undefined) return null;
        const top = mirrorContentTop + rect.top - scrollTop - 8;
        if (top < -64 || (editorHeight > 0 && top > editorHeight + 8)) {
          return null;
        }
        // The layer carries real block height so the rail spans the block and
        // the hover/focus reveal has a physical target: a zero-size layer
        // makes every descendant unreachable by a real pointer (elementFromPoint
        // hits nothing) and renders the rail with zero height.
        const layerTop = Math.max(0, top);
        const layerHeight = editorHeight > 0
          ? Math.max(0, Math.min(rect.height + 8, editorHeight - layerTop - 8))
          : Math.max(0, rect.height + 8);
        const expanded = expandedBlocks.has(blockIndex);
        return (
          <div
            key={`marker-layer-${blockIndex}`}
            data-change-marker="true"
            className="group/marker pointer-events-auto absolute left-0 w-3"
            style={{ top: `${layerTop}px`, height: `${layerHeight}px` }}
          >
            {/* `--accent` is a plain CSS variable, so Tailwind's `/50` opacity
                modifier never compiles for it (no `accent/50` rule exists in the
                bundle and the class silently does nothing); the rail color is
                derived from the token with color-mix instead. */}
            <div
              className="absolute -left-px top-0 bottom-0 w-0.5 bg-[color-mix(in_srgb,var(--accent)_50%,transparent)]"
              data-change-marker-rail="true"
              aria-hidden="true"
            />
            {/* Attribution and the expand control are hidden by default and
                revealed by hovering the rail band or by keyboard focus; while
                hidden the row must stay pointer-events-none so it never blocks
                text selection on the block's first line. The whole revealed row
                is hit-testable (no dead gap between the attribution and the
                button), and focus-within keeps it visible while the button has
                focus. */}
            <div
              data-change-marker-row="true"
              className="pointer-events-none absolute left-2 top-0 flex select-none items-center gap-2 text-xs text-hint opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover/marker:pointer-events-auto group-hover/marker:opacity-100 group-focus-within/marker:pointer-events-auto group-focus-within/marker:opacity-100"
            >
              <span className="whitespace-nowrap" aria-hidden="true">
                {marker.authorLabel} · {marker.timeLabel}
              </span>
              {marker.previousText != null && marker.previousText.length > 0 ? (
                <button
                  type="button"
                  className="whitespace-nowrap hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)]"
                  aria-expanded={expanded}
                  onClick={() => onToggleExpanded(blockIndex)}
                >
                  {expanded
                    ? t("console.mentionEditor.changeMarkerCollapse")
                    : t("console.mentionEditor.changeMarkerExpand")}
                </button>
              ) : null}
            </div>
            {expanded && marker.previousText != null && marker.previousText.length > 0 ? (
              <div
                className="absolute left-2 top-2 whitespace-pre-wrap rounded-sm border-l border-line bg-sunken px-2.5 py-2 text-xs leading-5 text-sub"
                style={{ minWidth: "min(420px, calc(100vw - 4rem))" }}
              >
                {marker.previousText}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function measureRangeTop(range: Range, textNode: Node, offset: number): number | null {
  try {
    range.setStart(textNode, Math.min(offset, textNode.textContent?.length ?? 0));
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return null;
    }
    return rect.top;
  } catch {
    return null;
  }
}

/**
 * Height of the text covered by the block, measured as the bounding rect of a
 * non-collapsed range from the probe offset to the block end. Returns 0 when
 * the environment has no layout (jsdom), where the caller falls back to
 * `estimateBlockMetrics`.
 */
function measureRangeHeight(range: Range, textNode: Node, start: number, end: number): number {
  try {
    const length = textNode.textContent?.length ?? 0;
    range.setStart(textNode, Math.min(start, length));
    range.setEnd(textNode, Math.min(end, length));
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return 0;
    }
    return rect.height;
  } catch {
    return 0;
  }
}

/**
 * Layout-free estimate of a block's top and height from line counts (used in
 * jsdom and for probe offsets that sit on a newline). Line height is the
 * editor's leading-6 (24px); the +8 matches the overlay's -8 lead-in so the
 * rail's bottom lands flush with the block's last line box.
 */
function estimateBlockMetrics(
  value: string,
  block: { start: number; end: number },
): { top: number; height: number } {
  const linesBefore = value.slice(0, block.start).split("\n").length - 1;
  const linesInBlock = value.slice(block.start, block.end).split("\n").length;
  return { top: linesBefore * 24, height: linesInBlock * 24 + 8 };
}

export function CopyableAgentSlug({ slug, className }: { slug: string; className?: string }): JSX.Element {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-hint hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
        className,
      )}
      aria-label={t("console.mentionEditor.copy", { slug })}
      title={t("console.mentionEditor.copy", { slug })}
      onClick={async () => {
        if (await copyPlainText(`@${slug}`)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      <span>@{slug}</span>
      {copied ? <Check className="h-3 w-3" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
      <span className="sr-only" aria-live="polite">{copied ? t("console.mentionEditor.copied") : ""}</span>
    </button>
  );
}

async function copyPlainText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy copy path for environments without clipboard permission.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = typeof document.execCommand === "function" && document.execCommand("copy");
  textarea.remove();
  return copied;
}

function hasMentionBoundaryBefore(text: string, atIndex: number): boolean {
  const previous = text[atIndex - 1];
  return previous === undefined || !slugBoundaryPattern.test(previous);
}

function hasMentionBoundaryAfter(text: string, end: number): boolean {
  const next = text[end];
  return next === undefined || !slugBoundaryPattern.test(next);
}

function serializeMentionEditor(root: HTMLElement): string {
  return [...root.childNodes].map(serializeMentionNode).join("");
}

function serializeMentionNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (!(node instanceof HTMLElement)) {
    return "";
  }

  const mentionSlug = node.dataset.agentMention;
  if (mentionSlug !== undefined) {
    return `@${mentionSlug}`;
  }
  // Presentation-only nodes (marker attribution, expand controls, previous-text
  // previews) are contentEditable=false and must never leak into the Markdown.
  if (node.getAttribute("contenteditable") === "false") {
    return "";
  }
  if (node.tagName === "BR") {
    return "\n";
  }

  const content = [...node.childNodes].map(serializeMentionNode).join("");
  if ((node.tagName === "DIV" || node.tagName === "P") && !content.endsWith("\n")) {
    return `${content}\n`;
  }
  return content;
}

function getEditorSelection(root: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return null;
  }
  const start = plainTextOffset(root, range.startContainer, range.startOffset);
  const end = plainTextOffset(root, range.endContainer, range.endOffset);
  return start <= end ? { start, end } : { start: end, end: start };
}

function plainTextOffset(root: Node, target: Node, targetOffset: number): number {
  let offset = 0;
  let found = false;

  const visit = (node: Node) => {
    if (found) {
      return;
    }
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) {
        offset += Math.min(targetOffset, node.textContent?.length ?? 0);
      } else {
        for (let index = 0; index < Math.min(targetOffset, node.childNodes.length); index += 1) {
          const child = node.childNodes[index];
          if (child !== undefined) {
            offset += mentionNodeLength(child);
          }
        }
      }
      found = true;
      return;
    }

    if (node instanceof HTMLElement && node.dataset.agentMention !== undefined) {
      offset += node.dataset.agentMention.length + 1;
      return;
    }
    if (node instanceof HTMLElement && node.getAttribute("contenteditable") === "false") {
      // Marker attribution / expand controls / previous-text previews occupy no
      // Markdown offset.
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += node.textContent?.length ?? 0;
      return;
    }
    for (const child of node.childNodes) {
      visit(child);
    }
  };

  visit(root);
  return offset;
}

function mentionNodeLength(node: Node): number {
  if (node instanceof HTMLElement && node.dataset.agentMention !== undefined) {
    return node.dataset.agentMention.length + 1;
  }
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.length ?? 0;
  }
  if (node instanceof HTMLElement && node.getAttribute("contenteditable") === "false") {
    return 0;
  }
  if (node instanceof HTMLElement && node.tagName === "BR") {
    return 1;
  }
  return [...node.childNodes].reduce((total, child) => total + mentionNodeLength(child), 0);
}

function setEditorCaret(root: HTMLElement, requestedOffset: number): void {
  const selection = window.getSelection();
  if (selection === null) {
    return;
  }
  const offset = Math.max(0, requestedOffset);
  let consumed = 0;
  const range = document.createRange();
  let found = false;

  const visit = (node: Node) => {
    if (found) {
      return;
    }
    if (node instanceof HTMLElement && node.dataset.agentMention !== undefined) {
      const length = node.dataset.agentMention.length + 1;
      if (offset <= consumed + length) {
        if (offset <= consumed) {
          range.setStartBefore(node);
        } else {
          range.setStartAfter(node);
        }
        found = true;
      } else {
        consumed += length;
      }
      return;
    }
    if (node instanceof HTMLElement && node.getAttribute("contenteditable") === "false") {
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (offset <= consumed + length) {
        range.setStart(node, Math.max(0, offset - consumed));
        found = true;
      } else {
        consumed += length;
      }
      return;
    }
    for (const child of node.childNodes) {
      visit(child);
    }
  };

  visit(root);
  if (found) {
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }

  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}
