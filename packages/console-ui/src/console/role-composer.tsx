import * as React from "react";
import { ArrowUp, Plus, Square } from "lucide-react";

import { translate, useI18n, type Translate, type TranslationKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import type { OperatorConsoleAppearance } from "@/console/operator-console-appearance";
import { operatorFloatingSurfaceClassName } from "@/console/operator-console-appearance";
import {
  StructuredAttachmentList,
  hasBlockingComposerAttachment,
  readyComposerAttachmentIds,
  type ComposerAttachment,
} from "@/console/structured-attachments";
import {
  TextFragmentList,
  type ComposerTextFragment,
} from "@/console/text-fragment-list";

export interface RoleCompletion {
  handle: string;
  label: string;
  description: string;
  avatar?: string;
}

const ROLE_COMPLETION_META = [
  { handle: "ceo", labelKey: "console.role.ceo", descriptionKey: "console.role.ceoDescription", avatar: "C" },
  { handle: "dev", labelKey: "console.role.dev", descriptionKey: "console.role.devDescription", avatar: "D" },
  { handle: "qa", labelKey: "console.role.qa", descriptionKey: "console.role.qaDescription", avatar: "Q" },
  { handle: "dev-manager", labelKey: "console.role.devManager", descriptionKey: "console.role.devManagerDescription", avatar: "T" },
  { handle: "product-manager", labelKey: "console.role.product", descriptionKey: "console.role.productDescription", avatar: "P" },
  { handle: "hermes-user", labelKey: "console.role.user", descriptionKey: "console.role.userDescription", avatar: "U" },
  { handle: "secretary", labelKey: "console.role.secretary", descriptionKey: "console.role.secretaryDescription", avatar: "S" },
] as const satisfies readonly {
  handle: string;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  avatar: string;
}[];

function localizedRoleCompletions(t: Translate): readonly RoleCompletion[] {
  return ROLE_COMPLETION_META.map((role) => ({
    handle: role.handle,
    label: t(role.labelKey),
    description: t(role.descriptionKey),
    avatar: role.avatar,
  }));
}

export const ROLE_COMPLETIONS = localizedRoleCompletions(
  (key, values) => translate("zh-CN", key, values),
);

export type RoleHandle = string;

export interface RoleComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit?: (value: string, attachmentIds: readonly string[]) => void;
  attachments?: readonly ComposerAttachment[];
  onFilesAdded?: (files: File[]) => void;
  onAttachmentRemove?: (clientId: string) => void;
  onAttachmentRetry?: (clientId: string) => void;
  textFragments?: readonly ComposerTextFragment[];
  onTextFragmentRemove?: (fragmentId: string) => void;
  placeholder?: string;
  statusText?: string;
  submitLabel?: string;
  interruptLabel?: string;
  disabled?: boolean;
  submitDisabled?: boolean;
  runActive?: boolean;
  onInterrupt?: () => void;
  roles?: readonly RoleCompletion[];
  context?: React.ReactNode;
  variant?: "main" | "embedded";
  appearance?: OperatorConsoleAppearance;
  className?: string;
}

export interface RoleTrigger {
  start: number;
  end: number;
  query: string;
}

interface TextRange {
  start: number;
  end: number;
}

export function maskCodeSpans(text: string): string {
  const chars = [...text];
  let index = 0;

  while (index < chars.length) {
    if (text.startsWith("```", index)) {
      const close = text.indexOf("```", index + 3);
      const end = close === -1 ? chars.length : close + 3;
      for (let cursor = index; cursor < end; cursor += 1) {
        chars[cursor] = " ";
      }
      index = end;
      continue;
    }

    if (chars[index] === "`") {
      const close = text.indexOf("`", index + 1);
      const end = close === -1 ? chars.length : close + 1;
      for (let cursor = index; cursor < end; cursor += 1) {
        chars[cursor] = " ";
      }
      index = end;
      continue;
    }

    index += 1;
  }

  return chars.join("");
}

export function findActiveRoleTrigger(text: string, cursor: number): RoleTrigger | null {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const beforeCursor = text.slice(0, safeCursor);
  const atIndex = beforeCursor.lastIndexOf("@");

  if (atIndex < 0) {
    return null;
  }

  const query = beforeCursor.slice(atIndex + 1);
  if (!/^[A-Za-z-]*$/u.test(query)) {
    return null;
  }

  const masked = maskCodeSpans(text);
  if (masked[atIndex] !== "@" || !hasBoundaryBefore(masked, atIndex)) {
    return null;
  }

  return { start: atIndex, end: safeCursor, query: query.toLowerCase() };
}

