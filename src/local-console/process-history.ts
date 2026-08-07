import type { LocalCodexThreadLinkFact } from "./codex-thread-link.js";
import type {
  CodexRolloutPromptLayer,
  CodexRolloutUnavailableReason,
  ResolveCodexRolloutOptions,
} from "./codex-rollout.js";
import type {
  LocalExecutionSessionLinkFact,
  LocalRunExecutionContextFact,
} from "./execution-context.js";
import type {
  ProviderContextSection,
  ProviderTraceLink,
  ProviderTraceResolution,
  ProviderTraceResolverOptions,
} from "./provider-process-trace.js";
import type { LocalConsoleProcessEvent } from "./process-event-projector.js";
import type { LocalConsoleExecutionEngine, LocalConsoleMessage, LocalConsoleRunTiming } from "./types.js";
import type { TrustedJsonlIdentity } from "../trusted-jsonl.js";
import {
  ProcessCursorError,
  type LocalProcessTraceReader,
} from "./process-history-contracts.js";

export interface LocalConsoleProcessAttemptMeta {
  runId: string;
  attempt: number;
  role: string;
  engine: LocalConsoleExecutionEngine;
  model: string | null;
  effort: string | null;
  provider: string | null;
  cliVersion: string | null;
  metadataSource: "rollout" | "provider-native" | "immutable-context" | "not-recorded";
  externalSessionId: string;
  identityLabel: "thread" | "session";
  threadId: string;
  startedAt: string;
  status: LocalConsoleRunTiming["status"];
  elapsedMs: number | null;
  completedAt: string | null;
}

export type LocalConsoleProcessTimelineEvent =
  | LocalConsoleProcessEvent
  | {
      key: string;
      kind: "attempt-header";
      runId: string;
      attempt: number;
      role: string;
      engine: LocalConsoleExecutionEngine;
      model: string | null;
      effort: string | null;
      provider: string | null;
      cliVersion: string | null;
      metadataSource: "rollout" | "provider-native" | "immutable-context" | "not-recorded";
      externalSessionId: string;
      identityLabel: "thread" | "session";
      threadId: string;
      startedAt: string;
      status: LocalConsoleRunTiming["status"];
      elapsedMs: number | null;
      completedAt: string | null;
    }
  | {
      key: string;
      kind: "execution-header";
      runId: string;
      attempt: number;
    };

export type LocalConsoleProcessUnavailableReason =
  | "link-missing"
  | "link-invalid"
  | "identity-invalid"
  | "source-message-missing"
  | CodexRolloutUnavailableReason;

export interface LocalConsoleProcessHistoryPage {
  sessionId: string;
  requestedRunId: string;
  role: string | null;
  status: "running" | "settled" | "unavailable";
  unavailableReason: LocalConsoleProcessUnavailableReason | null;
  unavailableEngine: LocalConsoleExecutionEngine | null;
  attempts: LocalConsoleProcessAttemptMeta[];
  events: LocalConsoleProcessTimelineEvent[];
  previousCursor: string | null;
  appendCursor: string | null;
  atLatest: boolean;
}

export interface LocalConsoleProcessAppendPage {
  events: LocalConsoleProcessEvent[];
  appendCursor: string;
  atLatest: boolean;
  status: "running" | "settled";
}

export type LocalConsoleProcessDebugInvocation =
  | {
      status: "available";
      sessionId: string;
      runId: string;
      engine: LocalConsoleExecutionEngine;
      sections?: ProviderContextSection[];
      prompts: {
        system: CodexRolloutPromptLayer;
        developer: CodexRolloutPromptLayer;
        user: CodexRolloutPromptLayer;
      };
      metadata: {
        model: string | null;
        effort: string | null;
        provider: string | null;
        cliVersion: string | null;
        cwd: string | null;
        externalSessionId: string;
        identityLabel: "thread" | "session";
        threadId: string;
        metadataSource: "rollout" | "provider-native" | "immutable-context" | "not-recorded";
      };
    }
  | {
      status: "unavailable" | "malformed";
      sessionId: string;
      runId: string;
      reason: string;
    };

export interface LoadLocalProcessHistoryOptions {
  sessionId: string;
  requestedRunId: string;
  sessionFactLogPath: string;
  messages: LocalConsoleMessage[];
  activeRunIds: ReadonlySet<string>;
  factReader: LocalProcessFactReader;
  cursor?: string;
  rollout?: ResolveCodexRolloutOptions;
  trace?: ProviderTraceResolverOptions;
  maxBytes?: number;
  maxEvents?: number;
}

