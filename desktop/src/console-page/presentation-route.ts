export const CONSOLE_PRESENTATION_ROUTE_KEY = "moebius.console-presentation-route.v1";

export interface ConsolePresentationRoute {
  version: 1;
  projectId: string;
  selectedSessionId: string;
  mainSessionId: string;
  rightConversationSessionId: string | null;
  hostSessionId: string;
  notice: "source-unavailable" | null;
}

export function ordinaryPresentationRoute(input: {
  projectId: string;
  sessionId: string;
}): ConsolePresentationRoute {
  return {
    version: 1,
    projectId: input.projectId,
    selectedSessionId: input.sessionId,
    mainSessionId: input.sessionId,
    rightConversationSessionId: null,
    hostSessionId: input.sessionId,
    notice: null,
  };
}

export function sidebarPresentationRoute(input: {
  sidebarProjectId: string;
  sidebarSessionId: string;
  originSessionId: string | null;
  originAvailable: boolean;
}): ConsolePresentationRoute {
  if (input.originSessionId !== null && input.originAvailable) {
    return {
      version: 1,
      projectId: input.sidebarProjectId,
      selectedSessionId: input.sidebarSessionId,
      mainSessionId: input.originSessionId,
      rightConversationSessionId: input.sidebarSessionId,
      hostSessionId: input.originSessionId,
      notice: null,
    };
  }
  return {
    version: 1,
    projectId: input.sidebarProjectId,
    selectedSessionId: input.sidebarSessionId,
    mainSessionId: input.sidebarSessionId,
    rightConversationSessionId: null,
    hostSessionId: input.sidebarSessionId,
    notice: input.originSessionId === null ? null : "source-unavailable",
  };
}

export interface ConsolePresentationRouteStore {
  read(): ConsolePresentationRoute | null;
  write(route: ConsolePresentationRoute): void;
  clear(): void;
}

export function createConsolePresentationRouteStore(storage: Storage): ConsolePresentationRouteStore {
  return {
    read() {
      try {
        return parseConsolePresentationRoute(
          JSON.parse(storage.getItem(CONSOLE_PRESENTATION_ROUTE_KEY) ?? "null") as unknown,
        );
      } catch {
        return null;
      }
    },
    write(route) {
      try {
        storage.setItem(CONSOLE_PRESENTATION_ROUTE_KEY, JSON.stringify(route));
      } catch {
        // Route persistence is best-effort; current navigation stays valid.
      }
    },
    clear() {
      try {
        storage.removeItem(CONSOLE_PRESENTATION_ROUTE_KEY);
      } catch {
        // Ignore blocked storage.
      }
    },
  };
}

export function parseConsolePresentationRoute(value: unknown): ConsolePresentationRoute | null {
  if (typeof value !== "object" || value === null) return null;
  const route = value as Partial<ConsolePresentationRoute>;
  if (
    route.version !== 1
    || typeof route.projectId !== "string"
    || typeof route.selectedSessionId !== "string"
    || typeof route.mainSessionId !== "string"
    || (route.rightConversationSessionId !== null && typeof route.rightConversationSessionId !== "string")
    || typeof route.hostSessionId !== "string"
    || (route.notice !== null && route.notice !== "source-unavailable")
  ) {
    return null;
  }
  return route as ConsolePresentationRoute;
}
