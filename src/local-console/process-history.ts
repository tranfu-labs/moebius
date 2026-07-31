import {
  readCodexThreadLinks,
} from "./codex-thread-link.js";
import {
  readCodexRolloutInvocation,
  type CodexRolloutPromptLayer,
  type CodexRolloutUnavailableReason,
  type ResolveCodexRolloutOptions,
} from "./codex-rollout.js";
import {
  readExecutionSessionLinks,
  readRunExecutionContexts,
  type LocalRunExecutionContextFact,
} from "./execution-context.js";
import {
  readProviderTraceAppend,
  readProviderTraceContext,
  readProviderTracePage,
  resolveProviderTrace,
  type ProviderContextSection,
  type ProviderTraceLink,
  type ProviderTraceResolution,
  type ProviderTraceResolverOptions,
} from "./provider-process-trace.js";
import type { LocalConsoleProcessEvent } from "./process-event-projector.js";
import type { LocalConsoleMessage, LocalConsoleRunTiming } from "./types.js";
import {
  TrustedJsonlCursorInvalidError,
  type TrustedJsonlIdentity,
} from "../trusted-jsonl.js";

export interface LocalConsoleProcessAttemptMeta {
  runId: string;
  attempt: number;
  role: string;
  engine: "codex" | "claude" | "kimi";
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
      engine: "codex" | "claude" | "kimi";
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
  unavailableEngine: "codex" | "claude" | "kimi" | null;
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
      engine: "codex" | "claude" | "kimi";
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
  appendCursor: string;
  rollout?: ResolveCodexRolloutOptions;
  trace?: ProviderTraceResolverOptions;
  maxBytes?: number;
  maxEvents?: number;
}

interface ResolvedAttempt {
  link: ProviderTraceLink;
  meta: LocalConsoleProcessAttemptMeta;
  resolution: ProviderTraceResolution;
}

type PreviousCursorState =
  | {
      v: 1;
      kind: "previous";
      sessionId: string;
      requestedRunId: string;
      sourceMessageId: number;
      attemptIndex: number;
      runId: string;
      engine: "codex" | "claude" | "kimi";
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
      engine: "codex" | "claude" | "kimi";
      stage: "intro";
      position: number;
      identity: null;
    };

interface AppendCursorState {
  v: 1;
  kind: "append";
  sessionId: string;
  requestedRunId: string;
  sourceMessageId: number;
  attemptIndex: number;
  runId: string;
  engine: "codex" | "claude" | "kimi";
  position: number;
  identity: CursorIdentity;
}

interface CursorIdentity {
  device: number;
  inode: number;
  minimumSize: number;
}

const DEFAULT_PAGE_BYTES = 256 * 1024;
const DEFAULT_PAGE_EVENTS = 80;

