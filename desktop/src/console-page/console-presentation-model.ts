import type {
  OperatorProject,
  OperatorSession,
  RightSidebarTabsState,
} from "@moebius/console-ui";

import { parseConversationTabSourceKey } from "./right-sidebar-tabs-model.js";

export function planConversationTabDiscriminators(
  tabsState: RightSidebarTabsState,
  projects: readonly OperatorProject[],
  updatingTabIds: ReadonlySet<string>,
  labels: { fallback: string; sameMomentIndex(index: number): string },
): Record<string, string> {
  const titleCounts = new Map<string, number>();
  for (const tab of tabsState.tabs) {
    if (tab.type === "conversation") titleCounts.set(tab.title, (titleCounts.get(tab.title) ?? 0) + 1);
  }
  const candidates = tabsState.tabs.flatMap((tab) => {
    if (
      tab.type !== "conversation"
      || ((titleCounts.get(tab.title) ?? 0) < 2 && !updatingTabIds.has(tab.id))
    ) return [];
    const locator = parseConversationTabSourceKey(tab.sourceKey);
    const session = locator?.kind === "session"
      ? projects.flatMap((project) => project.sessions).find(
          (candidate) => candidate.sessionId === locator.sessionId,
        )
      : undefined;
    const project = session === undefined
      ? undefined
      : projects.find((candidate) => candidate.projectId === session.projectId);
    const base = planConversationProjectContext(project, session)
      ?? tab.conversationContext
      ?? labels.fallback;
    const createdAt = session?.createdAt ?? tab.conversationCreatedAt ?? null;
    return [{
      tabId: tab.id,
      base,
      minute: createdAt?.replace("T", " ").slice(0, 16) ?? null,
      stableKey: `${createdAt ?? ""}\u0000${tab.sourceKey ?? tab.id}`,
    }];
  });
  const baseCounts = new Map<string, number>();
  for (const entry of candidates) baseCounts.set(entry.base, (baseCounts.get(entry.base) ?? 0) + 1);
  const withMinute = candidates.map((entry) => ({
    ...entry,
    candidate: (baseCounts.get(entry.base) ?? 0) > 1 && entry.minute !== null
      ? `${entry.base} · ${entry.minute}`
      : entry.base,
  }));
  const candidateCounts = new Map<string, number>();
  for (const entry of withMinute) {
    candidateCounts.set(entry.candidate, (candidateCounts.get(entry.candidate) ?? 0) + 1);
  }
  const result: Record<string, string> = {};
  const collisions = new Map<string, typeof withMinute>();
  for (const entry of withMinute) {
    if ((candidateCounts.get(entry.candidate) ?? 0) === 1) {
      result[entry.tabId] = entry.candidate;
      continue;
    }
    const group = collisions.get(entry.candidate) ?? [];
    group.push(entry);
    collisions.set(entry.candidate, group);
  }
  for (const group of collisions.values()) {
    group.sort((left, right) => left.stableKey.localeCompare(right.stableKey));
    group.forEach((entry, index) => {
      result[entry.tabId] = `${entry.candidate} · ${labels.sameMomentIndex(index + 1)}`;
    });
  }
  return result;
}

export function planConversationProjectContext(
  project: OperatorProject | undefined,
  session?: OperatorSession,
): string | undefined {
  if (project === undefined) return undefined;
  const context = [project.title, session?.branchName ?? project.branchName ?? null]
    .filter((value): value is string => value !== null && value.trim() !== "")
    .join(" · ");
  return context === "" ? undefined : context;
}

export function planCanonicalConversationTabTitles(
  tabsState: RightSidebarTabsState,
  projects: readonly OperatorProject[],
): { state: RightSidebarTabsState; unresolvedTabIds: string[] } {
  const sessions = new Map(projects.flatMap((project) => project.sessions.map((session) => [
    session.sessionId,
    { project, session },
  ] as const)));
  const unresolvedTabIds: string[] = [];
  return {
    state: {
      ...tabsState,
      tabs: tabsState.tabs.map((tab) => {
        if (tab.type !== "conversation") return tab;
        const locator = parseConversationTabSourceKey(tab.sourceKey);
        if (locator?.kind !== "session") return tab;
        const resolved = sessions.get(locator.sessionId);
        if (resolved === undefined) {
          unresolvedTabIds.push(tab.id);
          return tab;
        }
        const conversationContext = planConversationProjectContext(resolved.project, resolved.session);
        return resolved.session.title === tab.title
          && conversationContext === tab.conversationContext
          && resolved.session.createdAt === tab.conversationCreatedAt
          ? tab
          : {
              ...tab,
              title: resolved.session.title,
              conversationContext,
              conversationCreatedAt: resolved.session.createdAt,
            };
      }),
    },
    unresolvedTabIds,
  };
}

export function planAnalysisRootSession(
  sessions: readonly OperatorSession[],
  sessionId: string,
): OperatorSession | null {
  const byId = new Map(sessions.map((session) => [session.sessionId, session]));
  const visited = new Set<string>();
  let current = byId.get(sessionId);
  while (current !== undefined && current.analysisParentSessionId != null) {
    if (visited.has(current.sessionId)) return null;
    visited.add(current.sessionId);
    current = byId.get(current.analysisParentSessionId);
  }
  return current ?? null;
}
