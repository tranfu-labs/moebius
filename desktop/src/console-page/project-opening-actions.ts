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
      options.setError(availability.message);
      return null;
    }
    const picker = decideFolderPicker(
      options.selectProjectFolder,
      options.t("desktop.error.folderPickerUnavailable"),
    );
    if (picker.kind === "unavailable") {
      options.setError(picker.message);
      return null;
    }
    const mutation = decideMutationToken(selectionMutationLifecycle.begin(options, "open-project"));
    if (mutation.kind === "busy") return null;
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
        options.setError(addition.message);
        return null;
      }
      await options.refresh(options.getSelection(), mutation.token);
      return { projectId: addition.projectId };
    } catch (error) {
      options.setError(planConsoleErrorMessage(error));
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
      options.setError(availability.message);
      return;
    }
    const picker = decideFolderPicker(
      options.selectProjectFolder,
      options.t("desktop.error.folderPickerUnavailable"),
    );
    if (picker.kind === "unavailable") {
      options.setError(picker.message);
      return;
    }
    const mutation = decideMutationToken(selectionMutationLifecycle.begin(options, "open-project"));
    if (mutation.kind === "busy") return;
    try {
      const folder = decideSelectedFolder(await picker.picker());
      if (folder.kind === "cancelled") return;
      const project = await options.commands.openProject(availability.apiBase, folder.folderPath);
      const nextSelection = planOpenedProjectSelection({
        projectId: project.projectId,
        sessions: project.sessions,
        fallbackSessionId: options.getSelection().sessionId,
      });
      options.commitSelection(nextSelection);
      await options.refresh(nextSelection, mutation.token);
    } catch (error) {
      options.setError(planConsoleErrorMessage(error));
    } finally {
      selectionMutationLifecycle.finish(options, mutation.token);
    }
  },
};