export async function loadLocalProcessDebugInvocation(options: {
  sessionId: string;
  runId: string;
  sessionFactLogPath: string;
  rollout?: ResolveCodexRolloutOptions;
  trace?: ProviderTraceResolverOptions;
}): Promise<LocalConsoleProcessDebugInvocation> {
  let links: ProviderTraceLink[];
  let contexts: LocalRunExecutionContextFact[];
  try {
    [links, contexts] = await Promise.all([
      readProcessLinks(options.sessionFactLogPath, options.sessionId),
      readRunExecutionContexts(options.sessionFactLogPath, options.sessionId),
    ]);
  } catch {
    return unavailableInvocation(options, "link-invalid");
  }
  const link = links.find((candidate) => candidate.runId === options.runId);
  if (link === undefined) {
    return unavailableInvocation(options, "link-missing");
  }
  const context = contexts.find((candidate) => candidate.runId === options.runId);
  const resolution = await resolveProviderTrace({
    link,
    context,
    options: traceOptions(options),
  });
  if (resolution.status !== "available") {
    return unavailableInvocation(options, resolution.reason);
  }
  const fallbackModel = context?.profile?.model ?? null;
  const fallbackEffort = context?.profile?.effort ?? null;
  if (resolution.engine === "codex") {
    let invocation;
    try {
      invocation = await readCodexRolloutInvocation({ resolution: resolution.codex });
    } catch {
      return unavailableInvocation(options, "cursor-invalid");
    }
    if (invocation.status === "malformed") {
      return {
        status: "malformed",
        sessionId: options.sessionId,
        runId: options.runId,
        reason: invocation.reason,
      };
    }
    const usedProviderMetadata = Object.values(invocation.metadata).some((value) => value !== null);
    const usedContextMetadata = !usedProviderMetadata
      && (fallbackModel !== null || fallbackEffort !== null || context?.workspace.cwd !== undefined);
    return {
      status: "available",
      sessionId: options.sessionId,
      runId: options.runId,
      engine: "codex",
      sections: [
        {
          key: "system",
          label: "SYSTEM_PROMPT",
          source: "codex-rollout",
          ...invocation.prompts.system,
        },
        {
          key: "developer",
          label: "DEVELOPER_PROMPT",
          source: "codex-rollout",
          ...invocation.prompts.developer,
        },
        {
          key: "user",
          label: "USER_INPUT",
          source: "codex-rollout",
          ...invocation.prompts.user,
        },
      ],
      prompts: invocation.prompts,
      metadata: {
        model: invocation.metadata.model ?? fallbackModel,
        effort: invocation.metadata.effort ?? fallbackEffort,
        provider: invocation.metadata.provider,
        cliVersion: invocation.metadata.cliVersion,
        cwd: invocation.metadata.cwd ?? context?.workspace.cwd ?? null,
        externalSessionId: link.externalSessionId,
        identityLabel: "thread",
        threadId: link.externalSessionId,
        metadataSource: usedProviderMetadata
          ? "rollout"
          : usedContextMetadata
            ? "immutable-context"
            : "not-recorded",
      },
    };
  }
  const providerContext = await readProviderTraceContext(resolution);
  if ("status" in providerContext) {
    return {
      status: "malformed",
      sessionId: options.sessionId,
      runId: options.runId,
      reason: providerContext.reason,
    };
  }
  const usedProviderMetadata = Object.values(providerContext.metadata)
    .some((value) => value !== null);
  const usedContextMetadata = !usedProviderMetadata
    && (fallbackModel !== null || fallbackEffort !== null || context?.workspace.cwd !== undefined);
  return {
    status: "available",
    sessionId: options.sessionId,
    runId: options.runId,
    engine: resolution.engine,
    sections: providerContext.sections,
    prompts: {
      system: promptFromSections(providerContext.sections, ["system"]),
      developer: { status: "not-recorded", contents: [] },
      user: promptFromSections(providerContext.sections, ["user", "turn"]),
    },
    metadata: {
      model: providerContext.metadata.model ?? fallbackModel,
      effort: providerContext.metadata.effort ?? fallbackEffort,
      provider: providerContext.metadata.provider,
      cliVersion: providerContext.metadata.cliVersion,
      cwd: providerContext.metadata.cwd ?? context?.workspace.cwd ?? null,
      externalSessionId: link.externalSessionId,
      identityLabel: "session",
      threadId: link.externalSessionId,
      metadataSource: usedProviderMetadata
        ? "provider-native"
        : usedContextMetadata
          ? "immutable-context"
          : "not-recorded",
    },
  };
}

