import { useCallback, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { OperatorProject } from "@moebius/console-ui";

import type { ConsoleSelection } from "./console-state-coordinator.js";
import { planConsoleErrorMessage } from "./console-state-plan.js";
import type { ConsolePresentationRoute } from "./presentation-route.js";
import { sidebarPresentationRoute } from "./presentation-route.js";
import type { RightSidebarTabsStore } from "./right-sidebar-tabs-store.js";
import type {
  ProjectDesktopTransport,
  ProjectMutationPort,
} from "./project-mutation-contract.js";
import {
  decideProjectMutationAvailability,
  decideProjectRemovalMigration,
  decideProjectRemovalRefresh,
  planProjectRemovalContext,
  planRemovedProjectSessionIds,
} from "./project-mutation-model.js";
import type { ConsoleErrorController } from "./use-console-error-state.js";

export function useProjectMutations(
  apiBase: string | null,
  projects: readonly OperatorProject[],
  presentationRoute: ConsolePresentationRoute | null,
  selectionRef: MutableRefObject<ConsoleSelection>,
  selectionPersistenceEnabledRef: MutableRefObject<boolean>,
  forgetPersistedSelection: () => void,
  refresh: (selection: ConsoleSelection) => Promise<boolean>,
  commitPresentationRoute: (route: ConsolePresentationRoute) => void,
  setRightSidebarOpen: (open: boolean) => void,
  tabsStore: RightSidebarTabsStore,
  showTabsHost: (hostSessionId: string) => void,
  startNewConversation: () => void,
  transport: ProjectDesktopTransport | undefined,
  port: ProjectMutationPort,
  errors: ConsoleErrorController,
) {
  const [isPending, setPending] = useState(false);
  const input = {
    apiBase, projects, presentationRoute, selectionRef, selectionPersistenceEnabledRef,
    forgetPersistedSelection, refresh, commitPresentationRoute, setRightSidebarOpen,
    tabsStore, showTabsHost, startNewConversation, transport, port, errors,
  };
  const inputRef = useRef(input);
  inputRef.current = input;

  const showProjectInFolder = useCallback(async (folderPath: string) => {
    const current = inputRef.current;
    const errorOperation = current.errors.begin({ family: "project", scope: `show:${folderPath}` });
    try {
      await current.port.showInFolder(current.transport, folderPath);
      inputRef.current.errors.succeed(errorOperation);
    } catch (error) {
      inputRef.current.errors.fail(errorOperation, planConsoleErrorMessage(error));
    }
  }, []);

  const renameProject = useCallback(async (projectId: string, title: string) => {
    const current = inputRef.current;
    const availability = decideProjectMutationAvailability(current.apiBase);
    if (availability.kind === "unavailable") throw new Error(availability.error);
    const errorOperation = current.errors.begin({ family: "project", scope: `${projectId}:rename` });
    setPending(true);
    try {
      await current.port.renameProject(availability.apiBase, projectId, title);
      const latest = inputRef.current;
      await latest.refresh(latest.selectionRef.current);
      latest.errors.succeed(errorOperation);
    } catch (error) {
      inputRef.current.errors.fail(errorOperation, planConsoleErrorMessage(error));
      throw error;
    } finally {
      setPending(false);
    }
  }, []);

  const removeProject = useCallback(async (projectId: string, force: boolean) => {
    const current = inputRef.current;
    const availability = decideProjectMutationAvailability(current.apiBase);
    if (availability.kind === "unavailable") throw new Error(availability.error);
    const errorOperation = current.errors.begin({ family: "project", scope: `${projectId}:remove` });
    const removal = planProjectRemovalContext({
      projectId,
      selection: current.selectionRef.current,
      projects: current.projects,
      route: current.presentationRoute,
    });
    setPending(true);
    try {
      const response = await current.port.removeProject(availability.apiBase, projectId, force);
      const latest = inputRef.current;
      if (removal.wasCurrentProject) {
        latest.selectionPersistenceEnabledRef.current = false;
        latest.forgetPersistedSelection();
      }
      const archivedSessionIds = planRemovedProjectSessionIds(response, removal.removingSessionIds);
      archivedSessionIds.forEach((sessionId) => latest.tabsStore.removeSession(sessionId));
      latest.tabsStore.clearHosts(archivedSessionIds);
      const migration = decideProjectRemovalMigration(removal.migratingSidebarSession);
      if (migration.kind === "migrate") {
        const loaded = await latest.refresh({
          projectId: migration.session.projectId,
          sessionId: migration.session.sessionId,
        });
        if (decideProjectRemovalRefresh(loaded) === "commit") {
          latest.commitPresentationRoute(sidebarPresentationRoute({
            sidebarProjectId: migration.session.projectId,
            sidebarSessionId: migration.session.sessionId,
            originSessionId: migration.session.originSessionId ?? removal.routeBeforeRemoval!.mainSessionId,
            originAvailable: false,
          }));
          latest.setRightSidebarOpen(false);
          latest.showTabsHost(migration.session.sessionId);
        }
      } else {
        await latest.refresh(latest.selectionRef.current);
      }
      if (removal.wasCurrentProject) latest.startNewConversation();
      latest.errors.succeed(errorOperation);
    } catch (error) {
      inputRef.current.errors.fail(errorOperation, planConsoleErrorMessage(error));
      throw error;
    } finally {
      setPending(false);
    }
  }, []);

  const selectFolderForRepair = useCallback(async (projectId: string) => {
    const current = inputRef.current;
    return current.port.selectFolderForRepair(current.transport, projectId);
  }, []);

  const repairProjectFolder = useCallback(async (projectId: string, folderPath: string) => {
    const current = inputRef.current;
    const availability = decideProjectMutationAvailability(current.apiBase);
    if (availability.kind === "unavailable") throw new Error(availability.error);
    const errorOperation = current.errors.begin({ family: "project", scope: `${projectId}:repair` });
    setPending(true);
    try {
      await current.port.repairProjectFolder(availability.apiBase, projectId, folderPath);
      const latest = inputRef.current;
      await latest.refresh(latest.selectionRef.current);
      latest.errors.succeed(errorOperation);
    } catch (error) {
      inputRef.current.errors.fail(errorOperation, planConsoleErrorMessage(error));
      throw error;
    } finally {
      setPending(false);
    }
  }, []);

  return useMemo(() => ({
    isPending,
    showProjectInFolder,
    renameProject,
    removeProject,
    selectFolderForRepair,
    repairProjectFolder,
  }), [
    isPending,
    removeProject,
    renameProject,
    repairProjectFolder,
    selectFolderForRepair,
    showProjectInFolder,
  ]);
}
