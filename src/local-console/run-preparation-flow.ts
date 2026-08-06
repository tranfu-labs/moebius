import type { TimelineMessage } from "../conversation.js";
import type { LocalCodexRecoveryFacts, LocalCodexResumeMode } from "./codex-resume.js";
import type { LocalCodexThreadLinkFact } from "./codex-thread-link.js";
import {
  decideLocalRecoveryAvailability,
  planLatestAgentTimelineIndex,
  planLocalExecutionContextSeed,
  planLocalExecutionRecoveryFromSeed,
  planLocalRecoveryAvailabilityCheck,
  planLocalRunExecutionContext,
  workspaceFromExecutionContext,
  type LocalAgentSessionLinkFact,
  type LocalAgentTimelineCursorFact,
  type LocalExecutionRecoveryPlan,
  type LocalExecutionSessionLinkFact,
  type LocalProviderSessionObservedFact,
  type LocalRunExecutionContextFact,
} from "./execution-context.js";
import {
  decideMemberContinuation,
  planLocalExecutingAgentPrompt,
  planLocalRunAttachmentMessages,
  planLocalRunContext,
  planLocalRunInvocation,
  type LocalRunInvocationPlan,
} from "./run-invocation-plan.js";
import type {
  LocalConsoleAgentTeamSnapshot,
  LocalConsoleExecutionProfile,
  LocalConsoleMessage,
} from "./types.js";
import type { ResolvedLocalWorkspace } from "./workspace-source.js";

export interface LocalRunRecoverySnapshot {
  recoveryFacts: LocalCodexRecoveryFacts;
  threadLinks: LocalCodexThreadLinkFact[];
  executionLinks: LocalExecutionSessionLinkFact[];
  runContexts: LocalRunExecutionContextFact[];
  canonicalLinks: LocalAgentSessionLinkFact[];
  observations: LocalProviderSessionObservedFact[];
  timelineCursors: LocalAgentTimelineCursorFact[];
}

export interface LocalRunPreparationInput {
  lane: "primary" | "worker";
  sessionId: string;
  runId: string;
  sourceMessage: Pick<LocalConsoleMessage, "id" | "body">;
  role: string;
  defaultProfile: LocalConsoleExecutionProfile | null;
  continuationEnded?: boolean;
  defaultWorkspace: ResolvedLocalWorkspace;
  concurrentWorkspace: ResolvedLocalWorkspace | null;
  team: Array<{
    name: string;
    agentMarkdown: string;
    executionProfile: LocalConsoleExecutionProfile | null;
  }>;
  teamSnapshot?: LocalConsoleAgentTeamSnapshot | null;
  timeline: TimelineMessage[];
  timelineMessages: LocalConsoleMessage[];
  readOnly: boolean;
  promptContract: string;
  runDir: string;
}

export interface LocalRunPreparationPorts {
  nowIso(): string;
  loadRecoverySnapshot(): Promise<LocalRunRecoverySnapshot>;
  isCodexThreadAvailable(externalSessionId: string): Promise<boolean>;
  settleUnavailable(plan: Extract<LocalExecutionRecoveryPlan, { kind: "unavailable" }>): Promise<void>;
  recordRunExecutionContext(context: LocalRunExecutionContextFact): Promise<void>;
  recordAgentSessionLink(link: LocalAgentSessionLinkFact): Promise<void>;
  prepareAttachments(input: {
    messages: LocalConsoleMessage[];
    runDir: string;
  }): Promise<{ promptSuffix: string; imagePaths: string[] }>;
  consumeRecoveryIntent(input: {
    intentId: string;
    mode: LocalCodexResumeMode;
    reason: string;
  }): Promise<void>;
}

export type LocalRunPreparationResult =
  | { kind: "settled-unavailable" }
  | {
      kind: "ready";
      continuingSameRun: boolean;
      executionContext: LocalRunExecutionContextFact;
      recoveryPlan: Exclude<LocalExecutionRecoveryPlan, { kind: "unavailable" }>;
      invocationPlan: Extract<LocalRunInvocationPlan, { kind: "ready" }>;
      workspace: ResolvedLocalWorkspace;
      prompt: string;
      preparedAttachments: { promptSuffix: string; imagePaths: string[] };
    };

