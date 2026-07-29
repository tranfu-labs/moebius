import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  AgentTeamDetail,
  type AgentExecutionProfile,
  type AgentTeamDetailProps,
  type AgentTeamMemberEditorState,
} from "./agent-team-detail";

describe("AgentTeamDetail", () => {
  it("renders a flat horizontal member selector and switches the editor in place", () => {
    const onSelectMember = vi.fn();
    renderDetail({ onSelectMember });

    expect(screen.getByRole("heading", { name: "开发团队" })).toBeVisible();
    const selector = screen.getByTestId("agent-team-member-selector");
    expect(selector).toHaveClass("flex-nowrap", "overflow-x-auto");
    expect(within(selector).getAllByRole("tab")).toHaveLength(3);
    expect(within(selector).getByRole("tab", { name: /开发经理/u })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(within(selector).getByRole("tab", { name: "测试" }));
    expect(onSelectMember).toHaveBeenCalledWith("qa");
    expect(screen.queryByRole("link", { name: "测试" })).not.toBeInTheDocument();
  });

  it("gives an unfinished draft a useful empty state and adds the first Agent in the current detail", async () => {
    const onAddMember = vi.fn().mockResolvedValue(undefined);
    const props = detailProps({ onAddMember });
    render(<AgentTeamDetail
      {...props}
      team={{ ...props.team, primaryAgentSlug: null, memberOrder: [], members: [] }}
      state={{ ...props.state, selectedMemberSlug: null, memberEditors: {} }}
    />);

    expect(screen.getByText("还没有团队成员")).toBeVisible();
    expect(screen.getByText("添加第一个 Agent 来接收任务，成功后它会自动成为主 Agent。")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "添加第一个 Agent" }));
    await waitFor(() => expect(onAddMember).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps Add Agent beside the member selector once a team already has members", async () => {
    const onAddMember = vi.fn().mockResolvedValue(undefined);
    renderDetail({ onAddMember });

    fireEvent.click(screen.getByRole("button", { name: "添加 Agent" }));
    await waitFor(() => expect(onAddMember).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "添加 Agent" })).toBeEnabled());
  });

  it("shows per-member dirty markers and saves only the current member with Command/Ctrl+S", () => {
    const onChangeMember = vi.fn();
    const onSaveMember = vi.fn();
    renderDetail({ onChangeMember, onSaveMember });

    replaceEditorText(
      screen.getByRole("textbox", { name: "开发经理 AGENT.md" }),
      "# 开发经理\n\n新的职责\n",
    );
    expect(onChangeMember).toHaveBeenCalledWith("manager", "# 开发经理\n\n新的职责\n");

    fireEvent.keyDown(window, { key: "s", metaKey: true });
    expect(onSaveMember).toHaveBeenCalledTimes(1);
    expect(onSaveMember).toHaveBeenCalledWith("manager");
    expect(screen.getAllByLabelText("未保存")).toHaveLength(1);
  });

  it("keeps the user primary Agent selector visible, saves immediately, and preserves member drafts after reordering", () => {
    const onChangePrimaryAgent = vi.fn();
    const onSaveMember = vi.fn();
    const onChangeMember = vi.fn();
    const props = detailProps({
      onChangePrimaryAgent,
      onSaveMember,
      onChangeMember,
      state: stateWith(managerEditor({
        draftMarkdown: "# 开发经理\n\n下一步交给 @dev。\n",
      })),
    });
    const { rerender } = render(<AgentTeamDetail {...props} />);

    const selector = screen.getByRole("combobox", { name: "主 Agent" });
    expect(selector).toHaveValue("manager");
    expect(within(selector).getAllByRole("option").map((option) => option.getAttribute("value"))).toEqual([
      "manager",
      "dev",
      "qa",
    ]);
    fireEvent.change(selector, { target: { value: "dev" } });
    expect(onChangePrimaryAgent).toHaveBeenCalledWith("dev");
    expect(onSaveMember).not.toHaveBeenCalled();
    expect(onChangeMember).not.toHaveBeenCalled();

    rerender(<AgentTeamDetail
      {...props}
      team={{ ...props.team, primaryAgentSlug: "dev" }}
      state={{ ...props.state, primaryAgentChangeStatus: "saved" }}
    />);
    const tabs = within(screen.getByTestId("agent-team-member-selector")).getAllByRole("tab");
    expect(tabs[0]).toHaveTextContent("开发· 主 Agent");
    expect(screen.getByRole("button", { name: "开发，复制 @dev" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "开发经理 AGENT.md" }))
      .toHaveAttribute("data-raw-markdown", "# 开发经理\n\n下一步交给 @dev。\n");
    expect(screen.getAllByLabelText("未保存")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("已保存");
  });

  it("shows primary Agent progress and keeps the selector available for official teams", () => {
    const props = detailProps();
    const { rerender } = render(<AgentTeamDetail
      {...props}
      state={{ ...props.state, primaryAgentChangeStatus: "saving" }}
    />);
    expect(screen.getByRole("combobox", { name: "主 Agent" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("正在保存");

    rerender(<AgentTeamDetail
      {...props}
      state={{
        ...props.state,
        primaryAgentChangeStatus: "failed",
        primaryAgentChangeError: "磁盘暂时不可写",
      }}
    />);
    expect(screen.getByRole("alert")).toHaveTextContent("切换失败：磁盘暂时不可写");

    rerender(<AgentTeamDetail {...props} team={{ ...props.team, ownership: "system" }} />);
    expect(screen.getByRole("combobox", { name: "主 Agent" })).toBeVisible();
    expect(screen.getByText("官方来源")).toBeVisible();
  });

  it("disables duplicate saves while saving and retains a failed draft with retry", () => {
    const onSaveMember = vi.fn();
    const { rerender } = renderDetail({
      onSaveMember,
      state: stateWith(managerEditor({ saveStatus: "saving" })),
    });

    expect(screen.getByRole("status")).toHaveTextContent("正在保存");
    expect(screen.getByRole("button", { name: "正在保存" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "开发经理 AGENT.md" }))
      .toHaveAttribute("aria-disabled", "true");

    rerender(<AgentTeamDetail {...detailProps({
      onSaveMember,
      state: stateWith(managerEditor({ saveStatus: "failed", saveError: "文件被占用" })),
    })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("保存失败：文件被占用");
    expect(screen.getByRole("textbox", { name: "开发经理 AGENT.md" }))
      .toHaveAttribute("data-raw-markdown", "# 开发经理\n\n新职责\n");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onSaveMember).toHaveBeenCalledWith("manager");
  });

  it("updates an existing mention from another member's AGENT.md identity without changing its slug", () => {
    const baseState = stateWith(managerEditor({
      draftMarkdown: "# 开发经理\n\n下一步交给 @dev。\n",
    }));
    const { rerender } = renderDetail({ state: baseState });

    expect(screen.getByRole("button", { name: "开发，复制 @dev" })).toBeVisible();
    const rawMarkdown = screen.getByRole("textbox", { name: "开发经理 AGENT.md" });
    expect(rawMarkdown).toHaveAttribute("data-raw-markdown", "# 开发经理\n\n下一步交给 @dev。\n");

    rerender(<AgentTeamDetail {...detailProps({
      state: {
        ...baseState,
        memberEditors: {
          ...baseState.memberEditors,
          dev: {
            ...baseState.memberEditors.dev!,
            displayName: "软件工程师",
            draftMarkdown: "# 软件工程师\n\n负责实现\n",
          },
        },
      },
    })} />);

    expect(screen.getByRole("button", { name: "软件工程师，复制 @dev" })).toBeVisible();
    expect(rawMarkdown).toHaveAttribute("data-raw-markdown", "# 开发经理\n\n下一步交给 @dev。\n");
  });

  it("keeps the current member @slug visible and copyable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderDetail();

    const copySlug = screen.getByRole("button", { name: "复制 @manager" });
    expect(copySlug).toHaveTextContent("@manager");
    await act(async () => {
      fireEvent.click(copySlug);
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("@manager");
  });

  it("offers all three leave choices and stays when save-all reports a partial failure", async () => {
    const onLeave = vi.fn();
    const onSaveAll = vi.fn().mockResolvedValue({ failures: [{ memberSlug: "qa", reason: "权限不足" }] });
    const { rerender } = renderDetail({ onLeave, onSaveAll });

    fireEvent.click(screen.getByRole("button", { name: "Agent 团队" }));
    const dialog = screen.getByRole("dialog", { name: "还有未保存的修改" });
    expect(within(dialog).getByRole("button", { name: "继续编辑" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "放弃全部并继续" })).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "保存全部并继续" }));

    await waitFor(() => expect(onSaveAll).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "还有未保存的修改" })).not.toBeInTheDocument());
    expect(onLeave).not.toHaveBeenCalled();

    rerender(<AgentTeamDetail {...detailProps({
      onLeave,
      onSaveAll,
      state: {
        ...stateWith(managerEditor()),
        saveAllFailures: [{ memberSlug: "qa", reason: "权限不足" }],
      },
    })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("测试：权限不足");
  });

  it("explains official ownership and keeps official AGENT.md editable", () => {
    const onSaveMember = vi.fn();
    const base = detailProps();
    renderDetail({
      team: { ...base.team, teamKey: "system:development", ownership: "system" },
      state: { ...base.state, teamKey: "system:development" },
      readOnly: false,
      teamActions: <button type="button">复制团队</button>,
      onSaveMember,
    });

    expect(screen.getByText("官方来源")).toBeVisible();
    expect(screen.queryByText("只读")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制团队" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "开发经理 AGENT.md" }))
      .not.toHaveAttribute("aria-readonly", "true");
    expect(screen.getByRole("button", { name: "保存" })).toBeVisible();
    expect(screen.getByRole("button", { name: "放弃修改" })).toBeVisible();
    expect(screen.queryByText("复制 Agent")).not.toBeInTheDocument();
    expect(screen.queryByText("删除 Agent")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "s", metaKey: true });
    expect(onSaveMember).toHaveBeenCalledWith("manager");
  });

  it("quietly reports an automatically loaded external version", () => {
    renderDetail({
      state: stateWith(managerEditor({
        isDirty: false,
        externalChangeStatus: "reloaded",
      })),
    });

    expect(screen.getByRole("status")).toHaveTextContent("文件在软件外面改过了，已载入最新内容");
    expect(screen.queryByRole("button", { name: "载入外部版本" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "用当前内容覆盖" })).not.toBeInTheDocument();
  });

  it("links model and effort dropdowns for the selected CLI", async () => {
    const onSaveExecutionProfile = vi.fn().mockImplementation(async (_slug, profile) => ({
      binding: { source: "explicit", profile },
      recommendation: null,
      effectiveProfile: profile,
    }));
    renderDetail({ onSaveExecutionProfile });

    expect(screen.getByTestId("agent-execution-profile-editor")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "CLI" })).toHaveValue("codex");
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("gpt-5.6-sol");
    expect(within(screen.getByRole("combobox", { name: "Model" })).getAllByRole("option"))
      .toHaveLength(6);
    expect(within(screen.getByRole("combobox", { name: "思考程度" })).getAllByRole("option")
      .map((option) => option.getAttribute("value"))).toEqual(["low", "medium", "high", "xhigh", "max"]);

    fireEvent.change(screen.getByRole("combobox", { name: "CLI" }), { target: { value: "claude" } });
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("sonnet");
    expect(screen.getByRole("combobox", { name: "思考程度" })).toHaveValue("high");
    expect(within(screen.getByRole("combobox", { name: "Model" })).getAllByRole("option")
      .map((option) => option.getAttribute("value"))).toEqual(["fable", "sonnet", "opus"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), {
      target: { value: "fable" },
    });
    expect(within(screen.getByRole("combobox", { name: "思考程度" })).getAllByRole("option")
      .map((option) => option.getAttribute("value"))).toEqual([
        "low", "medium", "high", "xhigh", "max",
      ]);

    fireEvent.change(screen.getByRole("combobox", { name: "CLI" }), { target: { value: "kimi" } });
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("kimi-code/kimi-for-coding");
    expect(screen.getByRole("combobox", { name: "思考程度" })).toHaveValue("on");
    expect(screen.getByRole("option", { name: "k3（需相应会员权限）" })).toBeVisible();

    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), {
      target: { value: "kimi-code/k3" },
    });
    expect(screen.getByRole("combobox", { name: "思考程度" })).toHaveValue("high");
    fireEvent.change(screen.getByRole("combobox", { name: "思考程度" }), { target: { value: "max" } });
    fireEvent.click(screen.getByRole("button", { name: "保存运行配置" }));
    await waitFor(() => expect(onSaveExecutionProfile).toHaveBeenCalledWith(
      "manager",
      { cli: "kimi", model: "kimi-code/k3", effort: "max" },
    ));
  });

  it("preserves an unsupported historical profile until a supported model is selected", async () => {
    const onSaveExecutionProfile = vi.fn().mockImplementation(async (_slug, profile: AgentExecutionProfile) =>
      executionProfileDocument(profile));
    const base = detailProps();
    renderDetail({
      onSaveExecutionProfile,
      team: {
        ...base.team,
        members: base.team.members.map((member) => member.slug === "manager"
          ? {
              ...member,
              executionProfile: executionProfileDocument({
                cli: "kimi",
                model: "future-model",
                effort: "future-effort",
              }),
            }
          : member),
      },
    });
    const model = screen.getByRole("combobox", { name: "Model" });
    const effort = screen.getByRole("combobox", { name: "思考程度" });

    expect(model).toHaveValue("future-model");
    expect(effort).toHaveValue("future-effort");
    expect(screen.getByRole("option", { name: "future-model（旧版自定义配置）" })).toBeVisible();
    expect(screen.getByRole("option", { name: "future-effort（当前列表不支持）" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("旧版自定义配置会保留");
    expect(screen.getByRole("button", { name: "保存运行配置" })).toBeDisabled();
    expect(onSaveExecutionProfile).not.toHaveBeenCalled();

    fireEvent.change(model, { target: { value: "kimi-code/k3-256k" } });
    expect(effort).toHaveValue("high");
    fireEvent.click(screen.getByRole("button", { name: "保存运行配置" }));

    await waitFor(() => expect(onSaveExecutionProfile).toHaveBeenCalledWith(
      "manager",
      { cli: "kimi", model: "kimi-code/k3-256k", effort: "high" },
    ));
  });

  it("keeps per-member profile drafts across member switches and saves them before leaving", async () => {
    const onSaveExecutionProfile = vi.fn().mockImplementation(async (_slug, profile) =>
      executionProfileDocument(profile));
    const onSaveAll = vi.fn().mockResolvedValue({ failures: [] });
    const onLeave = vi.fn();
    const base = detailProps({
      state: stateWith(managerEditor({ isDirty: false })),
      onSaveExecutionProfile,
      onSaveAll,
      onLeave,
    });
    const { rerender } = render(<AgentTeamDetail {...base} />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "CLI" })).toHaveValue("codex"));
    fireEvent.change(screen.getByRole("combobox", { name: "CLI" }), { target: { value: "kimi" } });

    rerender(<AgentTeamDetail
      {...base}
      state={{ ...base.state, selectedMemberSlug: "dev" }}
    />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "CLI" })).toHaveValue("codex"));

    rerender(<AgentTeamDetail
      {...base}
      state={{ ...base.state, selectedMemberSlug: "manager" }}
    />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "CLI" })).toHaveValue("kimi"));
    fireEvent.click(screen.getByRole("button", { name: "Agent 团队" }));
    expect(onLeave).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog", { name: "还有未保存的修改" }))
      .getByRole("button", { name: "保存全部并继续" }));

    await waitFor(() => expect(onSaveExecutionProfile).toHaveBeenCalledWith(
      "manager",
      { cli: "kimi", model: "kimi-code/kimi-for-coding", effort: "on" },
    ));
    await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1));
  });

  it.each([
    ["返回团队列表", "Agent 团队"],
    ["修改团队信息", "修改信息"],
    ["复制内置团队", "复制团队"],
    ["复制成员", "复制 Agent"],
    ["删除成员", "删除 Agent"],
    ["复制用户团队", "复制用户团队"],
    ["删除用户团队", "删除用户团队"],
    ["更新官方团队", "更新到最新版"],
  ] as const)("guards %s when only the execution profile has an unsaved draft", async (actionKind, buttonName) => {
    const action = vi.fn().mockResolvedValue(actionKind === "更新官方团队"
      ? {
          copiedTeamId: null,
          appliedOfficialVersion: "2",
          memberChanges: { added: [], removed: [], renamed: [], recommendationChanged: [] },
        }
      : undefined);
    const base = detailProps({
      state: stateWith(managerEditor({ isDirty: false })),
      onLeave: actionKind === "返回团队列表" ? action : vi.fn(),
      teamActions: ["修改团队信息", "复制内置团队", "复制用户团队", "删除用户团队"].includes(actionKind)
        ? (request) => <button type="button" onClick={() => request(action)}>{buttonName}</button>
        : undefined,
      memberActions: ["复制成员", "删除成员"].includes(actionKind)
        ? (request) => <button type="button" onClick={() => request(action)}>{buttonName}</button>
        : undefined,
      onApplyOfficialUpdate: actionKind === "更新官方团队" ? action : undefined,
    });
    render(<AgentTeamDetail
      {...base}
      team={actionKind === "更新官方团队"
        ? {
            ...base.team,
            ownership: "system",
            officialManagement: {
              currentOfficialVersion: "1",
              latestOfficialVersion: "2",
              customizationStatus: "clean",
              updateStatus: "available",
              primaryAction: "update",
              requiresProtectiveCopy: false,
              addedMembers: [],
              removedMembers: [],
              recommendationChangedMembers: [],
              protectedMembers: [],
              collidingMembers: [],
            },
          }
        : base.team}
    />);

    await waitFor(() => expect(screen.getByRole("combobox", { name: "CLI" })).toHaveValue("codex"));
    fireEvent.change(screen.getByRole("combobox", { name: "CLI" }), { target: { value: "kimi" } });
    fireEvent.click(screen.getByRole("button", { name: buttonName }));

    expect(screen.getByRole("dialog", { name: "还有未保存的修改" })).toBeVisible();
    expect(action).not.toHaveBeenCalled();
  });

  it("keeps a static profile draft across parent rerenders without runtime-health UI", () => {
    const base = detailProps({ state: stateWith(managerEditor({ isDirty: false })) });
    const { rerender } = render(<AgentTeamDetail {...base} onSaveExecutionProfile={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), {
      target: { value: "gpt-5.4-mini" },
    });

    rerender(<AgentTeamDetail {...base} onSaveExecutionProfile={vi.fn()} />);

    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("gpt-5.4-mini");
    expect(screen.queryByText("正在读取运行配置…")).not.toBeInTheDocument();
    expect(screen.queryByText(/无法验证|需要调整|重新检查运行能力/u)).not.toBeInTheDocument();
  });

  it("shows an official update as a normal management state and reports the protected copy", async () => {
    const onApplyOfficialUpdate = vi.fn().mockResolvedValue({
      copiedTeamId: "development-copy",
      appliedOfficialVersion: "2",
      memberChanges: {
        added: ["reviewer"],
        removed: ["qa"],
        renamed: [],
        recommendationChanged: ["manager"],
      },
    });
    const onOpenCopiedTeam = vi.fn();
    const base = detailProps();
    renderDetail({
      team: {
        ...base.team,
        ownership: "system",
        officialManagement: {
          currentOfficialVersion: "1",
          latestOfficialVersion: "2",
          customizationStatus: "customized",
          updateStatus: "available",
          primaryAction: "protect-and-update",
          requiresProtectiveCopy: true,
          addedMembers: ["reviewer"],
          removedMembers: ["qa"],
          recommendationChangedMembers: ["manager"],
          protectedMembers: ["qa"],
          collidingMembers: [],
        },
      },
      state: stateWith(managerEditor({ isDirty: false })),
      onApplyOfficialUpdate,
      onOpenCopiedTeam,
    });

    expect(screen.getByText("已自定义")).toBeVisible();
    expect(screen.getByText("有更新")).toBeVisible();
    expect(screen.getByText("当前 1 → 最新 2")).toBeVisible();
    expect(screen.getByText("新增：@reviewer")).toBeVisible();
    expect(screen.getByText("删除：@qa")).toBeVisible();
    expect(screen.getByText("副本保护范围：@qa")).toBeVisible();
    expect(screen.queryByText("这支团队需要修复")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保留副本并更新" }));
    await waitFor(() => expect(onApplyOfficialUpdate).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(
      "已保留为 development-copy；已更新到官方版本 2：新增 @reviewer；删除 @qa；推荐配置更新 @manager。",
    )).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "进入保留的副本" }));
    expect(onOpenCopiedTeam).toHaveBeenCalledWith("development-copy");
  });

  it("shows exactly the two external-conflict choices and keeps normal save paths out", () => {
    const onLoadExternalVersion = vi.fn();
    const onOverwriteExternalVersion = vi.fn();
    const onSaveMember = vi.fn();
    const onLeave = vi.fn();
    renderDetail({
      state: stateWith(managerEditor({ externalChangeStatus: "conflict" })),
      onLoadExternalVersion,
      onOverwriteExternalVersion,
      onSaveMember,
      onLeave,
    });

    expect(screen.getByRole("alert")).toHaveTextContent("文件在软件外面被改过了");
    fireEvent.click(screen.getByRole("button", { name: "载入外部版本" }));
    fireEvent.click(screen.getByRole("button", { name: "用当前内容覆盖" }));
    expect(onLoadExternalVersion).toHaveBeenCalledWith("manager");
    expect(onOverwriteExternalVersion).toHaveBeenCalledWith("manager");
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "放弃修改" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Agent 团队" }));
    expect(onSaveMember).not.toHaveBeenCalled();
    expect(onLeave).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "还有未保存的修改" })).not.toBeInTheDocument();
    const blocked = screen.getByRole("dialog", { name: "无法返回团队列表" });
    expect(blocked).toHaveTextContent("开发经理 AGENT.md");
    expect(within(blocked).getByRole("button", { name: "知道了" })).toBeVisible();
  });

  it("checks the selected user AGENT.md when the window regains focus", () => {
    const onCheckExternalChange = vi.fn();
    renderDetail({ onCheckExternalChange });

    expect(onCheckExternalChange).toHaveBeenCalledTimes(1);
    fireEvent.focus(window);
    expect(onCheckExternalChange).toHaveBeenCalledTimes(2);
    expect(onCheckExternalChange).toHaveBeenLastCalledWith("manager");
  });

  it("explains repair impact in plain language and offers recheck and relocation for a missing team folder", async () => {
    const onRecheck = vi.fn().mockResolvedValue(undefined);
    const onRelocate = vi.fn().mockRejectedValue(new Error("所选位置缺少可读取的团队信息文件。"));
    const base = detailProps();
    renderDetail({
      team: {
        ...base.team,
        status: "needs-repair",
        canCreateConversation: false,
        issues: [{ code: "team-directory-missing" }],
      },
      onRecheck,
      onRelocate,
      onAddMember: vi.fn(),
    });

    const panel = screen.getByTestId("agent-team-repair-panel");
    expect(panel).toHaveTextContent("团队文件夹已移动、重命名或暂时无法访问");
    expect(panel).toHaveTextContent("修复前不能用于新建对话");
    expect(panel).toHaveTextContent("已有会话和历史消息不会消失");
    expect(screen.queryByRole("button", { name: "添加 Agent" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
    await waitFor(() => expect(onRecheck).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "重新定位团队" }));
    await waitFor(() => expect(panel).toHaveTextContent("所选位置缺少可读取的团队信息文件"));
    expect(screen.getByTestId("agent-team-repair-panel")).toBeVisible();
  });

  it("explains invalid member frontmatter as a repairable metadata problem", () => {
    const base = detailProps();
    renderDetail({
      team: {
        ...base.team,
        status: "needs-repair",
        canCreateConversation: false,
        issues: [{ code: "member-agent-metadata-invalid", slug: "manager" }],
      },
    });

    expect(screen.getByTestId("agent-team-repair-panel")).toHaveTextContent(
      "@manager 的 AGENT.md 身份元数据不完整或格式错误",
    );
  });

  it("states that removing a record never touches disk files before confirmation", async () => {
    const onRemoveRecord = vi.fn().mockResolvedValue(undefined);
    const base = detailProps();
    renderDetail({
      team: {
        ...base.team,
        status: "needs-repair",
        canCreateConversation: false,
        issues: [{ code: "team-directory-unreadable" }],
      },
      onRemoveRecord,
    });

    fireEvent.click(screen.getByRole("button", { name: "移除记录" }));
    const dialog = screen.getByRole("dialog", { name: "移除失效团队记录" });
    expect(dialog).toHaveTextContent("只会从应用中移除这条失效记录");
    expect(dialog).toHaveTextContent("不会删除、移动或修改磁盘上的任何文件");
    expect(dialog).toHaveTextContent("已有会话和历史消息也会保留");
    fireEvent.click(within(dialog).getByRole("button", { name: "只移除记录" }));
    await waitFor(() => expect(onRemoveRecord).toHaveBeenCalledTimes(1));
  });

  it("allows replacing an unavailable primary Agent only with a readable member", () => {
    const onChangePrimaryAgent = vi.fn();
    const base = detailProps();
    renderDetail({
      team: {
        ...base.team,
        status: "needs-repair",
        canCreateConversation: false,
        primaryAgentSlug: "manager",
        issues: [{ code: "member-agent-missing", slug: "manager" }],
        members: [
          { ...base.team.members[0]!, available: false },
          { ...base.team.members[1]!, available: true },
          { ...base.team.members[2]!, available: true },
        ],
      },
      state: {
        ...base.state,
        selectedMemberSlug: "manager",
        memberEditors: {
          ...base.state.memberEditors,
          manager: {
            ...base.state.memberEditors.manager!,
            loadStatus: "failed",
            loadError: "AGENT.md 缺失",
          },
        },
      },
      onChangePrimaryAgent,
      memberActions: <button type="button">删除 Agent</button>,
    });

    const primarySelector = screen.getByRole("combobox", { name: "主 Agent" });
    expect(within(primarySelector).queryByRole("option", { name: "开发经理" })).not.toBeInTheDocument();
    expect(within(primarySelector).getByRole("option", { name: "开发" })).toBeVisible();
    fireEvent.change(primarySelector, { target: { value: "dev" } });
    expect(onChangePrimaryAgent).toHaveBeenCalledWith("dev");
    expect(screen.getByRole("tab", { name: /开发经理.*不可用/u })).toBeVisible();
    expect(screen.getByRole("button", { name: "删除 Agent" })).toBeVisible();
  });
});

