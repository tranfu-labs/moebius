/**
 * Pure rules behind the agent question form.
 *
 * The product fixes what a form can express (see docs/product/pages/agent-form.md):
 * at most four questions, single / multiple / free-text, at most two agent-authored
 * options per choice question, and a "write your own" entry that the product appends.
 * Everything here is deliberately DOM-free so those rules can be asserted without
 * rendering, and so the card component never has to re-implement one of them inline.
 */

import { type ExecutionEngine } from "@/console/provider-mark";

/** A form with more questions than this is not renderable and falls back to plain text. */
export const AGENT_FORM_MAX_QUESTIONS = 4;
/** Preset options the agent may author per choice question, before the appended write-in. */
export const AGENT_FORM_MAX_PRESET_OPTIONS = 2;

export type AgentFormQuestionKind = "single" | "multiple" | "text";

export interface AgentFormOption {
  id: string;
  title: string;
  description?: string;
}

interface AgentFormQuestionBase {
  id: string;
  title: string;
}

export interface AgentFormChoiceQuestion extends AgentFormQuestionBase {
  kind: "single" | "multiple";
  options: readonly AgentFormOption[];
}

export interface AgentFormTextQuestion extends AgentFormQuestionBase {
  kind: "text";
}

export type AgentFormQuestion = AgentFormChoiceQuestion | AgentFormTextQuestion;

export interface AgentFormSpec {
  /** Identity of this form. A different id is a different form, never a continuation. */
  id: string;
  /** Readable name of the member asking. Always required: the card is attributed. */
  memberName: string;
  /** Stable identity slug behind the portrait and identity colour. */
  memberSlug?: string;
  portraitId?: string | null;
  /** Engine badge, so the same member looks the same here as in the timeline. */
  engine?: { cli: ExecutionEngine; providerId?: string };
  questions: readonly AgentFormQuestion[];
}

export interface AgentFormAnswer {
  /** Agent-authored options the user selected, in the order the form declares them. */
  selectedOptionIds: readonly string[];
  /** The user's own words: the write-in of a choice question, or a free-text answer. */
  ownText: string;
}

export interface AgentFormDraft {
  /** Which form these answers belong to. Mismatched drafts are discarded, not migrated. */
  formId: string;
  activeIndex: number;
  answers: Readonly<Record<string, AgentFormAnswer>>;
}

const EMPTY_ANSWER: AgentFormAnswer = { selectedOptionIds: [], ownText: "" };

export function isChoiceQuestion(question: AgentFormQuestion): question is AgentFormChoiceQuestion {
  return question.kind === "single" || question.kind === "multiple";
}

/**
 * Whether the card may render this form at all.
 *
 * Returns a verdict rather than throwing: the product wants an over-sized or malformed
 * form to disappear silently and stay in the agent's prose, with nothing explained to
 * the user. Callers decide what to render instead; this function never produces copy.
 */
export function isRenderableAgentForm(spec: AgentFormSpec): boolean {
  if (spec.memberName.trim().length === 0) return false;
  const { questions } = spec;
  if (questions.length === 0 || questions.length > AGENT_FORM_MAX_QUESTIONS) return false;
  if (new Set(questions.map((question) => question.id)).size !== questions.length) return false;

  return questions.every((question) => {
    if (question.id.trim().length === 0 || question.title.trim().length === 0) return false;
    if (!isChoiceQuestion(question)) return true;
    const { options } = question;
    if (options.length === 0 || options.length > AGENT_FORM_MAX_PRESET_OPTIONS) return false;
    if (new Set(options.map((option) => option.id)).size !== options.length) return false;
    return options.every((option) => option.id.trim().length > 0 && option.title.trim().length > 0);
  });
}

export function createAgentFormDraft(spec: AgentFormSpec): AgentFormDraft {
  return { formId: spec.id, activeIndex: 0, answers: {} };
}

/**
 * The draft to actually render. A draft from another form is dropped rather than
 * merged: the agent has moved on, and half of somebody else's answers is worse than none.
 */
export function resolveAgentFormDraft(spec: AgentFormSpec, draft?: AgentFormDraft): AgentFormDraft {
  if (draft === undefined || draft.formId !== spec.id) return createAgentFormDraft(spec);
  const lastIndex = Math.max(spec.questions.length - 1, 0);
  const activeIndex = Math.min(Math.max(Math.trunc(draft.activeIndex), 0), lastIndex);
  return activeIndex === draft.activeIndex ? draft : { ...draft, activeIndex };
}

