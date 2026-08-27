import {
  isChoiceQuestion,
  resolveAgentFormDraft,
  type AgentFormAnswer,
  type AgentFormDraft,
  type AgentFormSpec,
} from "@moebius/console-ui/console/agent-form-model";
import type { ConversationDraftKey } from "./conversation-draft-model.js";
import type { ConversationDraftStore } from "./draft-store.js";

export function readAgentFormDraft(
  store: ConversationDraftStore,
  key: ConversationDraftKey,
  spec: AgentFormSpec,
): AgentFormDraft {
  const raw = store.read(key);
  if (raw.trim() === "") return resolveAgentFormDraft(spec);
  try {
    const value: unknown = JSON.parse(raw);
    const parsed = parseDraft(value, spec);
    return parsed === null ? resolveAgentFormDraft(spec) : resolveAgentFormDraft(spec, parsed);
  } catch {
    return resolveAgentFormDraft(spec);
  }
}

export function writeAgentFormDraft(
  store: ConversationDraftStore,
  key: ConversationDraftKey,
  draft: AgentFormDraft,
): void {
  store.write(key, JSON.stringify(draft));
}

export function isAgentFormSubmitted(store: ConversationDraftStore, key: ConversationDraftKey): boolean {
  return store.read(key) === "1";
}

export function markAgentFormSubmitted(store: ConversationDraftStore, key: ConversationDraftKey): void {
  store.write(key, "1");
}

export function discardAgentForm(
  store: ConversationDraftStore,
  draftKey: ConversationDraftKey,
  submittedKey: ConversationDraftKey,
): void {
  store.clear(draftKey);
  markAgentFormSubmitted(store, submittedKey);
}

function parseDraft(value: unknown, spec: AgentFormSpec): AgentFormDraft | null {
  if (!isRecord(value) || value.formId !== spec.id || typeof value.activeIndex !== "number" || !Number.isFinite(value.activeIndex)) {
    return null;
  }
  if (!isRecord(value.answers)) return null;
  const answers: Record<string, AgentFormAnswer> = {};
  for (const question of spec.questions) {
    const rawAnswer = value.answers[question.id];
    if (rawAnswer === undefined) continue;
    if (!isRecord(rawAnswer) || typeof rawAnswer.ownText !== "string" || !Array.isArray(rawAnswer.selectedOptionIds)) {
      return null;
    }
    const selectedOptionIds = isChoiceQuestion(question)
      ? rawAnswer.selectedOptionIds.filter((id): id is string =>
          typeof id === "string" && question.options.some((option) => option.id === id))
      : [];
    answers[question.id] = {
      selectedOptionIds,
      ownText: rawAnswer.ownText,
    };
  }
  return { formId: spec.id, activeIndex: Math.trunc(value.activeIndex), answers };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
