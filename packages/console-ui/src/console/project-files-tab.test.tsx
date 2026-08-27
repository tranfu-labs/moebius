import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectFilesTab } from "./project-files-tab";

describe("ProjectFilesTab", () => {
  it("renders current files as source and defaults Markdown to Preview", async () => {
    const loadFile = vi.fn(async (_sessionId: string, path: string) => ({
      available: true as const,
      path,
      text: path === "README.md" ? "# Project\n\nCurrent README" : "const current = true;",
      lines: path === "README.md"
        ? [
            { kind: "unchanged" as const, oldLineNumber: 1, newLineNumber: 1, text: "# Project" },
            { kind: "unchanged" as const, oldLineNumber: 2, newLineNumber: 2, text: "" },
            { kind: "unchanged" as const, oldLineNumber: 3, newLineNumber: 3, text: "Current README" },
          ]
        : [{ kind: "addition" as const, oldLineNumber: null, newLineNumber: 1, text: "const current = true;" }],
      reason: null,
    }));
    render(
      <ProjectFilesTab
        sessionId="session-a"
        workspaceMode="direct"
        loadFiles={vi.fn().mockResolvedValue({
          available: true,
          files: [
            { path: "README.md", additions: null, deletions: null, changed: false },
            { path: "src/app.ts", additions: 1, deletions: 0, changed: true },
          ],
          reason: null,
          workspaceMode: "direct",
        })}
        loadFile={loadFile}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Project" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "源码" }));
    expect(screen.getByText("# Project")).toHaveClass("whitespace-pre");

    fireEvent.click(screen.getByTitle("src/app.ts"));
    const source = await screen.findByTestId("file-source-scroll");
    expect(within(source).getByText("const current = true;")).toBeVisible();
    expect(source).not.toHaveTextContent("+");
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("README.md"));
    expect(await screen.findByTestId("file-source-scroll")).toHaveTextContent("# Project");
    expect(screen.getByRole("button", { name: "源码" })).toHaveAttribute("aria-pressed", "true");
  });

  it("survives parent callback churn, ignores stale slow reads, and exposes failures", async () => {
    let resolveReadme!: (value: Awaited<ReturnType<typeof successfulFile>>) => void;
    const slowReadme = new Promise<Awaited<ReturnType<typeof successfulFile>>>((resolve) => {
      resolveReadme = resolve;
    });
    const firstLoadFile = vi.fn((_sessionId: string, path: string) => path === "README.md"
      ? slowReadme
      : Promise.resolve(successfulFile(path, "stale callback")));
    const latestLoadFile = vi.fn((_sessionId: string, path: string) => path === "broken.ts"
      ? Promise.reject(new Error("read failed"))
      : Promise.resolve(successfulFile(path, "latest callback")));
    const loadFiles = vi.fn().mockResolvedValue({
      available: true,
      files: [
        { path: "README.md", additions: null, deletions: null, changed: false },
        { path: "src/app.ts", additions: null, deletions: null, changed: false },
        { path: "broken.ts", additions: null, deletions: null, changed: false },
      ],
      reason: null,
      workspaceMode: "direct",
    });
    const rendered = render(
      <ProjectFilesTab sessionId="session-a" workspaceMode="direct" loadFiles={loadFiles} loadFile={firstLoadFile} />,
    );
    expect(await screen.findByTitle("src/app.ts")).toBeVisible();

    rendered.rerender(
      <ProjectFilesTab sessionId="session-a" workspaceMode="direct" loadFiles={loadFiles} loadFile={latestLoadFile} />,
    );
    expect(loadFiles).toHaveBeenCalledTimes(1);
    expect(firstLoadFile).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle("src/app.ts"));
    expect(await screen.findByText("latest callback")).toBeVisible();
    resolveReadme(successfulFile("README.md", "late stale result"));
    await waitFor(() => expect(screen.queryByText("late stale result")).not.toBeInTheDocument());

    fireEvent.click(screen.getByTitle("broken.ts"));
    expect(await screen.findByText("暂时无法读取文件内容，请重试。")).toBeVisible();
  });

  it("reloads the tree and ignores late content from the previous workspace revision", async () => {
    const oldContent = deferred<ReturnType<typeof successfulFile>>();
    const files = {
      available: true as const,
      files: [{ path: "src/app.ts", additions: null, deletions: null, changed: false }],
      reason: null,
      workspaceMode: "worktree" as const,
    };
    const loadFiles = vi.fn()
      .mockResolvedValueOnce(files)
      .mockResolvedValueOnce(files);
    const loadFile = vi.fn()
      .mockImplementationOnce(() => oldContent.promise)
      .mockResolvedValue(successfulFile("src/app.ts", "new workspace"));
    const rendered = render(
      <ProjectFilesTab
        sessionId="session-a"
        workspaceMode="worktree"
        workspaceRevision={1}
        loadFiles={loadFiles}
        loadFile={loadFile}
      />,
    );

    expect(await screen.findByTitle("src/app.ts")).toBeVisible();
    await waitFor(() => expect(loadFile).toHaveBeenCalledTimes(1));

    rendered.rerender(
      <ProjectFilesTab
        sessionId="session-a"
        workspaceMode="worktree"
        workspaceRevision={2}
        loadFiles={loadFiles}
        loadFile={loadFile}
      />,
    );

    expect(await screen.findByText("new workspace")).toBeVisible();
    expect(loadFiles).toHaveBeenCalledTimes(2);
    oldContent.resolve(successfulFile("src/app.ts", "old workspace"));
    await waitFor(() => expect(screen.queryByText("old workspace")).not.toBeInTheDocument());
  });

  it("restores a mode persisted by the containing project-files tab", async () => {
    const onModeChange = vi.fn();
    render(
      <ProjectFilesTab
        sessionId="session-a"
        workspaceMode="direct"
        loadFiles={vi.fn().mockResolvedValue({
          available: true,
          files: [{ path: "README.md", additions: null, deletions: null, changed: false }],
          reason: null,
          workspaceMode: "direct",
        })}
        loadFile={vi.fn().mockResolvedValue(successfulFile("README.md", "# Restored"))}
        rememberedModes={{ "README.md": "source" }}
        onModeChange={onModeChange}
      />,
    );

    expect(await screen.findByTestId("file-source-scroll")).toHaveTextContent("# Restored");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(onModeChange).toHaveBeenCalledWith("README.md", "preview");
  });
});

function successfulFile(path: string, text: string) {
  return {
    available: true as const,
    path,
    text,
    lines: [{ kind: "unchanged" as const, oldLineNumber: 1, newLineNumber: 1, text }],
    reason: null,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
