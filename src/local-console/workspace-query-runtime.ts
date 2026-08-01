import { formatLocalError } from "./runtime-domain.js";
import {
  decideProjectFileRead,
  planProjectFiles,
  planUnavailableProjectFile,
  planUnavailableProjectFiles,
  planUnavailableWorkspaceDiff,
  planWorkspaceDiffDetail,
  type WorkspaceDiffProjection,
} from "./workspace-query-plan.js";
import type {
  LocalConsoleFileContent,
  LocalConsoleFileReferenceContent,
  LocalConsoleProjectFiles,
  LocalConsoleWorkspaceDiffDetail,
  LocalConsoleWorkspaceMode,
} from "./types.js";

interface WorkspaceQueryContext {
  workspacePath: string;
  baselineCommit: string | null;
  workspaceMode: LocalConsoleWorkspaceMode;
}

export class LocalConsoleWorkspaceQueryRuntime {
  constructor(private readonly input: {
    readContext(sessionId: string): Promise<WorkspaceQueryContext>;
    readWorkspaceMode(sessionId: string): Promise<LocalConsoleWorkspaceMode>;
    readDiff(context: WorkspaceQueryContext): Promise<WorkspaceDiffProjection>;
    listFiles(workspacePath: string): Promise<string[]>;
    readDiffFile(context: WorkspaceQueryContext, filePath: string): Promise<LocalConsoleFileContent>;
    readWorkspaceFile(workspacePath: string, filePath: string): Promise<LocalConsoleFileContent>;
    readFileReference(input: { filePath: string; line: number; column: number | null }): Promise<LocalConsoleFileReferenceContent>;
    log(event: { event: string; [key: string]: unknown }): void;
  }) {}

  async workspaceDiffDetail(sessionId: string): Promise<LocalConsoleWorkspaceDiffDetail> {
    try {
      const context = await this.input.readContext(sessionId);
      return planWorkspaceDiffDetail(await this.input.readDiff(context), context.workspaceMode);
    } catch (error) {
      this.input.log({
        event: "local-console-workspace-diff-detail-unavailable",
        sessionId,
        error: formatLocalError(error),
      });
      return planUnavailableWorkspaceDiff(await this.input.readWorkspaceMode(sessionId));
    }
  }

  async projectFiles(sessionId: string): Promise<LocalConsoleProjectFiles> {
    try {
      const context = await this.input.readContext(sessionId);
      const [filePaths, diff] = await Promise.all([
        this.input.listFiles(context.workspacePath),
        this.input.readDiff(context),
      ]);
      return planProjectFiles({ filePaths, diff, workspaceMode: context.workspaceMode });
    } catch (error) {
      this.input.log({ event: "local-console-project-files-unavailable", sessionId, error: formatLocalError(error) });
      return planUnavailableProjectFiles(await this.input.readWorkspaceMode(sessionId));
    }
  }

  async projectFile(sessionId: string, filePath: string): Promise<LocalConsoleFileContent> {
    try {
      const context = await this.input.readContext(sessionId);
      const source = decideProjectFileRead(await this.input.readDiff(context), filePath);
      return source.kind === "diff"
        ? await this.input.readDiffFile(context, filePath)
        : await this.input.readWorkspaceFile(context.workspacePath, filePath);
    } catch (error) {
      this.input.log({
        event: "local-console-project-file-unavailable",
        sessionId,
        filePath,
        error: formatLocalError(error),
      });
      return planUnavailableProjectFile(filePath);
    }
  }

  async fileReference(
    sessionId: string,
    input: { filePath: string; line: number; column: number | null },
  ): Promise<LocalConsoleFileReferenceContent> {
    try {
      return await this.input.readFileReference(input);
    } catch (error) {
      this.input.log({
        event: "local-console-file-reference-unavailable",
        sessionId,
        filePath: input.filePath,
        line: input.line,
        error: formatLocalError(error),
      });
      return {
        available: false,
        path: input.filePath,
        lines: [],
        reason: "unavailable",
        targetLine: input.line,
        targetColumn: input.column,
      };
    }
  }
}