export async function loadLocalProcessHistoryPage(
  options: LoadLocalProcessHistoryOptions,
): Promise<LocalConsoleProcessHistoryPage> {
  const prepared = await prepareAttempts(options);
  if ("unavailableReason" in prepared) {
    return unavailablePage(options, prepared.unavailableReason, prepared.unavailableEngine);
  }
  const { attempts, sourceMessageId } = prepared;
  const maxEvents = positiveInteger(options.maxEvents ?? DEFAULT_PAGE_EVENTS);
  const maxBytes = positiveInteger(options.maxBytes ?? DEFAULT_PAGE_BYTES);
  let remainingEvents = maxEvents;
  let remainingBytes = maxBytes;
  let state: PreviousCursorState = options.cursor === undefined
    ? previousOutputState(options, sourceMessageId, attempts.length - 1, attempts.at(-1)!.link, null, null)
    : decodePreviousCursor(options.cursor, options, sourceMessageId, attempts);
  const pageEvents: LocalConsoleProcessTimelineEvent[] = [];
  let previousCursor: string | null = null;
  let latestAppendState: AppendCursorState | null = null;

  while (remainingEvents > 0 && (remainingBytes > 0 || state.stage === "intro")) {
    const attempt = attempts[state.attemptIndex];
    if (attempt === undefined) {
      throw new ProcessCursorError();
    }
    if (state.stage === "output") {
      if (attempt.resolution.status !== "available") {
        state = previousIntroState(
          options,
          sourceMessageId,
          state.attemptIndex,
          attempt.link,
          introEvents(attempt).length,
        );
        continue;
      }
      let slice;
      try {
        slice = await readProviderTracePage({
          resolution: attempt.resolution,
          runId: attempt.link.runId,
          ...(state.position === null ? {} : { endOffset: state.position }),
          ...(state.identity === null
            ? {}
            : {
                expectedIdentity: expectedIdentity(attempt.resolution, state.identity),
                minimumSize: state.identity.minimumSize,
              }),
          maxBytes: remainingBytes,
          maxEvents: remainingEvents,
        });
      } catch (error) {
        if (error instanceof TrustedJsonlCursorInvalidError) {
          throw new ProcessCursorError();
        }
        throw error;
      }
      pageEvents.unshift(...slice.events);
      remainingEvents -= slice.events.length;
      remainingBytes -= Math.max(1, slice.rawBytes);
      if (options.cursor === undefined && state.attemptIndex === attempts.length - 1) {
        latestAppendState = appendState(
          options,
          sourceMessageId,
          state.attemptIndex,
          attempt.link,
          slice.completeEndOffset,
          slice.identity,
        );
      }
      if (slice.previousOffset !== null) {
        previousCursor = encodeCursor(previousOutputState(
          options,
          sourceMessageId,
          state.attemptIndex,
          attempt.link,
          slice.previousOffset,
          slice.identity,
        ));
        break;
      }
      state = previousIntroState(
        options,
        sourceMessageId,
        state.attemptIndex,
        attempt.link,
        introEvents(attempt).length,
      );
      if (remainingEvents <= 0) {
        previousCursor = encodeCursor(state);
        break;
      }
      continue;
    }

    const intro = introEvents(attempt);
    const start = Math.max(0, state.position - remainingEvents);
    const selected = intro.slice(start, state.position);
    pageEvents.unshift(...selected);
    remainingEvents -= selected.length;
    if (start > 0) {
      previousCursor = encodeCursor(previousIntroState(
        options,
        sourceMessageId,
        state.attemptIndex,
        attempt.link,
        start,
      ));
      break;
    }
    if (state.attemptIndex === 0) {
      previousCursor = null;
      break;
    }
    const previousAttempt = attempts[state.attemptIndex - 1];
    if (previousAttempt === undefined) {
      throw new ProcessCursorError();
    }
    state = previousOutputState(
      options,
      sourceMessageId,
      state.attemptIndex - 1,
      previousAttempt.link,
      null,
      null,
    );
    if (remainingEvents <= 0 || remainingBytes <= 0) {
      previousCursor = encodeCursor(state);
      break;
    }
  }

  const active = prepared.meta.some((attempt) => attempt.status === "running");
  return {
    sessionId: options.sessionId,
    requestedRunId: options.requestedRunId,
    role: prepared.anchor.role,
    status: active ? "running" : "settled",
    unavailableReason: null,
    unavailableEngine: null,
    attempts: prepared.meta,
    events: dedupeTimelineEvents(pageEvents),
    previousCursor,
    appendCursor: latestAppendState === null ? null : encodeCursor(latestAppendState),
    atLatest: options.cursor === undefined,
  };
}

