import type { TimelineMessage } from "../conversation.js";
import type {
  LocalExecutionRecoveryPlan,
  LocalRunExecutionContextFact,
} from "./execution-context.js";
import {
  buildLocalAgentDeltaPrompt,
  buildLocalResumePrompt,
  selectLocalTimelineDelta,
} from "./prompt.js";

export type LocalRunLane = "primary" | "worker";

export type LocalRunContextPlan =
  | {
      kind: "unavailable";
      recoveryPlan: Extract<LocalExecutionRecoveryPlan, { kind: "unavailable" }>;
    }
  | {
      kind: "ready";
      recoveryPlan: Exclude<LocalExecutionRecoveryPlan, { kind: "unavailable" }>;
      continuingSameRun: boolean;
      executionContext: LocalRunExecutionContextFact;
    };

export type LocalRunInvocationPlan =
  | {
      kind: "unavailable";
      recoveryPlan: Extract<LocalExecutionRecoveryPlan, { kind: "unavailable" }>;
    }
  | {
      kind: "ready";
      recoveryPlan: Exclude<LocalExecutionRecoveryPlan, { kind: "unavailable" }>;
      executionContext: LocalRunExecutionContextFact;
      continuingSameRun: boolean;
      providerMode:
        | { kind: "full" }
        | { kind: "resume"; externalSessionId: string };
      prompt: string;
      deltaTimeline: TimelineMessage[];
      attachmentTimelineIndexes: ReadonlySet<number>;
      consumeIntentMode: "resume" | "full-fallback" | "unavailable" | null;
      workspaceAccess: "read-only" | "read-write";
    };

export function planLocalRunInvocation(input: {
  lane: LocalRunLane;
  role: string;
  sourceBody: string;
  fullPrompt: string;
  timeline: readonly TimelineMessage[];
  cursorLastSeenIndex: number;
  contextPlan: LocalRunContextPlan;
  readOnly: boolean;
}): LocalRunInvocationPlan {
  if (input.contextPlan.kind === "unavailable") {
    return { kind: "unavailable", recoveryPlan: input.contextPlan.recoveryPlan };
  }

  const { continuingSameRun, executionContext, recoveryPlan } = input.contextPlan;
  const deltaTimeline = recoveryPlan.kind === "resume" && !continuingSameRun
    ? selectLocalTimelineDelta(input.timeline, input.role, input.cursorLastSeenIndex)
    : [...input.timeline];
  const continuingIntent = continuingSameRun && recoveryPlan.kind === "resume"
    ? recoveryPlan.intent
    : null;
  const prompt = continuingIntent !== null
    ? buildLocalResumePrompt({ reason: continuingIntent.reason })
    : recoveryPlan.kind === "resume"
      ? recoveryPlan.intent?.reason === "edit-resend"
        ? `${buildLocalResumePrompt({
            reason: "edit-resend",
            correctionBody: input.sourceBody,
          })}\n\n${buildLocalAgentDeltaPrompt({ role: input.role, timeline: deltaTimeline })}`
        : buildLocalAgentDeltaPrompt({ role: input.role, timeline: deltaTimeline })
      : input.fullPrompt;
  const consumeIntentMode = recoveryPlan.intent === null
    ? null
    : recoveryPlan.kind === "resume"
      ? "resume"
      : input.lane === "worker" || recoveryPlan.intent.executionOverride !== undefined
        ? "full-fallback"
        : "unavailable";

  return {
    kind: "ready",
    recoveryPlan,
    executionContext,
    continuingSameRun,
    providerMode: recoveryPlan.kind === "resume"
      ? { kind: "resume", externalSessionId: recoveryPlan.externalSessionId }
      : { kind: "full" },
    prompt,
    deltaTimeline,
    attachmentTimelineIndexes: new Set(deltaTimeline.map((message) => message.index)),
    consumeIntentMode,
    workspaceAccess: input.readOnly ? "read-only" : "read-write",
  };
}

export function planLocalRunContext(input: {
  recoveryPlan: LocalExecutionRecoveryPlan;
  sessionId: string;
  runId: string;
  sourceMessageId: number;
  recordedAt: string;
}): LocalRunContextPlan {
  if (input.recoveryPlan.kind === "unavailable") {
    return { kind: "unavailable", recoveryPlan: input.recoveryPlan };
  }
  const continuingSameRun = input.recoveryPlan.kind === "resume"
    && input.recoveryPlan.intent?.reason === "graceful-shutdown"
    && input.recoveryPlan.intent.targetRunId === input.runId;
  return {
    kind: "ready",
    recoveryPlan: input.recoveryPlan,
    continuingSameRun,
    executionContext: continuingSameRun
      ? input.recoveryPlan.context
      : {
          ...input.recoveryPlan.context,
          sessionId: input.sessionId,
          runId: input.runId,
          sourceMessageId: input.sourceMessageId,
          recordedAt: input.recordedAt,
        },
  };
}

export function selectExecutingAgent(
  context: LocalRunExecutionContextFact,
  role: string,
):
  | { kind: "found"; agent: LocalRunExecutionContextFact["team"][number] }
  | { kind: "missing"; role: string } {
  const agent = context.team.find((candidate) => candidate.name === role);
  return agent === undefined ? { kind: "missing", role } : { kind: "found", agent };
}