function renderDetail(overrides: Partial<AgentTeamDetailProps> = {}) {
  return render(<AgentTeamDetail {...detailProps(overrides)} />);
}

function detailProps(overrides: Partial<AgentTeamDetailProps> = {}): AgentTeamDetailProps {
  return {
    team: {
      teamKey: "user:development",
      ownership: "user",
      name: "开发团队",
      description: "负责软件方案、实现和验收",
      primaryAgentSlug: "manager",
      memberOrder: ["manager", "dev", "qa"],
      members: [
        {
          slug: "manager",
          displayName: "开发经理",
          description: "默认接单",
          executionProfile: executionProfileDocument(),
        },
        {
          slug: "dev",
          displayName: "开发",
          description: "负责实现",
          executionProfile: executionProfileDocument(),
        },
        {
          slug: "qa",
          displayName: "测试",
          description: "负责验收",
          executionProfile: executionProfileDocument(),
        },
      ],
    },
    state: stateWith(managerEditor()),
    onSelectMember: vi.fn(),
    onChangePrimaryAgent: vi.fn(),
    onChangeMember: vi.fn(),
    onSaveMember: vi.fn(),
    onRetryLoad: vi.fn(),
    onDiscardMember: vi.fn(),
    onDiscardAll: vi.fn(),
    onSaveAll: vi.fn().mockResolvedValue({ failures: [] }),
    onLeave: vi.fn(),
    ...overrides,
  };
}

