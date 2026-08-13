import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChangeTab, type WorkspaceDiffData } from "./change-tab";
import type { WorkspaceFileContent } from "./file-diff-view";

describe("ChangeTab", () => {
  it("uses distinct copy for not started, loading, and completed-without-changes states", async () => {
    const pending = deferred<WorkspaceDiffData>();
    const { rerender } = render(
      <ChangeTab
        sessionId="session-a"
        workspaceMode="direct"
        conversationStarted={false}
        isWorking={false}
        loadDiff={() => pending.promise}
        loadFile={unavailableFile}
      />,
    );
    expect(screen.getByText("这段对话还没有开始，团队尚未工作。")).toBeVisible();

    rerender(
      <ChangeTab
        sessionId="session-b"
        workspaceMode="direct"
        conversationStarted
        isWorking={false}
        loadDiff={() => pending.promise}
        loadFile={unavailableFile}
      />,
    );
    expect(screen.getByText("正在读取这段对话期间的项目改动…")).toBeVisible();

    pending.resolve({
      available: true,
      fileCount: 0,
      files: [],
      reason: null,
      workspaceMode: "direct",
    });
    expect(await screen.findByText("这段对话期间，项目文件没有发生变化。")).toBeVisible();
  });

  it("keeps the selected file and reading position until the user accepts a refreshed change", async () => {
    const initialDiff = availableDiff(1);
    const refreshedDiff = availableDiff(2);
    const loadDiff = vi.fn()
      .mockResolvedValueOnce(initialDiff)
      .mockResolvedValueOnce(refreshedDiff);
    const loadFile = vi.fn()
      .mockResolvedValueOnce(fileContent("old content"))
      .mockResolvedValueOnce(fileContent("new content"));

    render(
      <ChangeTab
        sessionId="session-a"
        workspaceMode="worktree"
        conversationStarted
        isWorking
        loadDiff={loadDiff}
        loadFile={loadFile}
      />,
    );

    const tab = await screen.findByTestId("change-tab");
    expect(await within(tab).findByText("old content")).toBeVisible();
    expect(within(tab).getByText("团队正在工作，这份列表截至上一轮结束。")).toBeVisible();
    const contentScroll = within(tab).getByTestId("file-diff-scroll");
    contentScroll.scrollTop = 140;
    fireEvent.scroll(contentScroll);

    fireEvent.click(within(tab).getByRole("button", { name: "刷新" }));
    expect(await within(tab).findByRole("button", { name: "有新改动，点击后查看" })).toBeVisible();
    expect(within(tab).getByText("old content")).toBeVisible();
    expect(contentScroll.scrollTop).toBe(140);
    expect(within(tab).getByTitle("src/app.ts")).toHaveAttribute("aria-selected", "true");

    fireEvent.click(within(tab).getByRole("button", { name: "有新改动，点击后查看" }));
    expect(await within(tab).findByText("new content")).toBeVisible();
    await waitFor(() => expect(contentScroll.scrollTop).toBe(140));
    expect(within(tab).getByTitle("src/app.ts")).toHaveAttribute("aria-selected", "true");
  });

  it("shows line kinds, sticky numbers, long-line scrolling, and selectable read-only content", async () => {
    render(
      <ChangeTab
        sessionId="session-a"
        workspaceMode="direct"
        conversationStarted
        isWorking={false}
        loadDiff={async () => availableDiff(1)}
        loadFile={async () => ({
          available: true,
          path: "src/app.ts",
          lines: [
            { kind: "unchanged", oldLineNumber: 1, newLineNumber: 1, text: "context" },
            { kind: "deletion", oldLineNumber: 2, newLineNumber: null, text: "removed" },
            { kind: "addition", oldLineNumber: null, newLineNumber: 2, text: "x".repeat(240) },
          ],
          reason: null,
        })}
      />,
    );

    const scroll = await screen.findByTestId("file-diff-scroll");
    expect(scroll).toHaveClass("overflow-auto", "select-text");
    expect(scroll.querySelectorAll('[data-line-kind="unchanged"]')).toHaveLength(1);
    expect(scroll.querySelectorAll('[data-line-kind="deletion"]')).toHaveLength(1);
    expect(scroll.querySelectorAll('[data-line-kind="addition"]')).toHaveLength(1);
    expect(scroll.querySelector(".sticky.left-0")).not.toBeNull();
    expect(screen.getByText("x".repeat(240))).toHaveClass("whitespace-pre");
    expect(screen.queryByRole("button", { name: /编辑|保存|撤销|还原|提交|推送/u })).not.toBeInTheDocument();
  });

  it("keeps focused file and folder names at the primary foreground level", async () => {
    render(
      <ChangeTab
        appearance="focused"
        sessionId="session-a"
        workspaceMode="worktree"
        conversationStarted
        isWorking={false}
        loadDiff={async () => availableDiff(1)}
        loadFile={async () => fileContent("content")}
      />,
    );

    const file = await screen.findByTitle("src/app.ts");
    const folder = screen.getByText("src").parentElement;
    expect(file).toHaveClass("text-ink");
    expect(file).not.toHaveClass("text-sub");
    expect(folder).toHaveClass("text-ink");
  });
});

function availableDiff(additions: number): WorkspaceDiffData {
  return {
    available: true,
    fileCount: 1,
    files: [{ path: "src/app.ts", additions, deletions: 0 }],
    reason: null,
    workspaceMode: "worktree",
  };
}

function fileContent(text: string): WorkspaceFileContent {
  return {
    available: true,
    path: "src/app.ts",
    lines: [{ kind: "unchanged", oldLineNumber: 1, newLineNumber: 1, text }],
    reason: null,
  };
}

async function unavailableFile(_sessionId: string, filePath: string): Promise<WorkspaceFileContent> {
  return {
    available: false,
    path: filePath,
    lines: [],
    reason: "workspace-unavailable",
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
