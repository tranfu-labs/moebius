import { useEffect, useRef } from "react";
import type { OperatorProject } from "@moebius/console-ui";

import type { ConsoleSelection } from "./console-state-coordinator.js";
import type { ConsolePresentationRoute } from "./presentation-route.js";
import {
  decideSidebarSourceMigrationCommit,
  planSidebarSourceMigration,
} from "./sidebar-source-migration-model.js";

export function useSidebarSourceMigration(
  projects: readonly OperatorProject[],
  route: ConsolePresentationRoute | null,
  refresh: (selection: ConsoleSelection) => Promise<boolean>,
  commitRoute: (route: ConsolePresentationRoute) => void,
  showTabsHost: (hostSessionId: string) => void,
): void {
  const migratingRef = useRef<string | null>(null);
  const inputRef = useRef({ refresh, commitRoute, showTabsHost });
  inputRef.current = { refresh, commitRoute, showTabsHost };
  useEffect(() => {
    const migration = planSidebarSourceMigration({
      projects,
      route,
      migratingSessionId: migratingRef.current,
    });
    if (migration.kind === "skip") return;
    migratingRef.current = migration.sessionId;
    const request = inputRef.current;
    void request.refresh(migration.selection).then((loaded) => {
      if (decideSidebarSourceMigrationCommit(loaded) === "retain") return;
      const latest = inputRef.current;
      latest.commitRoute(migration.route);
      latest.showTabsHost(migration.sessionId);
    }).finally(() => {
      migratingRef.current = null;
    });
  }, [projects, route]);
}
