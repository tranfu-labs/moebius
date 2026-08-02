import { getLatestTimelineMessage, selectMentionedAgent } from "../conversation.js";
import type { TriggerInput, TriggerResult } from "./types.js";

export function resolveMentionTrigger(input: TriggerInput): TriggerResult | null {
  const latestMessage = getLatestTimelineMessage(input.timeline);
  if (latestMessage === null) return { kind: "skip", reason: "empty-timeline" };

  const selectedAgentName = selectMentionedAgent(latestMessage.body, input.availableAgentNames);
  if (selectedAgentName === null) return null;

  return { kind: "run-agent", role: selectedAgentName, reason: "mention" };
}
