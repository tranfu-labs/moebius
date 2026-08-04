/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectFilePort } from "../src/console-page/project-file-contract.js";
import { useProjectFileReader } from "../src/console-page/use-project-file-reader.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ProjectFileBundle = ReturnType<typeof useProjectFileReader>;

describe("project file reader controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: ProjectFileBundle;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("keeps an in-flight read on its request port and uses replacement ports afterward", async () => {
    const slow = deferred<{
      available: true;
      path: string;
      lines: [];
      reason: null;
    }>();
    const firstPort = port({ readProjectFile: vi.fn(async () => await slow.promise) });
    await render(firstPort);
    const pending = latest.readProjectFile("session-a", "src/slow.ts");

    const replacementPort = port({
      readProjectFile: vi.fn(async () => ({
        available: true as const, path: "src/new.ts", lines: [], reason: null,
      })),
    });
    await render(replacementPort);
    slow.resolve({ available: true, path: "src/slow.ts", lines: [], reason: null });
    await expect(pending).resolves.toMatchObject({ path: "src/slow.ts", available: true });
    await expect(latest.readProjectFile("session-a", "src/new.ts")).resolves.toMatchObject({
      path: "src/new.ts", available: true,
    });
    expect(firstPort.readProjectFile).toHaveBeenCalledOnce();
    expect(replacementPort.readProjectFile).toHaveBeenCalledOnce();

    const failingPort = port({
      readProjectFile: vi.fn(async () => Promise.reject(new Error("file failed"))),
    });
    await render(failingPort);
    await expect(latest.readProjectFile("session-a", "src/fail.ts")).rejects.toThrow("file failed");
  });

  async function render(filePort: ProjectFilePort): Promise<void> {
    await act(async () => root.render(<Harness filePort={filePort} />));
  }

  function Harness({ filePort }: { filePort: ProjectFilePort }): null {
    latest = useProjectFileReader("http://127.0.0.1:8787/", filePort);
    return null;
  }
});

function port(overrides: Partial<ProjectFilePort> = {}): ProjectFilePort {
  return {
    readWorkspaceDiff: vi.fn(async () => ({
      available: false as const,
      fileCount: null,
      files: [] as [],
      reason: "workspace-unavailable" as const,
      workspaceMode: "direct" as const,
    })),
    readProjectFiles: vi.fn(async () => ({
      available: false as const,
      files: [] as [],
      reason: "workspace-unavailable" as const,
      workspaceMode: "direct" as const,
    })),
    readProjectFile: vi.fn(async () => ({
      available: true as const,
      path: "src/file.ts",
      lines: [],
      reason: null,
    })),
    readWorkspaceDiffFile: vi.fn(async () => ({
      available: true as const,
      path: "src/file.ts",
      lines: [],
      reason: null,
    })),
    readFileReference: vi.fn(async () => ({
      available: true as const,
      scope: "workspace-file" as const,
      isComplete: true as const,
      path: "src/file.ts",
      lines: [],
      reason: null,
      targetLine: 1,
      targetColumn: null,
      truncatedBefore: false,
      truncatedAfter: false,
      relativePath: "src/file.ts",
      text: "",
    })),
    ...overrides,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
