/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRightSidebarTabsStore } from "../src/console-page/right-sidebar-tabs-store.js";
import type { ProjectMutationPort } from "../src/console-page/project-mutation-contract.js";
import { useProjectMutations } from "../src/console-page/use-project-mutations.js";
import { createTestConsoleErrorSetter } from "./console-error-test-controller.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ProjectMutationsBundle = ReturnType<typeof useProjectMutations>;

describe("project mutation controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: ProjectMutationsBundle;
  let latestTabsStore: ReturnType<typeof createRightSidebarTabsStore>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    latestTabsStore = createRightSidebarTabsStore(new MemoryStorage());
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("settles a slow mutation through current callbacks and uses a replacement port later", async () => {
    const slow = deferred<void>();
    const firstPort = port({ renameProject: vi.fn(async () => await slow.promise) });
    const firstRefresh = vi.fn(async () => true);
    const firstError = vi.fn();
    await render(firstPort, firstRefresh, firstError);

    let pending!: Promise<void>;
    act(() => { pending = latest.renameProject("project-a", "Renamed"); });
    expect(firstPort.renameProject).toHaveBeenCalledOnce();

    const replacementPort = port();
    const replacementRefresh = vi.fn(async () => true);
    const replacementError = vi.fn();
    await render(replacementPort, replacementRefresh, replacementError);
    await act(async () => {
      slow.resolve();
      await pending;
    });
    expect(firstRefresh).not.toHaveBeenCalled();
    expect(replacementRefresh).toHaveBeenCalledWith({ projectId: "project-a", sessionId: "root" });
    expect(replacementError).toHaveBeenLastCalledWith(null);

    const failedPort = port({
      renameProject: vi.fn(async () => Promise.reject(new Error("rename failed"))),
    });
    const failureError = vi.fn();
    await render(failedPort, vi.fn(async () => true), failureError);
    let failure: unknown;
    await act(async () => {
      try {
        await latest.renameProject("project-a", "Broken");
      } catch (error) {
        failure = error;
      }
    });
    expect(failure).toEqual(new Error("rename failed"));
    expect(failureError).toHaveBeenCalledWith("rename failed");
    expect(replacementPort.renameProject).not.toHaveBeenCalled();
  });

  it("does not clear right-sidebar state when project removal fails", async () => {
    const failingPort = port({
      removeProject: vi.fn(async () => Promise.reject(new Error("remove failed"))),
    });
    const failureError = vi.fn();
    await render(failingPort, vi.fn(async () => true), failureError);
    latestTabsStore.writeVisibilityPreference("root", "open");

    let failure: unknown;
    await act(async () => {
      try {
        await latest.removeProject("project-a", false);
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toEqual(new Error("remove failed"));
    expect(failureError).toHaveBeenCalledWith("remove failed");
    expect(latestTabsStore.readHostState("root").visibilityPreference).toBe("open");
  });

  it("persists a workspace preference and refreshes the current project state", async () => {
    const updateWorkspacePreference = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => true);
    const setError = vi.fn();
    await render(port({ updateWorkspacePreference }), refresh, setError);

    await act(async () => {
      await latest.updateWorkspacePreference("project-a", "worktree");
    });

    expect(updateWorkspacePreference).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/",
      "project-a",
      "worktree",
    );
    expect(refresh).toHaveBeenCalledWith({ projectId: "project-a", sessionId: "root" });
    expect(setError).toHaveBeenLastCalledWith(null);
  });

  async function render(
    mutationPort: ProjectMutationPort,
    refresh: ReturnType<typeof vi.fn>,
    setError: ReturnType<typeof vi.fn>,
  ): Promise<void> {
    await act(async () => root.render(
      <Harness mutationPort={mutationPort} refresh={refresh} setError={setError} />,
    ));
  }

  function Harness({
    mutationPort,
    refresh,
    setError,
  }: {
    mutationPort: ProjectMutationPort;
    refresh: ReturnType<typeof vi.fn>;
    setError: ReturnType<typeof vi.fn>;
  }): null {
    latest = useProjectMutations(
      "http://127.0.0.1:8787/",
      [],
      null,
      { current: { projectId: "project-a", sessionId: "root" } },
      { current: true },
      vi.fn(),
      refresh,
      vi.fn(),
      latestTabsStore,
      vi.fn(),
      vi.fn(),
      undefined,
      mutationPort,
      createTestConsoleErrorSetter(setError),
    );
    return null;
  }
});

function port(overrides: Partial<ProjectMutationPort> = {}): ProjectMutationPort {
  return {
    showInFolder: vi.fn(async () => undefined),
    renameProject: vi.fn(async () => undefined),
    updateWorkspacePreference: vi.fn(async () => undefined),
    removeProject: vi.fn(async () => ({})),
    selectFolderForRepair: vi.fn(async () => null),
    repairProjectFolder: vi.fn(async () => undefined),
    ...overrides,
  };
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
