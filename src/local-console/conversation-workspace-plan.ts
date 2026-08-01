import { parseTrailingStageMarker } from "../stages.js";
import type { LocalConsoleWorkspaceMode } from "./types.js";

export function decideConversationBaselineRead(input: {
  cached: boolean;
  persistenceAvailable: boolean;
}): { kind: "skip" } | { kind: "read" } {
  return input.cached || !input.persistenceAvailable ? { kind: "skip" } : { kind: "read" };
}

export function decideConversationDiffRead(
  baselineCommit: string | null | undefined,
): { kind: "missing-baseline" } | { kind: "read" } {
  return baselineCommit == null ? { kind: "missing-baseline" } : { kind: "read" };
}

export function planConversationWorkspaceContext(input: {
  workspaceMode: LocalConsoleWorkspaceMode;
  persistedBaselineCommit: string | null | undefined;
  cachedBaselineCommit: string | null | undefined;
}): {
  workspaceKind: "direct" | "worktree";
  baselineCommit: string | null;
} {
  return {
    workspaceKind: input.workspaceMode === "worktree" ? "worktree" : "direct",
    baselineCommit: input.persistedBaselineCommit ?? input.cachedBaselineCommit ?? null,
  };
}

export function planWorkspaceDiffRecording(input: {
  workspaceMode: LocalConsoleWorkspaceMode;
  worktreePath: string | null;
  finalText: string;
}): { kind: "skip" } | { kind: "record"; worktreePath: string } {
  return input.workspaceMode === "worktree"
    && input.worktreePath !== null
    && parseTrailingStageMarker(input.finalText) === "code-verified"
    ? { kind: "record", worktreePath: input.worktreePath }
    : { kind: "skip" };
}

export function planOriginalRepoStatusRead(
  originalRepoRoot: string | null,
): { kind: "clean" } | { kind: "read"; folderPath: string } {
  return originalRepoRoot === null
    ? { kind: "clean" }
    : { kind: "read", folderPath: originalRepoRoot };
}

export function decideOriginalRepoStatus(status: string): { kind: "clean" } | { kind: "dirty"; status: string } {
  return status === "" ? { kind: "clean" } : { kind: "dirty", status };
}