export interface LoadLocalProcessAppendOptions {
  sessionId: string;
  requestedRunId: string;
  sessionFactLogPath: string;
  activeRunIds: ReadonlySet<string>;
  factReader: LocalProcessFactReader;
  appendCursor: string;
  rollout?: ResolveCodexRolloutOptions;
  trace?: ProviderTraceResolverOptions;
  maxBytes?: number;
  maxEvents?: number;
}

export interface LocalProcessFactReader {
  readCodexThreadLinks(logPath: string, sessionId: string): Promise<LocalCodexThreadLinkFact[]>;
  readExecutionSessionLinks(logPath: string, sessionId: string): Promise<LocalExecutionSessionLinkFact[]>;
  readRunExecutionContexts(logPath: string, sessionId: string): Promise<LocalRunExecutionContextFact[]>;
}

export interface ResolvedAttempt {
  link: ProviderTraceLink;
  meta: LocalConsoleProcessAttemptMeta;
  resolution: ProviderTraceResolution;
}

export type PreviousCursorState =
  | {
      v: 1;
      kind: "previous";
      sessionId: string;
      requestedRunId: string;
      sourceMessageId: number;
      attemptIndex: number;
      runId: string;
      engine: LocalConsoleExecutionEngine;
      stage: "output";
      position: number | null;
      identity: CursorIdentity | null;
    }
  | {
      v: 1;
      kind: "previous";
      sessionId: string;
      requestedRunId: string;
      sourceMessageId: number;
      attemptIndex: number;
      runId: string;
      engine: LocalConsoleExecutionEngine;
      stage: "intro";
      position: number;
      identity: null;
    };

export interface AppendCursorState {
  v: 1;
  kind: "append";
  sessionId: string;
  requestedRunId: string;
  sourceMessageId: number;
  attemptIndex: number;
  runId: string;
  engine: LocalConsoleExecutionEngine;
  position: number;
  identity: CursorIdentity;
}

export interface CursorIdentity {
  device: number;
  inode: number;
  minimumSize: number;
}

export interface ProcessHistoryAccumulator {
  state: PreviousCursorState;
  remainingEvents: number;
  remainingBytes: number;
  pageEvents: LocalConsoleProcessTimelineEvent[];
  previousCursor: string | null;
  latestAppendState: AppendCursorState | null;
  done: boolean;
}

export type ProcessAttemptsPreparation =
  | {
      kind: "available";
      attempts: ResolvedAttempt[];
      meta: LocalConsoleProcessAttemptMeta[];
      anchor: ProviderTraceLink;
      sourceMessageId: number;
    }
  | {
      kind: "unavailable";
      unavailableReason: LocalConsoleProcessUnavailableReason;
      unavailableEngine: LocalConsoleExecutionEngine | null;
    };

export function decideProcessAttemptsAvailability(
  prepared: ProcessAttemptsPreparation,
):
  | { kind: "unavailable"; prepared: Extract<ProcessAttemptsPreparation, { kind: "unavailable" }> }
  | { kind: "available"; prepared: Extract<ProcessAttemptsPreparation, { kind: "available" }> } {
  return prepared.kind === "unavailable"
    ? { kind: "unavailable", prepared }
    : { kind: "available", prepared };
}

export function planDebugProcessSource(input: {
  links: ProviderTraceLink[];
  contexts: LocalRunExecutionContextFact[];
  runId: string;
}):
  | { kind: "unavailable" }
  | { kind: "selected"; link: ProviderTraceLink; context: LocalRunExecutionContextFact | undefined } {
  const link = input.links.find((candidate) => candidate.runId === input.runId);
  return link === undefined
    ? { kind: "unavailable" }
    : {
        kind: "selected",
        link,
        context: input.contexts.find((candidate) => candidate.runId === input.runId),
      };
}

export function planDebugTraceResolution(
  resolution: ProviderTraceResolution,
):
  | { kind: "unavailable"; reason: string }
  | { kind: "codex"; resolution: Extract<ProviderTraceResolution, { status: "available"; engine: "codex" }> }
  | { kind: "native"; resolution: Extract<ProviderTraceResolution, { status: "available"; engine: "claude" | "kimi" | "pi" }> } {
  if (resolution.status !== "available") return { kind: "unavailable", reason: resolution.reason };
  return resolution.engine === "codex"
    ? { kind: "codex", resolution }
    : { kind: "native", resolution };
}