function stateWith(manager: AgentTeamMemberEditorState): AgentTeamDetailProps["state"] {
  return {
    teamKey: "user:development",
    selectedMemberSlug: "manager",
    memberEditors: {
      manager,
      dev: {
        ...managerEditor(),
        memberSlug: "dev",
        displayName: "开发",
        description: "负责实现",
        isDirty: false,
      },
      qa: {
        ...managerEditor(),
        memberSlug: "qa",
        displayName: "测试",
        description: "负责验收",
        isDirty: false,
      },
    },
    saveAllFailures: [],
  };
}

function managerEditor(overrides: Partial<AgentTeamMemberEditorState> = {}): AgentTeamMemberEditorState {
  return {
    memberSlug: "manager",
    loadStatus: "ready",
    loadError: null,
    draftMarkdown: "# 开发经理\n\n新职责\n",
    isDirty: true,
    saveStatus: "idle",
    saveError: null,
    externalChangeStatus: "none",
    displayName: "开发经理",
    description: "新职责",
    ...overrides,
  };
}

function replaceEditorText(editor: HTMLElement, value: string): void {
  editor.textContent = value;
  fireEvent.input(editor);
}

function executionProfileDocument(
  effectiveProfile: AgentExecutionProfile = { cli: "codex", model: "gpt-5.6-sol", effort: "high" },
) {
  return {
    binding: { source: "explicit" as const, profile: effectiveProfile },
    recommendation: null,
    effectiveProfile,
  };
}
