import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";

import { NewConversationPage, type NewConversationPageProps } from "./new-conversation-page";

describe("NewConversationPage", () => {
  it("aligns the new-conversation composer with the main conversation column", () => {
    renderPage();

    const column = screen.getByTestId("new-conversation-column");
    const title = screen.getByRole("heading", { name: "新对话" });

    expect(column).toHaveClass("w-full", "max-w-[760px]");
    expect(column).not.toHaveClass("max-w-[720px]");
    expect(column.parentElement).toHaveClass("px-8");
    expect(column.parentElement).not.toHaveClass("px-6");
    expect(title).toHaveClass("w-full", "max-w-[760px]");
  });

  it("keeps drafting and team selection usable while project-dependent context and send stay unavailable", () => {
    const onDraftChange = vi.fn();
    const onSelectTeam = vi.fn();
    renderPage({ selectedProjectId: null, onDraftChange, onSelectTeam });

    expect(screen.getByRole("heading", { name: "新对话" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "消息内容" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
    expect(screen.getByText("选择一个项目后才能发送")).toBeVisible();
    expect(screen.queryByText("默认工作空间")).not.toBeInTheDocument();
    expect(screen.queryByText("main")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "消息内容" }), { target: { value: "draft" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Agent 团队" }), { target: { value: "user:product" } });
    expect(onDraftChange).toHaveBeenCalledWith("draft");
    expect(onSelectTeam).toHaveBeenCalledWith("user:product");
  });

  it("keeps an unavailable selected project visible with a repair-or-change reason", async () => {
    const onSelectProject = vi.fn();
    renderPage({
      projects: [
        { ...projects[0]!, available: false },
        projects[1]!,
      ],
      selectedProjectId: "a",
      onSelectProject,
    });

    const projectButton = screen.getByRole("button", { name: "项目：moebius，点击切换" });
    expect(projectButton).toHaveAttribute("aria-invalid", "true");
    expect(projectButton).toHaveClass("text-danger");
    expect(screen.getByText("当前项目不可用，请修复项目目录或改选可用项目")).toBeVisible();
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "工作空间：默认工作空间，点击切换" })).toBeDisabled();

    fireEvent.keyDown(projectButton, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "marketing-site" }));
    expect(onSelectProject).toHaveBeenCalledWith("b");
  });

  it("lists projects and appends the add-project action after a separator", async () => {
    const onSelectProject = vi.fn();
    const onAddProject = vi.fn();
    renderPage({ onSelectProject, onAddProject });

    fireEvent.keyDown(screen.getByRole("button", { name: "项目：moebius，点击切换" }), { key: "ArrowDown" });
    const menu = await screen.findByRole("menu");
    expect(menu.querySelectorAll('[role="menuitemcheckbox"]')).toHaveLength(2);
    expect(menu.querySelector('[role="separator"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "添加项目…" }));
    expect(onAddProject).toHaveBeenCalledTimes(1);
  });

  it("completes mentions from the team displayed in the composer context", () => {
    renderPage({ selectedTeamKey: "user:product", draft: "@" });
    const input = screen.getByRole("textbox", { name: "消息内容" });
    const textInput = input as HTMLTextAreaElement;
    textInput.setSelectionRange(1, 1);
    fireEvent.focus(textInput);
    fireEvent.select(textInput);

    const completionList = screen.getByRole("listbox", { name: "角色补全面板" });
    expect(within(completionList).getByRole("option", { name: /产品/u })).toBeInTheDocument();
    expect(within(completionList).queryByRole("option", { name: /开发/u })).not.toBeInTheDocument();
  });

  it("keeps composition Enter inside the shared new-conversation composer", () => {
    const onSubmit = vi.fn();
    renderPage({ draft: "输入法候选", onSubmit });
    const input = screen.getByRole("textbox", { name: "消息内容" });

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", isComposing: false });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("selects an independent workspace only after explaining its pre-message boundary", () => {
    const onSelectWorkspace = vi.fn();
    renderPage({ onSelectWorkspace });

    fireEvent.keyDown(screen.getByRole("button", { name: "工作空间：默认工作空间，点击切换" }), {
      key: "ArrowDown",
    });
    fireEvent.click(screen.getByText("独立工作空间"));
    const dialog = screen.getByRole("dialog", { name: "换成独立工作空间" });
    expect(dialog).toHaveTextContent("副本基于项目当前所在的提交");
    expect(dialog).toHaveTextContent("不包含你还没提交的改动");
    expect(dialog).not.toHaveTextContent("已经在项目文件夹里产生的改动");
    fireEvent.click(within(dialog).getByRole("button", { name: "换过去" }));
    expect(onSelectWorkspace).toHaveBeenCalledWith("worktree");
  });

  it("disables independent workspace selection for a non-git project with the reason in the menu", () => {
    renderPage({ selectedProjectId: "b" });

    fireEvent.keyDown(screen.getByRole("button", { name: "工作空间：默认工作空间，点击切换" }), {
      key: "ArrowDown",
    });
    expect(screen.getByText("独立工作空间").closest('[role="menuitemcheckbox"]')).toHaveAttribute("data-disabled");
    expect(screen.getByText("这个项目文件夹不是 git 仓库，无法隔离改动")).toBeVisible();
  });

  it("allows a pure ready attachment and blocks a failed attachment", () => {
    const attachment = {
      clientId: "file-1",
      attachmentId: "attachment-1",
      kind: "file" as const,
      displayName: "requirements.pdf",
      mediaType: "application/pdf",
      byteSize: 100,
      status: "ready" as const,
    };
    const { rerender } = renderPage({ draft: "", attachments: [attachment] });
    expect(screen.getByRole("button", { name: "发送消息" })).toBeEnabled();
    rerender(<NewConversationPage
      {...baseProps()}
      draft="正文"
      attachments={[{ ...attachment, status: "failed", error: "磁盘空间不足" }]}
    />);
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
    expect(screen.getByText("磁盘空间不足")).toBeVisible();
  });

  it("shows full static text on hover and keyboard focus without coupling the remove action", async () => {
    const onTextFragmentRemove = vi.fn();
    const user = userEvent.setup();
    renderPage({
      draft: "",
      textFragments: [{
        id: "fragment-1",
        label: "文本片段 1",
        text: "Moebius 会话记录：sessions/source.jsonl；外部执行：Codex abc",
      }],
      onTextFragmentRemove,
    });

    const fragment = screen.getByRole("listitem", {
      name: "文本片段 1：Moebius 会话记录：sessions/source.jsonl；外部执行：Codex abc",
    });
    const remove = screen.getByRole("button", { name: "删除 文本片段 1" });

    expect(fragment).not.toHaveAttribute("title");
    await user.hover(fragment);
    const hoverTooltip = await screen.findByRole("tooltip");
    expect(hoverTooltip).toHaveTextContent(
      "Moebius 会话记录：sessions/source.jsonl；外部执行：Codex abc",
    );
    expect(fragment.closest("ul")).not.toContainElement(hoverTooltip);

    await user.unhover(fragment);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    act(() => fragment.focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Moebius 会话记录：sessions/source.jsonl；外部执行：Codex abc",
    );

    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
    act(() => remove.focus());
    expect(remove).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onTextFragmentRemove).toHaveBeenCalledWith("fragment-1");
  });

  it("inserts the full prompt when a candidate question is activated", () => {
    const onPromptSuggestionSelect = vi.fn();
    renderPage({
      promptSuggestions: [{
        id: "slow",
        label: "Agent 运行太长了？",
        prompt: "分析耗时并先给出方案。",
      }],
      onPromptSuggestionSelect,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent 运行太长了？" }));
    expect(onPromptSuggestionSelect).toHaveBeenCalledWith({
      id: "slow",
      label: "Agent 运行太长了？",
      prompt: "分析耗时并先给出方案。",
    });
  });

  it("never renders the removed CLI preparation concept in Chinese or English", () => {
    const teams: NewConversationPageProps["teams"] = [{
      teamKey: "system:development",
      label: "开发团队",
      members: [
        {
          slug: "dev",
          displayName: "开发",
          description: "实现功能",
          executionProfile: { effectiveProfile: { cli: "codex" } },
        },
        {
          slug: "qa",
          displayName: "测试",
          description: "功能验收",
          executionProfile: { effectiveProfile: { cli: "kimi" } },
        },
      ],
    }];
    const props = {
      ...baseProps(),
      teams,
    };
    const { rerender } = render(
      <I18nProvider locale="zh-CN">
        <NewConversationPage {...props} />
      </I18nProvider>,
    );

    expect(document.querySelector('[data-testid*="compatibility"]')).toBeNull();
    expect(screen.queryByText(/名成员仍需|Codex 准备|Kimi 准备|可在 Agent 团队页调整/u))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送消息" })).toBeEnabled();

    rerender(
      <I18nProvider locale="en">
        <NewConversationPage {...props} />
      </I18nProvider>,
    );

    expect(document.querySelector('[data-testid*="compatibility"]')).toBeNull();
    expect(screen.queryByText(/members still need|Codex setup|Kimi setup|adjust this on the Agent teams page/iu))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
  });

  it("keeps an unavailable preselected team visible but blocks sending until repair or an explicit change", () => {
    renderPage({
      teams: [{
        teamKey: "system:general-assistant",
        label: "通用助手 · 官方来源",
        available: false,
        members: [],
      }],
      selectedTeamKey: "system:general-assistant",
    });

    expect(screen.getByRole("option", { name: "通用助手 · 官方来源" })).toBeDisabled();
    expect(screen.getByText("所选 Agent 团队需要先修复")).toBeVisible();
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
  });
});

const projects = [
  { projectId: "a", title: "moebius", available: true, independentWorkspaceAvailable: true, branchLabel: "main" },
  { projectId: "b", title: "marketing-site", available: true, independentWorkspaceAvailable: false, branchLabel: "main" },
];

function renderPage(overrides: Partial<NewConversationPageProps> = {}) {
  return render(<NewConversationPage
    {...baseProps()}
    {...overrides}
  />);
}

function baseProps(): NewConversationPageProps {
  return {
    projects,
    teams: [
      {
        teamKey: "system:development",
        label: "开发团队",
        members: [{ slug: "dev", displayName: "开发", description: "实现功能" }],
      },
      {
        teamKey: "user:product",
        label: "产品团队",
        members: [{ slug: "product", displayName: "产品", description: "定义需求" }],
      },
    ],
    selectedProjectId: "a",
    selectedWorkspaceMode: "direct",
    selectedTeamKey: "system:development",
    draft: "目标",
    onSelectProject: vi.fn(),
    onSelectWorkspace: vi.fn(),
    onAddProject: vi.fn(),
    onSelectTeam: vi.fn(),
    onDraftChange: vi.fn(),
    onSubmit: vi.fn(),
  };
}
