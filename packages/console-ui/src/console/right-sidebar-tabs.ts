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

export const RIGHT_SIDEBAR_SELECTABLE_TAB_TYPES = [
  "conversation",
  "workspace-diff",
  "project-files",
] as const satisfies readonly RightSidebarTabType[];

export type RightSidebarSelectableTabType = (typeof RIGHT_SIDEBAR_SELECTABLE_TAB_TYPES)[number];

export interface RightSidebarTab {
  id: string;
  type: RightSidebarTabType;
  title: string;
  sourceKey: string | null;
  closable: true;
  processScroll?: RightSidebarProcessScrollSnapshot;
}

export interface RightSidebarProcessScrollSnapshot {
  anchorEventKey: string | null;
  offsetPx: number;
  followLatest: boolean;
}

export interface RightSidebarTabsState {
  tabs: RightSidebarTab[];
  activeTabId: string | null;
}

export interface RightSidebarSourceTab {
  id: string;
  type: Exclude<RightSidebarTabType, "blank">;
  title: string;
  sourceKey: string;
}

export const EMPTY_RIGHT_SIDEBAR_TABS: RightSidebarTabsState = {
  tabs: [],
  activeTabId: null,
};

export const RIGHT_SIDEBAR_BUILTIN_TAB_TITLES = {
  blank: "builtin:blank",
  conversation: "builtin:conversation",
  workspaceDiff: "builtin:workspace-diff",
  projectFiles: "builtin:project-files",
} as const;

const RUN_OUTPUT_SOURCE_KEY_PREFIX = "run-output-v2:";
const STEP_RUN_OUTPUT_SOURCE_KEY_PREFIX = "run-output-v3:";
const FILE_REFERENCE_SOURCE_KEY_PREFIX = "file-reference-v1:";

export interface FileReferenceSourceLocator {
  sessionId: string;
  path: string;
  line: number;
  column: number | null;
}

export function createFileReferenceSourceKey(
  sessionId: string,
  reference: Omit<FileReferenceSourceLocator, "sessionId">,
): string {
  const column = reference.column === null ? "" : String(reference.column);
  return `${FILE_REFERENCE_SOURCE_KEY_PREFIX}${[
    encodeURIComponent(sessionId),
    encodeURIComponent(reference.path),
    String(reference.line),
    column,
  ].join(":")}`;
}

export function parseFileReferenceSourceKey(sourceKey: string | null): FileReferenceSourceLocator | null {
  if (sourceKey === null || !sourceKey.startsWith(FILE_REFERENCE_SOURCE_KEY_PREFIX)) {
    return null;
  }
  const parts = sourceKey.slice(FILE_REFERENCE_SOURCE_KEY_PREFIX.length).split(":");
  if (parts.length !== 4) {
    return null;
  }
  try {
    const sessionId = decodeURIComponent(parts[0]!);
    const filePath = decodeURIComponent(parts[1]!);
    const line = readPositiveInteger(parts[2]!);
    const column = parts[3] === "" ? null : readPositiveInteger(parts[3]!);
    return sessionId === "" || !filePath.startsWith("/") || line === null || (parts[3] !== "" && column === null)
      ? null
      : { sessionId, path: filePath, line, column };
  } catch {
    return null;
  }
}

export function createRunOutputSourceKey(
  sessionId: string,
  runId: string,
  stepId: string | null = null,
): string {
  if (stepId !== null && stepId !== "") {
    return `${STEP_RUN_OUTPUT_SOURCE_KEY_PREFIX}${encodeURIComponent(sessionId)}:${encodeURIComponent(stepId)}:${encodeURIComponent(runId)}`;
  }
  return `${RUN_OUTPUT_SOURCE_KEY_PREFIX}${encodeURIComponent(sessionId)}:${encodeURIComponent(runId)}`;
}

