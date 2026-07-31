export type ExecutionInterruptionCause =
  | "user"
  | "runtime-closing"
  | "redirect"
  | "context-unavailable"
  | "system";

export type ExecutionTerminal =
  | {
      kind: "completed";
      externalSessionId: string | null;
      finalText: string;
    }
  | {
      kind: "interrupted";
      actor: "user" | "system";
      cause: ExecutionInterruptionCause;
      partialText: string;
    }
  | {
      kind: "timeout";
      basis: "idle" | "tool" | "max";
      partialText: string;
    }
  | {
      kind: "quota-exhausted";
      retryable: false;
      partialText: string;
      safeCode: string;
    }
  | {
      kind: "rate-limited";
      retryable: true;
      partialText: string;
      safeCode: string;
      retryAfterMs?: number;
    }
  | {
      kind: "auth";
      retryable: false;
      partialText: string;
      safeCode: string;
    }
  | {
      kind: "crashed";
      partialText: string;
      safeCode: string;
    };

export type ExecutionFailureTerminal = Exclude<ExecutionTerminal, { kind: "completed" }>;

export type ExecutionProgressEvent =
  | { kind: "assistant-output"; delta: string; sequence: number }
  | { kind: "reasoning-output"; delta: string; sequence: number }
  | {
      kind: "tool-started" | "tool-finished";
      toolId: string;
      toolKind: string;
      sequence: number;
    }
  | { kind: "file-changed"; pathHint: string; sequence: number }
  | {
      kind: "provider-retry";
      retryKind: "rate-limit" | "service";
      attempt?: number;
      sequence: number;
    }
  | {
      kind: "status" | "config" | "usage" | "heartbeat";
      sequence: number;
    };

export interface ClaudeToolProjectionState {
  toolIdsByBlock: ReadonlyMap<number, string>;
}

const CLAUDE_TOOL_GROUP_ID = "claude-tools-in-flight";

export interface ProviderToolProjectionState {
  nextOccurrence: number;
  activeByProviderId: ReadonlyMap<string, string>;
  anonymousQueue: readonly {
    occurrenceId: string;
    matchKind: string;
  }[];
}

export function createProviderToolProjectionState(): ProviderToolProjectionState {
  return {
    nextOccurrence: 1,
    activeByProviderId: new Map(),
    anonymousQueue: [],
  };
}

export function createClaudeToolProjectionState(): ClaudeToolProjectionState {
  return { toolIdsByBlock: new Map() };
}

export function projectClaudeToolLifecycle(
  value: unknown,
  sequence: number,
  previous: ClaudeToolProjectionState,
): { progress: ExecutionProgressEvent | null; state: ClaudeToolProjectionState } {
  if (!isRecord(value)) return { progress: null, state: previous };
  if (value.type === "stream_event" && isRecord(value.event)) {
    const nested = value.event;
    const blockIndex = readNonNegativeInteger(nested.index);
    if (
      nested.type === "content_block_start"
      && blockIndex !== null
      && isRecord(nested.content_block)
      && readString(nested.content_block.type) === "tool_use"
    ) {
      const toolId = readString(nested.content_block.id) ?? `claude-block:${String(blockIndex)}`;
      const toolIdsByBlock = new Map(previous.toolIdsByBlock);
      toolIdsByBlock.set(blockIndex, toolId);
      return {
        progress: {
          kind: "tool-started",
          toolId: CLAUDE_TOOL_GROUP_ID,
          toolKind: readString(nested.content_block.name) ?? "tool",
          sequence,
        },
        state: { toolIdsByBlock },
      };
    }
    if (nested.type === "content_block_stop" && blockIndex !== null) {
      // This only closes Claude's streamed tool-use block; the external tool is
      // still running. Keep it in flight until the later user/tool_result event.
      return { progress: null, state: previous };
    }
  }
  if (value.type === "user" && isRecord(value.message) && Array.isArray(value.message.content)) {
    const resultIds = new Set(value.message.content.flatMap((part) =>
      isRecord(part)
      && part.type === "tool_result"
      && typeof part.tool_use_id === "string"
        ? [part.tool_use_id]
        : []));
    if (resultIds.size > 0) {
      const toolIdsByBlock = new Map(
        [...previous.toolIdsByBlock].filter(([, toolId]) => !resultIds.has(toolId)),
      );
      if (previous.toolIdsByBlock.size === 0 || toolIdsByBlock.size > 0) {
        return {
          progress: statusProgress(sequence),
          state: { toolIdsByBlock },
        };
      }
      return {
        progress: {
          kind: "tool-finished",
          toolId: CLAUDE_TOOL_GROUP_ID,
          toolKind: "tool-result",
          sequence,
        },
        state: { toolIdsByBlock },
      };
    }
  }
  return { progress: null, state: previous };
}