export function planCodexDebugInvocation(input: {
  options: { sessionId: string; runId: string };
  link: ProviderTraceLink;
  context: LocalRunExecutionContextFact | undefined;
  invocation: Awaited<ReturnType<LocalProcessTraceReader["readCodexInvocation"]>>;
}): LocalConsoleProcessDebugInvocation {
  if (input.invocation.status === "malformed") {
    return {
      status: "malformed",
      sessionId: input.options.sessionId,
      runId: input.options.runId,
      reason: input.invocation.reason,
    };
  }
  const fallbackModel = input.context?.profile?.model ?? null;
  const fallbackEffort = input.context?.profile?.effort ?? null;
  const usedProviderMetadata = Object.values(input.invocation.metadata).some((value) => value !== null);
  const usedContextMetadata = !usedProviderMetadata
    && (fallbackModel !== null || fallbackEffort !== null || input.context?.workspace.cwd !== undefined);
  return {
    status: "available",
    sessionId: input.options.sessionId,
    runId: input.options.runId,
    engine: "codex",
    sections: [
      { key: "system", label: "SYSTEM_PROMPT", source: "codex-rollout", ...input.invocation.prompts.system },
      { key: "developer", label: "DEVELOPER_PROMPT", source: "codex-rollout", ...input.invocation.prompts.developer },
      { key: "user", label: "USER_INPUT", source: "codex-rollout", ...input.invocation.prompts.user },
    ],
    prompts: input.invocation.prompts,
    metadata: {
      model: input.invocation.metadata.model ?? fallbackModel,
      effort: input.invocation.metadata.effort ?? fallbackEffort,
      provider: input.invocation.metadata.provider,
      cliVersion: input.invocation.metadata.cliVersion,
      cwd: input.invocation.metadata.cwd ?? input.context?.workspace.cwd ?? null,
      externalSessionId: input.link.externalSessionId,
      identityLabel: "thread",
      threadId: input.link.externalSessionId,
      metadataSource: usedProviderMetadata
        ? "rollout"
        : usedContextMetadata
          ? "immutable-context"
          : "not-recorded",
    },
  };
}

export function planNativeDebugInvocation(input: {
  options: { sessionId: string; runId: string };
  link: ProviderTraceLink;
  context: LocalRunExecutionContextFact | undefined;
  resolution: Extract<ProviderTraceResolution, { status: "available"; engine: "claude" | "kimi" | "pi" }>;
  providerContext: Awaited<ReturnType<LocalProcessTraceReader["readContext"]>>;
}): LocalConsoleProcessDebugInvocation {
  if ("status" in input.providerContext) {
    return {
      status: "malformed",
      sessionId: input.options.sessionId,
      runId: input.options.runId,
      reason: input.providerContext.reason,
    };
  }
  const fallbackModel = input.context?.profile?.model ?? null;
  const fallbackEffort = input.context?.profile?.effort ?? null;
  const usedProviderMetadata = Object.values(input.providerContext.metadata).some((value) => value !== null);
  const usedContextMetadata = !usedProviderMetadata
    && (fallbackModel !== null || fallbackEffort !== null || input.context?.workspace.cwd !== undefined);
  return {
    status: "available",
    sessionId: input.options.sessionId,
    runId: input.options.runId,
    engine: input.resolution.engine,
    sections: input.providerContext.sections,
    prompts: {
      system: planPromptFromSections(input.providerContext.sections, ["system"]),
      developer: { status: "not-recorded", contents: [] },
      user: planPromptFromSections(input.providerContext.sections, ["user", "turn"]),
    },
    metadata: {
      model: input.providerContext.metadata.model ?? fallbackModel,
      effort: input.providerContext.metadata.effort ?? fallbackEffort,
      provider: input.providerContext.metadata.provider,
      cliVersion: input.providerContext.metadata.cliVersion,
      cwd: input.providerContext.metadata.cwd ?? input.context?.workspace.cwd ?? null,
      externalSessionId: input.link.externalSessionId,
      identityLabel: "session",
      threadId: input.link.externalSessionId,
      metadataSource: usedProviderMetadata
        ? "provider-native"
        : usedContextMetadata
          ? "immutable-context"
          : "not-recorded",
    },
  };
}

export function planAppendProcessSelection(input: {
  links: ProviderTraceLink[];
  options: LoadLocalProcessAppendOptions;
}):
  | { kind: "invalid" }
  | { kind: "selected"; anchor: ProviderTraceLink; link: ProviderTraceLink; cursor: AppendCursorState } {
  const anchor = input.links.find((link) => link.runId === input.options.requestedRunId);
  if (anchor === undefined) return { kind: "invalid" };
  const grouped = planProcessLinkGroup(input.links, anchor.sourceMessageId);
  if (!decideSameProcessStepIdentity(grouped, anchor)) return { kind: "invalid" };
  const cursor = planDecodeAppendCursor(
    input.options.appendCursor,
    input.options,
    anchor.sourceMessageId,
    grouped,
  );
  const link = grouped[cursor.attemptIndex];
  return link === undefined || link.runId !== grouped.at(-1)?.runId
    ? { kind: "invalid" }
    : { kind: "selected", anchor, link, cursor };
}