export function parseRunOutputSourceKey(
  sourceKey: string | null,
  legacySessionId?: string,
): { sessionId: string; runId: string; stepId: string | null } | null {
  if (sourceKey === null) {
    return null;
  }
  if (sourceKey.startsWith(STEP_RUN_OUTPUT_SOURCE_KEY_PREFIX)) {
    const encoded = sourceKey.slice(STEP_RUN_OUTPUT_SOURCE_KEY_PREFIX.length);
    const firstSeparator = encoded.indexOf(":");
    const secondSeparator = encoded.indexOf(":", firstSeparator + 1);
    if (
      firstSeparator <= 0
      || secondSeparator <= firstSeparator + 1
      || secondSeparator >= encoded.length - 1
    ) {
      return null;
    }
    try {
      const sessionId = decodeURIComponent(encoded.slice(0, firstSeparator));
      const stepId = decodeURIComponent(encoded.slice(firstSeparator + 1, secondSeparator));
      const runId = decodeURIComponent(encoded.slice(secondSeparator + 1));
      return sessionId === "" || stepId === "" || runId === ""
        ? null
        : { sessionId, runId, stepId };
    } catch {
      return null;
    }
  }
  if (sourceKey.startsWith(RUN_OUTPUT_SOURCE_KEY_PREFIX)) {
    const encoded = sourceKey.slice(RUN_OUTPUT_SOURCE_KEY_PREFIX.length);
    const separator = encoded.indexOf(":");
    if (separator <= 0 || separator >= encoded.length - 1) {
      return null;
    }
    try {
      const sessionId = decodeURIComponent(encoded.slice(0, separator));
      const runId = decodeURIComponent(encoded.slice(separator + 1));
      return sessionId === "" || runId === "" ? null : { sessionId, runId, stepId: null };
    } catch {
      return null;
    }
  }
  if (legacySessionId === undefined) {
    return null;
  }
  const legacyPrefix = `run-output:${legacySessionId}:`;
  const runId = sourceKey.startsWith(legacyPrefix)
    ? sourceKey.slice(legacyPrefix.length)
    : "";
  return runId === "" ? null : { sessionId: legacySessionId, runId, stepId: null };
}

export function createBlankRightSidebarTab(id: string): RightSidebarTab {
  return {
    id,
    type: "blank",
    title: RIGHT_SIDEBAR_BUILTIN_TAB_TITLES.blank,
    sourceKey: null,
    closable: true,
  };
}

export function addBlankRightSidebarTab(
  state: RightSidebarTabsState,
  id: string,
): RightSidebarTabsState {
  const tab = createBlankRightSidebarTab(uniqueRightSidebarTabId(state, id));
  return {
    tabs: [...state.tabs, tab],
    activeTabId: tab.id,
  };
}

export function ensureRightSidebarTabsForOpen(
  state: RightSidebarTabsState,
  _options: { id: string; isGitRepository: boolean },
): RightSidebarTabsState {
  if (state.tabs.length > 0) {
    return state.activeTabId === null
      ? { ...state, activeTabId: state.tabs[0]?.id ?? null }
      : state;
  }
  return EMPTY_RIGHT_SIDEBAR_TABS;
}

export function openRightSidebarSourceTab(
  state: RightSidebarTabsState,
  source: RightSidebarSourceTab,
): RightSidebarTabsState {
  const existing = state.tabs.find((tab) => sameRightSidebarSource(tab, source));
  if (existing !== undefined) {
    const sourceLocator = source.type === "run-output"
      ? parseRunOutputSourceKey(source.sourceKey)
      : null;
    const existingLocator = existing.type === "run-output"
      ? parseRunOutputSourceKey(existing.sourceKey, sourceLocator?.sessionId)
      : null;
    const shouldUpgradeRunSource = existingLocator?.stepId === null
      && sourceLocator?.stepId !== null
      && sourceLocator?.stepId !== undefined;
    const shouldCorrectUnknownTitle = existing.type === "run-output"
      && isUnknownProcessTitle(existing.title)
      && !isUnknownProcessTitle(source.title);
    const shouldRefreshConversationTitle = existing.type === "conversation"
      && source.type === "conversation"
      && existing.title !== source.title;
    if (
      state.activeTabId === existing.id
      && !shouldUpgradeRunSource
      && !shouldCorrectUnknownTitle
      && !shouldRefreshConversationTitle
    ) {
      return state;
    }
    return {
      ...state,
      tabs: shouldUpgradeRunSource || shouldCorrectUnknownTitle || shouldRefreshConversationTitle
        ? state.tabs.map((tab) => tab.id === existing.id
            ? {
                ...tab,
                sourceKey: shouldUpgradeRunSource ? source.sourceKey : tab.sourceKey,
                title: shouldCorrectUnknownTitle || shouldRefreshConversationTitle
                  ? source.title
                  : tab.title,
              }
            : tab)
        : state.tabs,
      activeTabId: existing.id,
    };
  }
  const tab: RightSidebarTab = {
    ...source,
    id: uniqueRightSidebarTabId(state, source.id),
    closable: true,
  };
  return {
    tabs: [...state.tabs, tab],
    activeTabId: tab.id,
  };
}

