import { isRenderableAgentForm, type AgentFormQuestion, type AgentFormSpec } from "./agent-form-model.js";

/** The private response fence understood by the real console host. */
export const AGENT_FORM_FENCE = "moebius-form";

export interface AgentFormMessageFallback {
  memberName: string;
  memberSlug?: string;
}

export interface ParsedAgentFormMessage {
  /** Agent prose with a valid form fence removed; invalid fences stay visible as prose. */
  body: string;
  spec: AgentFormSpec | null;
}

/**
 * Extract one structured form from an Agent response.
 *
 * The fence is an implementation protocol, not user-facing Markdown. Malformed or
 * oversized payloads deliberately return the original body so the existing prose fallback
 * remains safe and observable.
 */
export function parseAgentFormMessage(
  body: string,
  fallback: AgentFormMessageFallback,
): ParsedAgentFormMessage {
  const openingFence = "```" + AGENT_FORM_FENCE;
  const closingFence = "```";
  const candidates = [...body.matchAll(new RegExp(
    `${openingFence}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n${closingFence}`,
    "gu",
  ))];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const match = candidates[index];
    if (match === undefined || match.index === undefined) continue;
    const spec = parseAgentFormSpec(match[1], fallback);
    if (spec === null) continue;
    const visibleBody = `${body.slice(0, match.index)}${body.slice(match.index + match[0].length)}`
      .replace(/\n{3,}/gu, "\n\n")
      .trim();
    return { body: visibleBody, spec };
  }
  return { body, spec: null };
}

function parseAgentFormSpec(rawJson: string | undefined, fallback: AgentFormMessageFallback): AgentFormSpec | null {
  if (rawJson === undefined) return null;
  let value: unknown;
  try {
    value = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const id = readNonBlankString(value.id);
  if (id === null) return null;
  const questions = readQuestions(value.questions);
  if (questions === null) return null;
  const memberName = readNonBlankString(value.memberName) ?? fallback.memberName;
  if (memberName.trim().length === 0) return null;
  const memberSlug = readNonBlankString(value.memberSlug) ?? fallback.memberSlug;
  const spec: AgentFormSpec = {
    id,
    memberName,
    ...(memberSlug === undefined ? {} : { memberSlug }),
    ...(value.portraitId === null || typeof value.portraitId === "string"
      ? { portraitId: value.portraitId ?? null }
      : {}),
    questions,
  };
  return isRenderableAgentForm(spec) ? spec : null;
}

function readQuestions(value: unknown): AgentFormQuestion[] | null {
  if (!Array.isArray(value)) return null;
  const questions: AgentFormQuestion[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const id = readNonBlankString(item.id);
    const title = readNonBlankString(item.title);
    const kind = item.kind;
    if (id === null || title === null || (kind !== "single" && kind !== "multiple" && kind !== "text")) {
      return null;
    }
    if (kind === "text") {
      questions.push({ id, title, kind });
      continue;
    }
    if (!Array.isArray(item.options)) return null;
    const options = [];
    for (const option of item.options) {
      if (!isRecord(option)) return null;
      const optionId = readNonBlankString(option.id);
      const optionTitle = readNonBlankString(option.title);
      if (optionId === null || optionTitle === null) return null;
      const description = typeof option.description === "string" ? option.description : undefined;
      options.push(description === undefined
        ? { id: optionId, title: optionTitle }
        : { id: optionId, title: optionTitle, description });
    }
    questions.push({ id, title, kind, options });
  }
  return questions;
}

function readNonBlankString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