export function decideAvailableProviderTrace(
  resolution: ProviderTraceResolution,
):
  | { kind: "invalid" }
  | { kind: "available"; resolution: Extract<ProviderTraceResolution, { status: "available" }> } {
  return resolution.status === "available"
    ? { kind: "available", resolution }
    : { kind: "invalid" };
}

export function planProcessAppendResult(input: {
  options: LoadLocalProcessAppendOptions;
  selection: { anchor: ProviderTraceLink; link: ProviderTraceLink; cursor: AppendCursorState };
  slice: Awaited<ReturnType<LocalProcessTraceReader["readAppend"]>>;
}): LocalConsoleProcessAppendPage {
  const next = planAppendState(
    input.options,
    input.selection.anchor.sourceMessageId,
    input.selection.cursor.attemptIndex,
    input.selection.link,
    input.slice.nextOffset,
    input.slice.identity,
  );
  return {
    events: planDedupeTimelineEvents(input.slice.events),
    appendCursor: planEncodeProcessCursor(next),
    atLatest: input.slice.nextOffset === input.slice.completeEndOffset,
    status: input.options.activeRunIds.has(input.selection.link.runId) ? "running" : "settled",
  };
}

export function planProcessHistoryStart(input: {
  options: LoadLocalProcessHistoryOptions;
  attempts: ResolvedAttempt[];
  sourceMessageId: number;
  defaultPageBytes: number;
  defaultPageEvents: number;
}): ProcessHistoryAccumulator {
  const remainingEvents = planPositiveInteger(input.options.maxEvents ?? input.defaultPageEvents);
  const remainingBytes = planPositiveInteger(input.options.maxBytes ?? input.defaultPageBytes);
  return {
    state: input.options.cursor === undefined
      ? planPreviousOutputState(
          input.options,
          input.sourceMessageId,
          input.attempts.length - 1,
          input.attempts.at(-1)!.link,
          null,
          null,
        )
      : planDecodePreviousCursor(
          input.options.cursor,
          input.options,
          input.sourceMessageId,
          input.attempts,
        ),
    remainingEvents,
    remainingBytes,
    pageEvents: [],
    previousCursor: null,
    latestAppendState: null,
    done: false,
  };
}

export function decideProcessHistoryContinuation(accumulator: ProcessHistoryAccumulator): boolean {
  return !accumulator.done
    && accumulator.remainingEvents > 0
    && (accumulator.remainingBytes > 0 || accumulator.state.stage === "intro");
}

export function planProcessHistoryStep(
  attempt: ResolvedAttempt | undefined,
  state: PreviousCursorState,
): { kind: "invalid" } | { kind: "output"; attempt: ResolvedAttempt } | { kind: "intro"; attempt: ResolvedAttempt } {
  if (attempt === undefined) return { kind: "invalid" };
  return state.stage === "output" ? { kind: "output", attempt } : { kind: "intro", attempt };
}

export function planProcessOutputRequest(input: {
  attempt: ResolvedAttempt;
  state: Extract<PreviousCursorState, { stage: "output" }>;
  remainingBytes: number;
  remainingEvents: number;
}):
  | { kind: "intro" }
  | { kind: "read"; request: Parameters<LocalProcessTraceReader["readPage"]>[0] } {
  if (input.attempt.resolution.status !== "available") return { kind: "intro" };
  return {
    kind: "read",
    request: {
      resolution: input.attempt.resolution,
      runId: input.attempt.link.runId,
      ...(input.state.position === null ? {} : { endOffset: input.state.position }),
      ...(input.state.identity === null
        ? {}
        : {
            expectedIdentity: planExpectedIdentity(input.attempt.resolution, input.state.identity),
            minimumSize: input.state.identity.minimumSize,
          }),
      maxBytes: input.remainingBytes,
      maxEvents: input.remainingEvents,
    },
  };
}

export function planUnavailableProcessOutput(input: {
  accumulator: ProcessHistoryAccumulator;
  options: LoadLocalProcessHistoryOptions;
  attempt: ResolvedAttempt;
  sourceMessageId: number;
}): ProcessHistoryAccumulator {
  return {
    ...input.accumulator,
    state: planPreviousIntroState(
      input.options,
      input.sourceMessageId,
      input.accumulator.state.attemptIndex,
      input.attempt.link,
      planProcessIntroEvents(input.attempt).length,
    ),
  };
}

