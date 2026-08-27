import {
  decidePromoteConversationDraft,
  decideRemoveConversation,
  decideRenameConversation,
  EMPTY_RIGHT_SIDEBAR_TABS,
  RIGHT_SIDEBAR_TAB_TYPES,
  type RightSidebarTabState,
  type RightSidebarTabsState,
  type RightSidebarTabType,
} from "./right-sidebar-tabs-model.js";
import {
  readRightSidebarVisibilityPreference,
  type RightSidebarVisibilityPreference,
} from "./right-sidebar-preference.js";

export {
  conversationDraftTabSourceKey,
  conversationTabSourceKey,
  parseConversationTabSourceKey,
} from "./right-sidebar-tabs-model.js";

export const RIGHT_SIDEBAR_TABS_DOCUMENT_KEY = "moebius.right-sidebar-tabs.v3";
export const LEGACY_RIGHT_SIDEBAR_TABS_DOCUMENT_KEY = "moebius.right-sidebar-tabs.v2";
export type RightSidebarTabsKey = `tabs:${string}`;

export function rightSidebarTabsKey(sessionId: string): RightSidebarTabsKey {
  return `tabs:${sessionId}`;
}

export interface RightSidebarHostState {
  tabs: RightSidebarTabsState;
  visibilityPreference: RightSidebarVisibilityPreference;
}

interface RightSidebarTabsDocument {
  version: 3;
  legacyVisibilityMigrated: boolean;
  hosts: Record<string, RightSidebarHostState>;
}

export interface RightSidebarTabsStore {
  read(sessionId: string): RightSidebarTabsState;
  write(sessionId: string, state: RightSidebarTabsState): void;
  readHostState(sessionId: string): RightSidebarHostState;
  writeVisibilityPreference(
    sessionId: string,
    preference: RightSidebarVisibilityPreference,
  ): void;
  snapshot?(): RightSidebarTabsStoreSnapshot;
  restore?(snapshot: RightSidebarTabsStoreSnapshot): void;
  promoteConversationDraft(input: {
    draftId: string;
    sessionId: string;
    title: string;
    conversationContext?: string;
    conversationCreatedAt?: string;
  }): readonly string[];
  renameConversation(sessionId: string, title: string): readonly string[];
  removeSession(sessionId: string): void;
  clearHosts(hostSessionIds: readonly string[]): void;
}

export interface RightSidebarTabsStoreSnapshot {
  version: 3;
  legacyVisibilityMigrated: boolean;
  hosts: Record<string, RightSidebarHostState>;
}

