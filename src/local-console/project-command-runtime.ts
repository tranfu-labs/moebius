import { formatLocalError } from "./runtime-domain.js";
import {
  decideProjectCommandCapability,
  decideProjectFolderAvailability,
  planProjectRemoval,
  planProjectRemovalError,
  planProjectRepairError,
} from "./project-command-plan.js";
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
    resolvePath(folderPath: string): string;
    directoryAvailable(folderPath: string): Promise<boolean>;
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
    const capability = decideProjectCommandCapability(this.input.store.repairProjectFolder !== undefined);
    if (capability.kind === "unavailable") {
      throw new Error("local console project folder repair unavailable");
    }
    const folderPath = this.input.resolvePath(input.folderPath);
    const availability = decideProjectFolderAvailability(await this.input.directoryAvailable(folderPath));
    if (availability.kind === "unavailable") {
      throw new LocalConsoleProjectFolderError("PROJECT_DIRECTORY_UNAVAILABLE", "所选文件夹不可访问，请重新选择");
    }
    try {
      const repaired = await this.input.storeCall("local-console-store-repair-project-folder", () =>
        this.input.store.repairProjectFolder!({ projectId: input.projectId, folderPath, now: this.input.nowIso() }));
      for (const session of repaired.sessions) this.input.processPending(session.sessionId);
      return await this.input.withDirectoryAvailability(repaired, true);
    } catch (error) {
      const message = formatLocalError(error);
      const plan = planProjectRepairError(message);
      if (plan.kind === "already-bound") {
        throw new LocalConsoleProjectFolderError(
          "PROJECT_FOLDER_ALREADY_BOUND",
          "该文件夹已绑定其他项目，不能合并项目记录；请转到已有项目或重新选择",
        );
      }
      if (plan.kind === "not-found") {
        throw new LocalConsoleProjectFolderError("LOCAL_PROJECT_NOT_FOUND", "项目不存在或已移除");
      }
      throw error;
    }
  }

  async rename(input: { projectId: string; title: string }): Promise<LocalConsoleProjectSummary> {
    const capability = decideProjectCommandCapability(this.input.store.renameProject !== undefined);
    if (capability.kind === "unavailable") throw new Error("local console project rename unavailable");
    return await this.input.storeCall("local-console-store-rename-project", () =>
      this.input.store.renameProject!({ ...input, now: this.input.nowIso() }));
  }

  async remove(input: { projectId: string; force: boolean }): Promise<LocalConsoleProjectRemovalResult> {
    const capability = decideProjectCommandCapability(this.input.store.removeProject !== undefined);
    if (capability.kind === "unavailable") throw new Error("local console project removal unavailable");
    const project = (await this.input.storeCall("local-console-store-list-projects", () =>
      this.input.store.listProjects())).find((candidate) => candidate.projectId === input.projectId);
    const allSessions = await this.input.storeCall("local-console-store-list-project-removal-sessions", () =>
      this.input.store.listSessions());
    const plan = planProjectRemoval({ project, allSessions, force: input.force });
    if (plan.kind === "not-found") throw new Error(`local console project not found: ${input.projectId}`);
    if (plan.kind === "running") throw new LocalConsoleProjectRunningError();
    for (const sessionId of plan.sessionIds) {
      this.input.inactiveSessions.add(sessionId);
      if (plan.abortActiveRuns) {
        for (const active of this.input.activeRunsForSession(sessionId)) active.controller.abort("project-removed");
      }
    }
    try {
      return await this.input.storeCall("local-console-store-remove-project", () =>
        this.input.store.removeProject!({ ...input, now: this.input.nowIso() }));
    } catch (error) {
      for (const sessionId of plan.sessionIds) this.input.inactiveSessions.delete(sessionId);
      const errorPlan = planProjectRemovalError(formatLocalError(error));
      if (errorPlan.kind === "running") throw new LocalConsoleProjectRunningError();
      throw error;
    }
  }

  async reorder(projectIds: string[]): Promise<LocalConsoleProjectSummary[]> {
    return await this.input.storeCall("local-console-store-reorder-projects", () =>
      this.input.store.reorderProjects(projectIds));
  }
}
