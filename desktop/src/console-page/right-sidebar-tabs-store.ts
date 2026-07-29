import {
  EMPTY_RIGHT_SIDEBAR_TABS,
  parseRightSidebarTabsState,
  serializeRightSidebarTabsState,
  type RightSidebarTabsState,
} from "../../../packages/console-ui/src/console/right-sidebar-tabs.js";

export const RIGHT_SIDEBAR_TABS_DOCUMENT_KEY = "moebius.right-sidebar-tabs.v2";
export type RightSidebarTabsKey = `tabs:${string}`;

export function rightSidebarTabsKey(sessionId: string): RightSidebarTabsKey {
  return `tabs:${sessionId}`;
}

interface RightSidebarTabsDocument {
  version: 2;
  hosts: Record<string, ReturnType<typeof serializeRightSidebarTabsState>>;
}

export interface RightSidebarTabsStore {
  read(sessionId: string): RightSidebarTabsState;
  write(sessionId: string, state: RightSidebarTabsState): void;
  promoteConversationDraft(input: {
    draftId: string;
    sessionId: string;
    title: string;
  }): readonly string[];
  removeSession(sessionId: string): void;
  clearHosts(hostSessionIds: readonly string[]): void;
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
        hosts[host] = serializeRightSidebarTabsState(parseStoredState(state));
      }
      return { version: 2, hosts };
    } catch {
      return { version: 2, hosts: {} };
    }
  };
  const writeDocument = (document: RightSidebarTabsDocument): void => {
    try {
      storage.setItem(RIGHT_SIDEBAR_TABS_DOCUMENT_KEY, JSON.stringify(document));
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
        document.hosts[sessionId] = serializeRightSidebarTabsState(migrated);
        writeDocument(document);
        storage.removeItem(rightSidebarTabsKey(sessionId));
        return migrated;
      } catch {
        return EMPTY_RIGHT_SIDEBAR_TABS;
      }
    },
    write(sessionId, state) {
      const document = readDocument();
      document.hosts[sessionId] = serializeRightSidebarTabsState(state);
      writeDocument(document);
    },
    promoteConversationDraft(input) {
      const document = readDocument();
      const updatedHosts: string[] = [];
      for (const [hostId, state] of Object.entries(document.hosts)) {
        const parsed = parseStoredState(state);
        let changed = false;
        const tabs = parsed.tabs.map((tab) => {
          if (tab.type !== "conversation") return tab;
          const locator = parseConversationTabSourceKey(tab.sourceKey);
          if (locator?.kind !== "draft" || locator.draftId !== input.draftId) return tab;
          changed = true;
          return {
            ...tab,
            sourceKey: conversationTabSourceKey(input.sessionId),
            title: input.title,
          };
        });
        if (!changed) continue;
        updatedHosts.push(hostId);
        document.hosts[hostId] = serializeRightSidebarTabsState({
          tabs,
          activeTabId: parsed.activeTabId,
        });
      }
      if (updatedHosts.length > 0) writeDocument(document);
      return updatedHosts;
    },
    removeSession(sessionId) {
      const document = readDocument();
      let changed = false;
      delete document.hosts[sessionId];
      for (const [hostId, state] of Object.entries(document.hosts)) {
        const parsed = parseStoredState(state);
        const tabs = parsed.tabs.filter((tab) => {
          if (tab.type !== "conversation") return true;
          const locator = parseConversationTabSourceKey(tab.sourceKey);
          return locator?.kind !== "session" || locator.sessionId !== sessionId;
        });
        if (tabs.length === parsed.tabs.length) continue;
        changed = true;
        document.hosts[hostId] = serializeRightSidebarTabsState({
          tabs,
          activeTabId: tabs.some((tab) => tab.id === parsed.activeTabId)
            ? parsed.activeTabId
            : tabs[0]?.id ?? null,
        });
      }
      if (changed || document.hosts[sessionId] === undefined) writeDocument(document);
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

const CONVERSATION_SOURCE_PREFIX = "conversation:";
const CONVERSATION_DRAFT_SOURCE_PREFIX = "conversation-draft:";

export function conversationTabSourceKey(sessionId: string): string {
  return `${CONVERSATION_SOURCE_PREFIX}${encodeURIComponent(sessionId)}`;
}

export function conversationDraftTabSourceKey(draftId: string): string {
  return `${CONVERSATION_DRAFT_SOURCE_PREFIX}${encodeURIComponent(draftId)}`;
}

export function parseConversationTabSourceKey(
  sourceKey: string | null,
): { kind: "session"; sessionId: string } | { kind: "draft"; draftId: string } | null {
  if (sourceKey === null) return null;
  const prefix = sourceKey.startsWith(CONVERSATION_SOURCE_PREFIX)
    ? CONVERSATION_SOURCE_PREFIX
    : sourceKey.startsWith(CONVERSATION_DRAFT_SOURCE_PREFIX)
      ? CONVERSATION_DRAFT_SOURCE_PREFIX
      : null;
  if (prefix === null) return null;
  try {
    const value = decodeURIComponent(sourceKey.slice(prefix.length));
    if (value === "") return null;
    return prefix === CONVERSATION_SOURCE_PREFIX
      ? { kind: "session", sessionId: value }
      : { kind: "draft", draftId: value };
  } catch {
    return null;
  }
}
