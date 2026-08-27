import { describe, expect, it, vi } from "vitest";

import {
  CONSOLE_SELECTION_STORAGE_KEY,
  clearConsoleSelectionPreference,
  decideConsoleSelectionCommit,
  isSameConsoleSelection,
  planInitialConsoleSelectionPreference,
  readConsoleSelectionFromSearch,
  readConsoleSelectionPreference,
  shouldRestoreConsoleSelection,
  writeConsoleSelectionPreference,
} from "../src/console-page/selection-preference.js";

describe("console selection preference", () => {
  it("reads a complete project and session pair from a deep link", () => {
    expect(readConsoleSelectionFromSearch(
      "?projectId=local-project%3Ademo&sessionId=local%3Ademo-1",
    )).toEqual({ projectId: "local-project:demo", sessionId: "local:demo-1" });
    expect(readConsoleSelectionFromSearch("?projectId=local-project%3Ademo")).toBeNull();
  });

  it("prioritizes a complete deep link over the remembered selection", () => {
    const linked = { projectId: "linked-project", sessionId: "linked-session" };
    const remembered = { projectId: "remembered-project", sessionId: "remembered-session" };
    expect(planInitialConsoleSelectionPreference(linked, remembered)).toEqual(linked);
    expect(planInitialConsoleSelectionPreference(null, remembered)).toEqual(remembered);
  });

  it("restores a valid project and session pair", () => {
    const selection = { projectId: "project-b", sessionId: "session-b" };
    expect(readConsoleSelectionPreference({
      getItem: () => JSON.stringify(selection),
    })).toEqual(selection);
    expect(shouldRestoreConsoleSelection(selection, {
      ...selection,
      isRootSession: true,
    })).toBe(true);
  });

  it("rejects absent, corrupt, partial, empty, mismatched, and child selections", () => {
    expect(readConsoleSelectionPreference({ getItem: () => null })).toBeNull();
    expect(readConsoleSelectionPreference({ getItem: () => "not-json" })).toBeNull();
    expect(readConsoleSelectionPreference({
      getItem: () => JSON.stringify({ projectId: "project-b" }),
    })).toBeNull();
    expect(readConsoleSelectionPreference({
      getItem: () => JSON.stringify({ projectId: " ", sessionId: "session-b" }),
    })).toBeNull();

    const remembered = { projectId: "project-b", sessionId: "session-b" };
    expect(shouldRestoreConsoleSelection(remembered, {
      projectId: "project-a",
      sessionId: "session-b",
      isRootSession: true,
    })).toBe(false);
    expect(shouldRestoreConsoleSelection(remembered, {
      projectId: "project-b",
      sessionId: "session-a",
      isRootSession: true,
    })).toBe(false);
    expect(shouldRestoreConsoleSelection(remembered, {
      ...remembered,
      isRootSession: false,
    })).toBe(false);
    expect(shouldRestoreConsoleSelection(null, {
      ...remembered,
      isRootSession: true,
    })).toBe(false);
  });

  it("persists and clears selections without letting storage failures break the console", () => {
    const selection = { projectId: "project-b", sessionId: "session-b" };
    const setItem = vi.fn();
    const removeItem = vi.fn();

    writeConsoleSelectionPreference({ setItem }, selection);
    clearConsoleSelectionPreference({ removeItem });

    expect(setItem).toHaveBeenCalledWith(CONSOLE_SELECTION_STORAGE_KEY, JSON.stringify(selection));
    expect(removeItem).toHaveBeenCalledWith(CONSOLE_SELECTION_STORAGE_KEY);
    expect(() => readConsoleSelectionPreference({ getItem: () => { throw new Error("blocked"); } })).not.toThrow();
    expect(() => writeConsoleSelectionPreference({ setItem: () => { throw new Error("full"); } }, selection)).not.toThrow();
    expect(() => clearConsoleSelectionPreference({ removeItem: () => { throw new Error("blocked"); } })).not.toThrow();
  });

  it("compares confirmed selections without treating null as a match", () => {
    const selection = { projectId: "project-b", sessionId: "session-b" };
    expect(isSameConsoleSelection(selection, { ...selection })).toBe(true);
    expect(isSameConsoleSelection(null, selection)).toBe(false);
    expect(isSameConsoleSelection(selection, { ...selection, sessionId: "session-c" })).toBe(false);
  });

  it("restores only an exact startup match and otherwise opens an unselected new conversation", () => {
    const remembered = { projectId: "project-b", sessionId: "session-b" };
    expect(decideConsoleSelectionCommit({
      startupPending: true,
      persistenceEnabled: false,
      remembered,
      snapshot: { ...remembered, isRootSession: true },
    })).toEqual({ action: "restore", persistenceEnabled: true });
    expect(decideConsoleSelectionCommit({
      startupPending: true,
      persistenceEnabled: false,
      remembered,
      snapshot: { projectId: "local", sessionId: "default", isRootSession: true },
    })).toEqual({ action: "open-new-conversation", persistenceEnabled: false });
    expect(decideConsoleSelectionCommit({
      startupPending: true,
      persistenceEnabled: false,
      remembered: { projectId: "local", sessionId: "default" },
      snapshot: { projectId: "local", sessionId: "default", isRootSession: false },
    })).toEqual({ action: "open-new-conversation", persistenceEnabled: false });
  });

  it("remembers only confirmed roots and disables persistence after an empty selection", () => {
    const remembered = { projectId: "project-a", sessionId: "session-a" };
    expect(decideConsoleSelectionCommit({
      startupPending: false,
      persistenceEnabled: true,
      remembered,
      snapshot: { projectId: "project-b", sessionId: "session-b", isRootSession: true },
    })).toEqual({ action: "remember", persistenceEnabled: true });
    expect(decideConsoleSelectionCommit({
      startupPending: false,
      persistenceEnabled: true,
      remembered,
      snapshot: { ...remembered, isRootSession: true },
    })).toEqual({ action: "none", persistenceEnabled: true });
    expect(decideConsoleSelectionCommit({
      startupPending: false,
      persistenceEnabled: true,
      remembered,
      snapshot: { ...remembered, isRootSession: false },
    })).toEqual({ action: "forget", persistenceEnabled: false });
    expect(decideConsoleSelectionCommit({
      startupPending: false,
      persistenceEnabled: false,
      remembered,
      snapshot: { projectId: "project-b", sessionId: "session-b", isRootSession: true },
    })).toEqual({ action: "none", persistenceEnabled: false });
  });
});
