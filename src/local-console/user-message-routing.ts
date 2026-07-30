import { parseAgentMentions } from "../conversation.js";

export type LocalUserMessageDispatchLane = "primary" | "worker" | "awaiting-team";
export type LocalUserMessageDispatchReason =
  | "single-valid-mention"
  | "no-valid-mention"
  | "multiple-valid-mentions";

export interface LocalUserMessageDispatch {
  lane: Exclude<LocalUserMessageDispatchLane, "awaiting-team">;
  role: string;
  reason: LocalUserMessageDispatchReason;
}

export function resolveLocalUserMessageDispatch(input: {
  body: string;
  availableAgentNames: readonly string[];
  primaryAgent: string;
}): LocalUserMessageDispatch {
  const available = new Set(input.availableAgentNames);
  const validTargets = new Set(
    parseAgentMentions(input.body)
      .map((mention) => mention.name)
      .filter((name) => available.has(name)),
  );

  if (validTargets.size === 1) {
    const role = [...validTargets][0]!;
    return {
      lane: role === input.primaryAgent ? "primary" : "worker",
      role,
      reason: "single-valid-mention",
    };
  }

  return {
    lane: "primary",
    role: input.primaryAgent,
    reason: validTargets.size === 0
      ? "no-valid-mention"
      : "multiple-valid-mentions",
  };
}