export function planProcessOutputSlice(input: {
  accumulator: ProcessHistoryAccumulator;
  options: LoadLocalProcessHistoryOptions;
  attempt: ResolvedAttempt;
  sourceMessageId: number;
  slice: Awaited<ReturnType<LocalProcessTraceReader["readPage"]>>;
  attemptCount: number;
}): ProcessHistoryAccumulator {
  const remainingEvents = input.accumulator.remainingEvents - input.slice.events.length;
  const remainingBytes = input.accumulator.remainingBytes - Math.max(1, input.slice.rawBytes);
  const pageEvents = [...input.slice.events, ...input.accumulator.pageEvents];
  const latestAppendState = input.options.cursor === undefined
    && input.accumulator.state.attemptIndex === input.attemptCount - 1
    ? planAppendState(
        input.options,
        input.sourceMessageId,
        input.accumulator.state.attemptIndex,
        input.attempt.link,
        input.slice.completeEndOffset,
        input.slice.identity,
      )
    : input.accumulator.latestAppendState;
  if (input.slice.previousOffset !== null) {
    return {
      ...input.accumulator,
      remainingEvents,
      remainingBytes,
      pageEvents,
      latestAppendState,
      previousCursor: planEncodeProcessCursor(planPreviousOutputState(
        input.options,
        input.sourceMessageId,
        input.accumulator.state.attemptIndex,
        input.attempt.link,
        input.slice.previousOffset,
        input.slice.identity,
      )),
      done: true,
    };
  }
  const state = planPreviousIntroState(
    input.options,
    input.sourceMessageId,
    input.accumulator.state.attemptIndex,
    input.attempt.link,
    planProcessIntroEvents(input.attempt).length,
  );
  return {
    ...input.accumulator,
    state,
    remainingEvents,
    remainingBytes,
    pageEvents,
    latestAppendState,
    previousCursor: remainingEvents <= 0 ? planEncodeProcessCursor(state) : input.accumulator.previousCursor,
    done: remainingEvents <= 0,
  };
}

export function planProcessIntroSlice(input: {
  accumulator: ProcessHistoryAccumulator;
  options: LoadLocalProcessHistoryOptions;
  attempts: ResolvedAttempt[];
  attempt: ResolvedAttempt;
  sourceMessageId: number;
}): ProcessHistoryAccumulator {
  const intro = planProcessIntroEvents(input.attempt);
  const start = Math.max(0, input.accumulator.state.position! - input.accumulator.remainingEvents);
  const selected = intro.slice(start, input.accumulator.state.position!);
  const remainingEvents = input.accumulator.remainingEvents - selected.length;
  const pageEvents = [...selected, ...input.accumulator.pageEvents];
  if (start > 0) {
    return {
      ...input.accumulator,
      remainingEvents,
      pageEvents,
      previousCursor: planEncodeProcessCursor(planPreviousIntroState(
        input.options,
        input.sourceMessageId,
        input.accumulator.state.attemptIndex,
        input.attempt.link,
        start,
      )),
      done: true,
    };
  }
  if (input.accumulator.state.attemptIndex === 0) {
    return { ...input.accumulator, remainingEvents, pageEvents, previousCursor: null, done: true };
  }
  const previousAttempt = input.attempts[input.accumulator.state.attemptIndex - 1];
  if (previousAttempt === undefined) throw new ProcessCursorError();
  const state = planPreviousOutputState(
    input.options,
    input.sourceMessageId,
    input.accumulator.state.attemptIndex - 1,
    previousAttempt.link,
    null,
    null,
  );
  const done = remainingEvents <= 0 || input.accumulator.remainingBytes <= 0;
  return {
    ...input.accumulator,
    state,
    remainingEvents,
    pageEvents,
    previousCursor: done ? planEncodeProcessCursor(state) : input.accumulator.previousCursor,
    done,
  };
}

export function planProcessHistoryResult(input: {
  options: LoadLocalProcessHistoryOptions;
  prepared: {
    meta: LocalConsoleProcessAttemptMeta[];
    anchor: ProviderTraceLink;
  };
  accumulator: ProcessHistoryAccumulator;
}): LocalConsoleProcessHistoryPage {
  const active = input.prepared.meta.some((attempt) => attempt.status === "running");
  return {
    sessionId: input.options.sessionId,
    requestedRunId: input.options.requestedRunId,
    role: input.prepared.anchor.role,
    status: active ? "running" : "settled",
    unavailableReason: null,
    unavailableEngine: null,
    attempts: input.prepared.meta,
    events: planDedupeTimelineEvents(input.accumulator.pageEvents),
    previousCursor: input.accumulator.previousCursor,
    appendCursor: input.accumulator.latestAppendState === null
      ? null
      : planEncodeProcessCursor(input.accumulator.latestAppendState),
    atLatest: input.options.cursor === undefined,
  };
}

