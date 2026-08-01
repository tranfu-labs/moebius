import type { TriggerResult } from "../triggers/index.js";
import type { LocalCodexResumeIntentFact } from "./codex-resume.js";
import type { LocalConsoleMessage } from "./types.js";

export type LocalClaimedControlAction =
  | { kind: "complete-source" }
  | { kind: "record-retry-trigger-missing"; intent: LocalCodexResumeIntentFact }
  | { kind: "route-without-primary-agent" }
  | { kind: "fail-missing-agent"; role: string }
  | { kind: "run-primary"; role: string }
  | { kind: "schedule-worker"; role: string };

export function selectSourceRetryIntent(input: {
  sourceMessageId: number;
  intents: readonly LocalCodexResumeIntentFact[];
  consumedIntentIds: ReadonlySet<string>;
}): LocalCodexResumeIntentFact | null {
  return [...input.intents].reverse().find((intent) =>
    intent.reason === "retry"
    && intent.sourceMessageId === input.sourceMessageId
    && !input.consumedIntentIds.has(intent.intentId)) ?? null;
}

export function resolveClaimedControlAction(input: {
  source: Pick<LocalConsoleMessage, "speaker" | "role">;
  primaryAgent: string | null;
  explicitTrigger: TriggerResult;
  availableAgentNames: readonly string[];
  retryIntent: LocalCodexResumeIntentFact | null;
}): LocalClaimedControlAction {
  const trigger: TriggerResult = input.source.speaker === "user" && input.primaryAgent !== null
    ? { kind: "run-agent", role: input.primaryAgent, reason: "mention" }
    : input.explicitTrigger.kind === "skip" && input.primaryAgent !== null
      ? input.source.speaker === "agent" && input.source.role !== input.primaryAgent
        ? { kind: "run-agent", role: input.primaryAgent, reason: "mention" }
        : input.explicitTrigger
      : input.explicitTrigger;

  if (trigger.kind !== "run-agent") {
    if (input.source.speaker === "agent") {
      return input.retryIntent === null
        ? { kind: "complete-source" }
        : { kind: "record-retry-trigger-missing", intent: input.retryIntent };
    }
    return { kind: "route-without-primary-agent" };
  }

  if (!input.availableAgentNames.includes(trigger.role)) {
    return { kind: "fail-missing-agent", role: trigger.role };
  }

  if (
    input.source.speaker === "agent"
    && input.primaryAgent !== null
    && trigger.role !== input.primaryAgent
  ) {
    return { kind: "schedule-worker", role: trigger.role };
  }

  return { kind: "run-primary", role: trigger.role };
}

export interface LocalPendingWorkerCandidate {
  message: Pick<
    LocalConsoleMessage,
    "id" | "speaker" | "status" | "dispatchLane" | "dispatchRole"
  >;
  role: string;
}

export function planPendingWorkerDispatches(input: {
  messages: readonly LocalPendingWorkerCandidate["message"][];
  activeRoles: ReadonlySet<string>;
  queuedRoles: ReadonlySet<string>;
}): LocalPendingWorkerCandidate[] {
  const firstPendingByRole = new Map<string, LocalPendingWorkerCandidate["message"]>();
  for (const message of input.messages) {
    if (
      message.speaker !== "user"
      || message.status !== "pending"
      || message.dispatchLane !== "worker"
      || message.dispatchRole == null
      || firstPendingByRole.has(message.dispatchRole)
    ) {
      continue;
    }
    firstPendingByRole.set(message.dispatchRole, message);
  }

  return [...firstPendingByRole].flatMap(([role, message]) =>
    input.activeRoles.has(role) || input.queuedRoles.has(role)
      ? []
      : [{ message, role }]);
}