export async function executeLocalRunPreparationFlow(
  input: LocalRunPreparationInput,
  ports: LocalRunPreparationPorts,
): Promise<LocalRunPreparationResult> {
  const snapshot = await ports.loadRecoverySnapshot();
  const contextSeed = planLocalExecutionContextSeed({
    lane: input.lane,
    sessionId: input.sessionId,
    runId: input.runId,
    sourceMessageId: input.sourceMessage.id,
    role: input.role,
    defaultProfile: input.defaultProfile,
    defaultWorkspace: input.defaultWorkspace,
    concurrentWorkspace: input.concurrentWorkspace,
    intents: snapshot.recoveryFacts.intents,
    consumedIntentIds: snapshot.recoveryFacts.consumedIntentIds,
    contexts: snapshot.runContexts,
  });
  const currentContext = planLocalRunExecutionContext({
    sessionId: input.sessionId,
    runId: input.runId,
    sourceMessageId: input.sourceMessage.id,
    role: input.role,
    seed: contextSeed,
    team: input.team,
    teamSnapshot: input.teamSnapshot,
    recordedAt: ports.nowIso(),
  });
  if (decideMemberContinuation(input.continuationEnded).kind === "ended") {
    await ports.settleUnavailable({
      kind: "unavailable",
      intent: null,
      context: currentContext,
      reason: "continuation-ended",
    });
    return { kind: "settled-unavailable" };
  }
  let recoveryPlan = planLocalExecutionRecoveryFromSeed({
    sourceMessageId: input.sourceMessage.id,
    role: input.role,
    currentContext,
    seed: contextSeed,
    intents: snapshot.recoveryFacts.intents,
    consumedIntentIds: snapshot.recoveryFacts.consumedIntentIds,
    canonicalLinks: snapshot.canonicalLinks,
    observations: snapshot.observations,
    executionLinks: snapshot.executionLinks,
    legacyCodexLinks: snapshot.threadLinks,
    contexts: snapshot.runContexts,
  });
  const availabilityCheck = planLocalRecoveryAvailabilityCheck(recoveryPlan);
  if (availabilityCheck.kind === "required") {
    recoveryPlan = decideLocalRecoveryAvailability(
      availabilityCheck.recoveryPlan,
      await ports.isCodexThreadAvailable(availabilityCheck.externalSessionId),
    );
  }
  const contextPlan = planLocalRunContext({
    recoveryPlan,
    sessionId: input.sessionId,
    runId: input.runId,
    sourceMessageId: input.sourceMessage.id,
    recordedAt: ports.nowIso(),
  });
  if (contextPlan.kind === "unavailable") {
    await ports.settleUnavailable(contextPlan.recoveryPlan);
    return { kind: "settled-unavailable" };
  }

  const executionContext = contextPlan.executionContext;
  const promptPlan = planLocalExecutingAgentPrompt({
    context: executionContext,
    role: input.role,
    timeline: input.timeline,
  });
  if (promptPlan.kind === "missing") {
    throw new Error(`Run execution context is missing Agent: ${input.role}`);
  }
  if (!contextPlan.continuingSameRun) await ports.recordRunExecutionContext(executionContext);
  if (recoveryPlan.kind === "resume" && recoveryPlan.canonicalLinkMissing) {
    await ports.recordAgentSessionLink({
      sessionId: input.sessionId,
      agentIdentityFingerprint: executionContext.agentIdentityFingerprint,
      role: input.role,
      engine: executionContext.engine,
      externalSessionId: recoveryPlan.externalSessionId,
      profileFingerprint: executionContext.profileFingerprint,
      contextFingerprint: executionContext.contextFingerprint,
      linkedAt: ports.nowIso(),
    });
  }
  const cursorLastSeenIndex = planLatestAgentTimelineIndex(
    snapshot.timelineCursors,
    executionContext.agentIdentityFingerprint,
  );
  const invocationPlan = planLocalRunInvocation({
    lane: input.lane,
    role: input.role,
    sourceBody: input.sourceMessage.body,
    fullPrompt: promptPlan.fullPrompt,
    timeline: input.timeline,
    cursorLastSeenIndex,
    contextPlan,
    readOnly: input.readOnly,
  });
  if (invocationPlan.kind === "unavailable") {
    throw new Error("Ready run context unexpectedly produced an unavailable invocation");
  }
  const attachmentMessages = planLocalRunAttachmentMessages({
    recoveryPlan: invocationPlan.recoveryPlan,
    continuingSameRun: contextPlan.continuingSameRun,
    timelineMessages: input.timelineMessages,
    attachmentTimelineIndexes: invocationPlan.attachmentTimelineIndexes,
  });
  const preparedAttachments = await ports.prepareAttachments({
    messages: attachmentMessages,
    runDir: input.runDir,
  });
  if (recoveryPlan.intent !== null) {
    await ports.consumeRecoveryIntent({
      intentId: recoveryPlan.intent.intentId,
      mode: invocationPlan.consumeIntentMode!,
      reason: recoveryPlan.reason,
    });
  }
  return {
    kind: "ready",
    continuingSameRun: contextPlan.continuingSameRun,
    executionContext,
    recoveryPlan: invocationPlan.recoveryPlan,
    invocationPlan,
    workspace: workspaceFromExecutionContext(executionContext),
    prompt: `${invocationPlan.prompt}${input.promptContract}${preparedAttachments.promptSuffix}`,
    preparedAttachments,
  };
}
