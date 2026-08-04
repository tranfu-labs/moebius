import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FileReferenceTab, type FileReferenceContent } from "./file-reference-tab";
import { parseFileReferenceSourceKey } from "./right-sidebar-tabs";
import { I18nProvider } from "../i18n";

describe("FileReferenceTab", () => {
  it("opens a bare workspace Markdown path in Preview and can switch to source", async () => {
    const onModeChange = vi.fn();
    render(
      <FileReferenceTab
        sessionId="session-a"
        filePath="/workspace/README.md"
        line={1}
        column={null}
        hasExplicitLine={false}
        loadReference={vi.fn().mockResolvedValue(workspaceMarkdown())}
        onModeChange={onModeChange}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Project" })).toBeVisible();
    expect(screen.getByTestId("file-reference-tab")).toHaveAttribute("data-file-scope", "workspace-file");
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "源码" }));
    expect(screen.getByTestId("file-source-scroll")).toHaveTextContent("# Project");
    expect(onModeChange).toHaveBeenCalledWith("source");
  });

  it("opens an explicit Markdown location in source before allowing Preview", async () => {
    render(
      <FileReferenceTab
        sessionId="session-a"
        filePath="/workspace/README.md"
        line={2}
        column={null}
        hasExplicitLine
        loadReference={vi.fn().mockResolvedValue(workspaceMarkdown())}
      />,
    );

    expect(await screen.findByTestId("file-source-target-line")).toHaveTextContent("Details");
    expect(screen.getByRole("button", { name: "源码" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByRole("heading", { name: "Project" })).toBeVisible();
  });

  it("loads the requested line window and highlights the real target line", async () => {
    const load = vi.fn().mockResolvedValue({
      available: true,
      scope: "external-preview",
      isComplete: false,
      path: "/Users/wing/.codex/sessions/day/rollout.jsonl",
      reason: null,
      targetLine: 292,
      targetColumn: 7,
      truncatedBefore: true,
      truncatedAfter: true,
      lines: [
        { lineNumber: 291, text: "before" },
        { lineNumber: 292, text: "target" },
        { lineNumber: 293, text: "after" },
      ],
      relativePath: null,
      text: null,
    });

    render(
      <FileReferenceTab
        sessionId="session-a"
        filePath="/Users/wing/.codex/sessions/day/rollout.jsonl"
        line={292}
        column={7}
        hasExplicitLine
        loadReference={load}
      />,
    );

    await waitFor(() => expect(load).toHaveBeenCalledWith(
      "session-a",
      "/Users/wing/.codex/sessions/day/rollout.jsonl",
      292,
      7,
      true,
    ));
    const targetLine = await screen.findByTestId("file-source-target-line");
    expect(targetLine).toHaveTextContent("292");
    expect(targetLine).toHaveTextContent("target");
    expect(screen.getByText("目标位置：第 292 行，第 7 列")).toBeVisible();
    expect(screen.getByTestId("file-reference-path")).toHaveTextContent("/Users/wing/.codex/sessions");
    expect(screen.getByTestId("external-file-preview-label")).toHaveTextContent("预览 · 工作空间外文件");
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
  });

  it.each([
    ["line-too-large", "目标附近存在过长单行，无法安全显示。"],
    ["response-too-large", "目标附近内容超过本次安全显示范围。"],
  ] as const)("explains bounded-response failures: %s", async (reason, copy) => {
    render(
      <FileReferenceTab
        sessionId="session-a"
        filePath="/workspace/large.txt"
        line={1}
        column={null}
        hasExplicitLine
        loadReference={vi.fn().mockResolvedValue({
          available: false,
          scope: "external-preview",
          isComplete: null,
          path: "/workspace/large.txt",
          lines: [],
          reason,
          targetLine: 1,
          targetColumn: null,
          relativePath: null,
          text: null,
        })}
      />,
    );

    expect(await screen.findByText(copy)).toBeVisible();
    expect(screen.getByTestId("file-reference-tab")).toHaveAttribute("data-file-scope", "external-preview");
    expect(screen.getByTestId("external-file-preview-label")).toHaveTextContent("预览 · 工作空间外文件");
    expect(screen.getByText("仅显示目标行附近内容")).toBeVisible();
  });

  it("renders labels and bounded errors from the English resource", async () => {
    render(
      <I18nProvider locale="en">
        <FileReferenceTab
          sessionId="session-a"
          filePath="/workspace/large.txt"
          line={4}
          column={2}
          hasExplicitLine
          loadReference={vi.fn().mockResolvedValue({
            available: false,
            scope: "external-preview",
            isComplete: null,
            path: "/workspace/large.txt",
            lines: [],
            reason: "line-too-large",
            targetLine: 4,
            targetColumn: 2,
            relativePath: null,
            text: null,
          })}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("region", { name: "File reference details" })).toBeVisible();
    expect(screen.getByText("Target: line 4, column 2")).toBeVisible();
    expect(await screen.findByText("A line near the target is too long to display safely.")).toBeVisible();
  });

  it("restores legacy explicit Markdown and source locations before rendering", async () => {
    const markdownLocator = parseFileReferenceSourceKey(
      "file-reference-v1:session-a:%2Fworkspace%2FREADME.md:42:",
    );
    expect(markdownLocator).not.toBeNull();
    const markdown = render(
      <FileReferenceTab
        sessionId={markdownLocator!.sessionId}
        filePath={markdownLocator!.path}
        line={markdownLocator!.line}
        column={markdownLocator!.column}
        hasExplicitLine={markdownLocator!.hasExplicitLine}
        loadReference={vi.fn().mockResolvedValue(workspaceText(markdownLocator!.path, 42))}
      />,
    );
    expect(await screen.findByTestId("file-source-target-line")).toHaveTextContent("line 42");
    expect(screen.getByRole("button", { name: "源码" })).toHaveAttribute("aria-pressed", "true");
    markdown.unmount();

    const sourceLocator = parseFileReferenceSourceKey(
      "file-reference-v1:session-a:%2Fworkspace%2Fsrc%2Fapp.ts:42:",
    );
    expect(sourceLocator).not.toBeNull();
    render(
      <FileReferenceTab
        sessionId={sourceLocator!.sessionId}
        filePath={sourceLocator!.path}
        line={sourceLocator!.line}
        column={sourceLocator!.column}
        hasExplicitLine={sourceLocator!.hasExplicitLine}
        loadReference={vi.fn().mockResolvedValue(workspaceText(sourceLocator!.path, 42))}
      />,
    );
    expect(await screen.findByTestId("file-source-target-line")).toHaveTextContent("line 42");
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
  });

  it("uses the latest callback after parent rerenders without restarting an active read", async () => {
    let resolveInitial!: (value: ReturnType<typeof workspaceMarkdown>) => void;
    const initialRead = new Promise<ReturnType<typeof workspaceMarkdown>>((resolve) => {
      resolveInitial = resolve;
    });
    const first = vi.fn(() => initialRead);
    const latest = vi.fn().mockResolvedValue(workspaceMarkdown());
    const rendered = render(
      <FileReferenceTab
        sessionId="session-a"
        filePath="/workspace/README.md"
        line={1}
        column={null}
        hasExplicitLine={false}
        loadReference={first}
      />,
    );
    rendered.rerender(
      <FileReferenceTab
        sessionId="session-a"
        filePath="/workspace/README.md"
        line={1}
        column={null}
        hasExplicitLine={false}
        loadReference={latest}
      />,
    );
    expect(first).toHaveBeenCalledTimes(1);
    expect(latest).not.toHaveBeenCalled();
    resolveInitial(workspaceMarkdown());
    expect(await screen.findByRole("heading", { name: "Project" })).toBeVisible();
  });

  it.each(["success", "failure"] as const)(
    "ignores an old %s after the parent switches both session and file",
    async (oldOutcome) => {
      const oldRead = deferred<FileReferenceContent>();
      const currentRead = deferred<FileReferenceContent>();
      const loadReference = vi.fn((sessionId: string) =>
        sessionId === "session-a" ? oldRead.promise : currentRead.promise);
      const rendered = render(
        <FileReferenceTab
          sessionId="session-a"
          filePath="/workspace/old.txt"
          line={1}
          column={null}
          hasExplicitLine={false}
          loadReference={loadReference}
        />,
      );
      rendered.rerender(
        <FileReferenceTab
          sessionId="session-b"
          filePath="/workspace/current.txt"
          line={2}
          column={null}
          hasExplicitLine
          loadReference={loadReference}
        />,
      );
      currentRead.resolve(workspaceText("/workspace/current.txt", 2));
      expect(await screen.findByText("line 2 target")).toBeVisible();
      if (oldOutcome === "success") {
        oldRead.resolve(workspaceText("/workspace/old.txt", 1));
      } else {
        oldRead.reject(new Error("old read failed"));
      }

      await waitFor(() => {
        expect(screen.getByText("line 2 target")).toBeVisible();
        expect(screen.queryByText("line 1 target")).not.toBeInTheDocument();
        expect(screen.queryByText("暂时无法读取这个文件，请重试。")).not.toBeInTheDocument();
      });
    },
  );
});

function workspaceMarkdown() {
  return {
    available: true as const,
    scope: "workspace-file" as const,
    isComplete: true as const,
    path: "/workspace/README.md",
    lines: [
      { lineNumber: 1, text: "# Project" },
      { lineNumber: 2, text: "Details" },
    ],
    reason: null,
    targetLine: 2,
    targetColumn: null,
    truncatedBefore: false,
    truncatedAfter: false,
    relativePath: "README.md",
    text: "# Project\nDetails",
  };
}

function workspaceText(filePath: string, targetLine: number): FileReferenceContent {
  const lines = Array.from({ length: 50 }, (_, index) => ({
    lineNumber: index + 1,
    text: index + 1 === targetLine ? `line ${String(targetLine)} target` : `line ${String(index + 1)}`,
  }));
  return {
    available: true,
    scope: "workspace-file",
    isComplete: true,
    path: filePath,
    lines,
    reason: null,
    targetLine,
    targetColumn: null,
    truncatedBefore: false,
    truncatedAfter: false,
    relativePath: filePath.replace("/workspace/", ""),
    text: lines.map((line) => line.text).join("\n"),
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}
