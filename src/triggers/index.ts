import { resolveMentionTrigger } from "./mention-trigger.js";
import type { TriggerInput, TriggerResult } from "./types.js";

export function resolveTrigger(input: TriggerInput): TriggerResult {
  const mentionTrigger = resolveMentionTrigger(input);
  if (mentionTrigger !== null) return mentionTrigger;
  return { kind: "skip", reason: "no-trigger" };
}

export type { TriggerResult } from "./types.js";
