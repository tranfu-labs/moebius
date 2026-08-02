import type { ConsoleStateActionsOptions } from "./console-state-action-contract.js";
import {
  decideAddedProject,
  decideConsoleApiBase,
  decideFolderPicker,
  decideMutationToken,
  decideSelectedFolder,
  planConsoleErrorMessage,
  planOpenedProjectSelection,
} from "./console-state-plan.js";
import { selectionMutationLifecycle } from "./selection-mutation-lifecycle.js";

export const projectOpeningActions = {
  async addProject(
    options: ConsoleStateActionsOptions,
    existingProjectIds: readonly string[],
  ): Promise<{ projectId: string } | null> {
    const availability = decideConsoleApiBase(
      options.apiBase,
      options.t("desktop.error.localConsoleUnavailable"),
    );
    if (availability.kind === "unavailable") {
      options.errors.report({ family: "project", scope: "add" }, availability.message);
      return null;
    }
    const picker = decideFolderPicker(
      options.selectProjectFolder,
      options.t("desktop.error.folderPickerUnavailable"),
    );
    if (picker.kind === "unavailable") {
      options.errors.report({ family: "project", scope: "add" }, picker.message);
      return null;
    }
    const mutation = decideMutationToken(selectionMutationLifecycle.begin(options, "open-project"));
    if (mutation.kind === "busy") return null;
    const errorOperation = options.errors.begin({ family: "project", scope: "add" });
    try {
      const folder = decideSelectedFolder(await picker.picker());
      if (folder.kind === "cancelled") return null;
      const project = await options.commands.openProject(availability.apiBase, folder.folderPath);
      const addition = decideAddedProject(
        project.projectId,
        existingProjectIds,
        options.t("desktop.error.folderAlreadyUsed"),
      );
      if (addition.kind === "duplicate") {
        options.errors.fail(errorOperation, addition.message);
        return null;
      }
      await options.refresh(options.getSelection(), mutation.token);
      options.errors.succeed(errorOperation);
      return { projectId: addition.projectId };
    } catch (error) {
      options.errors.fail(errorOperation, planConsoleErrorMessage(error));
      return null;
    } finally {
      selectionMutationLifecycle.finish(options, mutation.token);
    }
  },

  async openProject(options: ConsoleStateActionsOptions): Promise<void> {
    const availability = decideConsoleApiBase(
      options.apiBase,
      options.t("desktop.error.localConsoleUnavailable"),
    );
    if (availability.kind === "unavailable") {
      options.errors.report({ family: "project", scope: "open" }, availability.message);
      return;
    }
    const picker = decideFolderPicker(
      options.selectProjectFolder,
      options.t("desktop.error.folderPickerUnavailable"),
    );
    if (picker.kind === "unavailable") {
      options.errors.report({ family: "project", scope: "open" }, picker.message);
      return;
    }
    const mutation = decideMutationToken(selectionMutationLifecycle.begin(options, "open-project"));
    if (mutation.kind === "busy") return;
    const errorOperation = options.errors.begin({ family: "project", scope: "open" });
    try {
      const folder = decideSelectedFolder(await picker.picker());
      if (folder.kind === "cancelled") {
        options.errors.succeed(errorOperation);
        return;
      }
      const project = await options.commands.openProject(availability.apiBase, folder.folderPath);
      const nextSelection = planOpenedProjectSelection({
        projectId: project.projectId,
        sessions: project.sessions,
        fallbackSessionId: options.getSelection().sessionId,
      });
      options.commitSelection(nextSelection);
      await options.refresh(nextSelection, mutation.token);
      options.errors.succeed(errorOperation);
    } catch (error) {
      options.errors.fail(errorOperation, planConsoleErrorMessage(error));
    } finally {
      selectionMutationLifecycle.finish(options, mutation.token);
    }
  },
};