export function planProcessLinkGroup(links: ProviderTraceLink[], sourceMessageId: number): ProviderTraceLink[] {
  return links
    .filter((link) => link.sourceMessageId === sourceMessageId)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.runId.localeCompare(right.runId));
}

export function decideSameProcessStepIdentity(links: ProviderTraceLink[], anchor: ProviderTraceLink): boolean {
  return links.every((link) =>
    link.engine === anchor.engine
    && link.role === anchor.role);
}

export function planProcessAttemptSelection(input: {
  links: ProviderTraceLink[];
  contexts: LocalRunExecutionContextFact[];
  requestedRunId: string;
}):
  | { kind: "selected"; anchor: ProviderTraceLink; grouped: ProviderTraceLink[] }
  | { kind: "unavailable"; reason: LocalConsoleProcessUnavailableReason; engine: LocalConsoleExecutionEngine | null } {
  const anchor = input.links.find((link) => link.runId === input.requestedRunId);
  if (anchor === undefined) {
    return {
      kind: "unavailable",
      reason: "link-missing",
      engine: input.contexts.find((context) => context.runId === input.requestedRunId)?.engine ?? null,
    };
  }
  const grouped = planProcessLinkGroup(input.links, anchor.sourceMessageId);
  return decideSameProcessStepIdentity(grouped, anchor)
    ? { kind: "selected", anchor, grouped }
    : { kind: "unavailable", reason: "identity-invalid", engine: anchor.engine };
}

export function planProcessAttemptMetadata(input: {
  grouped: ProviderTraceLink[];
  contexts: LocalRunExecutionContextFact[];
  messages: LocalConsoleMessage[];
  activeRunIds: ReadonlySet<string>;
}): LocalConsoleProcessAttemptMeta[] {
  return input.grouped.map((link, index) => {
    const timing = input.messages.find((message) => message.runId === link.runId)?.runTiming;
    const context = input.contexts.find((candidate) => candidate.runId === link.runId);
    const model = context?.profile?.model ?? null;
    const effort = context?.profile?.effort ?? null;
    return {
      runId: link.runId,
      attempt: timing?.attempt ?? index + 1,
      role: link.role,
      engine: link.engine,
      model,
      effort,
      provider: null,
      cliVersion: null,
      metadataSource: model !== null || effort !== null ? "immutable-context" : "not-recorded",
      externalSessionId: link.externalSessionId,
      ...(link.tracePath === undefined ? {} : { tracePath: link.tracePath }),
      identityLabel: link.engine === "codex" ? "thread" : "session",
      threadId: link.externalSessionId,
      startedAt: timing?.startedAt ?? link.startedAt,
      status: timing?.status ?? (input.activeRunIds.has(link.runId) ? "running" : "completed"),
      elapsedMs: timing?.elapsedMs ?? null,
      completedAt: timing?.completedAt ?? null,
    };
  });
}

export function planProcessIntroEvents(attempt: ResolvedAttempt): LocalConsoleProcessTimelineEvent[] {
  return [
    {
      key: `${attempt.link.runId}:attempt`,
      kind: "attempt-header",
      runId: attempt.link.runId,
      attempt: attempt.meta.attempt,
      role: attempt.meta.role,
      engine: attempt.meta.engine,
      model: attempt.meta.model,
      effort: attempt.meta.effort,
      provider: attempt.meta.provider,
      cliVersion: attempt.meta.cliVersion,
      metadataSource: attempt.meta.metadataSource,
      externalSessionId: attempt.meta.externalSessionId,
      identityLabel: attempt.meta.identityLabel,
      threadId: attempt.meta.threadId,
      startedAt: attempt.meta.startedAt,
      status: attempt.meta.status,
      elapsedMs: attempt.meta.elapsedMs,
      completedAt: attempt.meta.completedAt,
    },
    ...(attempt.resolution.status === "available"
      ? []
      : [{
          key: `${attempt.link.runId}:unavailable`,
          engine: attempt.meta.engine,
          kind: "error" as const,
          timestamp: attempt.meta.completedAt,
          protocolType: `moebius · ${attempt.meta.engine}_trace_unavailable`,
          rawPayload: "",
          message: `${planProviderDisplayName(attempt.meta.engine)} 过程记录已不可用`,
          detail: null,
        }]),
    {
      key: `${attempt.link.runId}:execution`,
      kind: "execution-header",
      runId: attempt.link.runId,
      attempt: attempt.meta.attempt,
    },
  ];
}

export function planUnavailableProcessInvocation(
  options: { sessionId: string; runId: string },
  reason: string,
): LocalConsoleProcessDebugInvocation {
  return {
    status: "unavailable",
    sessionId: options.sessionId,
    runId: options.runId,
    reason,
  };
}

