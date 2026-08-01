import path from "node:path";
import { directoryAvailable } from "./runtime-file-support.js";
import { formatLocalError } from "./runtime-domain.js";
import type {
  LocalConsoleProjectRemovalResult,
  LocalConsoleProjectSummary,
  LocalConsoleStore,
} from "./types.js";
import {
  LocalConsoleProjectFolderError,
  LocalConsoleProjectRunningError,
} from "./types.js";

export class LocalProjectCommandRuntime {
  constructor(private readonly input: {
    store: LocalConsoleStore;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    nowIso(): string;
    assertDirectoryAvailable(projectId: string): Promise<void>;
    withDirectoryAvailability(project: LocalConsoleProjectSummary, knownAvailable?: boolean): Promise<LocalConsoleProjectSummary>;
    processPending(sessionId: string): void;
    activeRunsForSession(sessionId: string): Array<{ controller: AbortController }>;
    inactiveSessions: Set<string>;
  }) {}

  async create(input: { folderPath: string; worktreeMode: boolean }): Promise<LocalConsoleProjectSummary> {
    return await this.input.storeCall("local-console-store-create-project", () =>
      this.input.store.createProject({ ...input, now: this.input.nowIso() }));
  }

  async update(input: { projectId: string; worktreeMode: boolean }): Promise<LocalConsoleProjectSummary> {
    await this.input.assertDirectoryAvailable(input.projectId);
    return await this.input.storeCall("local-console-store-update-project", () =>
      this.input.store.updateProject({ ...input, now: this.input.nowIso() }));
  }

  async repairFolder(input: { projectId: string; folderPath: string }): Promise<LocalConsoleProjectSummary> {
    if (this.input.store.repairProjectFolder === undefined) {
      throw new Error("local console project folder repair unavailable");
    }
    const folderPath = path.resolve(input.folderPath);
    if (!(await directoryAvailable(folderPath))) {
      throw new LocalConsoleProjectFolderError("PROJECT_DIRECTORY_UNAVAILABLE", "所选文件夹不可访问，请重新选择");
    }
    try {
      const repaired = await this.input.storeCall("local-console-store-repair-project-folder", () =>
        this.input.store.repairProjectFolder!({ projectId: input.projectId, folderPath, now: this.input.nowIso() }));
      for (const session of repaired.sessions) this.input.processPending(session.sessionId);
      return await this.input.withDirectoryAvailability(repaired, true);
    } catch (error) {
      const message = formatLocalError(error);
      if (message.includes("PROJECT_FOLDER_ALREADY_BOUND")) {
        throw new LocalConsoleProjectFolderError(
          "PROJECT_FOLDER_ALREADY_BOUND",
          "该文件夹已绑定其他项目，不能合并项目记录；请转到已有项目或重新选择",
        );
      }
      if (message.includes("LOCAL_PROJECT_NOT_FOUND")) {
        throw new LocalConsoleProjectFolderError("LOCAL_PROJECT_NOT_FOUND", "项目不存在或已移除");
      }
      throw error;
    }
  }

  async rename(input: { projectId: string; title: string }): Promise<LocalConsoleProjectSummary> {
    if (this.input.store.renameProject === undefined) throw new Error("local console project rename unavailable");
    return await this.input.storeCall("local-console-store-rename-project", () =>
      this.input.store.renameProject!({ ...input, now: this.input.nowIso() }));
  }

  async remove(input: { projectId: string; force: boolean }): Promise<LocalConsoleProjectRemovalResult> {
    if (this.input.store.removeProject === undefined) throw new Error("local console project removal unavailable");
    const project = (await this.input.storeCall("local-console-store-list-projects", () =>
      this.input.store.listProjects())).find((candidate) => candidate.projectId === input.projectId);
    if (project === undefined) throw new Error(`local console project not found: ${input.projectId}`);
    if (project.runningCount > 0 && !input.force) throw new LocalConsoleProjectRunningError();

    const allSessions = await this.input.storeCall("local-console-store-list-project-removal-sessions", () =>
      this.input.store.listSessions());
    const removalSessionIds = new Set(project.sessions.map((session) => session.sessionId));
    let changed = true;
    while (changed) {
      changed = false;
      for (const session of allSessions) {
        if (session.analysisParentSessionId != null
          && removalSessionIds.has(session.analysisParentSessionId)
          && !removalSessionIds.has(session.sessionId)) {
          removalSessionIds.add(session.sessionId);
          changed = true;
        }
      }
    }
    const sessionIds = [...removalSessionIds];
    for (const sessionId of sessionIds) {
      this.input.inactiveSessions.add(sessionId);
      if (input.force) {
        for (const active of this.input.activeRunsForSession(sessionId)) active.controller.abort("project-removed");
      }
    }
    try {
      return await this.input.storeCall("local-console-store-remove-project", () =>
        this.input.store.removeProject!({ ...input, now: this.input.nowIso() }));
    } catch (error) {
      for (const sessionId of sessionIds) this.input.inactiveSessions.delete(sessionId);
      if (error instanceof Error && error.message.includes("PROJECT_HAS_RUNNING_AGENTS")) {
        throw new LocalConsoleProjectRunningError();
      }
      throw error;
    }
  }

  async reorder(projectIds: string[]): Promise<LocalConsoleProjectSummary[]> {
    return await this.input.storeCall("local-console-store-reorder-projects", () =>
      this.input.store.reorderProjects(projectIds));
  }
}
