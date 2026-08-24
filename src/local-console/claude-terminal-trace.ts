import type { LocalConsoleExecutionEngine } from "./types.js";

/**
 * Claude TUI 原始终端字节的活动运行期投影。
 *
 * 这不是会话事实、Agent Markdown 或 lifecycle 输入：它只在对应 run
 * 仍活动时保留，供只读终端以游标增量回放。base64 让 JSON transport
 * 保持逐字节可逆，renderer 再将它交给 terminal emulator。
 */

export interface LocalClaudeTerminalTraceChunk {
  /** 单调递增的块游标；初始块为 0。 */
  cursor: number;
  /** 原始 PTY UTF-8 / binary bytes 的 base64 编码。 */
  dataBase64: string;
}

export interface LocalClaudeTerminalTrace {
  chunks: LocalClaudeTerminalTraceChunk[];
  nextCursor: number;
  bytesObserved: number;
  bytesRetained: number;
  incomplete: boolean;
  maxBytes: number;
}

export interface LocalClaudeTerminalTraceRun {
  sessionId: string;
  runDir: string | null;
  engine: LocalConsoleExecutionEngine;
  claudeTerminalTrace: LocalClaudeTerminalTrace | null;
}

export interface LocalConsoleClaudeTerminalTracePage {
  sessionId: string;
  runId: string;
  chunks: LocalClaudeTerminalTraceChunk[];
  nextCursor: number;
  bytesObserved: number;
  bytesRetained: number;
  incomplete: boolean;
}

export type LocalClaudeTerminalTraceAppendResult =
  | { kind: "ignored" }
  | { kind: "accepted"; chunk: LocalClaudeTerminalTraceChunk }
  | { kind: "incomplete" };

export const DEFAULT_CLAUDE_TERMINAL_TRACE_MAX_BYTES = 1024 * 1024;

export class LocalClaudeTerminalTraceCursorError extends Error {
  constructor() {
    super("invalid Claude terminal trace cursor");
    this.name = "LocalClaudeTerminalTraceCursorError";
  }
}

export class LocalClaudeTerminalTraceUnavailableError extends Error {
  constructor() {
    super("Claude terminal trace is unavailable");
    this.name = "LocalClaudeTerminalTraceUnavailableError";
  }
}

export function createLocalClaudeTerminalTrace(
  maxBytes = DEFAULT_CLAUDE_TERMINAL_TRACE_MAX_BYTES,
): LocalClaudeTerminalTrace {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("Claude terminal trace max bytes must be a positive safe integer");
  }
  return {
    chunks: [],
    nextCursor: 0,
    bytesObserved: 0,
    bytesRetained: 0,
    incomplete: false,
    maxBytes,
  };
}

/** Creates the trace only for the Claude execution lane. */
export function planLocalClaudeTerminalTrace(
  engine: LocalConsoleExecutionEngine,
): LocalClaudeTerminalTrace | null {
  return engine === "claude" ? createLocalClaudeTerminalTrace() : null;
}

/** Narrows an active run to the only state allowed to receive raw PTY bytes. */
export function decideLocalClaudeTerminalTraceAppend(
  active: Pick<LocalClaudeTerminalTraceRun, "engine" | "runDir" | "claudeTerminalTrace"> | undefined,
): { kind: "skip" } | { kind: "append"; trace: LocalClaudeTerminalTrace; runDir: string | null } {
  return active?.engine === "claude" && active.claudeTerminalTrace !== null
    ? { kind: "append", trace: active.claudeTerminalTrace, runDir: active.runDir }
    : { kind: "skip" };
}

/** Keeps the terminal endpoint scoped to its owning active Claude run. */
export function decideLocalClaudeTerminalTraceRead(
  active: LocalClaudeTerminalTraceRun | undefined,
  sessionId: string,
): { kind: "unavailable" } | { kind: "available"; trace: LocalClaudeTerminalTrace } {
  return active?.sessionId === sessionId
    && active.engine === "claude"
    && active.claudeTerminalTrace !== null
    ? { kind: "available", trace: active.claudeTerminalTrace }
    : { kind: "unavailable" };
}

export function planLocalClaudeTerminalTraceSource(
  active: LocalClaudeTerminalTraceRun | undefined,
  sessionId: string,
):
  | { kind: "active"; trace: LocalClaudeTerminalTrace }
  | { kind: "historical" }
  | { kind: "unavailable" } {
  if (active === undefined) return { kind: "historical" };
  const read = decideLocalClaudeTerminalTraceRead(active, sessionId);
  return read.kind === "available"
    ? { kind: "active", trace: read.trace }
    : { kind: "unavailable" };
}

/** Append one PTY delivery without interpreting its ANSI, lifecycle, or text. */
export function appendLocalClaudeTerminalTrace(
  trace: LocalClaudeTerminalTrace,
  data: string | Uint8Array,
  maxBytes = trace.maxBytes,
): LocalClaudeTerminalTraceAppendResult {
  const bytes = Buffer.from(data);
  if (bytes.length === 0) return { kind: "ignored" };

  trace.bytesObserved += bytes.length;
  if (trace.incomplete || trace.bytesRetained >= maxBytes) {
    trace.incomplete = true;
    return { kind: "incomplete" };
  }

  const retained = bytes.subarray(0, Math.min(bytes.length, maxBytes - trace.bytesRetained));
  trace.bytesRetained += retained.length;
  if (retained.length < bytes.length) trace.incomplete = true;

  const chunk: LocalClaudeTerminalTraceChunk = {
    cursor: trace.nextCursor,
    dataBase64: retained.toString("base64"),
  };
  trace.chunks.push(chunk);
  trace.nextCursor += 1;
  return { kind: "accepted", chunk };
}

export function parseLocalClaudeTerminalTraceCursor(value: string | undefined): number {
  if (value === undefined) return 0;
  if (!/^\d+$/u.test(value)) throw new LocalClaudeTerminalTraceCursorError();
  const cursor = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new LocalClaudeTerminalTraceCursorError();
  return cursor;
}

export function pageLocalClaudeTerminalTrace(
  input: {
    sessionId: string;
    runId: string;
    trace: LocalClaudeTerminalTrace;
    cursor: number;
  },
): LocalConsoleClaudeTerminalTracePage {
  if (input.cursor > input.trace.nextCursor) throw new LocalClaudeTerminalTraceCursorError();
  return {
    sessionId: input.sessionId,
    runId: input.runId,
    chunks: input.trace.chunks
      .filter((chunk) => chunk.cursor >= input.cursor)
      .map((chunk) => ({ ...chunk })),
    nextCursor: input.trace.nextCursor,
    bytesObserved: input.trace.bytesObserved,
    bytesRetained: input.trace.bytesRetained,
    incomplete: input.trace.incomplete,
  };
}
