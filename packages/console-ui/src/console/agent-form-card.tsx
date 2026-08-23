import { Check } from "lucide-react";
import * as React from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { AgentPortrait } from "@/console/agent-portrait";
import { Button } from "@/ui/button";
import {
  answerFor,
  applyOwnText,
  canSubmitAgentForm,
  composeAgentFormMessage,
  goToQuestion,
  isChoiceQuestion,
  isQuestionAnswered,
  resolveAgentFormDraft,
  toggleOption,
  type AgentFormChoiceQuestion,
  type AgentFormDraft,
  type AgentFormQuestion,
  type AgentFormSpec,
} from "@/console/agent-form-model";

/** `--dur` and friends are authored in CSS; WAAPI needs the resolved number. */
function readDuration(style: CSSStyleDeclaration, name: string, fallback: number): number {
  const raw = style.getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) return fallback;
  return raw.endsWith("ms") ? value : value * 1000;
}

export interface AgentFormCardProps {
  spec: AgentFormSpec;
  /** Answers and the question the user stopped on. A draft from another form is ignored. */
  draft?: AgentFormDraft;
  onDraftChange?: (draft: AgentFormDraft) => void;
  /** Receives the assembled plain-text message; the host turns it into a user message. */
  onSubmit?: (message: string, draft: AgentFormDraft) => void;
  className?: string;
}

/**
 * The question form an agent puts above the composer when it needs the user to decide.
 *
 * Fully controlled: it holds no answers of its own, so keeping a half-finished form
 * across a conversation switch or an app restart is the host's job — only the host
 * knows which conversation the draft belongs to.
 */
export function AgentFormCard({
  spec,
  draft: incomingDraft,
  onDraftChange,
  onSubmit,
  className,
}: AgentFormCardProps): JSX.Element {
  const { t } = useI18n();
  const draft = resolveAgentFormDraft(spec, incomingDraft);
  const questions = spec.questions;
  const total = questions.length;
  const activeIndex = draft.activeIndex;
  const question = questions[activeIndex] as AgentFormQuestion;
  const isLast = activeIndex === total - 1;
  const canSubmit = canSubmitAgentForm(spec, draft);
  const cardRef = React.useRef<HTMLElement>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  // Height the card had at the moment the question changed — read live, so tapping
  // pressing next twice in a row resumes from where the last resize had got to.
  const heightBefore = React.useRef<number | null>(null);
  // Set only by the navigation actions: the card must never grab focus just by appearing,
  // and the progress track moves focus to its own cell.
  const focusAnswerArea = React.useRef(false);
  const resize = React.useRef<Animation | null>(null);

  /**
   * Questions are different heights, and the card sits directly under the pointer that
   * just pressed next. Snapping between sizes teleports the button away from the
   * finger that is still on it; resizing over 150ms keeps the target where the user
   * left it. This is the only spatial motion in the card — see DESIGN.md.
   */
  React.useLayoutEffect(() => {
    const node = cardRef.current;
    const from = heightBefore.current;
    heightBefore.current = null;
    if (node === null || from === null || typeof node.animate !== "function") return;
    const to = node.getBoundingClientRect().height;
    if (Math.abs(to - from) < 1) return;
    const style = window.getComputedStyle(node);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    resize.current?.cancel();
    resize.current = node.animate(
      [{ height: `${from}px` }, { height: `${to}px` }],
      {
        duration: readDuration(style, "--dur", 150),
        easing: style.getPropertyValue("--ease").trim() || "ease-out",
      },
    );
  }, [activeIndex]);

  React.useEffect(() => {
    if (!focusAnswerArea.current) return;
    focusAnswerArea.current = false;
    bodyRef.current?.querySelector<HTMLElement>("input, textarea")?.focus();
  }, [activeIndex]);

  function goTo(index: number): void {
    focusAnswerArea.current = true;
    commit(goToQuestion(draft, spec, index));
  }

  function commit(next: AgentFormDraft): void {
    if (next === draft) return;
    if (next.activeIndex !== draft.activeIndex) {
      heightBefore.current = cardRef.current?.getBoundingClientRect().height ?? null;
    }
    onDraftChange?.(next);
  }

  function submit(): void {
    if (!canSubmit) return;
    onSubmit?.(
      composeAgentFormMessage(spec, draft, {
        line: t("console.agentForm.answerLine"),
        answerJoin: t("console.agentForm.answerJoin"),
      }),
      draft,
    );
  }

  function advance(): void {
    if (isLast) submit();
    else goTo(activeIndex + 1);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key !== "Enter") return;
    const target = event.target as HTMLElement;
    // Enter is a newline inside the free-text and write-in areas; Cmd/Ctrl + Enter moves on.
    if (target instanceof HTMLTextAreaElement && !(event.metaKey || event.ctrlKey)) return;
    // Buttons already turn Enter into a click; handling it again would run the action twice.
    if (target instanceof HTMLButtonElement) return;
    event.preventDefault();
    advance();
  }

  return (
    <section
      aria-label={t("console.agentForm.cardLabel", { member: spec.memberName })}
      onKeyDown={handleKeyDown}
      ref={cardRef}
      className={cn("flex max-h-full flex-col overflow-hidden rounded-xl border border-line bg-card", className)}
    >
      {/* Identity and progress share one row: a full-width track reads as a page loading
          bar, and the card is small enough that a whole row of it is the loudest thing
          on screen — louder than the question it is supposed to be indexing. */}
      <div className="flex shrink-0 items-center gap-2 px-3 pb-3 pt-2.5">
        <AgentPortrait
          displayName={spec.memberName}
          slug={spec.memberSlug ?? spec.memberName}
          portraitId={spec.portraitId}
          engine={spec.engine}
        />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{spec.memberName}</span>
        {total > 1 ? (
          <div className="flex shrink-0 items-center gap-2">
            <ProgressTrack spec={spec} draft={draft} onDraftChange={commit} />
            <span className="text-meta tabular-nums text-hint">
              {t("console.agentForm.progress", { current: activeIndex + 1, total })}
            </span>
          </div>
        ) : null}
      </div>

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <h3 className="text-base font-semibold text-ink">{question.title}</h3>
        <div className="mt-3">
          {isChoiceQuestion(question) ? (
            <ChoiceAnswerArea
              question={question}
              draft={draft}
              onDraftChange={commit}
            />
          ) : (
            <AnswerTextarea
              value={answerFor(draft, question.id).ownText}
              placeholder={t("console.agentForm.textPlaceholder")}
              aria-label={question.title}
              onValueChange={(value) => commit(applyOwnText(draft, question, value))}
              className="min-h-[76px] rounded-lg border border-line px-3 py-2.5"
            />
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 px-3 pb-2.5 pt-2">
        {activeIndex > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => goTo(activeIndex - 1)}
          >
            {t("console.agentForm.previous")}
          </Button>
        ) : null}
        {isLast ? (
          <Button
            type="button"
            size="sm"
            disabled={!canSubmit}
            aria-label={t("console.agentForm.sendAction")}
            onClick={submit}
          >
            {t("console.agentForm.send")}
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={advance}>
            {t("console.agentForm.next")}
          </Button>
        )}
      </div>
    </section>
  );
}

