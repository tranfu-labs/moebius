import type {
  FileReferenceContent,
  ProjectFilesData,
  WorkspaceDiffData,
  WorkspaceFileContent,
} from "@moebius/console-ui";

export interface ProjectFilePort {
  readWorkspaceDiff(apiBase: string, sessionId: string): Promise<WorkspaceDiffData>;
  readProjectFiles(apiBase: string, sessionId: string): Promise<ProjectFilesData>;
  readProjectFile(
    apiBase: string,
    sessionId: string,
    filePath: string,
  ): Promise<WorkspaceFileContent>;
  readFileReference(
    apiBase: string,
    sessionId: string,
    filePath: string,
    line: number,
    column: number | null,
  ): Promise<FileReferenceContent>;
}
