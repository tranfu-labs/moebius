import { parseAgentMentions } from "../conversation.js";

export type LocalRouteJudgmentResult =
  | { action: "NO_ACTION"; reason: "ceo-no-action" }
  | { action: "APPEND"; body: string; targetRole: string; reason: "appended" }
  | {
      action: "FAIL_OPEN";
      reason:
        | "codex-failed"
        | "codex-timeout"
        | "empty-output"
        | "invalid-json"
        | "unknown-action"
        | "empty-body"
        | "missing-mention"
        | "multiple-mentions"
        | "unknown-mention"
        | "persona-load-failed";
      detail?: string;
    };

export type ParsedLocalRouteJudgment =
  | { kind: "no_action" }
  | { kind: "append"; body: string }
  | { kind: "invalid_json"; detail: string }
  | { kind: "unknown_action"; detail: string };

export function parseLocalRouteJudgment(output: string): ParsedLocalRouteJudgment {
  const raw = stripFencedCodeBlock(output.trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { kind: "invalid_json", detail: formatError(error) };
  }
  if (!isPlainObject(parsed)) {
    return { kind: "invalid_json", detail: "output is not a JSON object" };
  }
  const action = parsed["action"];
  if (action === "no_action") return { kind: "no_action" };
  if (action === "append") {
    const body = typeof parsed["body"] === "string" ? parsed["body"] : "";
    return { kind: "append", body: body.trimEnd() };
  }
  return { kind: "unknown_action", detail: typeof action === "string" ? action : JSON.stringify(action) };
}

export function validateLocalRouteAppendBody(
  body: string,
  availableAgentNames: string[],
):
  | { ok: true; targetRole: string }
  | { ok: false; reason: "empty-body" | "missing-mention" | "multiple-mentions" | "unknown-mention"; detail?: string } {
  if (body.trim() === "") return { ok: false, reason: "empty-body" };
  const mentions = parseAgentMentions(body);
  if (mentions.length === 0) return { ok: false, reason: "missing-mention" };
  if (mentions.length > 1) {
    return { ok: false, reason: "multiple-mentions", detail: mentions.map((mention) => mention.name).join(",") };
  }
  const targetRole = mentions[0]?.name;
  if (targetRole === undefined || !availableAgentNames.includes(targetRole)) {
    return { ok: false, reason: "unknown-mention", detail: targetRole };
  }
  return { ok: true, targetRole };
}

function stripFencedCodeBlock(text: string): string {
  const fenced = text.match(/^```(?:[A-Za-z0-9_-]+)?\s*([\s\S]*?)\s*```$/u);
  return fenced?.[1]?.trim() ?? text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}
