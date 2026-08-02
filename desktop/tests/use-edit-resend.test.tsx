/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorMessage } from "@moebius/console-ui";

import { waitForCondition } from "../../src/testing/wait.js";
import type { LocalConsoleState } from "../src/console-page/console-state-contract.js";
import { sessionDraftKey } from "../src/console-page/conversation-draft-model.js";
import { createConversationDraftStore } from "../src/console-page/draft-store.js";
import { useEditResend } from "../src/console-page/use-edit-resend.js";
import { createTestConsoleErrorSetter } from "./console-error-test-controller.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type EditResendBundle = ReturnType<typeof useEditResend>;

describe("edit resend controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: EditResendBundle;
  let draftStore: ReturnType<typeof createConversationDraftStore>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    draftStore = createConversationDraftStore(new MemoryStorage());
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("commits a slow refill through current callbacks and uses a replacement attachment port later", async () => {
    const slow = deferred<void>();
    const firstReplace = vi.fn(async () => await slow.promise);
    const firstCommit = vi.fn();
    await render(firstReplace, firstCommit, vi.fn());
    latest.editAndResend({ sessionId: "session-a", stoppedMessageId: 2, runId: "run-a" });

    const replacementReplace = vi.fn(async () => undefined);
    const replacementCommit = vi.fn();
    const replacementError = vi.fn();
    await render(replacementReplace, replacementCommit, replacementError);
    slow.resolve(undefined);
    await waitFor(() => replacementCommit.mock.calls.length === 1);
    expect(firstCommit).not.toHaveBeenCalled();
    expect(draftStore.read(sessionDraftKey("session-a"))).toBe("Original body");
    expect(draftStore.readResumeRunId(sessionDraftKey("session-a"))).toBe("run-a");

    const failingReplace = vi.fn(async () => Promise.reject(new Error("attachments failed")));
    const failureError = vi.fn();
    await render(failingReplace, vi.fn(), failureError);
    latest.editAndResend({ sessionId: "session-a", stoppedMessageId: 2, runId: "run-a" });
    await waitFor(() => failureError.mock.calls.length === 1);
    expect(replacementReplace).not.toHaveBeenCalled();
    expect(failureError).toHaveBeenCalledWith("attachments failed");
  });

  async function render(
    replaceAttachments: ReturnType<typeof vi.fn>,
    commitDraft: ReturnType<typeof vi.fn>,
    setError: ReturnType<typeof vi.fn>,
  ): Promise<void> {
    await act(async () => root.render(
      <Harness
        replaceAttachments={replaceAttachments}
        commitDraft={commitDraft}
        setError={setError}
      />,
    ));
  }

  function Harness({
    replaceAttachments,
    commitDraft,
    setError,
  }: {
    replaceAttachments: ReturnType<typeof vi.fn>;
    commitDraft: ReturnType<typeof vi.fn>;
    setError: ReturnType<typeof vi.fn>;
  }): null {
    latest = useEditResend(
      { current: consoleState() },
      replaceAttachments,
      draftStore,
      { current: { key: sessionDraftKey("session-a"), value: "" } },
      commitDraft,
      createTestConsoleErrorSetter(setError),
      (key) => key,
    );
    return null;
  }
});

function consoleState(): LocalConsoleState {
  const session = {
    sessionId: "session-a", projectId: "project-a", analysisParentSessionId: null,
    workspaceMode: "direct" as const, workspacePendingMode: null, title: "Session",
    status: "idle" as const, awaitsHumanReason: null, unreadSince: null,
    runningCount: 0, waitingCount: 0, stuckCount: 0, errorCount: 0, interruptedCount: 0,
    createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z",
  };
  const project = {
    projectId: "project-a", sourceType: "local-folder" as const, title: "Project",
    folderPath: "/tmp/project-a", worktreeMode: false, workspaceCwd: "/tmp/project-a",
    workspaceMode: "direct" as const, worktreePath: null, worktreeUnavailableReason: null,
    workspaceUpdatedAt: null, sessions: [session], runningCount: 0, waitingCount: 0,
    stuckCount: 0, errorCount: 0,
  };
  return {
    projects: [project], project, selectedProjectId: "project-a", selectedSessionId: "session-a",
    selectedSession: session, messages: [
      message(1, "user", "Original body"),
      message(2, "system", "Stopped", { systemEventKind: "user-stopped", runId: "run-a" }),
    ],
    pendingPrimaryMessages: [], childSessions: [], memberIdentities: [], activeRun: null,
    activeRuns: [], workspaceDiff: { available: false, fileCount: null, reason: "unavailable" },
    sqlitePath: "/tmp/test.sqlite", lastError: null,
  };
}

function message(
  id: number,
  speaker: OperatorMessage["speaker"],
  body: string,
  overrides: Partial<OperatorMessage> = {},
): OperatorMessage {
  return {
    id, sessionId: "session-a", speaker, role: null, body, status: "displayed",
    runId: null, runDir: null, error: null, systemEventKind: "other",
    createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  await waitForCondition(predicate, {
    timeoutMs: 2_000,
    pollMs: 10,
    tick: async (ms) => act(async () => new Promise((resolve) => setTimeout(resolve, ms))),
    describe: "edit resend condition",
    snapshot: () => ({ body: document.body.textContent }),
  });
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}