export function hasLegalRoleMention(
  text: string,
  ignoreRange?: TextRange,
  roles: readonly RoleCompletion[] = ROLE_COMPLETIONS,
): boolean {
  return findLegalRoleMentions(text, ignoreRange, roles).length > 0;
}

export function findLegalRoleMentions(
  text: string,
  ignoreRange?: TextRange,
  roles: readonly RoleCompletion[] = ROLE_COMPLETIONS,
): TextRange[] {
  if (roles.length === 0) {
    return [];
  }

  const masked = maskCodeSpans(text);
  const mentions: TextRange[] = [];
  const roleHandlePattern = roles
    .map((role) => escapeRegExp(role.handle))
    .sort((left, right) => right.length - left.length)
    .join("|");
  const matcher = new RegExp(`@(${roleHandlePattern})`, "gu");

  for (const match of masked.matchAll(matcher)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;

    if (ignoreRange && rangesOverlap({ start, end }, ignoreRange)) {
      continue;
    }

    if (hasBoundaryBefore(masked, start) && hasBoundaryAfter(masked, end)) {
      mentions.push({ start, end });
    }
  }

  return mentions;
}

export function insertRoleMention(
  text: string,
  cursor: number,
  handle: RoleHandle,
  roles: readonly RoleCompletion[] = ROLE_COMPLETIONS,
): { value: string; cursor: number } {
  const trigger = findActiveRoleTrigger(text, cursor);
  if (!trigger || !roles.some((role) => role.handle === handle) || hasLegalRoleMention(text, trigger, roles)) {
    return { value: text, cursor };
  }

  const nextCharacter = text[trigger.end];
  const replacement = `@${handle}${nextCharacter && /\s/u.test(nextCharacter) ? "" : " "}`;
  const value = `${text.slice(0, trigger.start)}${replacement}${text.slice(trigger.end)}`;
  return { value, cursor: trigger.start + replacement.length };
}

