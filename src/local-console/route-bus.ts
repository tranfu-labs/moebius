import type { LocalRouteJudgmentResult } from "./local-route-judgment.js";
import type { CodexRunOptions, CodexRunResult } from "../codex.js";
import type { TimelineMessage } from "../conversation.js";
import type { LocalConsoleMessage, LocalConsoleStore } from "./types.js";
import {
  decideLocalRouteFailure,
  decideLocalRouteValidation,
  planLocalRouteAction,
  planLocalRouteAdmission,
  planLocalRouteExisting,
  routeKeyForLocalMessage,
} from "./local-route-plan.js";
import { planRuntimeFallback } from "./runtime-domain.js";

export type LocalRouteJudgment = (
  input: LocalRouteJudgmentInput,
) => Promise<LocalRouteJudgmentResult>;

export interface LocalRouteJudgmentInput {
  timeline: TimelineMessage[];
  latestMessage: LocalConsoleMessage;
  availableAgentNames: string[];
  runDir: string;
  agentsDir: string;
  timeoutMs?: number;
  runCodex?: (options: CodexRunOptions) => Promise<CodexRunResult>;
}

export interface LocalNoMentionRouteInput {
  store: LocalConsoleStore;
  message: LocalConsoleMessage;
  sessionId: string;
  timeline: TimelineMessage[];
  availableAgentNames: string[];
  runId: string;
  runDir: string | null;
  agentsDir: string;
  now: string;
  routeJudgment: LocalRouteJudgment;
  validateAppend(
    body: string,
    availableAgentNames: string[],
  ): { ok: true; targetRole: string } | { ok: false; reason: string; detail?: string };
  timeoutMs?: number;
  runCodex?: (options: CodexRunOptions) => Promise<CodexRunResult>;
}

export type LocalNoMentionRouteResult =
  | { kind: "routed"; outcome: "append"; targetRole: string }
  | { kind: "processed"; outcome: "no_action" | "fail_open" | "already-routed"; reason: string }
  | { kind: "retry"; reason: string };

export async function maybeRouteLocalNoMentionMessage(
  input: LocalNoMentionRouteInput,
): Promise<LocalNoMentionRouteResult> {
  const admission = planLocalRouteAdmission(input.message.speaker);
  if (admission.kind === "process") {
    await input.store.recordMessageProcessed({
      userMessageId: input.message.id,
      sessionId: input.sessionId,
      runId: input.runId,
      runDir: input.runDir,
      now: input.now,
    });
    return { kind: "processed", outcome: "no_action", reason: "non-user-no-route" };
  }

  const routeKey = routeKeyForLocalMessage(input.message);
  const existing = await input.store.findRouteDecision({ sessionId: input.sessionId, routeKey });
  const existingPlan = planLocalRouteExisting(existing);
  if (existingPlan.kind === "process") {
    await input.store.recordMessageProcessed({
      userMessageId: input.message.id,
      sessionId: input.sessionId,
      runId: input.runId,
      runDir: input.runDir,
      now: input.now,
    });
    return { kind: "processed", outcome: "already-routed", reason: existingPlan.existing.reason };
  }

  const routeResult = await input.routeJudgment({
    timeline: input.timeline,
    latestMessage: input.message,
    availableAgentNames: input.availableAgentNames,
    runDir: planRuntimeFallback(input.runDir, `/tmp/moebius-local-route-${String(input.message.id)}`),
    agentsDir: input.agentsDir,
    timeoutMs: input.timeoutMs,
    runCodex: input.runCodex,
  });

  const action = planLocalRouteAction(routeResult.action);
  if (action.kind === "append") {
    const append = routeResult as Extract<LocalRouteJudgmentResult, { action: "APPEND" }>;
    const validation = input.validateAppend(append.body, input.availableAgentNames);
    const validationPlan = decideLocalRouteValidation(validation.ok);
    if (validationPlan.kind === "invalid") {
      const invalid = validation as Extract<typeof validation, { ok: false }>;
      return await handleFailedRouteJudgment(input, routeKey, invalid.reason);
    }
    const valid = validation as Extract<typeof validation, { ok: true }>;
    await input.store.recordRouteAppend({
      userMessageId: input.message.id,
      sessionId: input.sessionId,
      routeKey,
      body: append.body,
      targetRole: valid.targetRole,
      runId: input.runId,
      runDir: input.runDir,
      now: input.now,
    });
    return { kind: "routed", outcome: "append", targetRole: valid.targetRole };
  }

  if (action.kind === "no-action") {
    const noAction = routeResult as Extract<LocalRouteJudgmentResult, { action: "NO_ACTION" }>;
    await input.store.recordRouteNoAction({
      userMessageId: input.message.id,
      sessionId: input.sessionId,
      routeKey,
      outcome: "no_action",
      reason: noAction.reason,
      runId: input.runId,
      runDir: input.runDir,
      now: input.now,
    });
    return { kind: "processed", outcome: "no_action", reason: noAction.reason };
  }

  return await handleFailedRouteJudgment(
    input,
    routeKey,
    (routeResult as Extract<LocalRouteJudgmentResult, { action: "FAIL_OPEN" }>).reason,
  );
}

async function handleFailedRouteJudgment(
  input: LocalNoMentionRouteInput,
  routeKey: string,
  reason: string,
): Promise<LocalNoMentionRouteResult> {
  const failure = decideLocalRouteFailure(input.message, input.availableAgentNames);
  if (failure.kind === "retry") {
    await input.store.releaseMessageForRetry({
      userMessageId: input.message.id,
      sessionId: input.sessionId,
      now: input.now,
    });
    return { kind: "retry", reason };
  }

  await input.store.recordRouteNoAction({
    userMessageId: input.message.id,
    sessionId: input.sessionId,
    routeKey,
    outcome: "fail_open",
    reason,
    runId: input.runId,
    runDir: input.runDir,
    now: input.now,
  });
  return { kind: "processed", outcome: "fail_open", reason };
}