export async function loadLocalProcessAppendPage(
  options: LoadLocalProcessAppendOptions,
): Promise<LocalConsoleProcessAppendPage> {
  let links: ProviderTraceLink[];
  let contexts: LocalRunExecutionContextFact[];
  try {
    [links, contexts] = await Promise.all([
      readProcessLinks(options.sessionFactLogPath, options.sessionId),
      readRunExecutionContexts(options.sessionFactLogPath, options.sessionId),
    ]);
  } catch {
    throw new ProcessCursorError();
  }
  const anchor = links.find((link) => link.runId === options.requestedRunId);
  if (anchor === undefined) {
    throw new ProcessCursorError();
  }
  const grouped = groupLinks(links, anchor.sourceMessageId);
  if (!sameStepIdentity(grouped, anchor)) {
    throw new ProcessCursorError();
  }
  const cursor = decodeAppendCursor(options.appendCursor, options, anchor.sourceMessageId, grouped);
  const link = grouped[cursor.attemptIndex];
  if (link === undefined || link.runId !== grouped.at(-1)?.runId) {
    throw new ProcessCursorError();
  }
  const resolution = await resolveProviderTrace({
    link,
    context: contexts.find((candidate) => candidate.runId === link.runId),
    options: traceOptions(options),
  });
  if (resolution.status !== "available") {
    throw new ProcessCursorError();
  }
  let slice;
  try {
    slice = await readProviderTraceAppend({
      resolution,
      runId: link.runId,
      startOffset: cursor.position,
      expectedIdentity: {
        realPath: resolution.identity.realPath,
        device: cursor.identity.device,
        inode: cursor.identity.inode,
      },
      minimumSize: cursor.identity.minimumSize,
      maxBytes: options.maxBytes,
      maxEvents: options.maxEvents,
    });
  } catch (error) {
    if (error instanceof TrustedJsonlCursorInvalidError) {
      throw new ProcessCursorError();
    }
    throw error;
  }
  const next = appendState(
    options,
    anchor.sourceMessageId,
    cursor.attemptIndex,
    link,
    slice.nextOffset,
    slice.identity,
  );
  return {
    events: dedupeTimelineEvents(slice.events),
    appendCursor: encodeCursor(next),
    atLatest: slice.nextOffset === slice.completeEndOffset,
    status: options.activeRunIds.has(link.runId) ? "running" : "settled",
  };
}

export class ProcessCursorError extends Error {
  constructor() {
    super("invalid process history cursor");
    this.name = "ProcessCursorError";
  }
}

async function prepareAttempts(options: LoadLocalProcessHistoryOptions): Promise<
  | {
      attempts: ResolvedAttempt[];
      meta: LocalConsoleProcessAttemptMeta[];
      anchor: ProviderTraceLink;
      sourceMessageId: number;
    }
  | {
      unavailableReason: LocalConsoleProcessUnavailableReason;
      unavailableEngine: "codex" | "claude" | "kimi" | null;
    }
> {
  let links: ProviderTraceLink[];
  let contexts: LocalRunExecutionContextFact[];
  try {
    [links, contexts] = await Promise.all([
      readProcessLinks(options.sessionFactLogPath, options.sessionId),
      readRunExecutionContexts(options.sessionFactLogPath, options.sessionId),
    ]);
  } catch {
    return { unavailableReason: "link-invalid", unavailableEngine: null };
  }
  const anchor = links.find((link) => link.runId === options.requestedRunId);
  if (anchor === undefined) {
    return {
      unavailableReason: "link-missing",
      unavailableEngine: contexts.find((context) =>
        context.runId === options.requestedRunId)?.engine ?? null,
    };
  }
  const grouped = groupLinks(links, anchor.sourceMessageId);
  if (!sameStepIdentity(grouped, anchor)) {
    return { unavailableReason: "identity-invalid", unavailableEngine: anchor.engine };
  }
  const meta = grouped.map((link, index) => {
    const timing = options.messages.find((message) => message.runId === link.runId)?.runTiming;
    const context = contexts.find((candidate) => candidate.runId === link.runId);
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
      metadataSource: model !== null || effort !== null
        ? "immutable-context" as const
        : "not-recorded" as const,
      externalSessionId: link.externalSessionId,
      identityLabel: link.engine === "codex" ? "thread" as const : "session" as const,
      threadId: link.externalSessionId,
      startedAt: timing?.startedAt ?? link.startedAt,
      status: timing?.status
        ?? (options.activeRunIds.has(link.runId) ? "running" as const : "completed" as const),
      elapsedMs: timing?.elapsedMs ?? null,
      completedAt: timing?.completedAt ?? null,
    };
  });
  const attempts: ResolvedAttempt[] = [];
  for (const [index, link] of grouped.entries()) {
    const resolution = await resolveProviderTrace({
      link,
      context: contexts.find((candidate) => candidate.runId === link.runId),
      options: traceOptions(options),
    });
    attempts.push({ link, meta: meta[index]!, resolution });
  }
  return { attempts, meta, anchor, sourceMessageId: anchor.sourceMessageId };
}

