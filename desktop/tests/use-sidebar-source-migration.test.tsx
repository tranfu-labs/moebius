/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sidebarPresentationRoute } from "../src/console-page/presentation-route.js";
import { useSidebarSourceMigration } from "../src/console-page/use-sidebar-source-migration.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("sidebar source migration controller", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("settles a slow migration through current callbacks and retains state after a failed refresh", async () => {
    const slow = deferred<boolean>();
    const firstCommit = vi.fn();
    await render("right-a", vi.fn(async () => await slow.promise), firstCommit, vi.fn());

    const replacementCommit = vi.fn();
    const replacementHost = vi.fn();
    await render("right-a", vi.fn(async () => true), replacementCommit, replacementHost);
    await act(async () => slow.resolve(true));
    await act(async () => Promise.resolve());
    expect(firstCommit).not.toHaveBeenCalled();
    expect(replacementCommit).toHaveBeenCalledOnce();
    expect(replacementHost).toHaveBeenCalledWith("right-a");

    const failedCommit = vi.fn();
    await render("right-b", vi.fn(async () => false), failedCommit, vi.fn());
    await act(async () => Promise.resolve());
    expect(failedCommit).not.toHaveBeenCalled();
  });

  async function render(
    sessionId: string,
    refresh: ReturnType<typeof vi.fn>,
    commitRoute: ReturnType<typeof vi.fn>,
    showHost: ReturnType<typeof vi.fn>,
  ): Promise<void> {
    await act(async () => root.render(
      <Harness
        sessionId={sessionId}
        refresh={refresh}
        commitRoute={commitRoute}
        showHost={showHost}
      />,
    ));
  }

  function Harness({
    sessionId,
    refresh,
    commitRoute,
    showHost,
  }: {
    sessionId: string;
    refresh: ReturnType<typeof vi.fn>;
    commitRoute: ReturnType<typeof vi.fn>;
    showHost: ReturnType<typeof vi.fn>;
  }): null {
    useSidebarSourceMigration(
      [project(session(sessionId))],
      sidebarPresentationRoute({
        sidebarProjectId: "project-a",
        sidebarSessionId: sessionId,
        originSessionId: "missing-main",
        originAvailable: true,
      }),
      refresh,
      commitRoute,
      vi.fn(),
      showHost,
    );
    return null;
  }
});

function project(...sessions: ReturnType<typeof session>[]) {
  return {
    projectId: "project-a", sourceType: "local-folder" as const, title: "Project",
    folderPath: "/tmp/project-a", worktreeMode: false, workspaceCwd: "/tmp/project-a",
    workspaceMode: "direct" as const, worktreePath: null, worktreeUnavailableReason: null,
    workspaceUpdatedAt: null, sessions, runningCount: 0, waitingCount: 0, stuckCount: 0, errorCount: 0,
  };
}

function session(sessionId: string) {
  return {
    sessionId, projectId: "project-a", originSessionId: "missing-main", analysisParentSessionId: null,
    workspaceMode: "direct" as const, workspacePendingMode: null, title: sessionId,
    status: "idle" as const, awaitsHumanReason: null, unreadSince: null,
    runningCount: 0, waitingCount: 0, stuckCount: 0, errorCount: 0, interruptedCount: 0,
    createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z",
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
