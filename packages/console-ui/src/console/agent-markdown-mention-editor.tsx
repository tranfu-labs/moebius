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
} from "react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

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

export interface AgentMarkdownMentionEditorProps {
  id?: string;
  value: string;
  members: readonly AgentMentionMember[];
  label: string;
  readOnly?: boolean;
  disabled?: boolean;
  onValueChange(value: string): void;
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
  onValueChange,
}: AgentMarkdownMentionEditorProps): JSX.Element {
  const { t } = useI18n();
  const editorRef = useRef<HTMLDivElement>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const composingRef = useRef(false);
  const listboxId = useId();
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const [activeIndex, setActiveIndex] = useState(0);
  const [closedTriggerKey, setClosedTriggerKey] = useState<string | null>(null);
  const segments = useMemo(() => segmentAgentMentions(value, members), [members, value]);
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
    <div className="relative mt-2">
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
        {segments.map((segment, index) => segment.kind === "text" ? (
          <span key={`text-${index}`}>{segment.text}</span>
        ) : (
          <AgentMention key={`mention-${index}-${segment.member.slug}`} member={segment.member} />
        ))}
      </div>

      {panelOpen ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={t("console.mentionEditor.completions")}
          className="absolute left-2 top-full z-40 mt-2 w-[min(360px,calc(100%-1rem))] rounded-md border border-line bg-sunken p-1.5"
        >
          {matches.map((member, index) => (
            <button
              key={member.slug}
              id={`${listboxId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={cn(
                "flex w-full items-center justify-between gap-4 rounded-md px-2.5 py-2 text-left hover:bg-hover",
                index === activeIndex && "bg-sel",
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                selectMember(member);
              }}
            >
              <span className="truncate text-sm font-medium text-ink">{member.displayName || `@${member.slug}`}</span>
              <span className="shrink-0 text-xs text-hint">@{member.slug}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
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

function AgentMention({ member }: { member: AgentMentionMember }): JSX.Element {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      contentEditable={false}
      data-agent-mention={member.slug}
      className="group relative mx-0.5 inline-flex items-baseline rounded-md bg-accent/10 px-1.5 py-0.5 font-medium text-accent hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
      aria-label={t("console.mentionEditor.memberCopy", {
        member: member.displayName || member.slug,
        slug: member.slug,
      })}
      title={t("console.mentionEditor.clickCopy", { slug: member.slug })}
      onClick={async () => {
        if (await copyPlainText(`@${member.slug}`)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      <span data-mention-label>{member.displayName || `@${member.slug}`}</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] font-normal leading-4 text-card group-hover:block group-focus-visible:block"
      >
        {copied
          ? t("console.mentionEditor.copiedSlug", { slug: member.slug })
          : t("console.mentionEditor.clickCopy", { slug: member.slug })}
      </span>
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