export function answerFor(draft: AgentFormDraft, questionId: string): AgentFormAnswer {
  return draft.answers[questionId] ?? EMPTY_ANSWER;
}

export function isQuestionAnswered(draft: AgentFormDraft, question: AgentFormQuestion): boolean {
  const answer = answerFor(draft, question.id);
  return answer.selectedOptionIds.length > 0 || answer.ownText.trim().length > 0;
}

export function answeredQuestionCount(spec: AgentFormSpec, draft: AgentFormDraft): number {
  return spec.questions.filter((question) => isQuestionAnswered(draft, question)).length;
}

export function canSubmitAgentForm(spec: AgentFormSpec, draft: AgentFormDraft): boolean {
  return answeredQuestionCount(spec, draft) > 0;
}

function withAnswer(
  draft: AgentFormDraft,
  questionId: string,
  answer: AgentFormAnswer,
): AgentFormDraft {
  return { ...draft, answers: { ...draft.answers, [questionId]: answer } };
}

/** Toggling a preset option. Single-select also gives up whatever the user had written. */
export function toggleOption(
  draft: AgentFormDraft,
  question: AgentFormChoiceQuestion,
  optionId: string,
): AgentFormDraft {
  const answer = answerFor(draft, question.id);
  if (question.kind === "single") {
    return withAnswer(draft, question.id, { selectedOptionIds: [optionId], ownText: "" });
  }
  const selected = new Set(answer.selectedOptionIds);
  if (selected.has(optionId)) selected.delete(optionId);
  else selected.add(optionId);
  return withAnswer(draft, question.id, {
    ...answer,
    selectedOptionIds: question.options
      .map((option) => option.id)
      .filter((id) => selected.has(id)),
  });
}

/**
 * Writing your own answer. Non-empty text *is* the selection, so a single-select question
 * releases its preset the moment the user starts typing, and gets it back only by picking
 * one again. Multi-select keeps both — the write-in is an extra item, not a replacement.
 */
export function applyOwnText(
  draft: AgentFormDraft,
  question: AgentFormQuestion,
  ownText: string,
): AgentFormDraft {
  const answer = answerFor(draft, question.id);
  const releasesPresets = question.kind === "single" && ownText.trim().length > 0;
  return withAnswer(draft, question.id, {
    selectedOptionIds: releasesPresets ? [] : answer.selectedOptionIds,
    ownText,
  });
}

export function goToQuestion(draft: AgentFormDraft, spec: AgentFormSpec, index: number): AgentFormDraft {
  const lastIndex = Math.max(spec.questions.length - 1, 0);
  const activeIndex = Math.min(Math.max(index, 0), lastIndex);
  return activeIndex === draft.activeIndex ? draft : { ...draft, activeIndex };
}

export interface AgentFormMessageFormat {
  /** Per-line template with `{question}` and `{answer}` placeholders. */
  line: string;
  /** Separator between the titles a multiple-choice question contributes. */
  answerJoin: string;
}

/** The answers a single question contributes, in the order the form declares them. */
export function questionAnswerText(
  draft: AgentFormDraft,
  question: AgentFormQuestion,
  answerJoin: string,
): string {
  const answer = answerFor(draft, question.id);
  const ownText = answer.ownText.trim();
  if (!isChoiceQuestion(question)) return ownText;

  const selectedTitles = question.options
    .filter((option) => answer.selectedOptionIds.includes(option.id))
    .map((option) => option.title);
  // The write-in is the last option on screen, so it reads last in the message too.
  const parts = ownText.length > 0 ? [...selectedTitles, ownText] : selectedTitles;
  return parts.join(answerJoin);
}

/**
 * The message the user actually sends: one line per answered question, title plus answer.
 * Descriptions stay out — they exist to help the user choose, and the agent wrote them.
 */
export function composeAgentFormMessage(
  spec: AgentFormSpec,
  draft: AgentFormDraft,
  format: AgentFormMessageFormat,
): string {
  return spec.questions
    .flatMap((question) => {
      const answer = questionAnswerText(draft, question, format.answerJoin);
      if (answer.length === 0) return [];
      return [format.line
        .replace("{question}", question.title.trim())
        .replace("{answer}", answer)];
    })
    .join("\n");
}
