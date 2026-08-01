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