function groupLinks(links: ProviderTraceLink[], sourceMessageId: number): ProviderTraceLink[] {
  return links
    .filter((link) => link.sourceMessageId === sourceMessageId)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.runId.localeCompare(right.runId));
}

function sameStepIdentity(links: ProviderTraceLink[], anchor: ProviderTraceLink): boolean {
  return links.every((link) =>
    link.engine === anchor.engine
    && link.role === anchor.role);
}

function introEvents(attempt: ResolvedAttempt): LocalConsoleProcessTimelineEvent[] {
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
          message: `${providerDisplayName(attempt.meta.engine)} 过程记录已不可用`,
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

function unavailableInvocation(
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

function unavailablePage(
  options: Pick<LoadLocalProcessHistoryOptions, "sessionId" | "requestedRunId">,
  reason: LocalConsoleProcessUnavailableReason,
  engine: "codex" | "claude" | "kimi" | null,
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

function previousOutputState(
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
    identity: identity === null ? null : cursorIdentity(identity),
  };
}

function previousIntroState(
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

function appendState(
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
    identity: cursorIdentity(identity),
  };
}

function cursorIdentity(identity: TrustedJsonlIdentity): CursorIdentity {
  return {
    device: identity.device,
    inode: identity.inode,
    minimumSize: identity.size,
  };
}

function expectedIdentity(
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

function encodeCursor(value: PreviousCursorState | AppendCursorState): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodePreviousCursor(
  cursor: string,
  options: Pick<LoadLocalProcessHistoryOptions, "sessionId" | "requestedRunId">,
  sourceMessageId: number,
  attempts: ResolvedAttempt[],
): PreviousCursorState {
  const value = decodeCursor(cursor);
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

function decodeAppendCursor(
  cursor: string,
  options: Pick<LoadLocalProcessAppendOptions, "sessionId" | "requestedRunId">,
  sourceMessageId: number,
  links: ProviderTraceLink[],
): AppendCursorState {
  const value = decodeCursor(cursor);
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

function decodeCursor(cursor: string): PreviousCursorState | AppendCursorState {
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

function dedupeTimelineEvents<T extends { key: string }>(events: T[]): T[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.key)) {
      return false;
    }
    seen.add(event.key);
    return true;
  });
}

function positiveInteger(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("page limit must be a positive integer");
  }
  return value;
}

async function readProcessLinks(
  logPath: string,
  sessionId: string,
): Promise<ProviderTraceLink[]> {
  const [executionLinks, legacyLinks] = await Promise.all([
    readExecutionSessionLinks(logPath, sessionId),
    readCodexThreadLinks(logPath, sessionId),
  ]);
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
    && left.contextFingerprint === right.contextFingerprint
    && left.startedAt === right.startedAt;
}

function traceOptions(options: {
  rollout?: ResolveCodexRolloutOptions;
  trace?: ProviderTraceResolverOptions;
}): ProviderTraceResolverOptions {
  return {
    ...options.trace,
    rollout: options.rollout ?? options.trace?.rollout,
  };
}

function promptFromSections(
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

function providerDisplayName(engine: "codex" | "claude" | "kimi"): string {
  return engine === "codex" ? "Codex" : engine === "claude" ? "Claude" : "Kimi";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
