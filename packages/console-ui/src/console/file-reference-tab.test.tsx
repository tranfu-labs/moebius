import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FileReferenceTab } from "./file-reference-tab";
import { I18nProvider } from "../i18n";

describe("FileReferenceTab", () => {
  it("loads the requested line window and highlights the real target line", async () => {
    const load = vi.fn().mockResolvedValue({
      available: true,
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
    });

    render(
      <FileReferenceTab
        sessionId="session-a"
        filePath="/Users/wing/.codex/sessions/day/rollout.jsonl"
        line={292}
        column={7}
        loadReference={load}
      />,
    );

    await waitFor(() => expect(load).toHaveBeenCalledWith(
      "session-a",
      "/Users/wing/.codex/sessions/day/rollout.jsonl",
      292,
      7,
    ));
    const targetLine = await screen.findByTestId("file-reference-target-line");
    expect(targetLine).toHaveTextContent("292");
    expect(targetLine).toHaveTextContent("target");
    expect(screen.getByText("目标位置：第 292 行，第 7 列")).toBeVisible();
    expect(screen.getByTestId("file-reference-path")).toHaveTextContent("/Users/wing/.codex/sessions");
  });

  it("shows an explicit boundary message for an untrusted target", async () => {
    render(
      <FileReferenceTab
        sessionId="session-a"
        filePath="/etc/passwd"
        line={1}
        column={null}
        loadReference={vi.fn().mockResolvedValue({
          available: false,
          path: "/etc/passwd",
          lines: [],
          reason: "outside-trusted-roots",
          targetLine: 1,
          targetColumn: null,
        })}
      />,
    );

    expect(await screen.findByText("这个文件不在当前会话允许读取的位置。")).toBeVisible();
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
        loadReference={vi.fn().mockResolvedValue({
          available: false,
          path: "/workspace/large.txt",
          lines: [],
          reason,
          targetLine: 1,
          targetColumn: null,
        })}
      />,
    );

    expect(await screen.findByText(copy)).toBeVisible();
  });

  it("renders labels and bounded errors from the English resource", async () => {
    render(
      <I18nProvider locale="en">
        <FileReferenceTab
          sessionId="session-a"
          filePath="/workspace/large.txt"
          line={4}
          column={2}
          loadReference={vi.fn().mockResolvedValue({
            available: false,
            path: "/workspace/large.txt",
            lines: [],
            reason: "line-too-large",
            targetLine: 4,
            targetColumn: 2,
          })}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("region", { name: "File reference details" })).toBeVisible();
    expect(screen.getByText("Target: line 4, column 2")).toBeVisible();
    expect(await screen.findByText("A line near the target is too long to display safely.")).toBeVisible();
  });
});