export function createRightSidebarTabsStore(storage: Storage): RightSidebarTabsStore {
  let volatileDocument: RightSidebarTabsDocument | null = null;
  const readDocument = (): RightSidebarTabsDocument => {
    if (volatileDocument !== null) return cloneRightSidebarTabsDocument(volatileDocument);
    try {
      const raw = storage.getItem(RIGHT_SIDEBAR_TABS_DOCUMENT_KEY);
      if (raw === null) return readLegacyDocument(storage);
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed !== "object"
        || parsed === null
        || (parsed as { version?: unknown }).version !== 3
        || typeof (parsed as { hosts?: unknown }).hosts !== "object"
        || (parsed as { hosts?: unknown }).hosts === null
      ) {
        return emptyDocument();
      }
      const hosts: RightSidebarTabsDocument["hosts"] = {};
      for (const [host, state] of Object.entries(
        (parsed as { hosts: Record<string, unknown> }).hosts,
      )) {
        hosts[host] = parseStoredHostState(state);
      }
      return {
        version: 3,
        legacyVisibilityMigrated: (parsed as { legacyVisibilityMigrated?: unknown })
          .legacyVisibilityMigrated === true,
        hosts,
      };
    } catch {
      return emptyDocument();
    }
  };
  const writeDocument = (document: RightSidebarTabsDocument): boolean => {
    const normalized = cloneRightSidebarTabsDocument(document);
    try {
      storage.setItem(RIGHT_SIDEBAR_TABS_DOCUMENT_KEY, JSON.stringify({
        version: 3,
        legacyVisibilityMigrated: normalized.legacyVisibilityMigrated,
        hosts: normalized.hosts,
      }));
      volatileDocument = null;
      return true;
    } catch {
      // Persistence is best-effort; retain the sanitized document for this app lifetime.
      volatileDocument = normalized;
      return false;
    }
  };
  return {
    read(sessionId) {
      const document = readDocument();
      const current = readHostState(document, storage, sessionId);
      if (current.state === undefined) return EMPTY_RIGHT_SIDEBAR_TABS;
      if (current.migratedLegacyTabs && writeDocument(document)) {
        removeLegacyTabs(storage, sessionId);
      }
      return current.state.tabs;
    },
    write(sessionId, state) {
      const document = readDocument();
      const current = readHostState(document, storage, sessionId);
      document.hosts[sessionId] = {
        tabs: parseRightSidebarTabsState(state),
        visibilityPreference: current.state?.visibilityPreference ?? "closed",
      };
      if (writeDocument(document) && current.migratedLegacyTabs) {
        removeLegacyTabs(storage, sessionId);
      }
    },
    readHostState(sessionId) {
      const document = readDocument();
      const current = readHostState(document, storage, sessionId);
      let state = current.state ?? emptyHostState();
      let changed = current.migratedLegacyTabs;
      if (!document.legacyVisibilityMigrated) {
        state = {
          ...state,
          visibilityPreference: readRightSidebarVisibilityPreference(storage),
        };
        document.hosts[sessionId] = state;
        document.legacyVisibilityMigrated = true;
        changed = true;
      }
      if (changed && writeDocument(document) && current.migratedLegacyTabs) {
        removeLegacyTabs(storage, sessionId);
      }
      return state;
    },
    writeVisibilityPreference(sessionId, preference) {
      const document = readDocument();
      const current = readHostState(document, storage, sessionId);
      document.hosts[sessionId] = {
        ...(current.state ?? emptyHostState()),
        visibilityPreference: preference,
      };
      document.legacyVisibilityMigrated = true;
      if (writeDocument(document) && current.migratedLegacyTabs) {
        removeLegacyTabs(storage, sessionId);
      }
    },
    snapshot() {
      return readDocument();
    },
    restore(snapshot) {
      writeDocument({
        version: 3,
        legacyVisibilityMigrated: snapshot.legacyVisibilityMigrated === true,
        hosts: Object.fromEntries(Object.entries(snapshot.hosts).map(([hostId, state]) => [
          hostId,
          parseStoredHostState(state),
        ])),
      });
    },
    promoteConversationDraft(input) {
      const document = readDocument();
      const decision = decidePromoteConversationDraft(tabsByHost(document.hosts), input);
      if (decision.updatedHostIds.length > 0) {
        writeDocument({ ...document, hosts: withUpdatedTabs(document.hosts, decision.hosts) });
      }
      return decision.updatedHostIds;
    },
    renameConversation(sessionId, title) {
      const document = readDocument();
      const decision = decideRenameConversation(tabsByHost(document.hosts), sessionId, title);
      if (decision.updatedHostIds.length > 0) {
        writeDocument({ ...document, hosts: withUpdatedTabs(document.hosts, decision.hosts) });
      }
      return decision.updatedHostIds;
    },
    removeSession(sessionId) {
      const document = readDocument();
      writeDocument({
        ...document,
        hosts: withUpdatedTabs(
          document.hosts,
          decideRemoveConversation(tabsByHost(document.hosts), sessionId),
        ),
      });
    },
    clearHosts(hostSessionIds) {
      const document = readDocument();
      for (const hostSessionId of hostSessionIds) delete document.hosts[hostSessionId];
      writeDocument(document);
    },
  };
}

function emptyDocument(): RightSidebarTabsDocument {
  return { version: 3, legacyVisibilityMigrated: false, hosts: {} };
}

function cloneRightSidebarTabsDocument(
  document: RightSidebarTabsDocument,
): RightSidebarTabsDocument {
  return {
    version: 3,
    legacyVisibilityMigrated: document.legacyVisibilityMigrated === true,
    hosts: Object.fromEntries(Object.entries(document.hosts).map(([hostId, state]) => [
      hostId,
      serializeRightSidebarHostState(state),
    ])),
  };
}

function readLegacyDocument(storage: Storage): RightSidebarTabsDocument {
  try {
    const raw = storage.getItem(LEGACY_RIGHT_SIDEBAR_TABS_DOCUMENT_KEY);
    if (raw === null) return emptyDocument();
    const parsed = JSON.parse(raw) as unknown;
    if (
      !isRecord(parsed)
      || parsed.version !== 2
      || !isRecord(parsed.hosts)
    ) return emptyDocument();
    const hosts: Record<string, RightSidebarHostState> = {};
    for (const [hostId, state] of Object.entries(parsed.hosts)) {
      hosts[hostId] = {
        tabs: parseStoredState(state),
        visibilityPreference: "closed",
      };
    }
    return { version: 3, legacyVisibilityMigrated: false, hosts };
  } catch {
    return emptyDocument();
  }
}

function readHostState(
  document: RightSidebarTabsDocument,
  storage: Storage,
  sessionId: string,
): { state: RightSidebarHostState | undefined; migratedLegacyTabs: boolean } {
  const current = document.hosts[sessionId];
  if (current !== undefined) return { state: current, migratedLegacyTabs: false };
  try {
    const legacy = storage.getItem(rightSidebarTabsKey(sessionId));
    if (legacy === null) return { state: undefined, migratedLegacyTabs: false };
    const state: RightSidebarHostState = {
      tabs: parseRightSidebarTabsState(JSON.parse(legacy) as unknown),
      visibilityPreference: "closed",
    };
    document.hosts[sessionId] = state;
    return { state, migratedLegacyTabs: true };
  } catch {
    return { state: undefined, migratedLegacyTabs: false };
  }
}