export function dedupeRunOutputTabsByStableStep(
  state: RightSidebarTabsState,
): RightSidebarTabsState {
  const canonicalIndexByStep = new Map<string, number>();
  const tabs: RightSidebarTab[] = [];
  let activeTabId = state.activeTabId;
  let changed = false;
  for (const tab of state.tabs) {
    const locator = tab.type === "run-output"
      ? parseRunOutputSourceKey(tab.sourceKey)
      : null;
    if (locator?.stepId === null || locator === null) {
      tabs.push(tab);
      continue;
    }
    const identity = `${encodeURIComponent(locator.sessionId)}:${encodeURIComponent(locator.stepId)}`;
    const canonicalIndex = canonicalIndexByStep.get(identity);
    if (canonicalIndex === undefined) {
      canonicalIndexByStep.set(identity, tabs.length);
      tabs.push(tab);
      continue;
    }
    changed = true;
    const canonical = tabs[canonicalIndex]!;
    const duplicateIsActive = state.activeTabId === tab.id;
    tabs[canonicalIndex] = {
      ...canonical,
      title: isUnknownProcessTitle(canonical.title) && !isUnknownProcessTitle(tab.title)
        ? tab.title
        : canonical.title,
      processScroll: duplicateIsActive
        ? tab.processScroll ?? canonical.processScroll
        : canonical.processScroll,
    };
    if (duplicateIsActive) {
      activeTabId = canonical.id;
    }
  }
  return changed ? { tabs, activeTabId } : state;
}

function sameRightSidebarSource(
  tab: RightSidebarTab,
  source: RightSidebarSourceTab,
): boolean {
  if (tab.type !== source.type) {
    return false;
  }
  if (tab.sourceKey === source.sourceKey) {
    return true;
  }
  if (tab.type !== "run-output") {
    return false;
  }
  const incoming = parseRunOutputSourceKey(source.sourceKey);
  const existing = parseRunOutputSourceKey(tab.sourceKey, incoming?.sessionId);
  if (existing === null || incoming === null || existing.sessionId !== incoming.sessionId) {
    return false;
  }
  if (existing.runId === incoming.runId) {
    return true;
  }
  return existing.stepId !== null
    && incoming.stepId !== null
    && existing.stepId === incoming.stepId;
}

function isUnknownProcessTitle(title: string): boolean {
  return /^(?:成员未知|Unknown member)(?: [2-9]\d*)?$/u.test(title); // i18n-exempt: recognizes persisted locale-specific dynamic titles
}

function readPositiveInteger(value: string): number | null {
  if (!/^[1-9]\d*$/u.test(value)) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function selectRightSidebarTab(
  state: RightSidebarTabsState,
  tabId: string,
): RightSidebarTabsState {
  return state.tabs.some((tab) => tab.id === tabId)
    ? { ...state, activeTabId: tabId }
    : state;
}

export function updateRightSidebarProcessScroll(
  state: RightSidebarTabsState,
  tabId: string,
  snapshot: RightSidebarProcessScrollSnapshot,
): RightSidebarTabsState {
  const normalized = normalizeProcessScrollSnapshot(snapshot);
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === tabId && tab.type === "run-output"
        ? { ...tab, processScroll: normalized }
        : tab),
  };
}

