import type { ConsoleSelection } from "./console-state-coordinator.js";
import type {
  ConsoleNavigationScene,
  ConsoleStateActionsOptions,
} from "./console-state-action-contract.js";
import {
  decideConsoleApiBase,
  decideMutationToken,
  decideProjectReorder,
  decideSessionProjectRebind,
  decideSessionSelection,
  planArchivedSession,
  planConsoleErrorMessage,
  planNavigationSceneSource,
  planSessionSelectionRollback,
} from "./console-state-plan.js";
import { selectionMutationLifecycle } from "./selection-mutation-lifecycle.js";

export const projectSessionActions = {
  selectSession(
    options: ConsoleStateActionsOptions,
    nextSelection: ConsoleSelection,
    navigationScene?: ConsoleNavigationScene,
  ): void {
    const decision = decideSessionSelection(options.coordinator.isSelectionMutationPending);
    if (decision === "blocked") return;
    const previousSelection = options.getSelection();
    const previousPresentationRoute = options.getPresentationRoute();
    const previousNavigationScene = planNavigationSceneSource(
      navigationScene,
      options.getNavigationScene?.(),
    );
    options.coordinator.invalidateRefresh();
    options.commitSelection(nextSelection);
    void options.refresh(nextSelection).then((loaded) => {
      const rollback = planSessionSelectionRollback({
        loaded,
        currentSelection: options.getSelection(),
        targetSelection: nextSelection,
        previousSelection,
        previousPresentationRoute,
        previousNavigationScene,
        canRestoreNavigationScene: options.restoreNavigationScene !== undefined,
      });
      type Rollback = ReturnType<typeof planSessionSelectionRollback>;
      const rollbackHandlers: Record<Rollback["kind"], () => void> = {
        keep: () => undefined,
        "restore-scene": () => options.restoreNavigationScene!((rollback as Extract<Rollback, {
          kind: "restore-scene";
        }>).scene),
        restore: () => {
          const legacy = rollback as Extract<Rollback, { kind: "restore" }>;
          options.commitSelection(legacy.selection);
          options.commitPresentationRoute(legacy.presentationRoute);
        },
      };
      rollbackHandlers[rollback.kind]();
    });
  },

  async rebindSessionProject(
    options: ConsoleStateActionsOptions,
    sessionId: string,
    projectId: string,
  ): Promise<void> {
    const decision = decideSessionProjectRebind({
      apiBase: options.apiBase,
      currentProjectId: options.getSelection().projectId,
      targetProjectId: projectId,
      unavailableMessage: options.t("desktop.error.localConsoleUnavailable"),
    });
    if (decision.kind !== "rebind") {
      if (decision.kind === "unavailable") {
        options.errors.report({ family: "conversation", scope: `${sessionId}:rebind` }, decision.message);
      }
      return;
    }
    const mutation = decideMutationToken(selectionMutationLifecycle.begin(options, "rebind-session"));
    if (mutation.kind === "busy") return;
    const errorOperation = options.errors.begin({ family: "conversation", scope: `${sessionId}:rebind` });
    try {
      await options.commands.rebindSessionProject(decision.apiBase, sessionId, projectId);
      const nextSelection = { projectId, sessionId };
      options.commitSelection(nextSelection);
      await options.refresh(nextSelection, mutation.token);
      options.errors.succeed(errorOperation);
    } catch (error) {
      options.errors.fail(errorOperation, planConsoleErrorMessage(error));
    } finally {
      selectionMutationLifecycle.finish(options, mutation.token);
    }
  },

  async changeSessionWorkspace(
    options: ConsoleStateActionsOptions,
    sessionId: string,
    workspaceMode: "direct" | "worktree",
  ): Promise<void> {
    await patchSessionContext(
      options,
      sessionId,
      "workspace",
      { workspaceMode },
      "change session workspace failed",
    );
  },

  async changeSessionTeam(
    options: ConsoleStateActionsOptions,
    sessionId: string,
    team: { ownership: "system" | "user"; id: string },
  ): Promise<void> {
    await patchSessionContext(
      options,
      sessionId,
      "team",
      { agentTeamOwnership: team.ownership, agentTeamId: team.id },
      "change session team failed",
    );
  },

  async reorderProjects(options: ConsoleStateActionsOptions, projectIds: string[]): Promise<boolean> {
    const decision = decideProjectReorder({
      apiBase: options.apiBase,
      mutationPending: options.coordinator.isSelectionMutationPending,
      unavailableMessage: options.t("desktop.error.localConsoleUnavailable"),
    });
    if (decision.kind === "unavailable") {
      options.errors.report({ family: "project", scope: "reorder" }, decision.message);
      return false;
    }
    if (decision.kind === "blocked") return false;
    const errorOperation = options.errors.begin({ family: "project", scope: "reorder" });
    try {
      await options.commands.reorderProjects(decision.apiBase, projectIds);
      await options.refresh(options.getSelection());
      options.errors.succeed(errorOperation);
      return true;
    } catch (error) {
      options.errors.fail(errorOperation, planConsoleErrorMessage(error));
      return false;
    }
  },

  async archiveSession(
    options: ConsoleStateActionsOptions,
    sessionId: string,
    projectId: string,
  ): Promise<string[] | null> {
    const availability = decideConsoleApiBase(
      options.apiBase,
      options.t("desktop.error.localConsoleUnavailable"),
    );
    if (availability.kind === "unavailable") {
      options.errors.report({ family: "conversation", scope: `${sessionId}:archive` }, availability.message);
      return null;
    }
    const mutation = decideMutationToken(selectionMutationLifecycle.begin(options, "archive-session"));
    if (mutation.kind === "busy") return null;
    const errorOperation = options.errors.begin({ family: "conversation", scope: `${sessionId}:archive` });
    try {
      const result = planArchivedSession({
        requestedSessionId: sessionId,
        requestedProjectId: projectId,
        response: await options.commands.archiveSession(availability.apiBase, sessionId),
        currentSelection: options.getSelection(),
      });
      if (result.kind === "rejected") throw new Error(result.message);
      options.commitSelection(result.selection);
      await options.refresh(result.selection, mutation.token);
      options.errors.succeed(errorOperation);
      return result.archivedIds;
    } catch (error) {
      options.errors.fail(errorOperation, planConsoleErrorMessage(error));
      return null;
    } finally {
      selectionMutationLifecycle.finish(options, mutation.token);
    }
  },
};

async function patchSessionContext(
  options: ConsoleStateActionsOptions,
  sessionId: string,
  context: "workspace" | "team",
  payload: Record<string, unknown>,
  fallbackError: string,
): Promise<void> {
  const availability = decideConsoleApiBase(
    options.apiBase,
    options.t("desktop.error.localConsoleUnavailable"),
  );
  if (availability.kind === "unavailable") {
    options.errors.report({ family: "conversation", scope: `${sessionId}:${context}` }, availability.message);
    return;
  }
  const errorOperation = options.errors.begin({ family: "conversation", scope: `${sessionId}:${context}` });
  try {
    await options.commands.patchSessionContext(
      availability.apiBase,
      sessionId,
      context,
      payload,
      fallbackError,
    );
    await options.refresh(options.getSelection());
    options.errors.succeed(errorOperation);
  } catch (error) {
    options.errors.fail(errorOperation, planConsoleErrorMessage(error));
  }
}
