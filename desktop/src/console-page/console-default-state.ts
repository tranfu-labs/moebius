import type { OperatorMessage, OperatorProject } from "@moebius/console-ui";

export const EMPTY_CONSOLE_PROJECT: OperatorProject = {
  projectId: "local",
  sourceType: "local-folder",
  title: "moebius",
  folderPath: "",
  worktreeMode: false,
  workspaceCwd: null,
  workspaceMode: null,
  worktreePath: null,
  worktreeUnavailableReason: null,
  workspaceUpdatedAt: null,
  branchName: null,
  isGitRepository: false,
  directoryAvailable: true,
  directoryUnavailableReason: null,
  sessions: [],
  runningCount: 0,
  waitingCount: 0,
  stuckCount: 0,
  errorCount: 0,
};

export const NO_OPERATOR_MESSAGES: OperatorMessage[] = [];
