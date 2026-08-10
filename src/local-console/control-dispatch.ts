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

/**
 * 主理人一等收束信号可记录性（domain）：complete-source 判定只对主理人 Agent 消息
 * 生效，且需要 store 具备落盘能力；返回 record 时携带要落盘的角色。
 */
export function planPrimaryCloseoutRecordability(input: {
  speaker: string;
  role: string | null;
  primaryAgent: string | null;
  recordCapable: boolean;
}): { kind: "record"; role: string } | { kind: "skip" } {
  return input.speaker === "agent"
    && input.role !== null
    && input.role === input.primaryAgent
    && input.recordCapable
    ? { kind: "record", role: input.role }
    : { kind: "skip" };
}

export interface LocalPendingWorkerCandidate {
  message: Pick<
    LocalConsoleMessage,
    "id" | "speaker" | "status" | "dispatchLane" | "dispatchRole"
  >;
  role: string;
}

/** 非主 Agent 回复是否需要在继续推动接力前做派工世代失效检查。 */
export function decideWorkerReplyStalenessCheck(input: {
  speaker: string;
  role: string | null;
  primaryAgent: string | null;
  runId: string | null;
  actionKind: string;
  handoffStateAvailable: boolean;
}): { kind: "check"; role: string; runId: string } | { kind: "skip" } {
  const continuesFlow = input.actionKind === "run-primary"
    || input.actionKind === "schedule-worker"
    || input.actionKind === "record-retry-trigger-missing";
  return input.speaker === "agent"
    && input.role !== null
    && input.role !== input.primaryAgent
    && input.runId !== null
    && continuesFlow
    && input.handoffStateAvailable
    ? { kind: "check", role: input.role, runId: input.runId }
    : { kind: "skip" };
}

/** 回复所属 run 的派工 generation 落后于该角色最新 generation 时，该回复为晚到结果。 */
export function decideHandoffStaleness(input: {
  runGeneration: number | null;
  latestGeneration: number | null;
}): { kind: "stale" } | { kind: "current" } {
  return input.runGeneration !== null
    && input.latestGeneration !== null
    && input.runGeneration < input.latestGeneration
    ? { kind: "stale" }
    : { kind: "current" };
}

export interface LocalHandoffDispatchFactInput {
  sessionId: string;
  role: string;
  runId: string;
  sourceMessageId: number;
  now: string;
}

/** 晚到结果是否覆盖为 complete-source（不再继续推动接力）。 */
export function decideHandoffStaleOutcome(input: { stale: boolean }): { kind: "complete-source" } | { kind: "keep" } {
  return input.stale ? { kind: "complete-source" } : { kind: "keep" };
}

/** 晚到结果覆盖判定（domain）：handoff 判定为 complete-source 时覆盖当前控制动作。 */
export function planHandoffControlOverride(
  controlAction: LocalClaimedControlAction,
  handoffOutcome: { kind: "complete-source" } | { kind: "keep" },
): LocalClaimedControlAction {
  return handoffOutcome.kind === "complete-source" ? { kind: "complete-source" } : controlAction;
}

/** store 提供派工事实写入能力时记录，否则跳过（测试替身/旧包装 store 保持现状行为）。 */
export function decideHandoffDispatchRecording(input: {
  record: ((fact: LocalHandoffDispatchFactInput) => Promise<number>) | undefined;
}): { kind: "record"; record: (fact: LocalHandoffDispatchFactInput) => Promise<number> } | { kind: "skip" } {
  return input.record === undefined
    ? { kind: "skip" }
    : { kind: "record", record: input.record };
}

function isFactRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 从事实事件投影 (session, role) 的下一派工 generation（既有最大值 +1）。 */
export function planHandoffDispatchGeneration(
  events: readonly { type: string; payload: unknown }[],
  input: { sessionId: string; role: string },
): number {
  let maximum = 0;
  for (const event of events) {
    if (event.type !== "handoff_dispatch" || !isFactRecord(event.payload)) continue;
    const payload = event.payload;
    if (payload.sessionId !== input.sessionId || payload.role !== input.role) continue;
    const generation = payload.generation;
    if (typeof generation === "number" && Number.isInteger(generation)) {
      maximum = Math.max(maximum, generation);
    }
  }
  return maximum + 1;
}

/** 投影某 run 所属派工 generation 与该 (session, role) 的最新 generation。 */
export function planHandoffDispatchState(
  events: readonly { type: string; payload: unknown }[],
  input: { sessionId: string; role: string; runId: string },
): { runGeneration: number | null; latestGeneration: number | null } {
  let runGeneration: number | null = null;
  let latestGeneration: number | null = null;
  for (const event of events) {
    if (event.type !== "handoff_dispatch" || !isFactRecord(event.payload)) continue;
    const payload = event.payload;
    if (payload.sessionId !== input.sessionId || payload.role !== input.role) continue;
    const generation = payload.generation;
    if (typeof generation !== "number" || !Number.isInteger(generation)) continue;
    if (payload.runId === input.runId) runGeneration = generation;
    latestGeneration = Math.max(latestGeneration ?? 0, generation);
  }
  return { runGeneration, latestGeneration };
}

export type LocalWorkerDispatchCheckpoint = { kind: "continue" } | { kind: "stop" };

export function decideWorkerDispatchCheckpoint(stopping: boolean): LocalWorkerDispatchCheckpoint {
  return stopping ? { kind: "stop" } : { kind: "continue" };
}

export type LocalWorkerClaimDecision =
  | { kind: "claimed"; message: LocalConsoleMessage }
  | { kind: "empty" };

export function decideWorkerClaim(message: LocalConsoleMessage | null): LocalWorkerClaimDecision {
  return message === null ? { kind: "empty" } : { kind: "claimed", message };
}

export function planPendingWorkerRoles(
  messages: readonly Pick<LocalConsoleMessage, "dispatchRole">[],
): ReadonlySet<string> {
  return new Set(messages.flatMap((message) =>
    message.dispatchRole == null ? [] : [message.dispatchRole]));
}

export type LocalWorkerAgentSelection =
  | { kind: "found"; index: number }
  | { kind: "missing"; role: string };

export function planWorkerAgentSelection(
  agentNames: readonly string[],
  role: string,
): LocalWorkerAgentSelection {
  const index = agentNames.indexOf(role);
  return index < 0 ? { kind: "missing", role } : { kind: "found", index };
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
