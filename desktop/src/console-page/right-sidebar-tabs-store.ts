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

export {
  conversationDraftTabSourceKey,
  conversationTabSourceKey,
  parseConversationTabSourceKey,
} from "./right-sidebar-tabs-model.js";

export const RIGHT_SIDEBAR_TABS_DOCUMENT_KEY = "moebius.right-sidebar-tabs.v2";
export type RightSidebarTabsKey = `tabs:${string}`;

export function rightSidebarTabsKey(sessionId: string): RightSidebarTabsKey {
  return `tabs:${sessionId}`;
}

interface RightSidebarTabsDocument {
  version: 2;
  hosts: Record<string, RightSidebarTabsState>;
}

export interface RightSidebarTabsStore {
  read(sessionId: string): RightSidebarTabsState;
  write(sessionId: string, state: RightSidebarTabsState): void;
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
  version: 2;
  hosts: Record<string, RightSidebarTabsState>;
}

export function createRightSidebarTabsStore(storage: Storage): RightSidebarTabsStore {
  const readDocument = (): RightSidebarTabsDocument => {
    try {
      const raw = storage.getItem(RIGHT_SIDEBAR_TABS_DOCUMENT_KEY);
      if (raw === null) return { version: 2, hosts: {} };
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed !== "object"
        || parsed === null
        || (parsed as { version?: unknown }).version !== 2
        || typeof (parsed as { hosts?: unknown }).hosts !== "object"
        || (parsed as { hosts?: unknown }).hosts === null
      ) {
        return { version: 2, hosts: {} };
      }
      const hosts: RightSidebarTabsDocument["hosts"] = {};
      for (const [host, state] of Object.entries(
        (parsed as { hosts: Record<string, unknown> }).hosts,
      )) {
        hosts[host] = parseStoredState(state);
      }
      return { version: 2, hosts };
    } catch {
      return { version: 2, hosts: {} };
    }
  };
  const writeDocument = (document: RightSidebarTabsDocument): void => {
    try {
      const hosts = Object.fromEntries(Object.entries(document.hosts).map(([hostId, state]) => [
        hostId,
        serializeRightSidebarTabsState(state),
      ]));
      storage.setItem(RIGHT_SIDEBAR_TABS_DOCUMENT_KEY, JSON.stringify({ version: 2, hosts }));
    } catch {
      // Persistence is best-effort; tab interactions remain available in memory.
    }
  };
  return {
    read(sessionId) {
      const document = readDocument();
      const current = document.hosts[sessionId];
      if (current !== undefined) return parseStoredState(current);
      try {
        const legacy = storage.getItem(rightSidebarTabsKey(sessionId));
        if (legacy === null) return EMPTY_RIGHT_SIDEBAR_TABS;
        const migrated = parseRightSidebarTabsState(JSON.parse(legacy) as unknown);
        document.hosts[sessionId] = migrated;
        writeDocument(document);
        storage.removeItem(rightSidebarTabsKey(sessionId));
        return migrated;
      } catch {
        return EMPTY_RIGHT_SIDEBAR_TABS;
      }
    },
    write(sessionId, state) {
      const document = readDocument();
      document.hosts[sessionId] = state;
      writeDocument(document);
    },
    snapshot() {
      return readDocument();
    },
    restore(snapshot) {
      writeDocument({
        version: 2,
        hosts: { ...snapshot.hosts },
      });
    },
    promoteConversationDraft(input) {
      const document = readDocument();
      const decision = decidePromoteConversationDraft(document.hosts, input);
      if (decision.updatedHostIds.length > 0) {
        writeDocument({ version: 2, hosts: decision.hosts });
      }
      return decision.updatedHostIds;
    },
    renameConversation(sessionId, title) {
      const document = readDocument();
      const decision = decideRenameConversation(document.hosts, sessionId, title);
      if (decision.updatedHostIds.length > 0) {
        writeDocument({ version: 2, hosts: decision.hosts });
      }
      return decision.updatedHostIds;
    },
    removeSession(sessionId) {
      const document = readDocument();
      writeDocument({
        version: 2,
        hosts: decideRemoveConversation(document.hosts, sessionId),
      });
    },
    clearHosts(hostSessionIds) {
      const document = readDocument();
      for (const hostSessionId of hostSessionIds) delete document.hosts[hostSessionId];
      writeDocument(document);
    },
  };
}

function parseStoredState(value: unknown): RightSidebarTabsState {
  if (typeof value !== "string") return parseRightSidebarTabsState(value);
  try {
    return parseRightSidebarTabsState(JSON.parse(value) as unknown);
  } catch {
    return EMPTY_RIGHT_SIDEBAR_TABS;
  }
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

function serializeRightSidebarTabsState(state: RightSidebarTabsState): string {
  return JSON.stringify(parseRightSidebarTabsState(state));
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