export function isTrueExecutionProgress(event: ExecutionProgressEvent): boolean {
  switch (event.kind) {
    case "assistant-output":
    case "reasoning-output":
      return event.delta.trim().length > 0;
    case "tool-started":
    case "tool-finished":
    case "file-changed":
      return true;
    case "provider-retry":
    case "status":
    case "config":
    case "usage":
    case "heartbeat":
      return false;
    default:
      return assertNever(event);
  }
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled execution contract member: ${String(value)}`);
}

export function executionInterruptionActor(reason: unknown): "user" | "system" {
  return executionInterruptionCause(reason) === "user" ? "user" : "system";
}

export function executionInterruptionCause(reason: unknown): ExecutionInterruptionCause {
  const text = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/runtime-closing|shutdown/iu.test(text)) return "runtime-closing";
  if (/redirect|new-message/iu.test(text)) return "redirect";
  if (/context-unavailable|project-(?:directory-)?unavailable|project-removed|agent-team-unavailable/iu.test(text)) {
    return "context-unavailable";
  }
  if (/system/iu.test(text)) return "system";
  return "user";
}

export function projectCodexProgress(
  value: unknown,
  sequence: number,
): ExecutionProgressEvent | null {
  if (!isRecord(value)) return null;
  if (value.type === "item.completed" && isRecord(value.item)) {
    const item = value.item;
    const itemType = readString(item.type);
    if (itemType === "agent_message") {
      const delta = readString(item.text);
      return delta === null ? null : { kind: "assistant-output", delta, sequence };
    }
    if (itemType === "reasoning" || itemType === "agent_reasoning") {
      const delta = readText(item.text) ?? readText(item.content);
      return delta === null ? null : { kind: "reasoning-output", delta, sequence };
    }
    if (itemType !== null && isFileType(itemType)) {
      return {
        kind: "file-changed",
        pathHint: readString(item.path) ?? readString(item.file_path) ?? "workspace",
        sequence,
      };
    }
  }
  return statusProgress(sequence);
}

export function projectCodexToolLifecycle(
  value: unknown,
  sequence: number,
  previous: ProviderToolProjectionState,
): { progress: ExecutionProgressEvent | null; state: ProviderToolProjectionState } {
  if (!isRecord(value) || !isRecord(value.item)) {
    return { progress: null, state: previous };
  }
  const itemType = readString(value.item.type);
  if (itemType === null || !isToolType(itemType)) {
    return { progress: null, state: previous };
  }
  if (value.type === "item.started") {
    return projectProviderToolTransition({
      transition: "started",
      providerId: readString(value.item.id),
      matchKind: itemType,
      toolKind: itemType,
      namespace: "codex-tool",
      sequence,
      previous,
    });
  }
  if (value.type === "item.completed") {
    return projectProviderToolTransition({
      transition: "finished",
      providerId: readString(value.item.id),
      matchKind: itemType,
      toolKind: itemType,
      namespace: "codex-tool",
      sequence,
      previous,
    });
  }
  return { progress: null, state: previous };
}

export function projectClaudeProgress(
  value: unknown,
  sequence: number,
): ExecutionProgressEvent | null {
  if (!isRecord(value)) return null;
  if (value.type !== "stream_event" || !isRecord(value.event)) {
    return statusProgress(sequence);
  }
  const nested = value.event;
  if (nested.type === "content_block_delta" && isRecord(nested.delta)) {
    const deltaType = readString(nested.delta.type);
    const delta = readString(nested.delta.text) ?? readString(nested.delta.thinking);
    if (delta === null) return statusProgress(sequence);
    return deltaType === "thinking_delta"
      ? { kind: "reasoning-output", delta, sequence }
      : { kind: "assistant-output", delta, sequence };
  }
  // Tool lifecycle belongs exclusively to projectClaudeToolLifecycle. In
  // particular, content_block_stop only closes the streamed tool-use block;
  // the external tool remains in flight until a later tool_result arrives.
  return statusProgress(sequence);
}

export function projectKimiProgress(
  value: unknown,
  sequence: number,
): ExecutionProgressEvent | null {
  if (!isRecord(value)) return null;
  const update = isRecord(value.update) ? value.update : value;
  const kind = firstString(update.sessionUpdate, update.session_update, update.type);
  if (kind === null) return null;
  const content = isRecord(update.content) ? update.content : update;
  if (kind === "agent_message_chunk") {
    const delta = firstString(content.text);
    return delta === null ? statusProgress(sequence) : { kind: "assistant-output", delta, sequence };
  }
  if (kind === "agent_thought_chunk") {
    const delta = firstString(content.text, content.thought);
    return delta === null ? statusProgress(sequence) : { kind: "reasoning-output", delta, sequence };
  }
  if (kind === "tool_call" || kind === "tool_call_update") return statusProgress(sequence);
  if (kind === "file_change" || kind === "file_changed") {
    return {
      kind: "file-changed",
      pathHint: firstString(update.path, update.filePath, update.file_path) ?? "workspace",
      sequence,
    };
  }
  if (kind === "config_option_update" || kind === "available_commands_update") {
    return { kind: "config", sequence };
  }
  if (kind.includes("usage")) {
    return { kind: "usage", sequence };
  }
  const retry = readProviderRetry(update, sequence);
  return retry ?? statusProgress(sequence);
}

export function projectKimiToolLifecycle(
  value: unknown,
  sequence: number,
  previous: ProviderToolProjectionState,
): { progress: ExecutionProgressEvent | null; state: ProviderToolProjectionState } {
  if (!isRecord(value)) return { progress: null, state: previous };
  const update = isRecord(value.update) ? value.update : value;
  const kind = firstString(update.sessionUpdate, update.session_update, update.type);
  const toolKind = firstString(update.title, update.name, update.kind) ?? "tool";
  const providerId = firstString(update.toolCallId, update.tool_call_id, update.id);
  if (kind === "tool_call") {
    return projectProviderToolTransition({
      transition: "started",
      providerId,
      matchKind: "tool_call",
      toolKind,
      namespace: "kimi-tool",
      sequence,
      previous,
    });
  }
  if (
    kind === "tool_call_update"
    && (firstString(update.status) === "completed" || firstString(update.status) === "failed")
  ) {
    return projectProviderToolTransition({
      transition: "finished",
      providerId,
      matchKind: "tool_call",
      toolKind,
      namespace: "kimi-tool",
      sequence,
      previous,
    });
  }
  return { progress: null, state: previous };
}

function projectProviderToolTransition(input: {
  transition: "started" | "finished";
  providerId: string | null;
  matchKind: string;
  toolKind: string;
  namespace: string;
  sequence: number;
  previous: ProviderToolProjectionState;
}): { progress: ExecutionProgressEvent; state: ProviderToolProjectionState } {
  if (input.transition === "started") {
    if (
      input.providerId !== null
      && input.previous.activeByProviderId.has(input.providerId)
    ) {
      return { progress: statusProgress(input.sequence), state: input.previous };
    }
    const occurrenceId = `${input.namespace}:${String(input.previous.nextOccurrence)}`;
    const activeByProviderId = new Map(input.previous.activeByProviderId);
    const anonymousQueue = [...input.previous.anonymousQueue];
    if (input.providerId === null) {
      anonymousQueue.push({ occurrenceId, matchKind: input.matchKind });
    } else {
      activeByProviderId.set(input.providerId, occurrenceId);
    }
    return {
      progress: {
        kind: "tool-started",
        toolId: occurrenceId,
        toolKind: input.toolKind,
        sequence: input.sequence,
      },
      state: {
        nextOccurrence: input.previous.nextOccurrence + 1,
        activeByProviderId,
        anonymousQueue,
      },
    };
  }

  const activeByProviderId = new Map(input.previous.activeByProviderId);
  const anonymousQueue = [...input.previous.anonymousQueue];
  let occurrenceId: string | undefined;
  if (input.providerId === null) {
    const index = anonymousQueue.findIndex((entry) => entry.matchKind === input.matchKind);
    if (index >= 0) {
      occurrenceId = anonymousQueue[index]?.occurrenceId;
      anonymousQueue.splice(index, 1);
    }
  } else {
    occurrenceId = activeByProviderId.get(input.providerId);
    activeByProviderId.delete(input.providerId);
  }
  if (occurrenceId === undefined) {
    return { progress: statusProgress(input.sequence), state: input.previous };
  }
  return {
    progress: {
      kind: "tool-finished",
      toolId: occurrenceId,
      toolKind: input.toolKind,
      sequence: input.sequence,
    },
    state: {
      nextOccurrence: input.previous.nextOccurrence,
      activeByProviderId,
      anonymousQueue,
    },
  };
}

function readProviderRetry(
  value: Record<string, unknown>,
  sequence: number,
): ExecutionProgressEvent | null {
  const text = [
    readString(value.message),
    readString(value.status),
    readString(value.error),
  ].filter((part): part is string => part !== null).join(" ");
  if (!/retry|重试|overload|busy|429/iu.test(text)) return null;
  const match = text.match(/(?:attempt|retry|重试)[^\d]{0,8}(\d+)/iu);
  const attempt = match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10);
  return {
    kind: "provider-retry",
    retryKind: /429|rate.?limit/iu.test(text) ? "rate-limit" : "service",
    ...(attempt === undefined || !Number.isFinite(attempt) ? {} : { attempt }),
    sequence,
  };
}

function statusProgress(sequence: number): ExecutionProgressEvent {
  return { kind: "status", sequence };
}

function isToolType(value: string): boolean {
  return value.includes("tool")
    || value.includes("command")
    || value === "function_call"
    || value === "web_search";
}

function isFileType(value: string): boolean {
  return value.includes("file") || value.includes("patch");
}

function readText(value: unknown): string | null {
  if (typeof value === "string") return value.trim().length === 0 ? null : value;
  if (!Array.isArray(value)) return null;
  const text = value
    .map((part) => isRecord(part) ? firstString(part.text, part.thinking) : null)
    .filter((part): part is string => part !== null)
    .join("");
  return text.trim().length === 0 ? null : text;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const candidate = readString(value);
    if (candidate !== null) return candidate;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
