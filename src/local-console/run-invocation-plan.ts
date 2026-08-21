import type { TimelineMessage } from "../conversation.js";
import { parseAgentManifest } from "../agent-manifest.js";
import type {
  LocalExecutionRecoveryPlan,
  LocalRunExecutionContextFact,
} from "./execution-context.js";
import {
  buildLocalAgentPrompt,
  buildLocalResumeDeltaPrompt,
  createLocalAgentPromptContext,
  selectLocalTimelineDelta,
  type LocalAgentPromptContext,
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
  promptContext: LocalAgentPromptContext;
  timeline: readonly TimelineMessage[];
  cursorLastSeenIndex: number;
  contextPlan: LocalRunContextPlan;
  readOnly: boolean;
}): LocalRunInvocationPlan {
  if (input.contextPlan.kind === "unavailable") {
    return { kind: "unavailable", recoveryPlan: input.contextPlan.recoveryPlan };
  }

  const { continuingSameRun, executionContext, recoveryPlan } = input.contextPlan;
  const deltaTimeline = recoveryPlan.kind === "resume"
    ? selectLocalTimelineDelta(input.timeline, input.role, input.cursorLastSeenIndex)
    : [...input.timeline];
  const resumeReason = recoveryPlan.kind === "resume"
    ? recoveryPlan.intent?.reason
    : undefined;
  const prompt = recoveryPlan.kind === "resume"
    ? buildLocalResumeDeltaPrompt({
        role: input.role,
        timeline: deltaTimeline,
        reason: resumeReason,
        correctionBody: resumeReason === "edit-resend" ? input.sourceBody : undefined,
      })
    : buildLocalAgentPrompt({
        ...input.promptContext,
        timeline: input.timeline,
      });
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

export type LocalExecutingAgentPromptPlan =
  | { kind: "missing"; role: string }
  | { kind: "ready"; promptContext: LocalAgentPromptContext };

export function planLocalExecutingAgentPrompt(input: {
  context: LocalRunExecutionContextFact;
  role: string;
}): LocalExecutingAgentPromptPlan {
  const selection = selectExecutingAgent(input.context, input.role);
  if (selection.kind === "missing") return selection;
  const manifest = parseAgentManifest(selection.agent.agentMarkdown);
  return {
    kind: "ready",
    promptContext: createLocalAgentPromptContext({
      role: input.role,
      agentMarkdown: manifest.body,
      primaryAgent: input.context.team[0]?.name ?? input.role,
      availableAgentNames: input.context.team.map((agent) => agent.name),
    }),
  };
}

export function planLocalRunAttachmentMessages<T>(input: {
  recoveryPlan: Exclude<LocalExecutionRecoveryPlan, { kind: "unavailable" }>;
  timelineMessages: T[];
  attachmentTimelineIndexes: ReadonlySet<number>;
}): T[] {
  return input.recoveryPlan.kind === "resume"
    ? input.timelineMessages.filter((_message, index) =>
        input.attachmentTimelineIndexes.has(index))
    : input.timelineMessages;
}

export function decideMemberContinuation(ended: boolean | undefined):
  | { kind: "continue" }
  | { kind: "ended" } {
  return ended === true ? { kind: "ended" } : { kind: "continue" };
}
