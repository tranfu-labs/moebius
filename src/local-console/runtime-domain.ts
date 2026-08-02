import path from "node:path";

import type { CodexRunResult } from "../codex.js";
import type {
  LocalConsoleExecutionProfile,
  LocalConsoleMessage,
  LocalConsoleProjectSummary,
  LocalConsoleSessionSummary,
  LocalConsoleTerminal,
  LocalConsoleTextFragment,
  LocalConsoleWorkspaceDiffSummary,
} from "./types.js";

export function buildFallbackProjectSummary(projectRoot: string): LocalConsoleProjectSummary {
  return {
    projectId: "local",
    sourceType: "local-folder",
    title: path.basename(projectRoot) || projectRoot,
    folderPath: projectRoot,
    worktreeMode: false,
    workspaceCwd: projectRoot,
    workspaceMode: "direct",
    worktreePath: null,
    worktreeUnavailableReason: null,
    workspaceUpdatedAt: null,
    sessions: [],
    runningCount: 0,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
  };
}

export function noSessionWorkspaceDiff(): LocalConsoleWorkspaceDiffSummary {
  return { available: false, fileCount: null, reason: "no-session" };
}

export function normalizeTitle(title: string | undefined): string {
  const trimmed = title?.trim();
  if (trimmed === undefined || trimmed === "") return "新会话";
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}...` : trimmed;
}

export function formatLocalError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function planRuntimeFallback<T>(value: T | null | undefined, fallback: T): T {
  return value ?? fallback;
}

export function decideRuntimeCapability<T>(capability: T | undefined):
  | { kind: "available"; capability: T }
  | { kind: "unavailable" } {
  return capability === undefined
    ? { kind: "unavailable" }
    : { kind: "available", capability };
}

export function localTerminalFromResult(
  result: Extract<CodexRunResult, { ok: false }>,
  fallbackPartialMarkdown: string | null,
  actualProfile: LocalConsoleExecutionProfile | null,
): LocalConsoleTerminal {
  const partialMarkdown = result.terminal?.partialText.trim().length
    ? result.terminal.partialText
    : fallbackPartialMarkdown ?? "";
  if (result.terminal === undefined) {
    return {
      kind: "crashed",
      subkind: null,
      safeCode: "legacy-run-failure",
      retryable: null,
      partialMarkdown,
      contentIncomplete: true,
      actualProfile,
    };
  }
  switch (result.terminal.kind) {
    case "interrupted":
      return { kind: "interrupted", subkind: result.terminal.actor, safeCode: null, retryable: null, partialMarkdown, contentIncomplete: true, actualProfile };
    case "timeout":
      return { kind: "timeout", subkind: result.terminal.basis, safeCode: null, retryable: null, partialMarkdown, contentIncomplete: true, actualProfile };
    case "quota-exhausted":
    case "rate-limited":
    case "auth":
      return { kind: result.terminal.kind, subkind: null, safeCode: result.terminal.safeCode, retryable: result.terminal.retryable, partialMarkdown, contentIncomplete: true, actualProfile };
    case "crashed":
      return { kind: "crashed", subkind: null, safeCode: result.terminal.safeCode, retryable: null, partialMarkdown, contentIncomplete: true, actualProfile };
    default:
      return assertNeverExecutionTerminal(result.terminal);
  }
}

export function workerLaneKey(sessionId: string, role: string): string {
  return `${sessionId}\u0000${role}`;
}

export function isPendingPrimaryMessage(message: LocalConsoleMessage): boolean {
  return isPendingDispatchMessage(message)
    && message.dispatchLane !== "worker"
    && message.dispatchLane !== "awaiting-team";
}

export function isPendingDispatchMessage(message: LocalConsoleMessage): boolean {
  return message.speaker === "user" && message.status === "pending";
}

export function projectPendingDispatch(message: LocalConsoleMessage) {
  const targetLane = message.dispatchLane ?? "primary";
  return {
    message,
    targetLane,
    targetRole: message.dispatchRole ?? null,
    waitingForTeam: targetLane === "awaiting-team",
  };
}

export function hasPendingStartupControlWork(session: LocalConsoleSessionSummary): boolean {
  return session.hasPendingControlWork === true || session.runningCount > 0;
}

export function isWorkerRunPlaceholder(message: LocalConsoleMessage): boolean {
  return message.sourceKind === "local-worker-run";
}

export function isVisibleTimelineMessage(message: LocalConsoleMessage): boolean {
  return message.sourceKind !== "pending-removed"
    && !isPendingDispatchMessage(message)
    && !isWorkerRunPlaceholder(message);
}

export function assertTextFragments(fragments: readonly LocalConsoleTextFragment[]): void {
  const ids = new Set<string>();
  for (const fragment of fragments) {
    if (fragment.id.trim() === "" || fragment.label.trim() === "" || fragment.text.trim() === "") {
      throw new Error("Text fragments require non-empty id, label, and text");
    }
    if (ids.has(fragment.id)) throw new Error("Text fragment ids must be unique");
    ids.add(fragment.id);
  }
}

export function requireAgentFilePath(agent: { name: string; path?: string }): string {
  if (agent.path === undefined) throw new Error(`Agent snapshot has no content: ${agent.name}`);
  return agent.path;
}

function assertNeverExecutionTerminal(value: never): never {
  throw new Error(`Unhandled local execution terminal: ${String(value)}`);
}