export function planUnavailableProcessPage(
  options: Pick<LoadLocalProcessHistoryOptions, "sessionId" | "requestedRunId">,
  reason: LocalConsoleProcessUnavailableReason,
  engine: LocalConsoleExecutionEngine | null,
  attempts: LocalConsoleProcessAttemptMeta[] = [],
): LocalConsoleProcessHistoryPage {
  return {
    sessionId: options.sessionId,
    requestedRunId: options.requestedRunId,
    role: null,
    status: "unavailable",
    unavailableReason: reason,
    unavailableEngine: engine,
    attempts,
    events: [],
    previousCursor: null,
    appendCursor: null,
    atLatest: true,
  };
}

export function planPreviousOutputState(
  options: Pick<LoadLocalProcessHistoryOptions, "sessionId" | "requestedRunId">,
  sourceMessageId: number,
  attemptIndex: number,
  link: ProviderTraceLink,
  position: number | null,
  identity: TrustedJsonlIdentity | null,
): PreviousCursorState {
  return {
    v: 1,
    kind: "previous",
    sessionId: options.sessionId,
    requestedRunId: options.requestedRunId,
    sourceMessageId,
    attemptIndex,
    runId: link.runId,
    engine: link.engine,
    stage: "output",
    position,
    identity: identity === null ? null : planCursorIdentity(identity),
  };
}

export function planPreviousIntroState(
  options: Pick<LoadLocalProcessHistoryOptions, "sessionId" | "requestedRunId">,
  sourceMessageId: number,
  attemptIndex: number,
  link: ProviderTraceLink,
  position: number,
): PreviousCursorState {
  return {
    v: 1,
    kind: "previous",
    sessionId: options.sessionId,
    requestedRunId: options.requestedRunId,
    sourceMessageId,
    attemptIndex,
    runId: link.runId,
    engine: link.engine,
    stage: "intro",
    position,
    identity: null,
  };
}

export function planAppendState(
  options: Pick<LoadLocalProcessHistoryOptions, "sessionId" | "requestedRunId">,
  sourceMessageId: number,
  attemptIndex: number,
  link: ProviderTraceLink,
  position: number,
  identity: TrustedJsonlIdentity,
): AppendCursorState {
  return {
    v: 1,
    kind: "append",
    sessionId: options.sessionId,
    requestedRunId: options.requestedRunId,
    sourceMessageId,
    attemptIndex,
    runId: link.runId,
    engine: link.engine,
    position,
    identity: planCursorIdentity(identity),
  };
}

function planCursorIdentity(identity: TrustedJsonlIdentity): CursorIdentity {
  return {
    device: identity.device,
    inode: identity.inode,
    minimumSize: identity.size,
  };
}

export function planExpectedIdentity(
  resolution: Extract<ProviderTraceResolution, { status: "available" }>,
  identity: CursorIdentity,
): TrustedJsonlIdentity {
  return {
    realPath: resolution.identity.realPath,
    device: identity.device,
    inode: identity.inode,
    size: identity.minimumSize,
  };
}

export function planEncodeProcessCursor(value: PreviousCursorState | AppendCursorState): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function planDecodePreviousCursor(
  cursor: string,
  options: Pick<LoadLocalProcessHistoryOptions, "sessionId" | "requestedRunId">,
  sourceMessageId: number,
  attempts: ResolvedAttempt[],
): PreviousCursorState {
  const value = planDecodeProcessCursor(cursor);
  if (
    value.kind !== "previous"
    || value.sessionId !== options.sessionId
    || value.requestedRunId !== options.requestedRunId
    || value.sourceMessageId !== sourceMessageId
    || value.attemptIndex < 0
    || value.attemptIndex >= attempts.length
    || attempts[value.attemptIndex]?.link.runId !== value.runId
    || attempts[value.attemptIndex]?.link.engine !== value.engine
  ) {
    throw new ProcessCursorError();
  }
  return value;
}

export function planDecodeAppendCursor(
  cursor: string,
  options: Pick<LoadLocalProcessAppendOptions, "sessionId" | "requestedRunId">,
  sourceMessageId: number,
  links: ProviderTraceLink[],
): AppendCursorState {
  const value = planDecodeProcessCursor(cursor);
  if (
    value.kind !== "append"
    || value.sessionId !== options.sessionId
    || value.requestedRunId !== options.requestedRunId
    || value.sourceMessageId !== sourceMessageId
    || value.attemptIndex < 0
    || value.attemptIndex >= links.length
    || links[value.attemptIndex]?.runId !== value.runId
    || links[value.attemptIndex]?.engine !== value.engine
  ) {
    throw new ProcessCursorError();
  }
  return value;
}