export function closeRightSidebarTab(
  state: RightSidebarTabsState,
  tabId: string,
  _fallbackBlankId?: string,
): RightSidebarTabsState {
  const closingIndex = state.tabs.findIndex((tab) => tab.id === tabId);
  if (closingIndex < 0) {
    return state;
  }
  const remaining = state.tabs.filter((tab) => tab.id !== tabId);
  if (remaining.length === 0) {
    return EMPTY_RIGHT_SIDEBAR_TABS;
  }
  if (state.activeTabId !== tabId) {
    return { ...state, tabs: remaining };
  }
  const nextActive = remaining[Math.min(closingIndex, remaining.length - 1)]!;
  return { tabs: remaining, activeTabId: nextActive.id };
}

export function convertBlankRightSidebarTab(
  state: RightSidebarTabsState,
  tabId: string,
  type: RightSidebarSelectableTabType,
): RightSidebarTabsState {
  const title = type === "workspace-diff"
    ? RIGHT_SIDEBAR_BUILTIN_TAB_TITLES.workspaceDiff
    : type === "project-files"
      ? RIGHT_SIDEBAR_BUILTIN_TAB_TITLES.projectFiles
      : RIGHT_SIDEBAR_BUILTIN_TAB_TITLES.conversation;
  return {
    tabs: state.tabs.map((tab) => tab.id === tabId && tab.type === "blank"
      ? { ...tab, type, title }
      : tab),
    activeTabId: state.activeTabId,
  };
}

export function parseRightSidebarTabsState(value: unknown): RightSidebarTabsState {
  if (!isRecord(value) || !Array.isArray(value.tabs)) {
    return EMPTY_RIGHT_SIDEBAR_TABS;
  }
  const tabs = value.tabs.flatMap((entry): RightSidebarTab[] => {
    if (
      !isRecord(entry)
      || typeof entry.id !== "string"
      || entry.id.trim() === ""
      || !isRightSidebarTabType(entry.type)
      || typeof entry.title !== "string"
      || !(typeof entry.sourceKey === "string" || entry.sourceKey === null)
    ) {
      return [];
    }
    return [{
      id: entry.id,
      type: entry.type,
      title: normalizeBuiltinTabTitle(entry.type, entry.title, entry.sourceKey),
      sourceKey: entry.sourceKey,
      closable: true,
    }];
  });
  const uniqueTabs = tabs.filter(
    (tab, index) => tabs.findIndex((candidate) => candidate.id === tab.id) === index,
  );
  const activeTabId = typeof value.activeTabId === "string"
    && uniqueTabs.some((tab) => tab.id === value.activeTabId)
    ? value.activeTabId
    : uniqueTabs[0]?.id ?? null;
  return {
    tabs: uniqueTabs,
    activeTabId,
  };
}

export function serializeRightSidebarTabsState(state: RightSidebarTabsState): string {
  return JSON.stringify(parseRightSidebarTabsState(state));
}

function normalizeBuiltinTabTitle(
  type: RightSidebarTabType,
  title: string,
  sourceKey: string | null,
): string {
  if (type === "blank") {
    return RIGHT_SIDEBAR_BUILTIN_TAB_TITLES.blank;
  }
  if (type === "workspace-diff") {
    return RIGHT_SIDEBAR_BUILTIN_TAB_TITLES.workspaceDiff;
  }
  if (type === "project-files") {
    return RIGHT_SIDEBAR_BUILTIN_TAB_TITLES.projectFiles;
  }
  if (type === "conversation") {
    return sourceKey === null ? RIGHT_SIDEBAR_BUILTIN_TAB_TITLES.conversation : title;
  }
  return title;
}

function isRightSidebarTabType(value: unknown): value is RightSidebarTabType {
  return typeof value === "string" && RIGHT_SIDEBAR_TAB_TYPES.some((type) => type === value);
}

function uniqueRightSidebarTabId(state: RightSidebarTabsState, requestedId: string): string {
  if (!state.tabs.some((tab) => tab.id === requestedId)) {
    return requestedId;
  }
  let suffix = 2;
  while (state.tabs.some((tab) => tab.id === `${requestedId}-${String(suffix)}`)) {
    suffix += 1;
  }
  return `${requestedId}-${String(suffix)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeProcessScrollSnapshot(
  value: RightSidebarProcessScrollSnapshot,
): RightSidebarProcessScrollSnapshot {
  return {
    anchorEventKey: value.anchorEventKey,
    offsetPx: Math.max(0, value.offsetPx),
    followLatest: value.followLatest,
  };
}
