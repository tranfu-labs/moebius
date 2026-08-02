import type { LocalConsoleAgentTeamSnapshot, LocalConsoleMessage } from "./types.js";
import { resolveLocalUserMessageDispatch } from "./user-message-routing.js";

export type PendingSessionContextPromotionPlan =
  | { kind: "blocked" }
  | { kind: "promote-only" }
  | { kind: "promote-and-resolve"; awaiting: LocalConsoleMessage[] };

export function planPendingSessionContextPromotion(input: {
  hasActiveRun: boolean;
  hasScheduledWorker: boolean;
  messages: readonly LocalConsoleMessage[];
}): PendingSessionContextPromotionPlan {
  if (input.hasActiveRun || input.hasScheduledWorker) return { kind: "blocked" };
  const workerPending = input.messages.some((message) =>
    message.speaker === "user"
    && (message.status === "pending" || message.status === "running")
    && message.dispatchLane === "worker");
  if (workerPending) return { kind: "blocked" };
  const awaiting = input.messages.filter((message) =>
    message.speaker === "user"
    && message.status === "pending"
    && message.dispatchLane === "awaiting-team");
  return awaiting.length === 0 ? { kind: "promote-only" } : { kind: "promote-and-resolve", awaiting };
}

export function decidePendingDispatchCapability(
  available: boolean,
): { kind: "available" } | { kind: "unavailable" } {
  return available ? { kind: "available" } : { kind: "unavailable" };
}

export function decidePendingAgentSource(
  snapshot: LocalConsoleAgentTeamSnapshot | null | undefined,
): { kind: "load" } | { kind: "snapshot"; agentNames: string[] } {
  return snapshot == null
    ? { kind: "load" }
    : { kind: "snapshot", agentNames: snapshot.members.map((member) => member.name) };
}

export type AwaitingDispatchResolutionPlan =
  | { kind: "skip" }
  | {
      kind: "resolve";
      dispatches: Array<{
        messageId: number;
        lane: "primary" | "worker";
        role: string;
        reason: "single-valid-mention" | "no-valid-mention" | "multiple-valid-mentions";
      }>;
    };

export function planAwaitingDispatchResolution(
  awaiting: readonly LocalConsoleMessage[],
  agentNames: readonly string[],
): AwaitingDispatchResolutionPlan {
  const primaryAgent = agentNames[0];
  if (primaryAgent === undefined) return { kind: "skip" };
  return {
    kind: "resolve",
    dispatches: awaiting.map((message) => ({
      messageId: message.id,
      ...resolveLocalUserMessageDispatch({
        body: message.body,
        availableAgentNames: agentNames,
        primaryAgent,
      }),
    })),
  };
}