function planDecodeProcessCursor(cursor: string): PreviousCursorState | AppendCursorState {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new ProcessCursorError();
  }
  if (!isRecord(value) || value.v !== 1 || !validBaseCursor(value)) {
    throw new ProcessCursorError();
  }
  if (value.kind === "append") {
    if (!validInteger(value.position) || !validIdentity(value.identity)) {
      throw new ProcessCursorError();
    }
    return value as unknown as AppendCursorState;
  }
  if (value.kind === "previous") {
    if (value.stage === "output") {
      if (
        !(value.position === null || validInteger(value.position))
        || (value.position === null && value.identity !== null)
        || (value.position !== null && !validIdentity(value.identity))
      ) {
        throw new ProcessCursorError();
      }
    } else if (value.stage === "intro") {
      if (!validInteger(value.position) || value.identity !== null) {
        throw new ProcessCursorError();
      }
    } else {
      throw new ProcessCursorError();
    }
    return value as unknown as PreviousCursorState;
  }
  throw new ProcessCursorError();
}

function validBaseCursor(value: Record<string, unknown>): boolean {
  return typeof value.sessionId === "string"
    && typeof value.requestedRunId === "string"
    && typeof value.runId === "string"
    && (value.engine === "codex" || value.engine === "claude" || value.engine === "kimi")
    && validInteger(value.sourceMessageId)
    && validInteger(value.attemptIndex);
}

function validIdentity(value: unknown): value is CursorIdentity {
  return isRecord(value)
    && validInteger(value.device)
    && validInteger(value.inode)
    && validInteger(value.minimumSize);
}

function validInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function planDedupeTimelineEvents<T extends { key: string }>(events: T[]): T[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.key)) {
      return false;
    }
    seen.add(event.key);
    return true;
  });
}

export function planPositiveInteger(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("page limit must be a positive integer");
  }
  return value;
}

export function planProcessLinks(
  executionLinks: LocalExecutionSessionLinkFact[],
  legacyLinks: LocalCodexThreadLinkFact[],
): ProviderTraceLink[] {
  const links = new Map<string, ProviderTraceLink>();
  for (const link of executionLinks) {
    const normalized: ProviderTraceLink = {
      sessionId: link.sessionId,
      runId: link.runId,
      sourceMessageId: link.sourceMessageId,
      role: link.role,
      engine: link.engine,
      externalSessionId: link.externalSessionId,
      contextFingerprint: link.contextFingerprint,
      startedAt: link.startedAt,
    };
    const current = links.get(normalized.runId);
    if (current !== undefined && !sameProcessLink(current, normalized)) {
      throw new Error(`conflicting provider session links for run ${normalized.runId}`);
    }
    links.set(normalized.runId, current ?? normalized);
  }
  for (const link of legacyLinks) {
    if (links.has(link.runId)) {
      continue;
    }
    links.set(link.runId, {
      sessionId: link.sessionId,
      runId: link.runId,
      sourceMessageId: link.sourceMessageId,
      role: link.role,
      engine: "codex",
      externalSessionId: link.threadId,
      contextFingerprint: link.contextFingerprint ?? "",
      startedAt: link.startedAt,
      legacyCodex: true,
    });
  }
  return [...links.values()].sort(
    (left, right) =>
      left.startedAt.localeCompare(right.startedAt) || left.runId.localeCompare(right.runId),
  );
}

function sameProcessLink(left: ProviderTraceLink, right: ProviderTraceLink): boolean {
  return left.sessionId === right.sessionId
    && left.runId === right.runId
    && left.sourceMessageId === right.sourceMessageId
    && left.role === right.role
    && left.engine === right.engine
    && left.externalSessionId === right.externalSessionId
    && left.tracePath === right.tracePath
    && left.contextFingerprint === right.contextFingerprint
    && left.startedAt === right.startedAt;
}

export function planTraceOptions(options: {
  rollout?: ResolveCodexRolloutOptions;
  trace?: ProviderTraceResolverOptions;
}): ProviderTraceResolverOptions {
  return {
    ...options.trace,
    rollout: options.rollout ?? options.trace?.rollout,
  };
}

export function planPromptFromSections(
  sections: ProviderContextSection[],
  keys: string[],
): CodexRolloutPromptLayer {
  const contents = sections
    .filter((section) => keys.includes(section.key))
    .flatMap((section) => section.contents);
  return {
    status: contents.length === 0 ? "not-recorded" : "recorded",
    contents,
  };
}

function planProviderDisplayName(engine: LocalConsoleExecutionEngine): string {
  return engine === "codex" ? "Codex" : engine === "claude" ? "Claude" : engine === "kimi" ? "Kimi" : "Pi API";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
