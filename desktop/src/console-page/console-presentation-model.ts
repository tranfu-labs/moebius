import type {
  AnalysisPanelEntry,
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

export function planAnalysisPanelEntries(
  sessions: readonly OperatorSession[],
  parentSessionId: string,
  locale: string,
): AnalysisPanelEntry[] {
  const children = sessions
    .filter((session) => session.analysisParentSessionId === parentSessionId)
    .sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) || left.sessionId.localeCompare(right.sessionId));
  const titleCounts = new Map<string, number>();
  for (const child of children) {
    titleCounts.set(child.title, (titleCounts.get(child.title) ?? 0) + 1);
  }
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium" });
  const baseLabels = children.map((child) =>
    titleCounts.get(child.title) === 1 ? null : formatter.format(new Date(child.createdAt)));
  const labelCounts = new Map<string, number>();
  children.forEach((child, index) => {
    const label = baseLabels[index];
    if (label === null) return;
    const key = `${child.title}\u0000${label}`;
    labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
  });
  const labelOccurrences = new Map<string, number>();
  return children.map((child, index) => {
    const label = baseLabels[index];
    if (label === null) return { sessionId: child.sessionId, title: child.title };
    const key = `${child.title}\u0000${label}`;
    const occurrence = (labelOccurrences.get(key) ?? 0) + 1;
    labelOccurrences.set(key, occurrence);
    return {
      sessionId: child.sessionId,
      title: child.title,
      createdLabel: (labelCounts.get(key) ?? 0) > 1
        ? `${label} · ${occurrence <= 26 ? String.fromCharCode(64 + occurrence) : `#${String(occurrence)}`}`
        : label,
    };
  });
}

export type AnalysisNavigationPlan =
  | { kind: "error"; reason: "source-missing" | "source-unavailable" | "open-failed" }
  | { kind: "direct"; root: OperatorSession }
  | {
      kind: "sidebar";
      root: OperatorSession;
      target: OperatorSession;
      selectRoot: boolean;
      focusTab: boolean;
    };

export function planConversationReferencePosition(reference:
  | { scope: "conversation"; sessionId: string }
  | { scope: "message"; sessionId: string; messageId: number }
): { sessionId: string; messageId: number } | null {
  return reference.scope === "message"
    ? { sessionId: reference.sessionId, messageId: reference.messageId }
    : null;
}

export function planHandledConversationMessageNavigation<T extends { requestId: number }>(
  current: T | null,
  handledRequestId: number,
): T | null {
  return current?.requestId === handledRequestId ? null : current;
}

export function planAnalysisNavigation(
  sessions: readonly OperatorSession[],
  currentSessionId: string,
  request:
    | { kind: "panel-entry"; parentSessionId: string; sessionId: string }
    | { kind: "reference"; sessionId: string },
): AnalysisNavigationPlan {
  const target = sessions.find((session) => session.sessionId === request.sessionId);
  if (
    target === undefined
    || (request.kind === "panel-entry" && target.analysisParentSessionId !== request.parentSessionId)
  ) {
    return {
      kind: "error",
      reason: request.kind === "panel-entry" ? "source-missing" : "source-unavailable",
    };
  }
  const root = planAnalysisRootSession(sessions, target.sessionId);
  if (root === null) return { kind: "error", reason: "open-failed" };
  if (request.kind === "reference" && target.analysisParentSessionId == null) {
    return { kind: "direct", root };
  }
  return {
    kind: "sidebar",
    root,
    target,
    selectRoot: currentSessionId !== root.sessionId,
    focusTab: request.kind === "panel-entry",
  };
}
