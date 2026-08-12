import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PORTRAIT_IDS, defaultPortraitId, type PortraitId } from "@/console/agent-portrait";
import { chooseOption, optionLabels, selectedOption } from "@/test/select";
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

  it("shows per-member dirty markers and saves only the current member with Command/Ctrl+S", async () => {
    const onChangeMember = vi.fn();
    const onSaveMember = vi.fn();
    renderDetail({ onChangeMember, onSaveMember });

    enterMarkdownEdit();
    replaceEditorText(
      screen.getByRole("textbox", { name: "开发经理 的职责说明" }),
      "# 开发经理\n\n新的职责\n",
    );
    expect(onChangeMember).toHaveBeenCalledWith("manager", "# 开发经理\n\n新的职责\n");

    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(onSaveMember).toHaveBeenCalledTimes(1));
    expect(onSaveMember).toHaveBeenCalledWith("manager");
    expect(screen.getAllByLabelText("未保存")).toHaveLength(1);
  });

  it("expresses the primary Agent by first place alone, with no separate selector", () => {
    const onReorderMembers = vi.fn();
    const onSaveMember = vi.fn();
    const onChangeMember = vi.fn();
    const props = detailProps({
      onReorderMembers,
      onSaveMember,
      onChangeMember,
      state: stateWith(managerEditor({
        draftMarkdown: "# 开发经理\n\n下一步交给 @dev。\n",
      })),
    });
    const { rerender } = render(<AgentTeamDetail {...props} />);

    // Appointing is dragging into first place; a second control for the same act would only give
    // the two a chance to disagree.
    expect(screen.queryByRole("combobox", { name: "主 Agent" })).toBeNull();
    const tabs = within(screen.getByTestId("agent-team-member-selector")).getAllByRole("tab");
    expect(tabs[0]).toHaveTextContent("开发经理· 主 Agent");

    rerender(<AgentTeamDetail
      {...props}
      team={{ ...props.team, primaryAgentSlug: "dev", memberOrder: ["dev", "manager", "qa"] }}
      state={{ ...props.state, primaryAgentChangeStatus: "saved" }}
    />);
    const reordered = within(screen.getByTestId("agent-team-member-selector")).getAllByRole("tab");
    expect(reordered[0]).toHaveTextContent("开发· 主 Agent");
    expect(onSaveMember).not.toHaveBeenCalled();
    expect(onChangeMember).not.toHaveBeenCalled();

    // The member's own draft is untouched by a change of primary.
    enterMarkdownEdit();
    expect(screen.getByRole("textbox", { name: "开发经理 的职责说明" }))
      .toHaveAttribute("data-raw-markdown", "# 开发经理\n\n下一步交给 @dev。\n");
    expect(screen.getAllByLabelText("未保存")).toHaveLength(1);
    expect(screen.getAllByRole("status").map((node) => node.textContent).join(" "))
      .toContain("已保存");
  });

  it("still reports the outcome of a primary change, and keeps official teams reorderable", () => {
    const props = detailProps();
    const { rerender } = render(<AgentTeamDetail
      {...props}
      state={{ ...props.state, primaryAgentChangeStatus: "saving" }}
    />);
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
    // Official teams reorder like any other; the ability is never hidden behind a menu.
    expect(within(screen.getByTestId("agent-team-member-selector")).getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByText("官方来源")).toBeVisible();
  });

  it("keeps a drag in the member-order draft until Save, previewing first place as the primary Agent", async () => {
    mockMemberStripRects();
    const onReorderMembers = vi.fn().mockResolvedValue(undefined);
    renderDetail({
      onReorderMembers,
      state: stateWith(managerEditor({ isDirty: false })),
    });
    const tabs = () => within(screen.getByTestId("agent-team-member-selector")).getAllByRole("tab");
    expect(tabs()[0]).toHaveTextContent("开发经理");

    await moveChipToFirst(tabs()[1]!);

    // The gesture only edits the local draft: no persistence callback fires, the page previews
    // the new order, and the primary marker follows first place.
    expect(onReorderMembers).not.toHaveBeenCalled();
    expect(tabs()[0]).toHaveTextContent("开发· 主 Agent");
    expect(screen.getByText("未保存 1 项")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onReorderMembers).toHaveBeenCalledTimes(1));
    expect(onReorderMembers).toHaveBeenCalledWith(["dev", "manager", "qa"]);
    // The draft is consumed by a successful commit.
    await waitFor(() => expect(screen.queryByText("未保存 1 项")).not.toBeInTheDocument());
  });

  it("keeps a failed order commit in the draft and retries the same order on the next Save", async () => {
    mockMemberStripRects();
    const onReorderMembers = vi.fn()
      .mockRejectedValueOnce(new Error("磁盘暂时不可写"))
      .mockResolvedValue(undefined);
    renderDetail({
      onReorderMembers,
      state: stateWith(managerEditor({ isDirty: false })),
    });
    const tabs = () => within(screen.getByTestId("agent-team-member-selector")).getAllByRole("tab");

    await moveChipToFirst(tabs()[1]!);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onReorderMembers).toHaveBeenCalledTimes(1));
    // The failed commit keeps the draft: the strip still previews it and the count stays.
    expect(tabs()[0]).toHaveTextContent("开发· 主 Agent");
    expect(screen.getByText("未保存 1 项")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onReorderMembers).toHaveBeenCalledTimes(2));
    expect(onReorderMembers).toHaveBeenLastCalledWith(["dev", "manager", "qa"]);
    await waitFor(() => expect(screen.queryByText("未保存 1 项")).not.toBeInTheDocument());
  });

  it("keeps a failed portrait commit in the draft and retries the same face on the next Save", async () => {
    mockMemberStripRects();
    const onChangeMemberPortrait = vi.fn()
      .mockRejectedValueOnce(new Error("磁盘暂时不可写"))
      .mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDetail({
      onChangeMemberPortrait,
      state: stateWith(managerEditor({ isDirty: false })),
    });
    const face = firstNonDefaultPortrait("manager");

    await pickPortrait(user, face);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onChangeMemberPortrait).toHaveBeenCalledTimes(1));
    // The failed commit keeps the draft: the count stays and no "saved" acknowledgement shows.
    expect(screen.getByText("未保存 1 项")).toBeVisible();
    expect(screen.queryByText("已保存")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onChangeMemberPortrait).toHaveBeenCalledTimes(2));
    expect(onChangeMemberPortrait).toHaveBeenLastCalledWith("manager", face);
    await waitFor(() => expect(screen.queryByText("未保存 1 项")).not.toBeInTheDocument());
  });

  it("keeps a portrait pick in the draft until Save and restores it on discard", async () => {
    mockMemberStripRects();
    const onChangeMemberPortrait = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDetail({
      onChangeMemberPortrait,
      state: stateWith(managerEditor({ isDirty: false })),
    });
    const face = firstNonDefaultPortrait("manager");

    await pickPortrait(user, face);

    // Picking is a draft edit: the persistence callback waits for Save, the page previews it.
    expect(onChangeMemberPortrait).not.toHaveBeenCalled();
    expect(screen.getByText("未保存 1 项")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onChangeMemberPortrait).toHaveBeenCalledTimes(1));
    expect(onChangeMemberPortrait).toHaveBeenCalledWith("manager", face);
    await waitFor(() => expect(screen.queryByText("未保存 1 项")).not.toBeInTheDocument());
  });

  it("restores both the draft order and the draft portrait with discard", async () => {
    mockMemberStripRects();
    const onReorderMembers = vi.fn();
    const onChangeMemberPortrait = vi.fn();
    const user = userEvent.setup();
    renderDetail({
      onReorderMembers,
      onChangeMemberPortrait,
      state: stateWith(managerEditor({ isDirty: false })),
    });
    const tabs = () => within(screen.getByTestId("agent-team-member-selector")).getAllByRole("tab");

    await moveChipToFirst(tabs()[1]!);
    await pickPortrait(user, firstNonDefaultPortrait("manager"));
    expect(screen.getByText("未保存 2 项")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));

    expect(onReorderMembers).not.toHaveBeenCalled();
    expect(onChangeMemberPortrait).not.toHaveBeenCalled();
    expect(tabs()[0]).toHaveTextContent("开发经理· 主 Agent");
    expect(screen.queryByText(/未保存/u)).not.toBeInTheDocument();
  });

  it("saves both draft order and draft portrait with the single Save", async () => {
    mockMemberStripRects();
    const onReorderMembers = vi.fn().mockResolvedValue(undefined);
    const onChangeMemberPortrait = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDetail({
      onReorderMembers,
      onChangeMemberPortrait,
      state: stateWith(managerEditor({ isDirty: false })),
    });
    const tabs = () => within(screen.getByTestId("agent-team-member-selector")).getAllByRole("tab");
    const face = firstNonDefaultPortrait("manager");

    await moveChipToFirst(tabs()[1]!);
    await pickPortrait(user, face);
    expect(screen.getByText("未保存 2 项")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onReorderMembers).toHaveBeenCalledWith(["dev", "manager", "qa"]));
    await waitFor(() => expect(onChangeMemberPortrait).toHaveBeenCalledWith("manager", face));
    await waitFor(() => expect(screen.queryByText(/未保存/u)).not.toBeInTheDocument());
  });

  it("guards leaving the page with draft order and portrait and can discard or save them", async () => {
    mockMemberStripRects();
    const onLeave = vi.fn();
    const onDiscardAll = vi.fn();
    const onReorderMembers = vi.fn().mockResolvedValue(undefined);
    const onChangeMemberPortrait = vi.fn().mockResolvedValue(undefined);
    const onSaveAll = vi.fn().mockResolvedValue({ failures: [] });
    const user = userEvent.setup();
    renderDetail({
      onLeave,
      onDiscardAll,
      onSaveAll,
      onReorderMembers,
      onChangeMemberPortrait,
      state: stateWith(managerEditor({ isDirty: false })),
    });
    const tabs = () => within(screen.getByTestId("agent-team-member-selector")).getAllByRole("tab");
    await moveChipToFirst(tabs()[1]!);
    await pickPortrait(user, firstNonDefaultPortrait("manager"));

    fireEvent.click(screen.getByRole("button", { name: "Agent 团队" }));
    const dialog = screen.getByRole("dialog", { name: "还有未保存的修改" });
    fireEvent.click(within(dialog).getByRole("button", { name: "放弃全部并继续" }));
    expect(onDiscardAll).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onReorderMembers).not.toHaveBeenCalled();
    expect(onChangeMemberPortrait).not.toHaveBeenCalled();
  });

  it("saves draft order and portraits and then leaves with 保存全部并继续", async () => {
    mockMemberStripRects();
    const onLeave = vi.fn();
    const onReorderMembers = vi.fn().mockResolvedValue(undefined);
    const onChangeMemberPortrait = vi.fn().mockResolvedValue(undefined);
    const onSaveAll = vi.fn().mockResolvedValue({ failures: [] });
    const user = userEvent.setup();
    renderDetail({
      onLeave,
      onSaveAll,
      onReorderMembers,
      onChangeMemberPortrait,
      state: stateWith(managerEditor({ isDirty: false })),
    });
    const tabs = () => within(screen.getByTestId("agent-team-member-selector")).getAllByRole("tab");
    await moveChipToFirst(tabs()[1]!);
    await pickPortrait(user, firstNonDefaultPortrait("manager"));

    fireEvent.click(screen.getByRole("button", { name: "Agent 团队" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "还有未保存的修改" }))
      .getByRole("button", { name: "保存全部并继续" }));

    await waitFor(() => expect(onReorderMembers).toHaveBeenCalledWith(["dev", "manager", "qa"]));
    await waitFor(() => expect(onChangeMemberPortrait).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSaveAll).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1));
  });

  it("disables duplicate saves while saving and retains a failed draft with retry", () => {
    const onSaveMember = vi.fn();
    const { rerender } = renderDetail({
      onSaveMember,
      state: stateWith(managerEditor({ saveStatus: "saving" })),
    });

    expect(screen.getByRole("status")).toHaveTextContent("正在保存");
    expect(screen.getByRole("button", { name: "正在保存" })).toBeDisabled();
    enterMarkdownEdit();
    expect(screen.getByRole("textbox", { name: "开发经理 的职责说明" }))
      .toHaveAttribute("aria-disabled", "true");

    rerender(<AgentTeamDetail {...detailProps({
      onSaveMember,
      state: stateWith(managerEditor({ saveStatus: "failed", saveError: "文件被占用" })),
    })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("保存失败：文件被占用");
    enterMarkdownEdit();
    expect(screen.getByRole("textbox", { name: "开发经理 的职责说明" }))
      .toHaveAttribute("data-raw-markdown", "# 开发经理\n\n新职责\n");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onSaveMember).toHaveBeenCalledWith("manager");
  });

  it("updates an existing mention from another member's AGENT.md identity without changing its slug", () => {
    const baseState = stateWith(managerEditor({
      draftMarkdown: "# 开发经理\n\n下一步交给 @dev。\n",
    }));
    const { rerender } = renderDetail({ state: baseState });

    enterMarkdownEdit();
    const rawMarkdown = screen.getByRole("textbox", { name: "开发经理 的职责说明" });
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

    // The mention's stored text stays `@dev`; only the rendered member identity changes.
    expect(rawMarkdown).toHaveAttribute("data-raw-markdown", "# 开发经理\n\n下一步交给 @dev。\n");
  });

  it("keeps no standing slug display or copy control", () => {
    renderDetail();

    // Typing `@` in the body already completes member names, so copying a slug by hand is a need
    // that does not exist; a standing control for it is only clutter.
    expect(screen.queryByRole("button", { name: /复制 @/u })).toBeNull();
    expect(screen.queryByText("@manager")).toBeNull();
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

  it("explains official ownership and keeps official AGENT.md editable", async () => {
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
    enterMarkdownEdit();
    expect(screen.getByRole("textbox", { name: "开发经理 的职责说明" }))
      .not.toHaveAttribute("aria-readonly", "true");
    expect(screen.getByRole("button", { name: "保存" })).toBeVisible();
    expect(screen.getByRole("button", { name: "放弃修改" })).toBeVisible();
    expect(screen.queryByText("复制 Agent")).not.toBeInTheDocument();
    expect(screen.queryByText("删除 Agent")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(onSaveMember).toHaveBeenCalledWith("manager"));
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

  it("moves the engine mark to the drafted engine before the profile is saved", () => {
    renderDetail({ onSaveExecutionProfile: vi.fn() });

    const marks = () => [...document.querySelectorAll('[data-agent-portrait="manager"]')]
      .map((portrait) => portrait.parentElement?.querySelector("svg path")?.getAttribute("d"))
      .filter((path): path is string => typeof path === "string");

    const codexMarks = marks();
    expect(codexMarks.length).toBeGreaterThan(0);

    chooseOption("执行引擎", "Claude Code");
    const claudeMarks = marks();

    expect(claudeMarks).toHaveLength(codexMarks.length);
    expect(claudeMarks.every((path) => !codexMarks.includes(path))).toBe(true);
    // Every place this member appears agrees; two engines on screen at once is worse than none.
    expect(new Set(claudeMarks).size).toBe(1);
  });

  it("keeps the runtime dropdowns on one line when a field below one of them shows an error", () => {
    renderDetail({ onSaveExecutionProfile: vi.fn() });

    chooseOption("执行引擎", "Pi API");
    expect(screen.getByText("请选择已就绪的 AI 服务商档案")).toBeVisible();

    // The error lives in one column only; the labels must not absorb the extra height by
    // stretching their own rows, which is what pushed that column's dropdown out of line.
    for (const name of ["执行引擎", "Provider", "Model"]) {
      expect(screen.getByRole("combobox", { name }).closest("label")).toHaveClass("content-start");
    }
  });

  it("links model and effort dropdowns for the selected CLI", async () => {
    const onSaveExecutionProfile = vi.fn().mockImplementation(async (_slug, profile) => ({
      binding: { source: "explicit", profile },
      recommendation: null,
      effectiveProfile: profile,
    }));
    renderDetail({ onSaveExecutionProfile });

    expect(screen.getByTestId("agent-execution-profile-editor")).toBeVisible();
    expect(selectedOption("执行引擎")).toBe("Codex");
    expect(selectedOption("Model")).toBe("gpt-5.6-sol");
    expect(optionLabels("Model"))
      .toHaveLength(6);
    expect(optionLabels("思考程度")).toEqual(["low", "medium", "high", "xhigh", "max"]);

    chooseOption("执行引擎", "Claude Code");
    expect(selectedOption("Model")).toBe("sonnet");
    expect(selectedOption("思考程度")).toBe("high");
    expect(optionLabels("Model")).toEqual(["fable", "sonnet", "opus"]);
    chooseOption("Model", "fable");
    expect(optionLabels("思考程度")).toEqual([
        "low", "medium", "high", "xhigh", "max",
      ]);

    chooseOption("执行引擎", "Kimi");
    expect(selectedOption("Model")).toBe("kimi-for-coding");
    expect(selectedOption("思考程度")).toBe("on");
    expect(optionLabels("Model")).toContain("k3（需相应会员权限）");

    chooseOption("Model", "k3（需相应会员权限）");
    expect(selectedOption("思考程度")).toBe("high");
    chooseOption("思考程度", "max");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSaveExecutionProfile).toHaveBeenCalledWith(
      "manager",
      { cli: "kimi", model: "kimi-code/k3", effort: "max" },
    ));
  });

  it("requires an explicit model when a ready Pi profile has no usable default", async () => {
    const onSaveExecutionProfile = vi.fn().mockImplementation(async (_slug, profile: AgentExecutionProfile) =>
      executionProfileDocument(profile));
    renderDetail({
      onSaveExecutionProfile,
      providerProfiles: [{
        id: "deepseek-work",
        providerId: "deepseek",
        providerName: "DeepSeek",
        displayName: "工作档案",
        defaultModel: null,
        verifiedModels: ["deepseek-v4-flash", "deepseek-v4-pro"],
        readiness: "ready",
        reason: null,
      }],
    });

    chooseOption("执行引擎", "Pi API");
    expect(selectedOption("Provider")).toBe("DeepSeek · 工作档案");
    expect(selectedOption("Model")).toBe("选择已验证模型");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();

    chooseOption("Model", "DeepSeek V4 Flash");
    expect(selectedOption("思考程度")).toBe("high");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSaveExecutionProfile).toHaveBeenCalledWith("manager", {
      cli: "pi",
      providerId: "deepseek",
      providerProfileId: "deepseek-work",
      model: "deepseek-v4-flash",
      effort: "high",
    }));
  });

  it("does not silently choose between multiple ready Pi profiles", () => {
    const profiles = ["one", "two"].map((id) => ({
      id,
      providerId: "deepseek" as const,
      providerName: "DeepSeek",
      displayName: id,
      defaultModel: "deepseek-v4-pro" as const,
      verifiedModels: ["deepseek-v4-pro" as const],
      readiness: "ready" as const,
      reason: null,
    }));
    renderDetail({ providerProfiles: profiles, onSaveExecutionProfile: vi.fn() });

    chooseOption("执行引擎", "Pi API");

    expect(selectedOption("Provider")).toBe("选择 AI 服务商档案");
    expect(screen.getByText("请选择已就绪的 AI 服务商档案")).toBeVisible();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("preserves an unsupported historical profile until a supported model is selected", async () => {
    const onSaveExecutionProfile = vi.fn().mockImplementation(async (_slug, profile: AgentExecutionProfile) =>
      executionProfileDocument(profile));
    const base = detailProps();
    renderDetail({
      onSaveExecutionProfile,
      // 单一保存反映的是整名成员，所以要让正文保持干净，禁用才等价于「运行配置无可保存」。
      state: stateWith(managerEditor({ isDirty: false })),
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
    expect(selectedOption("Model")).toBe("future-model（旧版自定义配置）");
    expect(selectedOption("思考程度")).toBe("future-effort（当前列表不支持）");
    // 历史值即使不在当前列表里，也仍然是一个可选项，不会被悄悄换掉
    expect(optionLabels("Model")).toContain("future-model（旧版自定义配置）");
    expect(optionLabels("思考程度")).toContain("future-effort（当前列表不支持）");
    expect(screen.getByRole("status")).toHaveTextContent("旧版自定义配置会保留");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(onSaveExecutionProfile).not.toHaveBeenCalled();

    chooseOption("Model", "k3-256k（需相应会员权限）");
    expect(selectedOption("思考程度")).toBe("high");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

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
    await waitFor(() => expect(selectedOption("执行引擎")).toBe("Codex"));
    chooseOption("执行引擎", "Kimi");

    rerender(<AgentTeamDetail
      {...base}
      state={{ ...base.state, selectedMemberSlug: "dev" }}
    />);
    await waitFor(() => expect(selectedOption("执行引擎")).toBe("Codex"));

    rerender(<AgentTeamDetail
      {...base}
      state={{ ...base.state, selectedMemberSlug: "manager" }}
    />);
    await waitFor(() => expect(selectedOption("执行引擎")).toBe("Kimi"));
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
  ] as const)("guards %s when only the execution profile has an unsaved draft", async (actionKind, buttonName) => {
    const action = vi.fn().mockResolvedValue(undefined);
    const base = detailProps({
      state: stateWith(managerEditor({ isDirty: false })),
      onLeave: actionKind === "返回团队列表" ? action : vi.fn(),
      teamActions: ["修改团队信息", "复制内置团队", "复制用户团队", "删除用户团队"].includes(actionKind)
        ? (request) => <button type="button" onClick={() => request(action)}>{buttonName}</button>
        : undefined,
      memberActions: ["复制成员", "删除成员"].includes(actionKind)
        ? (request) => <button type="button" onClick={() => request(action)}>{buttonName}</button>
        : undefined,
    });
    render(<AgentTeamDetail {...base} />);

    await waitFor(() => expect(selectedOption("执行引擎")).toBe("Codex"));
    chooseOption("执行引擎", "Kimi");
    fireEvent.click(screen.getByRole("button", { name: buttonName }));

    expect(screen.getByRole("dialog", { name: "还有未保存的修改" })).toBeVisible();
    expect(action).not.toHaveBeenCalled();
  });

  it("keeps a static profile draft across parent rerenders without runtime-health UI", () => {
    const base = detailProps({ state: stateWith(managerEditor({ isDirty: false })) });
    const { rerender } = render(<AgentTeamDetail {...base} onSaveExecutionProfile={vi.fn()} />);
    chooseOption("Model", "gpt-5.4-mini");

    rerender(<AgentTeamDetail {...base} onSaveExecutionProfile={vi.fn()} />);

    expect(selectedOption("Model")).toBe("gpt-5.4-mini");
    expect(screen.queryByText("正在读取运行配置…")).not.toBeInTheDocument();
    expect(screen.queryByText(/无法验证|需要调整|重新检查运行能力/u)).not.toBeInTheDocument();
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

    expect(screen.queryByRole("combobox", { name: "主 Agent" })).toBeNull();
    // The unavailable member stays visible and stays marked, but cannot take first place.
    expect(screen.getByRole("tab", { name: /开发经理.*不可用/u })).toBeVisible();
    expect(onChangePrimaryAgent).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "删除 Agent" })).toBeVisible();
  });

  it("selects the first sync-changed member, enters edit mode, expands its timeline and scrolls to its first marker from the banner button without a container callback", () => {
    const scrollIntoView = stubScrollIntoView();
    const onSelectMember = vi.fn();
    const base = detailProps({
      onSelectMember,
      state: {
        ...stateWith(managerEditor({ isDirty: false })),
        memberEditors: {
          manager: { ...managerEditor(), isDirty: false, changeMarkers: [] },
          dev: {
            ...managerEditor(),
            memberSlug: "dev",
            displayName: "开发",
            description: "负责实现",
            isDirty: false,
            recentChange: { summary: "官方 v2 更新了 1 处", summaryStatus: "ready" as const, authorLabel: "官方 v2", timeLabel: "2026-08-06" },
            changeMarkers: [{
              blockIndex: 1,
              authorKind: "official",
              authorLabel: "官方 v2",
              timeLabel: "2026-08-06",
              previousText: "旧文本",
            }],
            revisionTimeline: [{
              id: "dev-r2",
              authorLabel: "官方 v2",
              timeLabel: "2026-08-06",
              summary: "官方更新",
              summaryStatus: "ready" as const,
            }],
          },
          qa: { ...managerEditor(), memberSlug: "qa", displayName: "测试", description: "负责验收", isDirty: false },
        },
      },
    });
    const banner = { officialVersion: "2", affectedMemberCount: 1, memberChanges: { added: ["dev"], removed: [], renamed: [], adopted: [], recommendationChanged: [], keptOverridden: [], collidedMembers: [], mergedMembers: [], pendingMergeMembers: [] } };
    const { rerender } = render(<AgentTeamDetail
      {...base}
      team={{ ...base.team, ownership: "system" }}
      officialSyncBanner={banner}
    />);

    // 横幅按钮在没有容器回调时也必须可用（行为是组件自有的）。
    fireEvent.click(screen.getByRole("button", { name: "看看改了什么" }));
    expect(onSelectMember).toHaveBeenCalledWith("dev");

    // 容器异步响应切换后，目标成员渲染出来：编辑模式开启（标记可见）、时间线展开并滚动到第一个标记。
    rerender(<AgentTeamDetail
      {...base}
      team={{ ...base.team, ownership: "system" }}
      state={{ ...base.state, selectedMemberSlug: "dev" }}
      officialSyncBanner={banner}
    />);
    expect(screen.getByRole("textbox", { name: "开发 的职责说明" })).toBeVisible();
    expect(screen.getByTestId("agent-team-markdown-timeline-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("agent-markdown-revision-timeline")).toBeVisible();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
  });

  it("expands the timeline and scrolls without switching when the first changed member is already selected", async () => {
    const scrollIntoView = stubScrollIntoView();
    const onSelectMember = vi.fn();
    const props = detailProps({
      onSelectMember,
      state: stateWith(managerEditor({
        isDirty: false,
        recentChange: { summary: "官方 v2 更新了 1 处", summaryStatus: "ready" as const, authorLabel: "官方 v2", timeLabel: "2026-08-06" },
        changeMarkers: [{
          blockIndex: 1,
          authorKind: "official",
          authorLabel: "官方 v2",
          timeLabel: "2026-08-06",
          previousText: "旧文本",
        }],
        revisionTimeline: [{
          id: "r2",
          authorLabel: "官方 v2",
          timeLabel: "2026-08-06",
          summary: "官方更新",
          summaryStatus: "ready" as const,
        }],
      })),
    });
    render(<AgentTeamDetail
      {...props}
      team={{ ...props.team, ownership: "system" }}
      officialSyncBanner={{ officialVersion: "2", affectedMemberCount: 1, memberChanges: { added: ["dev"], removed: [], renamed: [], adopted: [], recommendationChanged: [], keptOverridden: [], collidedMembers: [], mergedMembers: [], pendingMergeMembers: [] } }}
    />);

    fireEvent.click(screen.getByRole("button", { name: "看看改了什么" }));
    expect(onSelectMember).not.toHaveBeenCalled();
    expect(screen.getByTestId("agent-team-markdown-timeline-toggle")).toHaveAttribute("aria-expanded", "true");
    // The marker overlay commits a frame after the editor mounts; the bounded
    // retry scrolls once the marker appears.
    await waitFor(() => expect(scrollIntoView.mock.calls.length).toBeGreaterThanOrEqual(1));
  });

  it("prefers official-authored markers over user-only edits when picking the first changed member", () => {
    const onSelectMember = vi.fn();
    const props = detailProps({
      onSelectMember,
      state: {
        ...stateWith(managerEditor({ isDirty: false })),
        memberEditors: {
          manager: {
            ...managerEditor(),
            isDirty: false,
            recentChange: { summary: "你把返工上限改成两轮", summaryStatus: "ready" as const, authorLabel: "你", timeLabel: "2026-08-03" },
            changeMarkers: [{
              blockIndex: 1,
              authorKind: "user",
              authorLabel: "你",
              timeLabel: "2026-08-03",
              previousText: "三轮",
            }],
          },
          dev: {
            ...managerEditor(),
            memberSlug: "dev",
            displayName: "开发",
            description: "负责实现",
            isDirty: false,
            changeMarkers: [{
              blockIndex: 1,
              authorKind: "official",
              authorLabel: "官方 v2",
              timeLabel: "2026-08-06",
              previousText: null,
            }],
            revisionTimeline: [{
              id: "dev-r2",
              authorLabel: "官方 v2",
              timeLabel: "2026-08-06",
              summary: "官方更新",
              summaryStatus: "ready" as const,
            }],
          },
          qa: { ...managerEditor(), memberSlug: "qa", displayName: "测试", description: "负责验收", isDirty: false },
        },
      },
    });
    render(<AgentTeamDetail
      {...props}
      team={{ ...props.team, ownership: "system" }}
      officialSyncBanner={{ officialVersion: "2", affectedMemberCount: 1, memberChanges: { added: ["dev"], removed: [], renamed: [], adopted: [], recommendationChanged: [], keptOverridden: [], collidedMembers: [], mergedMembers: [], pendingMergeMembers: [] } }}
    />);

    fireEvent.click(screen.getByRole("button", { name: "看看改了什么" }));
    expect(onSelectMember).toHaveBeenCalledWith("dev");
  });

  it("asks for confirmation with the reverted version and member count before reverting from the banner", () => {
    const onRevertSync = vi.fn();
    const props = detailProps({
      onRevertSync,
      state: stateWith(managerEditor({ isDirty: false })),
    });
    render(<AgentTeamDetail
      {...props}
      team={{ ...props.team, ownership: "system" }}
      officialSyncBanner={{ officialVersion: "2", affectedMemberCount: 3, memberChanges: { added: [], removed: [], renamed: [], adopted: ["dev-manager", "dev", "qa"], recommendationChanged: [], keptOverridden: [], collidedMembers: [], mergedMembers: [], pendingMergeMembers: [] } }}
    />);

    fireEvent.click(screen.getByRole("button", { name: "撤销这次同步" }));
    const dialog = screen.getByRole("dialog", { name: "撤销这次同步" });
    expect(dialog.textContent).toContain("官方 2");
    expect(dialog.textContent).toContain("3 名成员");
    expect(onRevertSync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onRevertSync).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "撤销这次同步" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "撤销这次同步" }));
    fireEvent.click(screen.getByRole("button", { name: "撤销同步" }));
    expect(onRevertSync).toHaveBeenCalledTimes(1);
  });

  it("honors the view-changes signal raised by a container-owned surface", async () => {
    const scrollIntoView = stubScrollIntoView();
    const props = detailProps({
      state: stateWith(managerEditor({
        isDirty: false,
        changeMarkers: [{
          blockIndex: 1,
          authorKind: "official",
          authorLabel: "官方 v2",
          timeLabel: "2026-08-06",
          previousText: "旧文本",
        }],
        revisionTimeline: [{
          id: "r2",
          authorLabel: "官方 v2",
          timeLabel: "2026-08-06",
          summary: "官方更新",
          summaryStatus: "ready" as const,
        }],
      })),
    });
    render(<AgentTeamDetail
      {...props}
      team={{ ...props.team, ownership: "system" }}
      officialSyncBanner={{ officialVersion: "2", affectedMemberCount: 1, memberChanges: { added: [], removed: [], renamed: [], adopted: [], recommendationChanged: [], keptOverridden: [], collidedMembers: [], mergedMembers: [], pendingMergeMembers: [] } }}
      viewSyncChangesSignal={1}
    />);

    expect(screen.getByTestId("agent-team-markdown-timeline-toggle")).toHaveAttribute("aria-expanded", "true");
    // The marker overlay commits one frame after the editor mounts; the scroll
    // uses a bounded retry, so wait for at least one scroll asynchronously.
    await waitFor(() => expect(scrollIntoView.mock.calls.length).toBeGreaterThanOrEqual(1));
  });

  it("keeps the recent-change line with a neutral placeholder while the summary is pending", () => {
    renderDetail({
      state: stateWith(managerEditor({
        isDirty: false,
        recentChange: {
          summary: null,
          summaryStatus: "pending",
          authorLabel: "你",
          timeLabel: "刚刚",
        },
        changeMarkers: [{
          blockIndex: 0,
          authorKind: "user",
          authorLabel: "你",
          timeLabel: "刚刚",
          previousText: null,
        }],
      })),
    });

    // The line above the member's body AND the header summary status render the
    // same placeholder: the user stays near the editor and still sees the
    // summary settle (product-review blocker 3).
    expect(screen.getAllByText("最近变化 · 正在生成说明…")).toHaveLength(2);
    expect(screen.getByTestId("agent-team-markdown-summary-status")).toHaveTextContent(
      "最近变化 · 正在生成说明…",
    );
  });

  it("keeps the recent-change line with a mechanical placeholder when the summary is unavailable", () => {
    renderDetail({
      state: stateWith(managerEditor({
        isDirty: false,
        recentChange: {
          summary: null,
          summaryStatus: "unavailable",
          authorLabel: "你",
          timeLabel: "刚刚",
        },
        changeMarkers: [
          {
            blockIndex: 0,
            authorKind: "user",
            authorLabel: "你",
            timeLabel: "刚刚",
            previousText: null,
          },
          {
            blockIndex: 1,
            authorKind: "user",
            authorLabel: "你",
            timeLabel: "刚刚",
            previousText: null,
          },
        ],
      })),
    });

    expect(screen.getAllByText("最近变化 · 本次改动涉及 2 处")).toHaveLength(2);
    expect(screen.getByTestId("agent-team-markdown-summary-status")).toHaveTextContent(
      "最近变化 · 本次改动涉及 2 处",
    );
  });

  it("settles the header summary status in place from pending to the terminal copy", () => {
    const { rerender } = renderDetail({
      state: stateWith(managerEditor({
        isDirty: false,
        recentChange: {
          summary: null,
          summaryStatus: "pending",
          authorLabel: "你",
          timeLabel: "刚刚",
        },
        changeMarkers: [{
          blockIndex: 1,
          authorKind: "user",
          authorLabel: "你",
          timeLabel: "刚刚",
          previousText: "旧文本",
        }],
      })),
    });
    const status = screen.getByTestId("agent-team-markdown-summary-status");
    expect(status).toHaveTextContent("最近变化 · 正在生成说明…");

    // The summary-settled refresh replaces the same line in place with the
    // terminal copy — no member switch, no scroll, no extra element.
    rerender(<AgentTeamDetail {...detailProps({
      state: stateWith(managerEditor({
        isDirty: false,
        recentChange: {
          summary: "把返工上限从三轮改成两轮",
          summaryStatus: "ready",
          authorLabel: "你",
          timeLabel: "刚刚",
        },
        changeMarkers: [{
          blockIndex: 1,
          authorKind: "user",
          authorLabel: "你",
          timeLabel: "刚刚",
          previousText: "旧文本",
        }],
      })),
    })} />);
    expect(screen.getByTestId("agent-team-markdown-summary-status")).toHaveTextContent(
      "最近变化 · 把返工上限从三轮改成两轮",
    );
    expect(screen.getAllByText("最近变化 · 把返工上限从三轮改成两轮")).toHaveLength(2);
  });

  it("marks a changed body block in the editor using body-relative block indices", () => {
    // The member file carries frontmatter: the desktop computes markers against
    // the FULL document, so block 0 is the frontmatter; the editor only shows the
    // body, and the marker must land on the body's own second block.
    renderDetail({
      state: stateWith(managerEditor({
        isDirty: false,
        draftMarkdown: "---\ndisplay_name: 开发经理\ndescription: 默认接单\n---\n\n# 开发经理\n\n负责实现。\n",
        changeMarkers: [{
          blockIndex: 2,
          authorKind: "user",
          authorLabel: "你",
          timeLabel: "刚刚",
          previousText: "旧职责",
        }],
      })),
    });

    enterMarkdownEdit();
    // The body has two blocks ("# 开发经理" and "负责实现。"); the marker's full-document
    // block 2 becomes body block 1, and the marker band renders.
    expect(screen.getByRole("textbox", { name: "开发经理 的职责说明" }))
      .toHaveAttribute("data-raw-markdown", "# 开发经理\n\n负责实现。\n");
    const markers = document.querySelectorAll("[data-change-marker]");
    expect(markers).toHaveLength(1);
    expect(markers[0]!.getAttribute("data-block-index")).toBe(null);
  });
});

