import type { LocalConsoleMessage, LocalConsoleRunOutput } from "./types.js";
import type { LocalClaudeTerminalTrace } from "./claude-terminal-trace.js";
import type { LocalConsoleExecutionEngine } from "./types.js";

export interface ActiveRunOutputSource {
  sessionId: string;
  runDir: string | null;
  role: string | null;
}

export interface ActiveClaudeTerminalTraceSource {
  engine: LocalConsoleExecutionEngine;
  claudeTerminalTrace: LocalClaudeTerminalTrace | null;
}

export function planRunOutputSource(input: {
  sessionId: string;
  messages: readonly LocalConsoleMessage[];
  active: ActiveRunOutputSource | undefined;
}):
  | { kind: "missing" }
  | { kind: "read"; runDir: string | null; role: string | null; fallback: string | null } {
  const matchingActive = input.active?.sessionId === input.sessionId ? input.active : undefined;
  if (input.messages.length === 0 && matchingActive === undefined) return { kind: "missing" };
  const historicalWithRunDir = [...input.messages].reverse().find((message) => message.runDir !== null);
  const fallback = input.messages
    .map((message) => message.error ?? message.body)
    .filter((value) => value.trim() !== "")
    .join("\n\n") || null;
  return {
    kind: "read",
    runDir: matchingActive?.runDir ?? historicalWithRunDir?.runDir ?? null,
    role: matchingActive?.role
      ?? [...input.messages].reverse().find((message) => message.role !== null)?.role
      ?? null,
    fallback,
  };
}

export function decideRunOutputFileRead(
  runDir: string | null,
): { kind: "skip" } | { kind: "read"; runDir: string } {
  return runDir === null ? { kind: "skip" } : { kind: "read", runDir };
}

export function planRunOutput(input: {
  sessionId: string;
  runId: string;
  source: Extract<ReturnType<typeof planRunOutputSource>, { kind: "read" }>;
  stdout: string | null;
  stderr: string | null;
}): LocalConsoleRunOutput {
  return {
    sessionId: input.sessionId,
    runId: input.runId,
    role: input.source.role,
    stdout: input.stdout,
    stderr: input.stderr,
    fallback: input.source.fallback,
  };
}

export function planProcessCursor(cursor: string | undefined): {} | { cursor: string } {
  return cursor === undefined ? {} : { cursor };
}
