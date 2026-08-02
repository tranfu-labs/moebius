import type { TimelineMessage } from "../conversation.js";

export type TriggerResult =
  | { kind: "run-agent"; role: string; reason: "mention" }
  | { kind: "skip"; reason: "empty-timeline" | "no-trigger" };

export interface TriggerInput {
  timeline: TimelineMessage[];
  availableAgentNames: string[];
}
