import {
  readCodexThreadLinks,
  type LocalCodexThreadLinkFact,
} from "./codex-thread-link.js";
import {
  CodexRolloutCursorInvalidError,
  readCodexRolloutAppend,
  readCodexRolloutInvocation,
  readCodexRolloutPage,
  resolveCodexRollout,
  type CodexRolloutPromptLayer,
  type CodexRolloutIdentity,
  type CodexRolloutUnavailableReason,
  type ResolveCodexRolloutOptions,
} from "./codex-rollout.js";
import {
  readRunExecutionContexts,
  type LocalRunExecutionContextFact,
} from "./execution-context.js";
import type { LocalConsoleProcessEvent } from "./process-event-projector.js";
import type { LocalConsoleMessage, LocalConsoleRunTiming } from "./types.js";

export interface LocalConsoleProcessAttemptMeta {
  runId: string;
  attempt: number;
  role: string;
  engine: "codex";
  model: string | null;
  effort: string | null;
  provider: string | null;
  cliVersion: string | null;
  metadataSource: "rollout" | "immutable-context" | "not-recorded";
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
      engine: "codex";
      model: string | null;
      effort: string | null;
      provider: string | null;
      cliVersion: string | null;
      metadataSource: "rollout" | "immutable-context" | "not-recorded";
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
  | "source-message-missing"
  | CodexRolloutUnavailableReason;

export interface LocalConsoleProcessHistoryPage {
  sessionId: string;
  requestedRunId: string;
  role: string | null;
  status: "running" | "settled" | "unavailable";
  unavailableReason: LocalConsoleProcessUnavailableReason | null;
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
        threadId: string;
        metadataSource: "rollout" | "immutable-context" | "not-recorded";
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
  maxBytes?: number;
  maxEvents?: number;
}

interface ResolvedAttempt {
  link: LocalCodexThreadLinkFact;
  meta: LocalConsoleProcessAttemptMeta;
  resolution: Awaited<ReturnType<typeof resolveCodexRollout>>;
}

type PreviousCursorState =
  | {
      v: 1;
      kind: "previous";
      sessionId: string;
      requestedRunId: string;
      sourceMessageId: number;
      attemptIndex: number;
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
}): Promise<LocalConsoleProcessDebugInvocation> {
  let links: LocalCodexThreadLinkFact[];
  let contexts: LocalRunExecutionContextFact[];
  try {
    [links, contexts] = await Promise.all([
      readCodexThreadLinks(options.sessionFactLogPath, options.sessionId),
      readRunExecutionContexts(options.sessionFactLogPath, options.sessionId),
    ]);
  } catch {
    return unavailableInvocation(options, "link-invalid");
  }
  const link = links.find((candidate) => candidate.runId === options.runId);
  if (link === undefined) {
    return unavailableInvocation(options, "link-missing");
  }
  const resolution = await resolveCodexRollout(link.threadId, options.rollout);
  if (resolution.status !== "available") {
    return unavailableInvocation(options, resolution.reason);
  }
  let invocation;
  try {
    invocation = await readCodexRolloutInvocation({ resolution });
  } catch (error) {
    if (error instanceof CodexRolloutCursorInvalidError) {
      return unavailableInvocation(options, "cursor-invalid");
    }
    throw error;
  }
  if (invocation.status === "malformed") {
    return {
      status: "malformed",
      sessionId: options.sessionId,
      runId: options.runId,
      reason: invocation.reason,
    };
  }
  const context = contexts.find((candidate) => candidate.runId === options.runId);
  const fallbackModel = context?.profile?.model ?? null;
  const fallbackEffort = context?.profile?.effort ?? null;
  const usedRolloutMetadata = Object.values(invocation.metadata).some((value) => value !== null);
  const usedContextMetadata = !usedRolloutMetadata
    && (fallbackModel !== null || fallbackEffort !== null || context?.workspace.cwd !== undefined);
  return {
    status: "available",
    sessionId: options.sessionId,
    runId: options.runId,
    prompts: invocation.prompts,
    metadata: {
      model: invocation.metadata.model ?? fallbackModel,
      effort: invocation.metadata.effort ?? fallbackEffort,
      provider: invocation.metadata.provider,
      cliVersion: invocation.metadata.cliVersion,
      cwd: invocation.metadata.cwd ?? context?.workspace.cwd ?? null,
      threadId: link.threadId,
      metadataSource: usedRolloutMetadata
        ? "rollout"
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
    return unavailablePage(options, prepared.unavailableReason);
  }
  const { attempts, sourceMessageId } = prepared;
  const maxEvents = positiveInteger(options.maxEvents ?? DEFAULT_PAGE_EVENTS);
  const maxBytes = positiveInteger(options.maxBytes ?? DEFAULT_PAGE_BYTES);
  let remainingEvents = maxEvents;
  let remainingBytes = maxBytes;
  let state: PreviousCursorState = options.cursor === undefined
    ? previousOutputState(options, sourceMessageId, attempts.length - 1, null, null)
    : decodePreviousCursor(options.cursor, options, sourceMessageId, attempts.length);
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
          introEvents(attempt).length,
        );
        continue;
      }
      let slice;
      try {
        slice = await readCodexRolloutPage({
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
        if (error instanceof CodexRolloutCursorInvalidError) {
          throw new ProcessCursorError();
        }
        throw error;
      }
      pageEvents.unshift(...slice.events);
      remainingEvents -= slice.events.length;
      remainingBytes -= Math.max(1, slice.rawBytes);
      if (options.cursor === undefined && state.attemptIndex === attempts.length - 1) {
        latestAppendState = appendState(options, sourceMessageId, state.attemptIndex, slice.completeEndOffset, slice.identity);
      }
      if (slice.previousOffset !== null) {
        previousCursor = encodeCursor(previousOutputState(
          options,
          sourceMessageId,
          state.attemptIndex,
          slice.previousOffset,
          slice.identity,
        ));
        break;
      }
      state = previousIntroState(
        options,
        sourceMessageId,
        state.attemptIndex,
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
        start,
      ));
      break;
    }
    if (state.attemptIndex === 0) {
      previousCursor = null;
      break;
    }
    state = previousOutputState(options, sourceMessageId, state.attemptIndex - 1, null, null);
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
  let links: LocalCodexThreadLinkFact[];
  try {
    links = await readCodexThreadLinks(options.sessionFactLogPath, options.sessionId);
  } catch {
    throw new ProcessCursorError();
  }
  const anchor = links.find((link) => link.runId === options.requestedRunId);
  if (anchor === undefined) {
    throw new ProcessCursorError();
  }
  const grouped = groupLinks(links, anchor.sourceMessageId);
  const cursor = decodeAppendCursor(options.appendCursor, options, anchor.sourceMessageId, grouped.length);
  const link = grouped[cursor.attemptIndex];
  if (link === undefined || link.runId !== grouped.at(-1)?.runId) {
    throw new ProcessCursorError();
  }
  const resolution = await resolveCodexRollout(link.threadId, options.rollout);
  if (resolution.status !== "available") {
    throw new ProcessCursorError();
  }
  let slice;
  try {
    slice = await readCodexRolloutAppend({
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
    if (error instanceof CodexRolloutCursorInvalidError) {
      throw new ProcessCursorError();
    }
    throw error;
  }
  const next = appendState(
    options,
    anchor.sourceMessageId,
    cursor.attemptIndex,
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
      anchor: LocalCodexThreadLinkFact;
      sourceMessageId: number;
    }
  | { unavailableReason: LocalConsoleProcessUnavailableReason }
> {
  let links: LocalCodexThreadLinkFact[];
  let contexts: LocalRunExecutionContextFact[];
  try {
    [links, contexts] = await Promise.all([
      readCodexThreadLinks(options.sessionFactLogPath, options.sessionId),
      readRunExecutionContexts(options.sessionFactLogPath, options.sessionId),
    ]);
  } catch {
    return { unavailableReason: "link-invalid" };
  }
  const anchor = links.find((link) => link.runId === options.requestedRunId);
  if (anchor === undefined) {
    return { unavailableReason: "link-missing" };
  }
  const grouped = groupLinks(links, anchor.sourceMessageId);
  const meta = grouped.map((link, index) => {
    const timing = options.messages.find((message) => message.runId === link.runId)?.runTiming;
    const context = contexts.find((candidate) => candidate.runId === link.runId);
    const model = context?.profile?.model ?? null;
    const effort = context?.profile?.effort ?? null;
    return {
      runId: link.runId,
      attempt: timing?.attempt ?? index + 1,
      role: link.role,
      engine: "codex" as const,
      model,
      effort,
      provider: null,
      cliVersion: null,
      metadataSource: model !== null || effort !== null
        ? "immutable-context" as const
        : "not-recorded" as const,
      threadId: link.threadId,
      startedAt: timing?.startedAt ?? link.startedAt,
      status: timing?.status
        ?? (options.activeRunIds.has(link.runId) ? "running" as const : "completed" as const),
      elapsedMs: timing?.elapsedMs ?? null,
      completedAt: timing?.completedAt ?? null,
    };
  });
  const attempts: ResolvedAttempt[] = [];
  for (const [index, link] of grouped.entries()) {
    const resolution = await resolveCodexRollout(link.threadId, options.rollout);
    attempts.push({ link, meta: meta[index]!, resolution });
  }
  return { attempts, meta, anchor, sourceMessageId: anchor.sourceMessageId };
}

function groupLinks(links: LocalCodexThreadLinkFact[], sourceMessageId: number): LocalCodexThreadLinkFact[] {
  return links
    .filter((link) => link.sourceMessageId === sourceMessageId)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.runId.localeCompare(right.runId));
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
          kind: "error" as const,
          timestamp: attempt.meta.completedAt,
          protocolType: "moebius · rollout_unavailable",
          rawPayload: "",
          message: "这次执行的过程记录不可用",
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
  attempts: LocalConsoleProcessAttemptMeta[] = [],
): LocalConsoleProcessHistoryPage {
  return {
    sessionId: options.sessionId,
    requestedRunId: options.requestedRunId,
    role: null,
    status: "unavailable",
    unavailableReason: reason,
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
  position: number | null,
  identity: CodexRolloutIdentity | null,
): PreviousCursorState {
  return {
    v: 1,
    kind: "previous",
    sessionId: options.sessionId,
    requestedRunId: options.requestedRunId,
    sourceMessageId,
    attemptIndex,
    stage: "output",
    position,
    identity: identity === null ? null : cursorIdentity(identity),
  };
}

function previousIntroState(
  options: Pick<LoadLocalProcessHistoryOptions, "sessionId" | "requestedRunId">,
  sourceMessageId: number,
  attemptIndex: number,
  position: number,
): PreviousCursorState {
  return {
    v: 1,
    kind: "previous",
    sessionId: options.sessionId,
    requestedRunId: options.requestedRunId,
    sourceMessageId,
    attemptIndex,
    stage: "intro",
    position,
    identity: null,
  };
}

function appendState(
  options: Pick<LoadLocalProcessHistoryOptions, "sessionId" | "requestedRunId">,
  sourceMessageId: number,
  attemptIndex: number,
  position: number,
  identity: CodexRolloutIdentity,
): AppendCursorState {
  return {
    v: 1,
    kind: "append",
    sessionId: options.sessionId,
    requestedRunId: options.requestedRunId,
    sourceMessageId,
    attemptIndex,
    position,
    identity: cursorIdentity(identity),
  };
}

function cursorIdentity(identity: CodexRolloutIdentity): CursorIdentity {
  return {
    device: identity.device,
    inode: identity.inode,
    minimumSize: identity.size,
  };
}

function expectedIdentity(
  resolution: Awaited<ReturnType<typeof resolveCodexRollout>> & { status: "available" },
  identity: CursorIdentity,
): CodexRolloutIdentity {
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
  attemptCount: number,
): PreviousCursorState {
  const value = decodeCursor(cursor);
  if (
    value.kind !== "previous"
    || value.sessionId !== options.sessionId
    || value.requestedRunId !== options.requestedRunId
    || value.sourceMessageId !== sourceMessageId
    || value.attemptIndex < 0
    || value.attemptIndex >= attemptCount
  ) {
    throw new ProcessCursorError();
  }
  return value;
}

function decodeAppendCursor(
  cursor: string,
  options: Pick<LoadLocalProcessAppendOptions, "sessionId" | "requestedRunId">,
  sourceMessageId: number,
  attemptCount: number,
): AppendCursorState {
  const value = decodeCursor(cursor);
  if (
    value.kind !== "append"
    || value.sessionId !== options.sessionId
    || value.requestedRunId !== options.requestedRunId
    || value.sourceMessageId !== sourceMessageId
    || value.attemptIndex < 0
    || value.attemptIndex >= attemptCount
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