function renderDetail(overrides: Partial<AgentTeamDetailProps> = {}) {
  return render(<AgentTeamDetail {...detailProps(overrides)} />);
}

/** jsdom does not implement `scrollIntoView`; expose a spy on the prototype for scroll assertions. */
function stubScrollIntoView(): ReturnType<typeof vi.fn> {
  const spy = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: spy,
  });
  return spy;
}

/**
 * `AGENT.md` now reads by default; editing is an explicit step, so tests take it too. Idempotent
 * because the component keeps edit mode across a rerender.
 */
function enterMarkdownEdit(): void {
  const enter = screen.queryByRole("button", { name: "编辑" });
  if (enter !== null) {
    fireEvent.click(enter);
  }
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

const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

/**
 * dnd-kit's sensors need real geometry; jsdom reports zero rects. Chips get a clean horizontal
 * layout so the keyboard sensor can compute "move one slot left" and the collision detector can
 * resolve the drop target.
 */
function mockMemberStripRects(): void {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const chips = [...document.querySelectorAll<HTMLElement>("[data-member-slug]")];
    const index = chips.indexOf(this);
    const left = index < 0 ? 0 : index * 100;
    return {
      x: left,
      y: 0,
      width: 80,
      height: 36,
      top: 0,
      left,
      right: left + 80,
      bottom: 36,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The keyboard-equivalent drag (Space to lift, arrows to move, Space to drop). The sensor's
 * move/end listeners attach on a macrotask after activation, so each key press is followed by
 * a tick.
 */
async function moveChipToFirst(chip: HTMLElement): Promise<void> {
  chip.focus();
  fireEvent.keyDown(chip, { code: "Space", key: " " });
  await tick();
  fireEvent.keyDown(chip, { code: "ArrowLeft", key: "ArrowLeft" });
  fireEvent.keyDown(chip, { code: "ArrowLeft", key: "ArrowLeft" });
  await tick();
  fireEvent.keyDown(chip, { code: "Space", key: " " });
}

async function pickPortrait(user: ReturnType<typeof userEvent.setup>, face: PortraitId): Promise<void> {
  await user.click(screen.getByRole("button", { name: /更换 .*的画像/u }));
  const options = within(screen.getByRole("radiogroup")).getAllByRole("radio");
  const index = PORTRAIT_IDS.indexOf(face);
  expect(index).toBeGreaterThanOrEqual(0);
  await user.click(options[index]!);
}

function firstNonDefaultPortrait(slug: string): PortraitId {
  const fallback = defaultPortraitId(slug);
  return PORTRAIT_IDS.find((id) => id !== fallback) ?? PORTRAIT_IDS[0]!;
}
