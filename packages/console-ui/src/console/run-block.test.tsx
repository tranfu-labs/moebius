import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RunBlock, type RunBlockStep } from "./run-block";

const steps: RunBlockStep[] = [
  {
    id: "bridge",
    title: "写消息组件",
    status: "completed",
    summary: "组件文件已生成",
    rawOutput: "completed raw output",
  },
  {
    id: "test",
    title: "运行测试",
    status: "running",
    summary: "正在运行组件测试",
    rawOutput: "RUNS console-ui\nexit:42 should stay hidden",
  },
  {
    id: "review",
    title: "自测走查",
    status: "pending",
  },
];

describe("RunBlock", () => {
  it("shows a labeled duration and live human-readable work without an unbound stop control", () => {
    const { container } = render(<RunBlock role="dev" elapsedTime="3分12秒" steps={steps} />);

    expect(container.firstElementChild).toHaveClass("max-w-[680px]");
    expect(screen.getByText("开发")).toBeVisible();
    expect(screen.getByText("已进行 3分12秒")).toBeVisible();
    expect(screen.queryByRole("button", { name: /停下/u })).not.toBeInTheDocument();
    expect(screen.queryByText("已完成")).not.toBeInTheDocument();
    expect(screen.queryByText("进行中")).not.toBeInTheDocument();
    expect(screen.queryByText("未开始")).not.toBeInTheDocument();
    expect(screen.getByText("运行测试")).toBeVisible();

    expect(screen.queryByText(/exit:42 should stay hidden/u)).not.toBeInTheDocument();
  });

  it("uses 24px identity and 32px indentation only in the main conversation variant", () => {
    const { rerender } = render(<RunBlock role="dev" summary="主会话活动" variant="main" />);

    expect(screen.getByText("开发").previousElementSibling).toHaveClass("h-6", "w-6");
    expect(screen.getByTestId("run-live-output")).toHaveClass("pl-8");

    rerender(<RunBlock role="dev" summary="右侧活动" />);
    expect(screen.getByText("开发").previousElementSibling).toHaveClass("h-5", "w-5");
    expect(screen.getByTestId("run-live-output")).toHaveClass("pl-7");
  });

  it("places the open process trail between the role row and current output", () => {
    render(
      <RunBlock
        role="dev"
        activity={{ action: "正在运行命令", object: "pnpm test" }}
        processSteps={[{
          id: "command",
          kind: "command",
          title: "运行测试",
          status: "running",
          input: "pnpm test",
          output: null,
        }]}
      />,
    );

    const activity = screen.getByTestId("run-activity");
    const step = screen.getByRole("button", { name: "展开步骤：运行测试" });
    const role = screen.getByText("开发");
    expect(role.compareDocumentPosition(step) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(step.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: /思考与工具调用/u })).not.toBeInTheDocument();
  });

  it("degrades to a single useful line when no step data exists", () => {
    render(
      <RunBlock
        role="qa"
        elapsedTime="12秒"
        summary="正在整理测试设计"
        rawOutput="idle-timeout raw detail"
        steps={[]}
      />,
    );

    expect(screen.getByText("测试")).toBeVisible();
    expect(screen.queryByText("12秒")).not.toBeInTheDocument();
    expect(screen.getByText("正在整理测试设计")).toBeVisible();
    expect(screen.queryByRole("button", { name: /停下/u })).not.toBeInTheDocument();
    expect(screen.queryByText("idle-timeout raw detail")).not.toBeInTheDocument();
    expect(screen.getByTestId("run-live-output")).toHaveClass("max-w-full", "overflow-x-auto");
  });

  it("uses deterministic fallbacks when steps, summary, and elapsed time are missing or blank", () => {
    render(<RunBlock role="dev" elapsedTime="   " summary="" steps={null} />);

    expect(screen.queryByText("耗时未知")).not.toBeInTheDocument();
    expect(screen.getByText("正在推进这一步…")).toBeVisible();
  });

  it("keeps top-level machine output out of the conversation surface", () => {
    const specialRaw = "first line\n<node attr=\"x\"> & exit:42";
    const onOpenOutput = vi.fn();
    render(
      <RunBlock
        role="dev"
        elapsedTime="3秒"
        summary="正在运行测试"
        rawOutput={specialRaw}
        onOpenOutput={onOpenOutput}
      />,
    );

    expect(screen.queryByText(specialRaw)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "完整输出" }));
    expect(onOpenOutput).toHaveBeenCalledWith(specialRaw);
    expect(screen.getByText("已进行 3秒")).toBeVisible();
    expect(screen.queryByText(/runDir|sessionId/u)).not.toBeInTheDocument();
  });

  it("replaces live Markdown inside the same run node", async () => {
    const { rerender } = render(
      <RunBlock role="dev" liveMarkdown={"## 第一段\n\n正在检查。"} />,
    );
    const liveNode = screen.getByTestId("run-live-output");
    expect(screen.getByRole("heading", { name: "第一段" })).toBeInTheDocument();

    rerender(<RunBlock role="dev" liveMarkdown={"## 第二段\n\n检查完成。"} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "第二段" })).toBeInTheDocument());
    expect(screen.getByTestId("run-live-output")).toBe(liveNode);
    expect(screen.queryByRole("heading", { name: "第一段" })).not.toBeInTheDocument();
    expect(screen.getAllByTestId("run-live-output")).toHaveLength(1);
  });

  it("keeps Streamdown Markdown and preserves machine details in live output", () => {
    render(
      <RunBlock
        role="dev"
        liveMarkdown={"## 检查结果\n\n正在读取 `/tmp/private-run`，runId=run-secret。"}
      />,
    );

    expect(screen.getByRole("heading", { name: "检查结果" })).toBeVisible();
    expect(screen.getByText("/tmp/private-run", { selector: "code" })).toBeVisible();
    expect(screen.getByText((_text, element) =>
      element?.tagName === "P"
      && element.textContent === "正在读取 /tmp/private-run，runId=run-secret。")).toBeVisible();
    expect(screen.queryByText(/路径已隐藏/u)).not.toBeInTheDocument();
  });

  it("uses the session member projection for custom roles and stop actions", () => {
    render(
      <RunBlock
        role="plan-executor"
        memberIdentities={[{ slug: "plan-executor", displayName: "方案执行者" }]}
        summary="正在落实方案"
        onInterrupt={vi.fn()}
      />,
    );

    expect(screen.getByText("方案执行者")).toBeVisible();
    expect(screen.getByRole("button", { name: "停下方案执行者" })).toBeVisible();
    expect(screen.queryByText("协作者")).not.toBeInTheDocument();
  });

  it("shows one structured activity with time and degrades Kimi complete output in place", () => {
    const onOpenOutput = vi.fn();
    render(
      <RunBlock
        role="dev"
        elapsedMs={84_000}
        activity={{ action: "正在运行命令", object: "pnpm test" }}
        processOutputAvailable={false}
        outputUnavailableMessage="完整输出不可用 · 当前执行引擎不提供可恢复的完整过程记录"
        onOpenOutput={onOpenOutput}
        onInterrupt={vi.fn()}
      />,
    );

    expect(screen.getByText("已进行 01:24")).toBeVisible();
    expect(screen.getByTestId("run-activity")).toHaveTextContent("正在运行命令·pnpm test");
    expect(screen.getByText(/当前执行引擎不提供可恢复/u)).toBeVisible();
    expect(screen.queryByRole("button", { name: "完整输出" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停下开发" })).toBeVisible();
  });

  it("opens the keyboard-accessible more menu and forwards the analysis entry", async () => {
    const onAnalyzeConversation = vi.fn();
    render(
      <RunBlock
        role="dev"
        summary="正在分析"
        onAnalyzeConversation={onAnalyzeConversation}
      />,
    );

    const runBlock = screen.getByTestId("run-live-output").parentElement!;
    fireEvent.contextMenu(runBlock);
    fireEvent.click(await screen.findByRole("menuitem", { name: "在右侧栏分析这条消息" }));
    expect(onAnalyzeConversation).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(runBlock).toHaveFocus());
  });
});
