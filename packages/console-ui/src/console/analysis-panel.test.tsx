import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AnalysisPanel, type AnalysisPanelEntry } from "./analysis-panel";

const entry: AnalysisPanelEntry = {
  sessionId: "analysis-1",
  title: "分析 Agent 运行耗时",
};

describe("AnalysisPanel", () => {
  it("renders only direct conversation entry triggers", () => {
    const onOpenEntry = vi.fn();
    render(
      <AnalysisPanel
        layout="split"
        state={{ status: "ready", entries: [entry] }}
        onOpenEntry={onOpenEntry}
      />,
    );

    expect(screen.getByTestId("analysis-panel")).toHaveAttribute("data-layout", "split");
    expect(screen.getByRole("button", { name: entry.title })).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/运行中|团队|模型/u)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: entry.title }));
    expect(onOpenEntry).toHaveBeenCalledWith(entry);
  });

  it("provides deterministic empty, loading, failure, and overlay states", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <AnalysisPanel
        layout="overlay"
        state={{ status: "ready", entries: [] }}
        onOpenEntry={() => undefined}
      />,
    );
    expect(screen.getByTestId("analysis-panel")).toHaveAttribute("data-layout", "overlay");
    expect(screen.getByText("还没有分析对话")).toBeVisible();

    rerender(
      <AnalysisPanel
        layout="overlay"
        state={{ status: "loading" }}
        onOpenEntry={() => undefined}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("正在读取分析对话");

    rerender(
      <AnalysisPanel
        layout="overlay"
        state={{ status: "failed" }}
        onOpenEntry={() => undefined}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("暂时无法读取分析对话");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps duplicate titles distinguishable without exposing identifiers", () => {
    render(
      <AnalysisPanel
        layout="split"
        state={{
          status: "ready",
          entries: [
            {
              ...entry,
              createdLabel: "2026-07-30 14:05:12",
              duplicateLabel: "同名项 A",
            },
            {
              ...entry,
              sessionId: "analysis-2",
              createdLabel: "2026-07-30 14:05:12",
              duplicateLabel: "同名项 B",
            },
          ],
        }}
        onOpenEntry={() => undefined}
      />,
    );

    expect(screen.getByRole("button", {
      name: "分析 Agent 运行耗时，2026-07-30 14:05:12 · 同名项 A",
    })).toBeVisible();
    expect(screen.getByRole("button", {
      name: "分析 Agent 运行耗时，2026-07-30 14:05:12 · 同名项 B",
    })).toBeVisible();
    expect(screen.queryByText("analysis-2")).not.toBeInTheDocument();
  });
});
