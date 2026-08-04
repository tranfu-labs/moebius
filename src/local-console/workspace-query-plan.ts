import type {
  LocalConsoleFileContent,
  LocalConsoleProjectFiles,
  LocalConsoleWorkspaceDiffFile,
  LocalConsoleWorkspaceDiffDetail,
  LocalConsoleWorkspaceMode,
} from "./types.js";

export type WorkspaceDiffProjection =
  | { available: true; fileCount: number; files: LocalConsoleWorkspaceDiffFile[]; reason: null }
  | {
      available: false;
      fileCount: null;
      files: [];
      reason: Exclude<LocalConsoleWorkspaceDiffDetail, { available: true }>["reason"];
    };

export function planWorkspaceDiffDetail(
  diff: WorkspaceDiffProjection,
  workspaceMode: LocalConsoleWorkspaceMode,
): LocalConsoleWorkspaceDiffDetail {
  return diff.available
    ? { ...diff, workspaceMode }
    : { ...diff, workspaceMode };
}

export function planUnavailableWorkspaceDiff(
  workspaceMode: LocalConsoleWorkspaceMode,
): LocalConsoleWorkspaceDiffDetail {
  return {
    available: false,
    fileCount: null,
    files: [],
    reason: "workspace-unavailable",
    workspaceMode,
  };
}

export function planProjectFiles(input: {
  filePaths: readonly string[];
  diff: WorkspaceDiffProjection;
  workspaceMode: LocalConsoleWorkspaceMode;
}): LocalConsoleProjectFiles {
  const changes = new Map(input.diff.available
    ? input.diff.files.map((file) => [file.path, file])
    : []);
  return {
    available: true,
    files: input.filePaths.map((filePath) => {
      const change = changes.get(filePath);
      return {
        path: filePath,
        additions: change?.additions ?? null,
        deletions: change?.deletions ?? null,
        changed: change !== undefined,
      };
    }),
    reason: null,
    workspaceMode: input.workspaceMode,
  };
}

export function planUnavailableProjectFiles(
  workspaceMode: LocalConsoleWorkspaceMode,
): LocalConsoleProjectFiles {
  return {
    available: false,
    files: [],
    reason: "workspace-unavailable",
    workspaceMode,
  };
}

export function planUnavailableProjectFile(filePath: string): LocalConsoleFileContent {
  return {
    available: false,
    path: filePath,
    lines: [],
    reason: "workspace-unavailable",
  };
}
