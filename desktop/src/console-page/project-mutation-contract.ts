export interface ProjectDesktopTransport {
  showInFolder?: (folderPath: string) => Promise<void>;
  selectFolderForRepair?: (projectId: string) => Promise<string | null>;
}

export class ProjectMutationRequestError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "ProjectMutationRequestError";
  }
}

export interface ProjectMutationPort {
  showInFolder(transport: ProjectDesktopTransport | undefined, folderPath: string): Promise<void>;
  renameProject(apiBase: string, projectId: string, title: string): Promise<void>;
  removeProject(
    apiBase: string,
    projectId: string,
    force: boolean,
  ): Promise<{ archivedSessionIds?: string[] }>;
  selectFolderForRepair(
    transport: ProjectDesktopTransport | undefined,
    projectId: string,
  ): Promise<string | null>;
  repairProjectFolder(apiBase: string, projectId: string, folderPath: string): Promise<void>;
}
