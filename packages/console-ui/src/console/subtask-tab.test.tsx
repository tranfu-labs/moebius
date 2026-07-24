import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { OperatorMessage, OperatorRunSnapshot, OperatorSession } from "./operator-console";
import { SubtaskTab } from "./subtask-tab";

describe("SubtaskTab", () => {
  it("renders the child summary and conversation while keeping file and management actions out", () => {
    renderTab();

    expect(screen.getByRole("heading", { name: "空状态验收" })).toBeVisible();
    expect(screen.getAllByText("测试").length).toBeGreaterThan(0);
    expect(screen.getByText("没跑起来")).toBeVisible();
    expect(screen.getByText("正在核对空状态的验收语句…")).toBeVisible();
    expect(screen.getByText("关闭标签只会关闭这个视图，不会取消子任务。")).toBeVisible();
    expect(screen.queryByText(/改动视图|文件树|行级对比|新建子任务|重命名|删除子任务|提交|推送|切分支/u))
      .not.toBeInTheDocument();
  });

  it("uses the shared composer for mention, send, retry, and stop actions", async () => {
    const onComposerChange = vi.fn();
    const onSend = vi.fn();
    const onRetry = vi.fn();
    const onInterrupt = vi.fn();
    const { rerender } = renderTab({
      composerValue: "@",
      onComposerChange,
      onSend,
      onRetry,
      onInterrupt,
    });

    const input = screen.getByRole("textbox", { name: "消息内容" }) as HTMLTextAreaElement;
    expect(input.closest("div.relative.w-full")).toHaveClass("max-w-[720px]");
    await act(async () => {
      input.setSelectionRange(1, 1);
      fireEvent.select(input);
      fireEvent.focus(input);
    });
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("option", { name: /开发/u }));
    });
    expect(onComposerChange).toHaveBeenCalledWith("@dev ");

    rerender(tab({
      composerValue: "@dev 请继续",
      onComposerChange,
      onSend,
      onRetry,
      onInterrupt,
    }));
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(onSend).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledWith("run-1");

    rerender(tab({
      state: {
        status: "ready",
        view: {
          session,
          messages,
          activeRun,
        },
      },
      composerValue: "",
      onComposerChange,
      onSend,
      onRetry,
      onInterrupt,
    }));
    fireEvent.click(screen.getByRole("button", { name: "停下当前这一步" }));
    expect(onInterrupt).toHaveBeenCalledWith("child-a", "run-active");
  });

  it("opens complete output with the child session for historical and active Agent runs", () => {
    const onOpenOutput = vi.fn();
    const { rerender } = renderTab({ onOpenOutput });
    const historicalEntry = screen.getByText("正在核对空状态的验收语句…").closest("article");
    if (historicalEntry === null) {
      throw new Error("historical Agent entry missing");
    }
    fireEvent.click(within(historicalEntry).getByRole("button", { name: "完整输出" }));
    expect(onOpenOutput).toHaveBeenLastCalledWith({
      sessionId: "child-a",
      runId: "run-1",
      role: "qa",
      fallbackOutput: "正在核对空状态的验收语句…",
    });

    rerender(tab({
      state: {
        status: "ready",
        view: {
          session,
          messages,
          activeRun,
        },
      },
      onOpenOutput,
    }));
    fireEvent.click(within(screen.getByTestId("subtask-active-run")).getByRole("button", {
      name: "完整输出",
    }));
    expect(onOpenOutput).toHaveBeenLastCalledWith({
      sessionId: "child-a",
      runId: "run-active",
      role: "qa",
      fallbackOutput: "running",
    });
  });
});

function renderTab(overrides: Partial<Parameters<typeof SubtaskTab>[0]> = {}) {
  return render(tab(overrides));
}

function tab(overrides: Partial<Parameters<typeof SubtaskTab>[0]> = {}) {
  return (
    <SubtaskTab
      sessionId="child-a"
      summary={{
        sessionId: "child-a",
        title: "空状态验收",
        memberName: "测试",
        status: "not-started",
        statusLabel: "没跑起来",
      }}
      state={{
        status: "ready",
        view: {
          session,
          messages,
          activeRun: null,
        },
      }}
      composerValue=""
      roles={[{ handle: "dev", label: "开发", description: "实现代码" }]}
      onComposerChange={vi.fn()}
      onSend={vi.fn()}
      onRetry={vi.fn()}
      onInterrupt={vi.fn()}
      {...overrides}
    />
  );
}

const session: OperatorSession = {
  sessionId: "child-a",
  projectId: "local",
  parentSessionId: "parent-a",
  workspaceMode: "worktree",
  workspacePendingMode: null,
  title: "空状态验收",
  status: "failed",
  awaitsHumanReason: "exception",
  unreadSince: null,
  runningCount: 0,
  waitingCount: 0,
  stuckCount: 0,
  errorCount: 1,
  interruptedCount: 0,
  createdAt: "2026-07-23T00:00:00.000Z",
  updatedAt: "2026-07-23T00:00:01.000Z",
};

const messages: OperatorMessage[] = [
  {
    id: 1,
    sessionId: "child-a",
    speaker: "agent",
    role: "qa",
    body: "正在核对空状态的验收语句…",
    status: "completed",
    runId: "run-1",
    runDir: null,
    error: null,
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z",
  },
  {
    id: 2,
    sessionId: "child-a",
    speaker: "system",
    role: "qa",
    body: "退出码 1",
    status: "failed",
    runId: "run-1",
    runDir: null,
    error: "退出码 1",
    systemEventKind: "run-not-started",
    createdAt: "2026-07-23T00:00:01.000Z",
    updatedAt: "2026-07-23T00:00:01.000Z",
  },
];

const activeRun: OperatorRunSnapshot = {
  sessionId: "child-a",
  runId: "run-active",
  role: "qa",
  status: "running",
  startedAt: "2026-07-23T00:00:00.000Z",
  elapsedMs: 1_000,
  runDir: null,
  cwd: null,
  workspaceMode: "worktree",
  worktreeUnavailableReason: null,
  stdoutTail: "running",
  stderrTail: null,
  liveMarkdown: "正在继续核对…",
  lastOutputSummary: "正在继续核对…",
  tailDiagnostic: null,
  interruptible: true,
};
