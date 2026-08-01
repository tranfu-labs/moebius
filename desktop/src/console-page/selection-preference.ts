import type { ConsoleSelection } from "./console-state-coordinator.js";

export const CONSOLE_SELECTION_STORAGE_KEY = "moebius.console.selection";

interface ConsoleSelectionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ConsoleSelectionSnapshot {
  projectId: string;
  sessionId: string;
  isRootSession: boolean;
}

export interface ConsoleSelectionCommitDecision {
  action: "none" | "restore" | "remember" | "forget" | "open-new-conversation";
  persistenceEnabled: boolean;
}

export function readConsoleSelectionPreference(
  storage: Pick<ConsoleSelectionStorage, "getItem">,
): ConsoleSelection | null {
  try {
    const raw = storage.getItem(CONSOLE_SELECTION_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }
    const projectId = readNonEmptyString(parsed.projectId);
    const sessionId = readNonEmptyString(parsed.sessionId);
    return projectId === null || sessionId === null ? null : { projectId, sessionId };
  } catch {
    return null;
  }
}

export function writeConsoleSelectionPreference(
  storage: Pick<ConsoleSelectionStorage, "setItem">,
  selection: ConsoleSelection,
): void {
  try {
    storage.setItem(CONSOLE_SELECTION_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Selection persistence is best-effort; browsing must remain available.
  }
}

export function clearConsoleSelectionPreference(
  storage: Pick<ConsoleSelectionStorage, "removeItem">,
): void {
  try {
    storage.removeItem(CONSOLE_SELECTION_STORAGE_KEY);
  } catch {
    // A blocked storage backend must not prevent the safe startup fallback.
  }
}

export function shouldRestoreConsoleSelection(
  remembered: ConsoleSelection | null,
  snapshot: ConsoleSelectionSnapshot,
): boolean {
  return remembered !== null
    && snapshot.isRootSession
    && remembered.projectId === snapshot.projectId
    && remembered.sessionId === snapshot.sessionId;
}

export function isSameConsoleSelection(
  left: ConsoleSelection | null,
  right: ConsoleSelection,
): boolean {
  return left?.projectId === right.projectId && left.sessionId === right.sessionId;
}

export function decideConsoleSelectionCommit(input: {
  startupPending: boolean;
  persistenceEnabled: boolean;
  remembered: ConsoleSelection | null;
  snapshot: ConsoleSelectionSnapshot;
}): ConsoleSelectionCommitDecision {
  if (input.startupPending) {
    return shouldRestoreConsoleSelection(input.remembered, input.snapshot)
      ? { action: "restore", persistenceEnabled: true }
      : { action: "open-new-conversation", persistenceEnabled: false };
  }
  if (!input.persistenceEnabled) {
    return { action: "none", persistenceEnabled: false };
  }
  if (!input.snapshot.isRootSession) {
    return { action: "forget", persistenceEnabled: false };
  }
  return isSameConsoleSelection(input.remembered, input.snapshot)
    ? { action: "none", persistenceEnabled: true }
    : { action: "remember", persistenceEnabled: true };
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