function removeLegacyTabs(storage: Storage, sessionId: string): void {
  try {
    storage.removeItem(rightSidebarTabsKey(sessionId));
  } catch {
    // The v3 document is already durable; stale legacy tabs are safe to leave behind.
  }
}

function emptyHostState(): RightSidebarHostState {
  return {
    tabs: { tabs: [], activeTabId: null },
    visibilityPreference: "closed",
  };
}

function tabsByHost(
  hosts: Record<string, RightSidebarHostState>,
): Record<string, RightSidebarTabsState> {
  return Object.fromEntries(Object.entries(hosts).map(([hostId, state]) => [hostId, state.tabs]));
}

function withUpdatedTabs(
  currentHosts: Record<string, RightSidebarHostState>,
  updatedTabsByHost: Readonly<Record<string, RightSidebarTabsState>>,
): Record<string, RightSidebarHostState> {
  return Object.fromEntries(Object.entries(updatedTabsByHost).map(([hostId, tabs]) => [
    hostId,
    {
      tabs: parseRightSidebarTabsState(tabs),
      visibilityPreference: currentHosts[hostId]?.visibilityPreference ?? "closed",
    },
  ]));
}

function parseStoredState(value: unknown): RightSidebarTabsState {
  if (typeof value !== "string") return parseRightSidebarTabsState(value);
  try {
    return parseRightSidebarTabsState(JSON.parse(value) as unknown);
  } catch {
    return EMPTY_RIGHT_SIDEBAR_TABS;
  }
}

function parseStoredHostState(value: unknown): RightSidebarHostState {
  if (!isRecord(value)) return emptyHostState();
  return {
    tabs: parseStoredState(value.tabs),
    visibilityPreference: value.visibilityPreference === "open" ? "open" : "closed",
  };
}

function parseRightSidebarTabsState(value: unknown): RightSidebarTabsState {
  if (!isRecord(value) || !Array.isArray(value.tabs)) return EMPTY_RIGHT_SIDEBAR_TABS;
  const tabs = value.tabs.flatMap((entry): RightSidebarTabState[] => {
    if (
      !isRecord(entry)
      || typeof entry.id !== "string"
      || entry.id.trim() === ""
      || !isRightSidebarTabType(entry.type)
      || typeof entry.title !== "string"
      || !(typeof entry.sourceKey === "string" || entry.sourceKey === null)
    ) return [];
    const conversationContext = entry.type === "conversation"
      && typeof entry.conversationContext === "string"
      && entry.conversationContext.trim() !== ""
      ? entry.conversationContext.trim()
      : undefined;
    const conversationCreatedAt = entry.type === "conversation"
      && typeof entry.conversationCreatedAt === "string"
      && entry.conversationCreatedAt.trim() !== ""
      ? entry.conversationCreatedAt
      : undefined;
    const fileMode = entry.type === "file-reference"
      && (entry.fileMode === "preview" || entry.fileMode === "source")
      ? entry.fileMode
      : undefined;
    const projectFileModes = entry.type === "project-files"
      ? parseProjectFileModes(entry.projectFileModes)
      : undefined;
    return [{
      id: entry.id,
      type: entry.type,
      title: normalizeBuiltinTabTitle(entry.type, entry.title, entry.sourceKey),
      sourceKey: entry.sourceKey,
      closable: true,
      ...(conversationContext === undefined ? {} : { conversationContext }),
      ...(conversationCreatedAt === undefined ? {} : { conversationCreatedAt }),
      ...(fileMode === undefined ? {} : { fileMode }),
      ...(projectFileModes === undefined ? {} : { projectFileModes }),
    }];
  });
  const uniqueTabs = tabs.filter(
    (tab, index) => tabs.findIndex((candidate) => candidate.id === tab.id) === index,
  );
  const activeTabId = typeof value.activeTabId === "string"
    && uniqueTabs.some((tab) => tab.id === value.activeTabId)
    ? value.activeTabId
    : uniqueTabs[0]?.id ?? null;
  return { tabs: uniqueTabs, activeTabId };
}

function parseProjectFileModes(value: unknown): Record<string, "preview" | "source"> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, "preview" | "source"] =>
      entry[0] !== "" && (entry[1] === "preview" || entry[1] === "source"),
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function serializeRightSidebarHostState(state: RightSidebarHostState): RightSidebarHostState {
  return {
    tabs: parseRightSidebarTabsState(state.tabs),
    visibilityPreference: state.visibilityPreference === "open" ? "open" : "closed",
  };
}

function normalizeBuiltinTabTitle(
  type: RightSidebarTabType,
  title: string,
  sourceKey: string | null,
): string {
  if (type === "blank") return "builtin:blank";
  if (type === "workspace-diff") return "builtin:workspace-diff";
  if (type === "project-files") return "builtin:project-files";
  if (type === "conversation" && sourceKey === null) return "builtin:conversation";
  return title;
}

function isRightSidebarTabType(value: unknown): value is RightSidebarTabType {
  return typeof value === "string" && RIGHT_SIDEBAR_TAB_TYPES.some((type) => type === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
