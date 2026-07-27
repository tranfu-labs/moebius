import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";
import {
  TeamBuilderView,
  type TeamBuilderViewProps,
  type TeamBuilderViewState,
} from "./team-builder-view";

const proposal = {
  team: { name: "产品发布团队", purpose: "持续完成产品发布" },
  members: [
    {
      slug: "launch-lead",
      name: "发布负责人",
      role: "统筹发布并收尾",
      responsibilities: ["拆解", "复核"],
      handoffs: ["content-planner"],
    },
    {
      slug: "content-planner",
      name: "内容策划",
      role: "准备发布内容",
      responsibilities: ["写作"],
      handoffs: ["launch-lead"],
    },
  ],
  primaryAgentSlug: "launch-lead",
  relayBeats: [
    { speakerSlug: "launch-lead", message: "派工" },
    { speakerSlug: "content-planner", message: "交付" },
  ],
};

describe("TeamBuilderView", () => {
  it("matches the prototype's in-place designer shell and submits the long-term goal", async () => {
    const onSubmit = vi.fn(async () => undefined);
    renderView({
      state: state({
        phase: "idle",
        messages: [{
          role: "assistant",
          text: "你希望这支团队长期替你完成什么工作？\n\n先说目标就好，不需要想好角色和分工。",
        }],
      }),
      onSubmit,
      contextLabel: "仍在第 2 步",
    });

    expect(screen.getByRole("heading", { name: "AI 团队设计器" })).toBeInTheDocument();
    expect(screen.getByText("仍在第 2 步")).toBeInTheDocument();
    expect(screen.getByText("你希望这支团队长期替你完成什么工作？")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "描述团队目标或回答问题" }), {
      target: { value: "持续做产品发布" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("持续做产品发布"));
  });

  it("renders a typed proposal card and commits only its visible revision", () => {
    const onCommit = vi.fn();
    renderView({
      state: state({
        phase: "proposal",
        messages: [{ role: "assistant", text: "我整理了一版团队方案。" }],
        proposal,
        proposalRevision: 3,
      }),
      onCommit,
    });

    expect(screen.getByText("团队提案 · 2 名成员")).toBeInTheDocument();
    expect(screen.getAllByText("发布负责人")).toHaveLength(2);
    expect(screen.getByText("主 Agent")).toBeInTheDocument();
    expect(screen.getByText("@content-planner")).toBeInTheDocument();
    expect(screen.getByTestId("team-proposal")).toHaveClass("shrink-0");
    fireEvent.click(screen.getByRole("button", { name: "创建并选中" }));
    expect(onCommit).toHaveBeenCalledWith(3);
  });

  it("shows a submitted user message immediately and reconciles without duplication", async () => {
    let resolveSubmit: (() => void) | undefined;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    }));
    const initialState = state({
      phase: "idle",
      messages: [{ role: "assistant", text: "你希望这支团队长期替你完成什么工作？" }],
    });
    const { rerender, props } = renderView({ state: initialState, onSubmit });

    fireEvent.change(screen.getByRole("textbox", { name: "描述团队目标或回答问题" }), {
      target: { value: "持续做产品发布" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(screen.getByTestId("pending-team-builder-user-message")).toHaveTextContent(
      "持续做产品发布",
    );
    expect(screen.getByRole("status", { name: "AI 正在处理" })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeDisabled();

    rerender(
      <I18nProvider locale="zh-CN">
        <TeamBuilderView {...props} state={state({
          phase: "clarifying",
          messages: [
            ...initialState.messages,
            { role: "user", text: "持续做产品发布" },
            { role: "assistant", text: "主要面向谁？" },
          ],
        })} />
      </I18nProvider>,
    );

    expect(screen.queryByTestId("pending-team-builder-user-message")).not.toBeInTheDocument();
    expect(screen.getAllByText("持续做产品发布")).toHaveLength(1);
    resolveSubmit?.();
    await waitFor(() => expect(
      screen.queryByRole("status", { name: "AI 正在处理" }),
    ).not.toBeInTheDocument());
  });

  it("turns the proposal into a read-only snapshot while the user writes an adjustment", async () => {
    const onAdjust = vi.fn(async () => undefined);
    renderView({
      state: state({
        phase: "proposal",
        messages: [],
        proposal,
        proposalRevision: 2,
      }),
      onAdjust,
    });

    fireEvent.click(screen.getByRole("button", { name: "继续聊着调整" }));
    expect(screen.queryByRole("button", { name: "创建并选中" })).not.toBeInTheDocument();
    const composer = screen.getByRole("textbox", { name: "调整团队提案" });
    fireEvent.change(composer, { target: { value: "负责人最后给我发布清单" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(onAdjust).toHaveBeenCalledWith("负责人最后给我发布清单"));
  });

  it("locks input during a run and exposes a visible retry action after failure", () => {
    const { rerender, props } = renderView({
      state: state({ phase: "running", messages: [], proposal, proposalRevision: 1 }),
    });
    expect(screen.getByRole("status", { name: "AI 正在处理" })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "创建并选中" })).not.toBeInTheDocument();

    rerender(
      <I18nProvider locale="zh-CN">
        <TeamBuilderView {...props} state={state({
          phase: "failed",
          messages: [],
          proposal,
          proposalRevision: 1,
          error: {
            code: "invalid-response",
            humanMessage: "AI 返回的团队方案不完整，请重试这一轮。",
            canRetry: true,
          },
        })} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps the create action visible as a single disabled progress state while committing", () => {
    renderView({
      state: state({
        phase: "committing",
        messages: [],
        proposal,
        proposalRevision: 4,
      }),
    });

    expect(screen.getByRole("button", { name: "正在创建…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "继续聊着调整" })).toBeDisabled();
  });

  it("uses the dedicated back action without clearing the displayed draft", () => {
    const onBack = vi.fn();
    renderView({
      state: state({
        phase: "clarifying",
        messages: [
          { role: "user", text: "持续做产品发布" },
          { role: "assistant", text: "主要面向谁？" },
        ],
      }),
      onBack,
    });

    fireEvent.click(screen.getByRole("button", { name: "返回选团队" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByText("持续做产品发布")).toBeInTheDocument();
    expect(screen.getByText("主要面向谁？")).toBeInTheDocument();
  });

  it("renders English interface copy without translating generated team content", () => {
    render(
      <I18nProvider locale="en">
        <TeamBuilderView
          state={state({
            phase: "proposal",
            messages: [{ role: "assistant", text: "我整理了一版团队方案。" }],
            proposal,
            proposalRevision: 3,
          })}
          onBack={vi.fn()}
          onSubmit={vi.fn()}
          onAdjust={vi.fn()}
          onRetry={vi.fn()}
          onCommit={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("heading", { name: "AI Team Designer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create and select" })).toBeInTheDocument();
    expect(screen.getByText("我整理了一版团队方案。")).toBeInTheDocument();
    expect(screen.getAllByText("发布负责人")).toHaveLength(2);
  });
});

function state(overrides: Partial<TeamBuilderViewState>): TeamBuilderViewState {
  return {
    phase: "idle",
    messages: [],
    proposal: null,
    proposalRevision: null,
    error: null,
    ...overrides,
  };
}

function renderView(overrides: Partial<TeamBuilderViewProps>) {
  const props: TeamBuilderViewProps = {
    state: state({}),
    onBack: vi.fn(),
    onSubmit: vi.fn(),
    onAdjust: vi.fn(),
    onRetry: vi.fn(),
    onCommit: vi.fn(),
    ...overrides,
  };
  return {
    ...render(
      <I18nProvider locale="zh-CN">
        <TeamBuilderView {...props} />
      </I18nProvider>,
    ),
    props,
  };
}