export function RoleComposer({
  value,
  onValueChange,
  onSubmit,
  placeholder,
  statusText,
  submitLabel,
  interruptLabel,
  disabled = false,
  submitDisabled = false,
  runActive = false,
  onInterrupt,
  roles,
  context,
  className,
  attachments = [],
  textFragments = [],
  onFilesAdded,
  onAttachmentRemove,
  onAttachmentRetry,
  onTextFragmentRemove,
  variant = "embedded",
  appearance = "default",
}: RoleComposerProps): JSX.Element {
  const { t } = useI18n();
  const roleOptions = roles ?? localizedRoleCompletions(t);
  const resolvedPlaceholder = placeholder ?? t("console.roleComposer.placeholder");
  const resolvedSubmitLabel = submitLabel ?? t("console.roleComposer.submit");
  const resolvedInterruptLabel = interruptLabel ?? t("console.roleComposer.interrupt");
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const pendingCaretRef = React.useRef<number | null>(null);
  const listboxId = React.useId();
  const [focused, setFocused] = React.useState(false);
  const [caret, setCaret] = React.useState(value.length);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [closedTriggerKey, setClosedTriggerKey] = React.useState<string | null>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const readyAttachmentIds = readyComposerAttachmentIds(attachments);
  const attachmentBlocked = hasBlockingComposerAttachment(attachments);
  const canSubmit = !disabled
    && !submitDisabled
    && !attachmentBlocked
    && (value.trim() !== "" || readyAttachmentIds.length > 0);

  const trigger = findActiveRoleTrigger(value, caret);
  const triggerKey = trigger ? `${value}:${trigger.start}:${trigger.end}` : null;
  const matchingRoleOptions = trigger ? matchingRoles(roleOptions, trigger.query) : [];
  const panelOpen =
    focused &&
    !disabled &&
    trigger !== null &&
    matchingRoleOptions.length > 0 &&
    !hasLegalRoleMention(value, trigger, roleOptions) &&
    closedTriggerKey !== triggerKey;

  React.useEffect(() => {
    setActiveIndex(0);
  }, [triggerKey, matchingRoleOptions.length]);

  React.useLayoutEffect(() => {
    if (pendingCaretRef.current === null || !inputRef.current) {
      return;
    }

    const nextCaret = pendingCaretRef.current;
    pendingCaretRef.current = null;
    inputRef.current.focus();
    inputRef.current.setSelectionRange(nextCaret, nextCaret);
  }, [value]);

  React.useLayoutEffect(() => {
    if (variant !== "main" || inputRef.current === null) {
      return;
    }
    resizeMainTextarea(inputRef.current);
  }, [value, variant]);

  const updateCaretFromInput = (input: HTMLTextAreaElement) => {
    setCaret(input.selectionStart ?? input.value.length);
  };

  const selectRole = (handle: RoleHandle) => {
    const currentCaret = inputRef.current?.selectionStart ?? caret;
    const next = insertRoleMention(value, currentCaret, handle, roleOptions);
    if (next.value === value) {
      return;
    }

    pendingCaretRef.current = next.cursor;
    setCaret(next.cursor);
    setFocused(true);
    setClosedTriggerKey(null);
    onValueChange(next.value);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (panelOpen && event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % matchingRoleOptions.length);
      return;
    }

    if (panelOpen && event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + matchingRoleOptions.length) % matchingRoleOptions.length);
      return;
    }

    if (panelOpen && event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      selectRole(matchingRoleOptions[activeIndex].handle);
      return;
    }

    if (panelOpen && event.key === "Escape") {
      event.preventDefault();
      setClosedTriggerKey(triggerKey);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && onSubmit && canSubmit) {
      event.preventDefault();
      onSubmit(value, readyAttachmentIds);
    }
  };

  return (
    <div
      className={cn("relative w-full", className)}
      data-testid={variant === "main" ? "main-role-composer" : "embedded-role-composer"}
    >
      {panelOpen ? (
        <div
          id={listboxId}
          role="listbox"
          className={operatorFloatingSurfaceClassName(
            appearance,
            "absolute bottom-full left-0 z-layer-floating-local mb-2 w-full rounded-lg border border-line bg-sunken p-1.5",
          )}
          aria-label={t("console.roleComposer.completions")}
        >
          {matchingRoleOptions.map((role, index) => (
            <button
              key={role.handle}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={cn(
                "grid w-full grid-cols-[28px_minmax(0,1fr)] items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-hover",
                index === activeIndex ? "bg-sel" : "bg-transparent",
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                selectRole(role.handle);
              }}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-xl border border-line bg-sunken text-xs font-semibold text-ava-fg">
                {role.avatar ?? (role.label.trim().charAt(0) || role.handle.charAt(0).toUpperCase())}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-normal text-ink">{role.label}</span>
                <span className="block truncate text-xs text-sub">{role.description}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          "relative overflow-hidden rounded-xl border border-line",
          variant === "main" ? "flex flex-col gap-2 bg-card px-3 pb-3 pt-2.5" : "bg-input",
          appearance === "focused" && variant === "main" && "border-line bg-input shadow-composer focus-within:border-line-strong focus-within:shadow-composer-focus",
          dragActive && "border-accent ring-2 ring-accent/20",
        )}
        data-layout-variant={variant}
        onDragEnter={(event) => {
          if (!disabled && event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            setDragActive(true);
          }
        }}
        onDragOver={(event) => {
          if (!disabled && event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          if (!disabled && event.dataTransfer.files.length > 0) {
            onFilesAdded?.(Array.from(event.dataTransfer.files));
          }
        }}
      >
        {context ? <div className={variant === "main" ? "" : "px-3 pt-2"}>{context}</div> : null}
        <TextFragmentList
          fragments={textFragments}
          mode="draft"
          className={variant === "main"
            ? "-mx-3 border-b border-line px-3 pb-2"
            : "border-b border-line px-3.5 py-3"}
          onRemove={onTextFragmentRemove}
        />
        <StructuredAttachmentList
          attachments={attachments}
          mode="draft"
          className={variant === "main"
            ? "-mx-3 border-b border-line px-3 pb-2"
            : "border-b border-line px-3.5 py-3"}
          onRemove={onAttachmentRemove}
          onRetry={onAttachmentRetry}
        />
        <div className={variant === "main"
          ? cn("flex min-h-8 items-end", appearance === "focused" ? "gap-1" : "gap-2")
          : "relative min-h-[76px]"}>
          <textarea
            ref={inputRef}
            value={value}
            rows={variant === "main" ? 1 : 2}
            disabled={disabled}
            placeholder={resolvedPlaceholder}
            aria-label={t("console.roleComposer.message")}
            aria-autocomplete="list"
            aria-expanded={panelOpen}
            aria-controls={panelOpen ? listboxId : undefined}
            className={cn(
              "block w-full resize-none bg-transparent text-sm text-ink outline-none placeholder:text-hint disabled:cursor-not-allowed",
              variant === "main"
                ? "min-h-8 max-h-[120px] flex-1 overflow-y-auto px-0 py-[5px] leading-[22px]"
                : cn("min-h-[76px] px-4 py-3.5 leading-6", runActive ? "pr-32" : "pr-24"),
            )}
            onChange={(event) => {
              setClosedTriggerKey(null);
              if (variant === "main") resizeMainTextarea(event.currentTarget);
              onValueChange(event.currentTarget.value);
              updateCaretFromInput(event.currentTarget);
            }}
            onFocus={(event) => {
              setFocused(true);
              updateCaretFromInput(event.currentTarget);
            }}
            onBlur={() => setFocused(false)}
            onClick={(event) => updateCaretFromInput(event.currentTarget)}
            onKeyDown={handleKeyDown}
            onPaste={(event) => {
              const imageFiles = Array.from(event.clipboardData.items)
                .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
                .flatMap((item) => {
                  const file = item.getAsFile();
                  return file === null ? [] : [file];
                });
              if (!disabled && imageFiles.length > 0) {
                event.preventDefault();
                onFilesAdded?.(imageFiles);
              }
            }}
            onKeyUp={(event) => updateCaretFromInput(event.currentTarget)}
            onSelect={(event) => updateCaretFromInput(event.currentTarget)}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            tabIndex={-1}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              if (files.length > 0) onFilesAdded?.(files);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={cn(
              "h-8 w-8 shrink-0 rounded-md border-line bg-transparent p-0 text-sub hover:bg-hover hover:text-ink",
              appearance === "focused" && variant === "main" && "h-7 w-7 rounded-md [&>svg]:h-3.5 [&>svg]:w-3.5",
              variant === "embedded" && "absolute bottom-3",
              variant === "embedded" && (runActive ? "right-[84px]" : "right-12"),
            )}
            disabled={disabled}
            aria-label={t("console.roleComposer.addAttachment")}
            title={t("console.roleComposer.addAttachment")}
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </Button>
          {runActive ? (
            <Button
              type="button"
              size="icon"
              className={cn(
                "h-8 w-8 shrink-0 rounded-md bg-ink p-0 text-canvas hover:opacity-85",
                appearance === "focused" && variant === "main" && "h-7 w-7 rounded-md [&>svg]:h-3.5 [&>svg]:w-3.5",
                variant === "embedded" && "absolute bottom-3 right-12",
              )}
              disabled={!canSubmit}
              aria-label={resolvedSubmitLabel}
              title={resolvedSubmitLabel}
              onClick={() => onSubmit?.(value, readyAttachmentIds)}
            >
              <ArrowUp className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon"
            className={cn(
              "h-8 w-8 shrink-0 rounded-md p-0",
              appearance === "focused" && variant === "main" && "h-7 w-7 rounded-md [&>svg]:h-3.5 [&>svg]:w-3.5",
              variant === "embedded" && "absolute bottom-3 right-3",
              runActive
                ? "bg-[var(--status-danger-bg)] text-danger hover:bg-[var(--status-danger-bg)] hover:opacity-85"
                : "bg-ink text-canvas hover:opacity-85",
            )}
            disabled={runActive ? disabled || onInterrupt === undefined : !canSubmit}
            aria-label={runActive ? resolvedInterruptLabel : resolvedSubmitLabel}
            title={runActive ? resolvedInterruptLabel : resolvedSubmitLabel}
            onClick={runActive ? onInterrupt : () => onSubmit?.(value, readyAttachmentIds)}
          >
            {runActive ? (
              <Square
                className={variant === "main" ? "h-4 w-4" : "h-3.5 w-3.5"}
                strokeWidth={1.5}
                aria-hidden="true"
              />
            ) : (
              <ArrowUp className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>
      {statusText ? <p role="status" className="mt-1.5 px-2 text-xs text-hint">{statusText}</p> : null}
    </div>
  );
}

function matchingRoles(roles: readonly RoleCompletion[], query: string): readonly RoleCompletion[] {
  if (query.length === 0) {
    return roles;
  }

  return roles.filter((role) => role.handle.startsWith(query));
}

function resizeMainTextarea(input: HTMLTextAreaElement): void {
  input.style.height = "auto";
  const nextHeight = Math.max(32, Math.min(input.scrollHeight, 120));
  input.style.height = `${nextHeight}px`;
  input.style.overflowY = input.scrollHeight > 120 ? "auto" : "hidden";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function rangesOverlap(left: TextRange, right: TextRange): boolean {
  return left.start < right.end && right.start < left.end;
}

function hasBoundaryBefore(text: string, atIndex: number): boolean {
  if (atIndex === 0) {
    return true;
  }
  return /[\s([{，。！？、；：]/u.test(text[atIndex - 1] ?? "");
}

function hasBoundaryAfter(text: string, endIndex: number): boolean {
  if (endIndex >= text.length) {
    return true;
  }
  return /[\s)\]}，。！？、；：]/u.test(text[endIndex] ?? "");
}
