import type { LocalConsoleWorkspaceMode } from "./types.js";

export type LocalSessionWorkspaceDecision =
  | { kind: "allow" }
  | { kind: "reject"; reason: "workspace-locked" | "not-git-repository" };

export function decideSessionWorkspaceSwitch(input: {
  messageCount: number;
  requestedMode: LocalConsoleWorkspaceMode;
  workspaceIsGitRepository: boolean;
}): LocalSessionWorkspaceDecision {
  if (input.messageCount > 0) {
    return { kind: "reject", reason: "workspace-locked" };
  }
  if (input.requestedMode === "worktree" && !input.workspaceIsGitRepository) {
    return { kind: "reject", reason: "not-git-repository" };
  }
  return { kind: "allow" };
}