/**
 * One cell per question: filled means answered, the taller one is where the user is.
 *
 * The whole track is a single tab stop with arrow keys inside it. Making every cell its
 * own stop would put four keystrokes between the user and the answers on every question,
 * which is most of the cost of answering a short form.
 */
function ProgressTrack({
  spec,
  draft,
  onDraftChange,
}: {
  spec: AgentFormSpec;
  draft: AgentFormDraft;
  onDraftChange: (draft: AgentFormDraft) => void;
}): JSX.Element {
  const { t } = useI18n();
  const total = spec.questions.length;
  const activeIndex = draft.activeIndex;
  const cellRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  function moveTo(index: number): void {
    onDraftChange(goToQuestion(draft, spec, index));
    cellRefs.current[Math.min(Math.max(index, 0), total - 1)]?.focus();
  }

  return (
    <div
      role="group"
      aria-label={t("console.agentForm.progressLabel", { current: activeIndex + 1, total })}
      className="flex items-center gap-1"
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        moveTo(activeIndex + (event.key === "ArrowRight" ? 1 : -1));
      }}
    >
      {spec.questions.map((entry, index) => {
        const answered = isQuestionAnswered(draft, entry);
        return (
          <button
            key={entry.id}
            ref={(node) => { cellRefs.current[index] = node; }}
            type="button"
            tabIndex={index === activeIndex ? 0 : -1}
            aria-label={t(
              answered ? "console.agentForm.questionAnswered" : "console.agentForm.questionUnanswered",
              { index: index + 1 },
            )}
            aria-current={index === activeIndex ? "step" : undefined}
            onClick={() => onDraftChange(goToQuestion(draft, spec, index))}
            className="group flex h-4 w-4 items-center outline-none"
          >
            <span
              className={cn(
                "w-full rounded-full transition-[height,background-color]",
                index === activeIndex ? "h-[5px]" : "h-[3px]",
                answered ? "bg-accent" : "bg-line",
                "group-hover:bg-accent-hover group-focus-visible:bg-accent-hover",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

function ChoiceAnswerArea({
  question,
  draft,
  onDraftChange,
}: {
  question: AgentFormChoiceQuestion;
  draft: AgentFormDraft;
  onDraftChange: (draft: AgentFormDraft) => void;
}): JSX.Element {
  const { t } = useI18n();
  const answer = answerFor(draft, question.id);
  const writeInRef = React.useRef<HTMLTextAreaElement>(null);
  const single = question.kind === "single";
  const ownSelected = answer.ownText.trim().length > 0;

  return (
    <div className="flex flex-col gap-1.5">
      {question.options.map((option) => {
        const checked = answer.selectedOptionIds.includes(option.id);
        return (
          <label
            key={option.id}
            className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line px-2.5 py-2 transition-colors hover:bg-hover has-[:checked]:border-accent has-[:checked]:bg-sel"
          >
            <input
              type={single ? "radio" : "checkbox"}
              name={question.id}
              className="peer sr-only"
              checked={checked}
              /* Named explicitly so the description travels with the title: the option is
                 unreadable without it, and a visually hidden control cannot rely on
                 whatever a browser decides to fold in from the surrounding label. */
              aria-label={option.description === undefined
                ? option.title
                : t("console.agentForm.optionLabel", { title: option.title, description: option.description })}
              onChange={() => onDraftChange(toggleOption(draft, question, option.id))}
            />
            <SelectionMark single={single} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="break-words text-sm text-ink">{option.title}</span>
              {option.description === undefined ? null : (
                <span className="break-words text-xs text-sub">{option.description}</span>
              )}
            </span>
          </label>
        );
      })}
      {/*
        The write-in is appended by the product, never declared by the agent, and it has no
        control of its own: text is the selection. It therefore cannot live inside a <label>
        — on a multi-select that would toggle the checkbox every time the user clicks to type.
      */}
      <div
        className={cn(
          "flex cursor-text items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors",
          ownSelected ? "border-accent bg-sel" : "border-line hover:bg-hover",
        )}
        onClick={() => writeInRef.current?.focus()}
      >
        <SelectionMark single={single} checked={ownSelected} />
        <AnswerTextarea
          ref={writeInRef}
          value={answer.ownText}
          placeholder={t("console.agentForm.ownPlaceholder")}
          aria-label={t("console.agentForm.ownOptionLabel")}
          onValueChange={(value) => onDraftChange(applyOwnText(draft, question, value))}
          className="min-h-[20px] leading-5"
        />
      </div>
    </div>
  );
}

/**
 * The radio dot / checkbox tick. Preset options drive it off the sibling input through
 * `peer-checked`; the write-in has no input, so it takes `checked` directly.
 */
function SelectionMark({ single, checked }: { single: boolean; checked?: boolean }): JSX.Element {
  const derived = checked !== undefined;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center border transition-colors",
        single ? "rounded-full" : "rounded-md",
        derived
          ? checked
            ? "border-accent bg-accent"
            : "border-line bg-card"
          : "border-line bg-card peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)]",
        "[&>*]:transition-opacity",
        derived
          ? checked
            ? "[&>*]:opacity-100"
            : "[&>*]:opacity-0"
          : "[&>*]:opacity-0 peer-checked:[&>*]:opacity-100",
      )}
    >
      {single ? (
        <span className="h-1.5 w-1.5 rounded-full bg-accent-fg" />
      ) : (
        <Check className="h-2.5 w-2.5 text-accent-fg" strokeWidth={2} />
      )}
    </span>
  );
}

const AnswerTextarea = React.forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    placeholder: string;
    "aria-label": string;
    onValueChange: (value: string) => void;
    className?: string;
  }
>(function AnswerTextarea({ value, placeholder, onValueChange, className, ...rest }, ref) {
  const innerRef = React.useRef<HTMLTextAreaElement>(null);
  React.useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement);
  React.useLayoutEffect(() => {
    const input = innerRef.current;
    if (input === null) return;
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      {...rest}
      ref={innerRef}
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onValueChange(event.currentTarget.value)}
      className={cn(
        "w-full resize-none overflow-hidden bg-transparent text-sm text-ink outline-none placeholder:text-hint",
        className,
      )}
    />
  );
});
