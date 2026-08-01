export const RIGHT_SIDEBAR_TAB_TYPES = [
  "workspace-diff",
  "project-files",
  "file-reference",
  "run-output",
  "sub-session",
  "conversation",
  "blank",
] as const;

export type RightSidebarTabType = (typeof RIGHT_SIDEBAR_TAB_TYPES)[number];

export interface RightSidebarTabState {
  id: string;
  type: RightSidebarTabType;
  title: string;
  sourceKey: string | null;
  closable: true;
  conversationContext?: string;
  conversationCreatedAt?: string;
  processScroll?: {
    anchorEventKey: string | null;
    offsetPx: number;
    followLatest: boolean;
  };
}

export interface RightSidebarTabsState {
  tabs: RightSidebarTabState[];
  activeTabId: string | null;
}

export type RightSidebarTabsByHost = Readonly<Record<string, RightSidebarTabsState>>;

export const EMPTY_RIGHT_SIDEBAR_TABS: RightSidebarTabsState = {
  tabs: [],
  activeTabId: null,
};

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

export function decidePromoteConversationDraft(
  hosts: RightSidebarTabsByHost,
  input: {
    draftId: string;
    sessionId: string;
    title: string;
    conversationContext?: string;
    conversationCreatedAt?: string;
  },
): { hosts: RightSidebarTabsByHost; updatedHostIds: readonly string[] } {
  return decideUpdateConversationTabs(hosts, (tab) => {
    const locator = parseConversationTabSourceKey(tab.sourceKey);
    return locator?.kind === "draft" && locator.draftId === input.draftId
      ? {
          ...tab,
          sourceKey: conversationTabSourceKey(input.sessionId),
          title: input.title,
          conversationContext: input.conversationContext,
          conversationCreatedAt: input.conversationCreatedAt,
        }
      : tab;
  });
}

export function decideRenameConversation(
  hosts: RightSidebarTabsByHost,
  sessionId: string,
  title: string,
): { hosts: RightSidebarTabsByHost; updatedHostIds: readonly string[] } {
  return decideUpdateConversationTabs(hosts, (tab) => {
    const locator = parseConversationTabSourceKey(tab.sourceKey);
    return locator?.kind === "session" && locator.sessionId === sessionId
      ? { ...tab, title }
      : tab;
  });
}

export function decideRemoveConversation(
  hosts: RightSidebarTabsByHost,
  sessionId: string,
): RightSidebarTabsByHost {
  const nextHosts: Record<string, RightSidebarTabsState> = {};
  for (const [hostId, state] of Object.entries(hosts)) {
    if (hostId === sessionId) continue;
    const tabs = state.tabs.filter((tab) => {
      const locator = tab.type === "conversation"
        ? parseConversationTabSourceKey(tab.sourceKey)
        : null;
      return locator?.kind !== "session" || locator.sessionId !== sessionId;
    });
    nextHosts[hostId] = tabs.length === state.tabs.length
      ? state
      : {
          tabs,
          activeTabId: tabs.some((tab) => tab.id === state.activeTabId)
            ? state.activeTabId
            : tabs[0]?.id ?? null,
        };
  }
  return nextHosts;
}

function decideUpdateConversationTabs(
  hosts: RightSidebarTabsByHost,
  update: (tab: RightSidebarTabState) => RightSidebarTabState,
): { hosts: RightSidebarTabsByHost; updatedHostIds: readonly string[] } {
  const nextHosts: Record<string, RightSidebarTabsState> = { ...hosts };
  const updatedHostIds: string[] = [];
  for (const [hostId, state] of Object.entries(hosts)) {
    const tabs = state.tabs.map((tab) => tab.type === "conversation" ? update(tab) : tab);
    if (tabs.every((tab, index) => tab === state.tabs[index])) continue;
    updatedHostIds.push(hostId);
    nextHosts[hostId] = { tabs, activeTabId: state.activeTabId };
  }
  return { hosts: nextHosts, updatedHostIds };
}
