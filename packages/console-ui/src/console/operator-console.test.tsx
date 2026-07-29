import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SIDEBAR_WIDTH_PX,
  MAX_SIDEBAR_WIDTH_PX,
  MIN_SIDEBAR_WIDTH_PX,
  NARROW_WINDOW_WIDTH_PX,
  OperatorConsole,
  resolveNewConversationAgentTeamKey,
  type OperatorConsoleProps,
  type OperatorMessage,
  type OperatorProject,
  type OperatorRunSnapshot,
  type OperatorSession,
} from "./operator-console";
import type { FileReferenceContent } from "./file-reference-tab";
import type { RightSidebarTabsState } from "./right-sidebar-tabs";

const originalWindowWidth = window.innerWidth;

afterEach(() => {
  setWindowWidth(originalWindowWidth);
});

describe("OperatorConsole", () => {
  it("reuses the ordinary conversation layout without the application shell when embedded", () => {
    renderConsole({ presentation: "conversation" });

    expect(screen.queryByTestId("operator-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("main-window-drag-region")).not.toBeInTheDocument();
    expect(screen.queryByTestId("right-sidebar")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "默认会话" })).toBeVisible();
    expect(screen.getByRole("region", { name: "会话时间线" })).toBeVisible();
    expect(screen.getByTestId("operator-content-shell").parentElement).toHaveClass("h-full", "min-h-0");
  });

  it("renders the fixed sidebar skeleton around the only scrolling project region", () => {
    renderConsole({ onOpenDiagnostics: vi.fn() });

    const sidebar = screen.getByTestId("operator-sidebar");
    const windowControls = screen.getByTestId("sidebar-window-controls");
    const brandRegion = screen.getByTestId("sidebar-brand-region");
    const appActions = screen.getByTestId("sidebar-app-actions");
    const projectList = screen.getByRole("navigation", { name: "项目列表" });
    const footer = screen.getByTestId("sidebar-footer");
    const projectHeading = screen.getByText("项目");

    const brandLogo = screen.getByTestId("moebius-logo");
    expect(brandLogo).toBeVisible();
    expect(brandLogo).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Moebius")).toBeVisible();
    expect(windowControls).toHaveClass(
      "window-drag-region",
      "h-[var(--window-header-height)]",
      "pl-[76px]",
    );
    expect(windowControls).not.toHaveClass("pt-[6px]");
    expect(brandRegion).toHaveClass("window-drag-region", "h-[34px]", "px-4");
    expect(brandRegion).not.toHaveClass("pl-[76px]");
    expect(windowControls).not.toContainElement(brandLogo);
    expect(screen.getByRole("button", { name: "关闭侧边栏" })).toHaveClass("window-no-drag");
    expect(screen.getByRole("button", { name: "关闭侧边栏" })).toHaveAttribute("title", "关闭侧边栏");

    const appEntries = ["新建对话", "搜索", "Agent 团队"].map((name) =>
      screen.getByRole("button", { name }),
    );
    expect(new Set(appEntries.map((entry) => entry.className)).size).toBe(1);
    for (const [index, entry] of appEntries.entries()) {
      expect(entry).toHaveAttribute("aria-label", ["新建对话", "搜索", "Agent 团队"][index]);
      expect(entry).toHaveAttribute("title", ["新建对话", "搜索", "Agent 团队"][index]);
    }
    expect(projectHeading).toBeVisible();
    expect(screen.getByRole("button", { name: "重新查看引导" })).toBeVisible();
    expect(screen.getByRole("button", { name: "设置" })).toBeVisible();
    expect(within(footer).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "重新查看引导",
      "设置",
    ]);

    expect(sidebar).toContainElement(brandRegion);
    expect(sidebar).toContainElement(appActions);
    expect(sidebar).toContainElement(projectHeading);
    expect(sidebar).toContainElement(projectList);
    expect(sidebar).toContainElement(footer);
    expect(projectList).toHaveClass("overflow-auto");
    expect(projectList).not.toContainElement(brandRegion);
    expect(projectList).not.toContainElement(appActions);
    expect(projectList).not.toContainElement(projectHeading);
    expect(projectList).not.toContainElement(footer);

    expect(screen.queryByRole("button", { name: "打开项目" })).not.toBeInTheDocument();
    expect(screen.queryByText("开发者诊断")).not.toBeInTheDocument();
    expect(screen.queryByText(/本地引擎/u)).not.toBeInTheDocument();
  });

  it("keeps sidebar icon controls keyboard-focusable in visual order with readable names and hover titles", () => {
    renderConsole({
      onShowProjectInFolder: vi.fn(),
      onRenameProject: vi.fn(),
      onRemoveProject: vi.fn(),
      onArchiveSession: vi.fn(),
    });

    const sidebar = screen.getByTestId("operator-sidebar");
    const controls = Array.from(sidebar.querySelectorAll<HTMLElement>("button, [role='button']"));
    expect(controls.map((control) => control.getAttribute("aria-label") ?? control.textContent?.trim())).toEqual([
      "关闭侧边栏",
      "新建对话",
      "搜索",
      "Agent 团队",
      "moebius 项目，已展开",
      "在 moebius 中新建会话",
      "moebius 项目菜单",
      "默认会话，正在运行",
      "默认会话 对话菜单",
      "验收会话，需要你处理",
      "验收会话 对话菜单",
      "重新查看引导",
      "设置",
    ]);
    for (const control of controls) {
      expect(control.tabIndex).toBeGreaterThanOrEqual(0);
      expect(control.getAttribute("aria-label") ?? control.textContent?.trim()).not.toBe("");
      expect(control).toHaveAttribute("title");
    }
  });

  it("keeps all three application entries available when there are no projects", () => {
    renderConsole({ projects: [] });

    expect(screen.getByText("从“新建对话”添加第一个项目")).toBeVisible();
    expect(screen.getByRole("button", { name: "新建对话" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "搜索" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Agent 团队" })).toBeEnabled();
  });

  it("delegates onboarding replay without coupling the presentational console to routing", () => {
    const onReplayOnboarding = vi.fn();
    renderConsole({ onReplayOnboarding });

    fireEvent.click(screen.getByRole("button", { name: "重新查看引导" }));

    expect(onReplayOnboarding).toHaveBeenCalledOnce();
  });

  it("opens the controlled language settings dialog without unmounting the workspace", () => {
    const onSelectLocale = vi.fn();
    renderConsole({ onSelectLocale });
    const sidebar = screen.getByTestId("operator-sidebar");

    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    expect(screen.getByRole("dialog", { name: "设置" })).toBeVisible();
    expect(sidebar).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(onSelectLocale).toHaveBeenCalledWith("en");
  });

  it("renders the settings entry and dialog from the active English resource", () => {
    renderConsole({ activeLocale: "en" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(screen.getByText("Choose the language used by the Moebius interface.")).toBeVisible();
  });

  it("keeps a slow update result across close and parent callback identity changes", () => {
    const initial = baseProps({
      settingsAbout: { currentVersion: "0.1.4", updateStatus: "checking" },
      onCheckSettingsUpdates: vi.fn(),
    });
    const view = render(<OperatorConsole {...initial} />);
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByText("正在检查…")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByText("正在检查…")).toBeVisible();
    expect(screen.getByRole("button", { name: "关于" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    view.rerender(<OperatorConsole
      {...initial}
      onCheckSettingsUpdates={vi.fn()}
      settingsAbout={{
        currentVersion: "0.1.4",
        latestVersion: "0.1.5",
        downloadUrl: "https://github.com/tranfu-labs/moebius/releases/tag/desktop-v0.1.5",
        updateStatus: "available",
      }}
    />);

    expect(screen.getByRole("status")).toHaveTextContent("发现新版本 0.1.5");
    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));
    expect(screen.getByText("新版 0.1.5")).toBeVisible();
    expect(screen.getByRole("button", { name: "下载新版本" })).toBeEnabled();
  });

  it("reports an external browser failure in About without leaving the workspace", async () => {
    const onOpenSettingsExternalLink = vi.fn(async () => {
      throw new Error("browser unavailable");
    });
    renderConsole({
      settingsAbout: { currentVersion: "0.1.4", updateStatus: "idle" },
      settingsExternalLinks: {
        releaseNotes: "https://github.com/tranfu-labs/moebius/releases",
        feedback: "https://github.com/tranfu-labs/moebius/issues/new",
        repository: "https://github.com/tranfu-labs/moebius",
      },
      onOpenSettingsExternalLink,
    });
    const workspace = screen.getByTestId("operator-sidebar").parentElement;

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: "关于" }));
    fireEvent.click(screen.getByRole("button", { name: "查看发布记录" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("无法打开系统浏览器"));
    expect(onOpenSettingsExternalLink).toHaveBeenCalledWith(
      "https://github.com/tranfu-labs/moebius/releases",
    );
    expect(screen.getByTestId("operator-sidebar").parentElement).toBe(workspace);
  });

  it("notifies a language save result completed after the dialog closes", () => {
    const initial = baseProps({ languageSaveStatus: "saving" });
    const view = render(<OperatorConsole {...initial} />);
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    view.rerender(<OperatorConsole {...initial} languageSaveStatus="failed" />);

    expect(screen.getByRole("status")).toHaveTextContent("语言设置保存失败");
    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));
    expect(screen.getByText(/无法保存语言设置/u)).toBeVisible();
  });

  it("preserves user content and the mounted workspace when the active locale changes", () => {
    const props = baseProps({
      composerValue: "用户草稿 must stay byte-for-byte",
      messages: [message({ id: 1, body: "Agent 原始回复 must stay byte-for-byte" })],
    });
    const view = render(<OperatorConsole {...props} />);
    const workspace = screen.getByTestId("operator-sidebar").parentElement;

    view.rerender(<OperatorConsole {...props} activeLocale="en" />);

    expect(screen.getByDisplayValue("用户草稿 must stay byte-for-byte")).toBeVisible();
    expect(screen.getByText("Agent 原始回复 must stay byte-for-byte")).toBeVisible();
    expect(screen.getByTestId("operator-sidebar").parentElement).toBe(workspace);
  });

  it("shows project loading structure while keeping independent application areas available", () => {
    renderConsole({ projectListState: "loading" });

    expect(screen.getByLabelText("项目正在加载")).toBeVisible();
    expect(screen.getByRole("button", { name: "新建对话" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "搜索" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Agent 团队" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "设置" })).toBeEnabled();
  });

  it("shows project load failure with retry while Agent teams and Settings stay available", () => {
    const onRetryProjectList = vi.fn();
    renderConsole({ projectListState: "error", onRetryProjectList });

    expect(screen.getByRole("alert")).toHaveTextContent("项目加载失败");
    expect(screen.getByRole("button", { name: "Agent 团队" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "设置" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetryProjectList).toHaveBeenCalledTimes(1);
  });

  it("disables conflicting project entries during configuration changes without blocking browsing", async () => {
    const onSelectSession = vi.fn();
    renderConsole({
      isProjectMutationPending: true,
      onSelectSession,
      onShowProjectInFolder: vi.fn(),
    });

    expect(screen.getByRole("button", { name: "新建对话" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "在 moebius 中新建会话" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "moebius 项目菜单" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "搜索" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Agent 团队" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "设置" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("正在更新…");

    fireEvent.click(screen.getByRole("button", { name: "验收会话，需要你处理" }));
    expect(onSelectSession).toHaveBeenCalledWith({ sessionId: "session-b", projectId: "local" });

    const projectToggle = screen.getByRole("button", { name: "moebius 项目，已展开" });
    fireEvent.keyDown(projectToggle, { key: "Enter" });
    expect(projectToggle).toHaveAttribute("aria-expanded", "false");
  });

  it("routes the application entry to the unscoped new-conversation page without opening a dialog", () => {
    const onStartNewConversation = vi.fn();
    renderConsole({ onStartNewConversation });

    fireEvent.click(screen.getByRole("button", { name: "新建对话" }));

    expect(onStartNewConversation).toHaveBeenCalledWith(undefined);
    expect(screen.queryByRole("dialog", { name: "新建对话" })).not.toBeInTheDocument();
  });

  it("routes a project-row entry to the same page with that explicit project", () => {
    const onStartNewConversation = vi.fn();
    const secondProject: OperatorProject = {
      ...project,
      projectId: "project-b",
      title: "project-b",
      folderPath: "/Users/example/project-b",
      sessions: [],
    };
    renderConsole({ projects: [project, secondProject], onStartNewConversation });

    fireEvent.click(screen.getByRole("button", { name: "在 project-b 中新建会话" }));

    expect(onStartNewConversation).toHaveBeenCalledWith("project-b");
  });

  it("renders the controlled new-conversation page instead of the selected session", () => {
    const userTeam = {
      ...agentTeam,
      teamKey: "user:my-team",
      id: "my-team",
      ownership: "user" as const,
      name: "我的团队",
    };
    const onNewConversationTeamChange = vi.fn();
    const onSubmitNewConversation = vi.fn();
    renderConsole({
      agentTeamsState: { status: "ready", teams: [agentTeam, userTeam] },
      newConversation: {
        selectedProjectId: null,
        selectedWorkspaceMode: "direct",
        selectedTeamKey: userTeam.teamKey,
        draft: "描述目标",
        isSubmitting: false,
        error: null,
      },
      onNewConversationTeamChange,
      onSubmitNewConversation,
    });

    const teamSelector = screen.getByRole("combobox", { name: "Agent 团队" });
    expect(teamSelector).toHaveValue(userTeam.teamKey);
    expect(screen.getByRole("region", { name: "新建对话" })).toBeVisible();
    expect(screen.getByRole("button", { name: "新建对话" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("region", { name: "会话时间线" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();

    fireEvent.change(teamSelector, { target: { value: agentTeam.teamKey } });
    expect(onNewConversationTeamChange).toHaveBeenCalledWith(agentTeam.teamKey);
    expect(onSubmitNewConversation).not.toHaveBeenCalled();
  });

  it("falls back to the first built-in team for first use, deletion, drafts, and repair states", () => {
    const unavailableLastUsed = {
      ...agentTeam,
      teamKey: "user:broken",
      id: "broken",
      ownership: "user" as const,
      name: "需要修复的团队",
      status: "needs-repair" as const,
      canCreateConversation: false,
    };
    const draft = {
      ...unavailableLastUsed,
      teamKey: "user:draft",
      id: "draft",
      name: "未完成团队",
      status: "unfinished-draft" as const,
    };
    const teams = [agentTeam, unavailableLastUsed, draft];
    const pendingTeam = {
      ...agentTeam,
      teamKey: "user:onboarding",
      id: "onboarding",
      ownership: "user" as const,
      name: "引导所选团队",
    };
    expect(resolveNewConversationAgentTeamKey(teams, null)).toBe(agentTeam.teamKey);
    expect(resolveNewConversationAgentTeamKey(teams, "user:deleted")).toBe(agentTeam.teamKey);
    expect(resolveNewConversationAgentTeamKey(teams, unavailableLastUsed.teamKey)).toBe(agentTeam.teamKey);
    expect(resolveNewConversationAgentTeamKey(
      [agentTeam, pendingTeam],
      agentTeam.teamKey,
      pendingTeam.teamKey,
    )).toBe(pendingTeam.teamKey);
  });

  it("keeps a project with an unavailable directory out of the new-conversation flow", () => {
    renderConsole({
      project: {
        ...project,
        newConversationDisabledReason: "当前项目本地文件夹不可用，无法新建对话",
      },
    });

    const projectNewConversation = screen.getByRole("button", { name: "在 moebius 中新建会话" });
    expect(projectNewConversation).toBeDisabled();
    expect(projectNewConversation).toHaveAttribute("title", "当前项目本地文件夹不可用，无法新建对话");
    fireEvent.click(projectNewConversation);
  });

  it("offers project setup inside the new-conversation project menu when no project exists", async () => {
    const onAddNewConversationProject = vi.fn();
    renderConsole({
      projects: [],
      newConversation: {
        selectedProjectId: null,
        selectedWorkspaceMode: "direct",
        selectedTeamKey: agentTeam.teamKey,
        draft: "目标",
        isSubmitting: false,
        error: null,
      },
      agentTeamsState: { status: "ready", teams: [agentTeam] },
      onAddNewConversationProject,
    });

    expect(screen.getByText("还没有项目，从上面的项目按钮添加一个")).toBeVisible();
    fireEvent.keyDown(screen.getByRole("button", { name: "项目：未选择，点击选择" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "添加项目…" }));
    expect(onAddNewConversationProject).toHaveBeenCalledTimes(1);
  });

  it("opens search over the current selection and restores it when closed", () => {
    renderConsole();
    const selectedSession = screen.getByRole("button", { name: "默认会话，正在运行" });

    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    expect(screen.getByRole("dialog", { name: "全局搜索" })).toBeVisible();
    expect(selectedSession).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog", { name: "全局搜索" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "默认会话，正在运行" })).toBe(selectedSession);
  });

  it("routes Agent Teams to the real data container and restores the current conversation", () => {
    renderConsole({
      agentTeamsState: { status: "ready", teams: [agentTeam] },
      selectedAgentTeamKey: "system:development",
      selectedAgentTeamMemberSlug: "manager",
    });
    const teamsEntry = screen.getByRole("button", { name: "Agent 团队" });

    fireEvent.click(teamsEntry);

    expect(teamsEntry).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Agent 团队" })).toBeVisible();
    expect(screen.getByLabelText("团队数据已载入")).toHaveAttribute("data-team-count", "1");
    expect(screen.getByLabelText("团队数据已载入")).toHaveAttribute("data-selected-team-key", "system:development");
    expect(screen.getByLabelText("团队数据已载入")).toHaveAttribute("data-selected-member-slug", "manager");
    expect(screen.queryByRole("region", { name: "会话时间线" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回当前对话" }));
    expect(teamsEntry).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("region", { name: "会话时间线" })).toBeVisible();
    expect(screen.getByRole("button", { name: "默认会话，正在运行" })).toHaveAttribute("aria-current", "page");
  });

  it("routes sidebar conversation selection through the conversation entry and protects unsaved team drafts", () => {
    const onSelectSession = vi.fn();
    const onDiscardAllAgentTeamDrafts = vi.fn();
    const dirtyDetail = detailStateFor(agentTeam.teamKey);
    dirtyDetail.memberEditors.manager!.isDirty = true;
    renderConsole({
      agentTeamsState: { status: "ready", teams: [agentTeam] },
      selectedAgentTeamKey: agentTeam.teamKey,
      agentTeamDetailState: dirtyDetail,
      onSelectSession,
      onDiscardAllAgentTeamDrafts,
    });
    fireEvent.click(screen.getByRole("button", { name: "Agent 团队" }));

    fireEvent.click(screen.getByRole("button", { name: "验收会话，需要你处理" }));
    expect(onSelectSession).not.toHaveBeenCalled();
    const prompt = screen.getByRole("dialog", { name: "还有未保存的修改" });
    fireEvent.click(within(prompt).getByRole("button", { name: "放弃全部" }));

    expect(onDiscardAllAgentTeamDrafts).toHaveBeenCalledWith(agentTeam.teamKey);
    expect(onSelectSession).toHaveBeenCalledWith({ sessionId: "session-b", projectId: "local" });
    expect(screen.getByRole("region", { name: "会话时间线" })).toBeVisible();
  });

  it("routes from Agent Teams into the new-conversation entry through the shared conversation gate", () => {
    const onStartNewConversation = vi.fn();
    renderConsole({
      agentTeamsState: { status: "ready", teams: [agentTeam] },
      onStartNewConversation,
    });
    fireEvent.click(screen.getByRole("button", { name: "Agent 团队" }));
    fireEvent.click(screen.getByRole("button", { name: "新建对话" }));

    expect(onStartNewConversation).toHaveBeenCalledWith(undefined);
    expect(screen.getByRole("region", { name: "会话时间线" })).toBeVisible();
  });

  it("returns to the conversation view when archiving the selected session from the teams page", async () => {
    const onArchiveSession = vi.fn();
    renderConsole({
      project: { ...project, sessions: [sessions[1]!], runningCount: 0 },
      selectedSessionId: "session-b",
      selectedSession: sessions[1],
      onArchiveSession,
    });
    fireEvent.click(screen.getByRole("button", { name: "Agent 团队" }));

    fireEvent.contextMenu(screen.getByRole("button", { name: "验收会话，需要你处理" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "归档" }));

    expect(onArchiveSession).toHaveBeenCalledWith("session-b", "local");
    expect(screen.getByRole("region", { name: "会话时间线" })).toBeVisible();
  });

  it("passes a sidebar copy-path action through the operator console without exposing a path", async () => {
    const onCopySessionLogPath = vi.fn(async () => ({ ok: true as const }));
    renderConsole({ onCopySessionLogPath });

    fireEvent.contextMenu(screen.getByRole("button", { name: "验收会话，需要你处理" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "复制对话记录路径" }));

    expect(onCopySessionLogPath).toHaveBeenCalledWith("session-b", "local");
    expect(await screen.findByRole("status")).toHaveTextContent("路径已复制");
    expect(document.body.textContent).not.toContain(".jsonl");
  });

  it("returns to the conversation view before removing the active project from the teams page", async () => {
    const onRemoveProject = vi.fn().mockResolvedValue(undefined);
    renderConsole({ project: { ...project, runningCount: 0 }, onRemoveProject });
    fireEvent.click(screen.getByRole("button", { name: "Agent 团队" }));

    await openProjectMenu("moebius");
    fireEvent.click(screen.getByRole("menuitem", { name: "移除项目" }));
    fireEvent.click(screen.getByRole("button", { name: "移除项目" }));

    await waitFor(() => expect(onRemoveProject).toHaveBeenCalledWith("local", false));
    expect(screen.getByRole("region", { name: "会话时间线" })).toBeVisible();
  });

  it("shows one accessible repair indicator and identifies every affected team after opening the page", () => {
    const secondRepairTeam = {
      ...repairTeam,
      teamKey: "user:repair-two",
      id: "repair-two",
      name: "内容团队",
    };
    renderConsole({
      agentTeamsState: { status: "ready", teams: [draftTeam, repairTeam, secondRepairTeam] },
    });

    const indicators = screen.getAllByRole("img", { name: "有 Agent 团队需要修复" });
    expect(indicators).toHaveLength(1);
    expect(indicators[0]).toHaveAttribute("title", "有 Agent 团队需要修复");
    expect(indicators[0]).toHaveTextContent("");

    fireEvent.click(screen.getByRole("button", { name: "Agent 团队" }));

    const rows = screen.getAllByTestId("agent-team-row");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("未完成")).toBeVisible();
    expect(within(rows[0]).queryByText("需要修复")).not.toBeInTheDocument();
    expect(within(rows[1]).getByText("需要修复")).toBeVisible();
    expect(within(rows[2]).getByText("需要修复")).toBeVisible();
  });

  it("does not show the sidebar repair indicator for unfinished drafts", () => {
    renderConsole({ agentTeamsState: { status: "ready", teams: [draftTeam] } });

    expect(screen.queryByRole("img", { name: "有 Agent 团队需要修复" })).not.toBeInTheDocument();
  });

  it("keeps session history visible while a selected team needing repair blocks sending", () => {
    const onSend = vi.fn();
    renderConsole({
      agentTeamsState: { status: "ready", teams: [repairTeam] },
      conversationAgentTeamKey: repairTeam.teamKey,
      selectedSession: {
        ...sessions[0]!,
        agentTeamOwnership: "user",
        agentTeamId: "repair",
        agentTeamHealth: "needs-repair",
      },
      onSend,
    });

    expect(screen.getByRole("region", { name: "会话时间线" })).toHaveTextContent("@dev hello");
    const teamButton = screen.getByRole("button", { name: "Agent 团队：客户支持团队，需要修复，点击切换" });
    expect(teamButton).toHaveClass("text-danger");
    expect(teamButton).toHaveTextContent("客户支持团队需要修复");
    expect(screen.getByRole("textbox", { name: "消息内容" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
    expect(screen.getByText("历史对话只读；修复或改选团队后可继续")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not let browsing a broken team change a healthy conversation's team or sending state", () => {
    renderConsole({
      agentTeamsState: { status: "ready", teams: [agentTeam, repairTeam] },
      conversationAgentTeamKey: agentTeam.teamKey,
      selectedAgentTeamKey: repairTeam.teamKey,
      selectedSession: {
        ...sessions[0]!,
        agentTeamOwnership: "system",
        agentTeamId: "development",
        agentTeamHealth: "usable",
      },
    });

    expect(screen.getByRole("textbox", { name: "消息内容" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Agent 团队：开发团队，点击切换" })).toBeVisible();
  });

  it("uses the team displayed in composer context for mention completion", () => {
    const pendingTeam = {
      ...agentTeam,
      teamKey: "user:review",
      id: "review",
      ownership: "user" as const,
      name: "评审团队",
      primaryAgentSlug: "security",
      memberOrder: ["security"],
      members: [{ slug: "security", displayName: "安全评审", description: "审查安全风险" }],
    };
    renderConsole({
      agentTeamsState: { status: "ready", teams: [agentTeam, pendingTeam] },
      conversationAgentTeamKey: agentTeam.teamKey,
      composerValue: "@",
      selectedSession: {
        ...sessions[0]!,
        agentTeamOwnership: "system",
        agentTeamId: "development",
        agentTeamHealth: "usable",
        agentTeamPendingOwnership: "user",
        agentTeamPendingId: "review",
      },
    });
    const input = screen.getByRole("textbox", { name: "消息内容" }) as HTMLTextAreaElement;
    input.setSelectionRange(1, 1);
    fireEvent.focus(input);
    fireEvent.select(input);

    expect(screen.getByRole("option", { name: /安全评审/u })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /开发经理/u })).not.toBeInTheDocument();
  });

  it("uses refreshed session health so an externally repaired team unblocks without reopening teams", () => {
    renderConsole({
      agentTeamsState: { status: "ready", teams: [repairTeam] },
      conversationAgentTeamKey: repairTeam.teamKey,
      selectedSession: {
        ...sessions[0]!,
        agentTeamOwnership: "user",
        agentTeamId: "repair",
        agentTeamHealth: "usable",
      },
    });

    expect(screen.getByRole("textbox", { name: "消息内容" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "发送消息" })).toBeEnabled();
  });

  it("keeps the horizontal team-row structure while Agent teams are loading", () => {
    renderConsole({ agentTeamsState: { status: "loading" } });
    fireEvent.click(screen.getByRole("button", { name: "Agent 团队" }));

    expect(screen.getByRole("status", { name: "Agent 团队正在加载" })).toBeVisible();
    expect(screen.getAllByTestId("agent-team-loading-row")).toHaveLength(2);
    expect(screen.queryByText(/没有团队/u)).not.toBeInTheDocument();
  });

  it("preserves the page frame and offers retry when team loading fails", () => {
    const onRetryAgentTeams = vi.fn();
    renderConsole({ agentTeamsState: { status: "error" }, onRetryAgentTeams });
    fireEvent.click(screen.getByRole("button", { name: "Agent 团队" }));

    expect(screen.getByRole("heading", { name: "Agent 团队" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("暂时无法加载 Agent 团队");
    expect(screen.getByRole("alert")).toHaveTextContent("团队数据没有被清空");
    expect(screen.queryByText(/没有团队/u)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetryAgentTeams).toHaveBeenCalledTimes(1);
  });

  it("calls out an application configuration error when built-in teams cannot load", () => {
    const onRetryAgentTeams = vi.fn();
    renderConsole({ agentTeamsState: { status: "configuration-error" }, onRetryAgentTeams });
    fireEvent.click(screen.getByRole("button", { name: "Agent 团队" }));

    expect(screen.getByRole("heading", { name: "Agent 团队" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("应用配置异常");
    expect(screen.getByRole("alert")).toHaveTextContent("软件自带的 Agent 团队无法读取");
    expect(screen.queryByRole("button", { name: "新建团队" })).not.toBeInTheDocument();
    expect(screen.queryByText(/没有团队/u)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetryAgentTeams).toHaveBeenCalledTimes(1);
  });

  it("renders one flat, fully clickable row per team with readable status badges", () => {
    setWindowWidth(1200);
    renderConsole({ agentTeamsState: { status: "ready", teams: [fiveMemberTeam, draftTeam, repairTeam] } });
    fireEvent.click(screen.getByRole("button", { name: "Agent 团队" }));

    const rows = screen.getAllByTestId("agent-team-row");
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.tagName === "BUTTON")).toBe(true);
    expect(rows.every((row) => row.querySelector("svg") === null)).toBe(true);
    expect(within(rows[0]).getByText("官方来源")).toBeVisible();
    expect(within(rows[1]).getByText("未完成")).toBeVisible();
    expect(within(rows[2]).getByText("需要修复")).toBeVisible();
    expect(within(rows[0]).getByText("5 名成员 · 主 Agent：开发经理")).toBeVisible();

    const memberStrip = within(rows[0]).getByTestId("agent-team-members");
    expect(within(memberStrip).getByTitle("开发经理")).toHaveAccessibleName("开发经理");
    expect(memberStrip.querySelectorAll("[data-agent-initial-avatar]")).toHaveLength(3);
    for (const memberName of ["开发经理", "开发", "测试"]) {
      expect(within(memberStrip).getByTitle(memberName)).toHaveClass("w-28");
    }
    expect(within(memberStrip).getByText("· 主 Agent")).toBeVisible();
    expect(within(memberStrip).getByLabelText("还有 2 名成员")).toHaveTextContent("＋2");
    expect(screen.queryByText("修改信息")).not.toBeInTheDocument();
    expect(screen.queryByText("复制并编辑")).not.toBeInTheDocument();
    expect(screen.queryByText("删除团队")).not.toBeInTheDocument();
  });

  it("creates a durable team draft from a short two-field dialog", async () => {
    const onCreateAgentTeam = vi.fn().mockResolvedValue(draftTeam);
    renderConsole({
      agentTeamsState: { status: "ready", teams: [agentTeam, draftTeam] },
      onCreateAgentTeam,
    });
    fireEvent.click(screen.getByRole("button", { name: "Agent 团队" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "新建团队" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "从空白开始" }));

    const dialog = screen.getByRole("dialog", { name: "新建团队" });
    expect(within(dialog).getAllByRole("textbox")).toHaveLength(2);
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "团队名称" }), {
      target: { value: "内容团队" },
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "一句话描述" }), {
      target: { value: "负责内容生产" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建团队" }));

    await waitFor(() => expect(onCreateAgentTeam).toHaveBeenCalledWith({
      name: "内容团队",
      description: "负责内容生产",
    }));
  });

  it("keeps a single team row at narrow widths and compacts extra members behind ＋N", () => {
    setWindowWidth(1200);
    renderConsole({ agentTeamsState: { status: "ready", teams: [fiveMemberTeam] } });
    fireEvent.click(screen.getByRole("button", { name: "Agent 团队" }));
    setWindowWidth(900);

    const row = screen.getByTestId("agent-team-row");
    expect(screen.getAllByTestId("agent-team-row")).toHaveLength(1);
    expect(row).toHaveAttribute("data-layout", "narrow");
    expect(row).toHaveClass("grid-cols-1");
    expect(within(row).getByTestId("agent-team-members")).toHaveClass("border-t");
    expect(within(row).getByLabelText("还有 2 名成员")).toHaveTextContent("＋2");
  });

  it("opens the real detail editor for the whole row and restores list scroll on return", () => {
    const onOpenAgentTeam = vi.fn();
    const onCloseAgentTeam = vi.fn();
    renderConsole({
      agentTeamsState: { status: "ready", teams: [fiveMemberTeam] },
      agentTeamDetailState: detailStateFor(fiveMemberTeam.teamKey),
      onOpenAgentTeam,
      onCloseAgentTeam,
    });
    fireEvent.click(screen.getByRole("button", { name: "Agent 团队" }));

    const listPage = screen.getByRole("region", { name: "Agent 团队" });
    listPage.scrollTop = 187;
    fireEvent.click(screen.getByTestId("agent-team-row"));

    expect(onOpenAgentTeam).toHaveBeenCalledWith("system:development");
    expect(screen.getByTestId("agent-team-detail-view")).toHaveAttribute("data-team-key", "system:development");
    expect(screen.getByTestId("agent-team-detail")).toBeVisible();
    expect(screen.getByText("官方来源")).toBeVisible();
    expect(screen.queryByText("只读")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "开发经理 AGENT.md" }))
      .not.toHaveAttribute("aria-readonly", "true");
    expect(screen.getByRole("button", { name: "复制团队" })).toBeVisible();
    expect(screen.getByRole("button", { name: "保存" })).toBeVisible();
    expect(screen.queryByTestId("agent-team-list")).not.toBeInTheDocument();
    expect(listPage.scrollTop).toBe(0);

    fireEvent.click(within(screen.getByTestId("agent-team-detail-view")).getByRole("button", { name: "Agent 团队" }));
    expect(onCloseAgentTeam).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("agent-team-list")).toBeVisible();
    expect(listPage.scrollTop).toBe(187);
  });

  it("keeps optional copying separate from direct official-team editing", async () => {
    const onDuplicateBuiltInAgentTeam = vi.fn().mockResolvedValue("user:development-copy");
    renderConsole({
      agentTeamsState: { status: "ready", teams: [fiveMemberTeam] },
      agentTeamDetailState: detailStateFor(fiveMemberTeam.teamKey),
      onDuplicateBuiltInAgentTeam,
    });
    fireEvent.click(screen.getByRole("button", { name: "Agent 团队" }));
    fireEvent.click(screen.getByTestId("agent-team-row"));
    expect(screen.getByRole("textbox", { name: "开发经理 AGENT.md" }))
      .not.toHaveAttribute("aria-readonly", "true");
    fireEvent.click(screen.getByRole("button", { name: "复制团队" }));

    await waitFor(() => expect(onDuplicateBuiltInAgentTeam).toHaveBeenCalledWith("system:development"));
    expect(screen.queryByText("复制 Agent")).not.toBeInTheDocument();
    expect(screen.queryByText("删除团队")).not.toBeInTheDocument();
  });

  it("renders the controlled team detail and keeps member selection inside that page", () => {
    const onSelectAgentTeamMember = vi.fn();
    const onChangeAgentTeamPrimaryAgent = vi.fn();
    const onCloseAgentTeam = vi.fn();
    const team = {
      ...agentTeam,
      ownership: "user" as const,
      teamKey: "user:development",
      memberOrder: ["manager", "dev"],
      members: [
        { slug: "manager", displayName: "开发经理", description: "默认接单" },
        { slug: "dev", displayName: "开发", description: "负责实现" },
      ],
    };
    renderConsole({
      agentTeamsState: { status: "ready", teams: [team] },
      agentTeamDetailState: {
        teamKey: team.teamKey,
        selectedMemberSlug: "manager",
        memberEditors: {
          manager: {
            memberSlug: "manager",
            loadStatus: "ready",
            loadError: null,
            draftMarkdown: "# 开发经理\n\n默认接单\n",
            isDirty: false,
            saveStatus: "idle",
            saveError: null,
            externalChangeStatus: "none",
            displayName: "开发经理",
            description: "默认接单",
          },
        },
        saveAllFailures: [],
      },
      onSelectAgentTeamMember,
      onChangeAgentTeamPrimaryAgent,
      onCloseAgentTeam,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent 团队" }));
    fireEvent.click(screen.getByTestId("agent-team-row"));
    const detail = screen.getByRole("region", { name: "开发团队详情" });
    expect(detail).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "主 Agent" }), { target: { value: "dev" } });
    expect(onChangeAgentTeamPrimaryAgent).toHaveBeenCalledWith("user:development", "dev");
    fireEvent.click(screen.getByRole("tab", { name: "开发" }));
    expect(onSelectAgentTeamMember).toHaveBeenCalledWith("user:development", "dev");
    expect(screen.queryByTestId("agent-team-list")).not.toBeInTheDocument();

    fireEvent.click(within(detail).getByRole("button", { name: "Agent 团队" }));
    expect(onCloseAgentTeam).toHaveBeenCalledTimes(1);
  });

  it("edits only a user team's name and one-line description from Modify information", async () => {
    const onUpdateAgentTeamInformation = vi.fn().mockResolvedValue(undefined);
    const userTeam = { ...agentTeam, teamKey: "user:development", ownership: "user" as const };
    renderConsole({
      agentTeamsState: { status: "ready", teams: [userTeam] },
      agentTeamDetailState: detailStateFor(userTeam.teamKey),
      onUpdateAgentTeamInformation,
    });
    fireEvent.click(screen.getByRole("button", { name: "Agent 团队" }));
    fireEvent.click(screen.getByTestId("agent-team-row"));
    fireEvent.click(screen.getByRole("button", { name: "修改信息" }));

    const dialog = screen.getByRole("dialog", { name: "修改团队信息" });
    expect(within(dialog).getAllByRole("textbox")).toHaveLength(2);
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "团队名称" }), {
      target: { value: "研发团队" },
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "一句话描述" }), {
      target: { value: "负责研发交付" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onUpdateAgentTeamInformation).toHaveBeenCalledWith(
      userTeam.teamKey,
      { name: "研发团队", description: "负责研发交付" },
    ));
  });

  it("closes and restores the sidebar without remounting the timeline or active run", () => {
    renderConsole({ activeRun: runSnapshot });

    const sidebar = screen.getByTestId("operator-sidebar");
    const main = screen.getByTestId("operator-main");
    const projectList = screen.getByRole("navigation", { name: "项目列表" });
    const selectedSessionRow = screen.getByRole("button", { name: "默认会话，正在运行" });
    const timeline = screen.getByRole("region", { name: "会话时间线" });
    const activeRunBlock = screen.getByTestId("active-run-block");
    projectList.scrollTop = 73;

    fireEvent.click(screen.getByRole("button", { name: "关闭侧边栏" }));

    expect(sidebar).not.toBeVisible();
    expect(sidebar).toHaveClass("hidden");
    expect(main).toHaveAttribute("data-sidebar-open", "false");
    const mainWindowDragRegion = screen.getByTestId("main-window-drag-region");
    const openSidebarButton = screen.getByRole("button", { name: "打开侧边栏" });
    expect(openSidebarButton).toHaveAttribute("title", "打开侧边栏");
    expect(openSidebarButton).toHaveClass("window-no-drag", "ml-[96px]");
    expect(openSidebarButton).not.toHaveClass("absolute", "top-[9px]");
    expect(mainWindowDragRegion).toHaveClass(
      "z-30",
      "flex",
      "h-[var(--window-header-height)]",
      "items-center",
    );
    expect(mainWindowDragRegion).toContainElement(openSidebarButton);
    expect(selectedSessionRow).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("region", { name: "会话时间线" })).toBe(timeline);
    expect(screen.getByTestId("active-run-block")).toBe(activeRunBlock);

    fireEvent.click(screen.getByRole("button", { name: "打开侧边栏" }));

    expect(sidebar).toBeVisible();
    expect(sidebar).toHaveClass("flex");
    expect(sidebar).not.toHaveClass("hidden");
    expect(main).toHaveAttribute("data-sidebar-open", "true");
    expect(projectList.scrollTop).toBe(73);
    expect(screen.getByRole("button", { name: "默认会话，正在运行" })).toBe(selectedSessionRow);
    expect(screen.getByRole("region", { name: "会话时间线" })).toBe(timeline);
    expect(screen.getByTestId("active-run-block")).toBe(activeRunBlock);
  });

  it("resizes the sidebar from its right boundary within the supported width range", () => {
    renderConsole();

    const sidebar = screen.getByTestId("operator-sidebar");
    const resizeHandle = screen.getByRole("separator", { name: "调整侧边栏宽度" });
    expect(sidebar).toHaveStyle({ width: `${DEFAULT_SIDEBAR_WIDTH_PX}px` });
    expect(resizeHandle).toHaveAttribute("aria-valuemin", String(MIN_SIDEBAR_WIDTH_PX));
    expect(resizeHandle).toHaveAttribute("aria-valuemax", String(MAX_SIDEBAR_WIDTH_PX));

    firePointer(resizeHandle, "pointerdown", { pointerId: 7, button: 0, clientX: DEFAULT_SIDEBAR_WIDTH_PX });
    firePointer(resizeHandle, "pointermove", { pointerId: 7, button: 0, clientX: -1_000 });
    expect(sidebar).toHaveStyle({ width: `${MIN_SIDEBAR_WIDTH_PX}px` });
    expect(resizeHandle).toHaveAttribute("aria-valuenow", String(MIN_SIDEBAR_WIDTH_PX));

    firePointer(resizeHandle, "pointermove", { pointerId: 7, button: 0, clientX: 1_000 });
    expect(sidebar).toHaveStyle({ width: `${MAX_SIDEBAR_WIDTH_PX}px` });
    expect(resizeHandle).toHaveAttribute("aria-valuenow", String(MAX_SIDEBAR_WIDTH_PX));
    firePointer(resizeHandle, "pointerup", { pointerId: 7, button: 0, clientX: 1_000 });
  });

  it("auto-collapses only for a narrow window and restores from the explicit user preference", () => {
    setWindowWidth(NARROW_WINDOW_WIDTH_PX + 100);
    const onSidebarOpenChange = vi.fn();
    const { rerender } = renderConsole({ sidebarOpen: true, onSidebarOpenChange });
    const sidebar = screen.getByTestId("operator-sidebar");
    const main = screen.getByTestId("operator-main");
    expect(sidebar).toBeVisible();

    setWindowWidth(NARROW_WINDOW_WIDTH_PX - 1);
    expect(sidebar).not.toBeVisible();
    expect(main).toHaveAttribute("data-sidebar-auto-collapsed", "true");
    expect(onSidebarOpenChange).not.toHaveBeenCalled();

    setWindowWidth(NARROW_WINDOW_WIDTH_PX + 100);
    expect(sidebar).toBeVisible();
    expect(main).toHaveAttribute("data-sidebar-auto-collapsed", "false");
    expect(onSidebarOpenChange).not.toHaveBeenCalled();

    rerender(<OperatorConsole {...baseProps({ sidebarOpen: false, onSidebarOpenChange })} />);
    setWindowWidth(NARROW_WINDOW_WIDTH_PX - 1);
    setWindowWidth(NARROW_WINDOW_WIDTH_PX + 100);
    expect(sidebar).not.toBeVisible();
    expect(main).toHaveAttribute("data-sidebar-auto-collapsed", "false");
    expect(onSidebarOpenChange).not.toHaveBeenCalled();
  });

  it("keeps long project and conversation names on one line with their full text available on hover", () => {
    const longProjectName = "这是一个非常长的项目显示名称，用来验证侧边栏缩窄后仍然保持单行";
    const longSessionName = "这是一个非常长的对话标题，用来验证用户悬停时可以查看完整内容";
    renderConsole({
      project: {
        ...project,
        title: longProjectName,
        sessions: [{ ...sessions[0], title: longSessionName }],
      },
      selectedSession: { ...sessions[0], title: longSessionName },
    });

    const projectName = screen.getByTitle(longProjectName);
    const sessionRow = screen.getByRole("button", { name: `${longSessionName}，正在运行` });
    const conversationHeading = screen.getByRole("heading", { name: longSessionName });
    expect(projectName).toHaveClass("truncate");
    expect(sessionRow).toHaveAttribute("title", longSessionName);
    expect(sessionRow.querySelector(".truncate")).toHaveTextContent(longSessionName);
    expect(conversationHeading).toHaveClass("truncate");
    expect(conversationHeading).toHaveAttribute("title", longSessionName);
  });

  it("keeps the conversation title sticky, opaque, and aligned with the timeline content", () => {
    renderConsole();

    const timeline = screen.getByRole("region", { name: "会话时间线" });
    const titleHeader = screen.getByTestId("conversation-title-header");
    const title = screen.getByRole("heading", { name: "默认会话" });
    const composer = screen.getByRole("textbox", { name: "消息内容" }).closest("div.relative.w-full");
    const composerHost = composer?.parentElement;

    expect(timeline).toContainElement(titleHeader);
    expect(timeline).not.toHaveClass("pt-20", "px-8");
    expect(titleHeader).toHaveClass(
      "sticky",
      "top-0",
      "h-[var(--window-header-height)]",
      "bg-canvas",
      "px-8",
    );
    expect(titleHeader).not.toHaveClass("absolute", "pt-12", "window-drag-region");
    expect(title).toHaveClass("w-full", "max-w-[760px]", "text-left");
    expect(composer).toHaveClass("w-full", "max-w-[760px]");
    expect(composer).not.toHaveClass("max-w-[720px]");
    expect(composerHost).toHaveClass("px-8");
    expect(composerHost).not.toHaveClass("px-6");
    expect(title).not.toHaveClass("pl-10");
  });

  it("aligns the active run with the same content column as historical messages", () => {
    renderConsole({
      activeRun: runSnapshot,
      messages: [message({ id: 1, body: "先看一眼现状", speaker: "agent", role: "dev" })],
    });

    const historicalMessage = screen.getByText("先看一眼现状").closest(".group");
    const activeRunHost = screen.getByTestId("active-run-block");
    const activeRun = activeRunHost.firstElementChild;

    expect(historicalMessage).not.toHaveClass("pl-10");
    expect(historicalMessage?.querySelector(".pl-7")).not.toBeNull();
    expect(activeRunHost).not.toHaveClass("pl-10");
    expect(activeRun?.querySelector(".pl-7")).not.toBeNull();
    expect(activeRun).toHaveClass("max-w-none");
    expect(activeRun).not.toHaveClass("max-w-[680px]");
  });

  it("renders user messages in a right-aligned chat lane outside the shared left column", () => {
    renderConsole();

    const userMessage = screen.getByText("@dev hello").closest(".group");

    expect(userMessage?.querySelector(".pl-7")).toBeNull();
    expect(userMessage?.querySelector(".justify-end")).not.toBeNull();
    expect(userMessage).toHaveTextContent("你");
  });

  it("keeps the selected conversation mounted when its project is collapsed", () => {
    const onSelectSession = vi.fn();
    renderConsole({ onSelectSession });

    const timeline = screen.getByRole("region", { name: "会话时间线" });
    expect(screen.getByRole("button", { name: "默认会话，正在运行" })).toHaveAttribute("aria-current", "page");

    fireEvent.keyDown(screen.getByRole("button", { name: "moebius 项目，已展开" }), { key: "Enter" });

    expect(screen.getByRole("button", { name: "moebius 项目，已折叠，需要你处理" })).toHaveAttribute(
      "data-status-dot",
      "red",
    );
    expect(screen.queryByRole("button", { name: "默认会话，正在运行" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "会话时间线" })).toBe(timeline);
    expect(onSelectSession).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole("button", { name: "moebius 项目，已折叠，需要你处理" }), {
      key: "Enter",
    });

    expect(screen.getByRole("button", { name: "默认会话，正在运行" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("region", { name: "会话时间线" })).toBe(timeline);
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it("keeps an explicit closed sidebar preference after onboarding moved to its own route", () => {
    const onSidebarOpenChange = vi.fn();
    renderConsole({
      sidebarOpen: false,
      onSidebarOpenChange,
    });

    expect(screen.getByTestId("operator-sidebar")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "打开侧边栏" })).toBeInTheDocument();
    expect(onSidebarOpenChange).not.toHaveBeenCalled();
  });

  it("keeps the active-run composer usable and binds its stop only to the primary run", () => {
    const onInterrupt = vi.fn();
    renderConsole({ activeRun: runSnapshot, composerValue: "", onInterrupt });

    expect(screen.getByText("Moebius")).toBeVisible();
    expect(screen.getAllByText("moebius").length).toBeGreaterThan(0);
    expect(screen.getAllByText("默认会话").length).toBeGreaterThan(0);
    expect(screen.getByText("验收会话")).toBeVisible();
    expect(screen.getByText("开发")).toBeVisible();
    expect(screen.queryByText("00:12")).not.toBeInTheDocument();
    expect(screen.getByText("live tail from codex")).toBeVisible();
    expect(screen.getByText("独立工作空间")).toBeVisible();
    expect(screen.queryByText("0 通过")).not.toBeInTheDocument();
    expect(screen.queryByText("查看当前会话原始信息")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "消息内容" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /停下开发当前这一步/u })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "停下主理人" }));
    expect(onInterrupt).toHaveBeenCalledWith("session-a", "run-1");
  });

  it("sends text during an active run without invoking interrupt", () => {
    const onInterrupt = vi.fn();
    const onSend = vi.fn();
    renderConsole({ activeRun: runSnapshot, composerValue: "补一句话", onInterrupt, onSend });

    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onInterrupt).not.toHaveBeenCalled();
  });

  it("keeps composition Enter inside the shared session composer", () => {
    const onSend = vi.fn();
    renderConsole({ composerValue: "输入法候选", onSend });
    const input = screen.getByRole("textbox", { name: "消息内容" });

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", isComposing: false });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("emits a run-output intent beside the shared composer stop without using developer diagnostics", () => {
    const onOpenEvidence = vi.fn();
    const onOpenDiagnostics = vi.fn();
    renderConsole({ activeRun: runSnapshot, composerValue: "", onOpenEvidence, onOpenDiagnostics });

    expect(screen.getByRole("button", { name: "完整输出" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /停下开发/u })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停下主理人" })).toBeVisible();
    expect(screen.getByText("已进行 00:12")).toBeVisible();
    expect(screen.queryByText(/run-1|\/tmp\//u)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "完整输出" }));
    expect(onOpenEvidence).toHaveBeenCalledWith({
      kind: "run-output",
      sessionId: "session-a",
      runId: "run-1",
      stepId: null,
      role: "dev",
      fallbackOutput: "live tail from codex",
    });
    expect(onOpenDiagnostics).not.toHaveBeenCalled();
  });

  it("renders a FIFO primary pending zone and independent worker stop controls", () => {
    const onInterrupt = vi.fn();
    const devRun = { ...runSnapshot, runId: "run-dev", role: "dev" };
    const qaRun = { ...runSnapshot, runId: "run-qa", role: "qa" };
    renderConsole({
      activeRun: runSnapshot,
      activeRuns: [runSnapshot, devRun, qaRun],
      pendingPrimaryMessages: [
        message({ id: 7, body: "先处理线上报错", status: "pending" }),
        message({ id: 8, body: "再补一份回归说明", status: "pending" }),
      ],
      onInterrupt,
    });

    const pendingZone = screen.getByTestId("primary-pending-zone");
    expect(within(pendingZone).getByText("先处理线上报错")).toBeVisible();
    expect(within(pendingZone).getByText("再补一份回归说明")).toBeVisible();
    expect(pendingZone).toHaveClass("w-full", "max-w-[760px]");
    expect(pendingZone).not.toHaveClass("max-w-[720px]");
    expect(screen.getByRole("region", { name: "会话时间线" })).toHaveClass("pb-72");
    expect(screen.getAllByTestId("active-run-block")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "停下开发" }));
    expect(onInterrupt).toHaveBeenLastCalledWith("session-a", "run-dev");
    fireEvent.click(screen.getByRole("button", { name: "停下测试" }));
    expect(onInterrupt).toHaveBeenLastCalledWith("session-a", "run-qa");
    fireEvent.click(screen.getByRole("button", { name: "停下主理人" }));
    expect(onInterrupt).toHaveBeenLastCalledWith("session-a", "run-1");
  });

  it("uses effective custom member names across the main timeline, runs, facts, stops, and process tabs", () => {
    const onInterrupt = vi.fn();
    const memberIdentities = [
      { slug: "plan-supervisor", displayName: "方案监督者" },
      { slug: "plan-executor", displayName: "方案执行者" },
    ];
    const supervisorRun = { ...runSnapshot, runId: "run-supervisor", role: "plan-supervisor" };
    const executorRun = { ...runSnapshot, runId: "run-executor", role: "plan-executor" };
    renderConsole({
      memberIdentities,
      messages: [
        message({ id: 10, speaker: "agent", role: "plan-supervisor", runId: "history-supervisor", body: "监督结论" }),
        message({ id: 11, speaker: "agent", role: "plan-executor", runId: "history-executor", body: "执行结论" }),
        message({ id: 12, speaker: "system", role: "plan-executor", runId: "fact-failed", status: "failed", systemEventKind: "run-not-started", body: "没跑起来" }),
        message({ id: 13, speaker: "system", role: "plan-executor", runId: "fact-stuck", status: "stuck", systemEventKind: "run-stuck", body: "卡住" }),
        message({ id: 14, speaker: "system", role: "plan-executor", runId: "fact-stopped", status: "interrupted", systemEventKind: "user-stopped", body: "停下" }),
        message({ id: 15, speaker: "system", role: "plan-executor", runId: "fact-exhausted", status: "failed", systemEventKind: "retry-exhausted", body: "耗尽" }),
      ],
      activeRun: supervisorRun,
      activeRuns: [supervisorRun, executorRun],
      onInterrupt,
    });

    expect(screen.getAllByText("方案监督者").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("方案执行者").length).toBeGreaterThanOrEqual(6);
    expect(screen.queryByText("团队成员")).not.toBeInTheDocument();
    expect(screen.queryByText("协作者")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "停下方案执行者" }));
    expect(onInterrupt).toHaveBeenCalledWith("session-a", "run-executor");

    const outputButtons = screen.getAllByRole("button", { name: "完整输出" });
    fireEvent.click(outputButtons[0]!);
    fireEvent.click(outputButtons[1]!);
    const panel = screen.getByTestId("right-sidebar");
    expect(within(panel).getByRole("tab", { name: "方案监督者" })).toBeVisible();
    expect(within(panel).getByRole("tab", { name: "方案执行者" })).toBeVisible();
  });

  it("keeps the composer stop absent when only worker runs are active", () => {
    const onInterrupt = vi.fn();
    const workerRun = { ...runSnapshot, runId: "run-qa", role: "qa" };
    renderConsole({
      activeRun: null,
      activeRuns: [workerRun],
      onInterrupt,
    });

    expect(screen.queryByRole("button", { name: "停下主理人" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "停下测试" }));
    expect(onInterrupt).toHaveBeenCalledWith("session-a", "run-qa");
  });

  it("shows one settled result card and keeps complete output on the historical step", () => {
    const onOpenEvidence = vi.fn();
    const settled = {
      ...sessions[0],
      status: "idle" as const,
      runningCount: 0,
      lastMessageMentionsAgent: false,
    };
    renderConsole({
      selectedSession: settled,
      messages: [message({ id: 2, speaker: "agent", role: "dev", runId: "run-finished", body: "完成实现" })],
      workspaceDiff: { available: true, fileCount: 2, reason: null },
      onOpenEvidence,
    });

    expect(screen.getByText("这段对话期间有 2 个文件发生改动。")).toBeVisible();
    expect(screen.queryByText(/团队成员造成|src\//u)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看" }));
    expect(onOpenEvidence).toHaveBeenCalledWith({ kind: "workspace-diff", sessionId: "session-a", fileCount: 2 });
    fireEvent.click(screen.getByRole("button", { name: "完整输出" }));
    expect(onOpenEvidence).toHaveBeenLastCalledWith({
      kind: "run-output",
      sessionId: "session-a",
      runId: "run-finished",
      stepId: null,
      role: "dev",
      fallbackOutput: "完成实现",
    });
  });

  it("drives the result-card entry through the console container into the loaded change tab", async () => {
    const loadDiff = vi.fn(async () => ({
      available: true as const,
      fileCount: 1,
      files: [{ path: "src/app.ts", additions: 2, deletions: 1 }],
      reason: null,
      workspaceMode: "worktree" as const,
    }));
    const loadFile = vi.fn(async () => ({
      available: true as const,
      path: "src/app.ts",
      lines: [
        { kind: "unchanged" as const, oldLineNumber: 1, newLineNumber: 1, text: "const before = true;" },
        { kind: "deletion" as const, oldLineNumber: 2, newLineNumber: null, text: "const oldValue = 1;" },
        { kind: "addition" as const, oldLineNumber: null, newLineNumber: 2, text: "const newValue = 2;" },
      ],
      reason: null,
    }));
    renderConsole({
      selectedSession: { ...sessions[0], status: "idle", runningCount: 0, lastMessageMentionsAgent: false },
      messages: [message({ id: 2, speaker: "agent", role: "dev", body: "完成实现" })],
      workspaceDiff: { available: true, fileCount: 1, reason: null },
      onLoadWorkspaceDiff: loadDiff,
      onLoadProjectFile: loadFile,
    });

    fireEvent.click(screen.getByRole("button", { name: "查看" }));

    const panel = await screen.findByTestId("change-tab");
    expect(within(panel).getByText("这段对话期间，项目发生了这些改动（独立工作空间）。")).toBeVisible();
    expect(within(panel).getByText("这些改动在一份隔离副本里，你的项目文件夹没有被动过。")).toBeVisible();
    expect(within(panel).getByTitle("src/app.ts")).toBeVisible();
    expect(await within(panel).findByText("const newValue = 2;")).toHaveClass("whitespace-pre");
    expect(loadDiff).toHaveBeenCalledWith("session-a");
    expect(loadFile).toHaveBeenCalledWith("session-a", "src/app.ts");
    expect(within(panel).queryByText(/成员改了|团队改了/u)).not.toBeInTheDocument();
  });

  it("opens the zero-tab content selector before loading project files", async () => {
    const loadFiles = vi.fn(async () => ({
      available: true as const,
      files: [
        { path: "README.md", additions: null, deletions: null, changed: false },
        { path: "src/app.ts", additions: 1, deletions: 0, changed: true },
      ],
      reason: null,
      workspaceMode: "direct" as const,
    }));
    const loadFile = vi.fn(async (_sessionId: string, filePath: string) => ({
      available: true as const,
      path: filePath,
      lines: [{ kind: "unchanged" as const, oldLineNumber: 1, newLineNumber: 1, text: "# Project" }],
      reason: null,
    }));
    renderConsole({
      rightSidebarOpen: true,
      project: {
        ...project,
        isGitRepository: false,
      },
      selectedSession: {
        ...sessions[0],
        workspaceMode: "direct",
      },
      onLoadProjectFiles: loadFiles,
      onLoadProjectFile: loadFile,
    });

    expect(screen.getByRole("heading", { name: "这个标签要看什么" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /项目文件/u }));
    const panel = await screen.findByTestId("project-files-tab");
    expect(within(panel).getByText("正在浏览完整项目树（项目文件夹）。")).toBeVisible();
    expect(within(panel).getByTitle("README.md")).toBeVisible();
    expect(await within(panel).findByText("# Project")).toBeVisible();
    expect(loadFiles).toHaveBeenCalledWith("session-a");
    expect(loadFile).toHaveBeenCalledWith("session-a", "README.md");
  });

  it("keeps historical Markdown and reveals an in-place output icon on message hover or focus", () => {
    renderConsole({
      messages: [message({
        id: 2,
        speaker: "agent",
        role: "dev",
        runId: "run-finished",
        body: "## 完成\n\n产物位于 `/tmp/private-run`，runId=run-secret。",
      })],
      onOpenEvidence: vi.fn(),
    });

    expect(screen.getByRole("heading", { name: "完成" })).toBeVisible();
    expect(screen.getByText(/路径已隐藏/u)).toBeVisible();
    const outputButton = screen.getByRole("button", { name: "完整输出" });
    expect(outputButton).toHaveAttribute("title", "完整输出");
    expect(outputButton).toHaveClass(
      "absolute",
      "left-7",
      "top-full",
      "h-6",
      "w-6",
      "opacity-0",
      "group-hover:opacity-100",
      "group-focus-within:opacity-100",
      "focus-visible:opacity-100",
    );
    expect(outputButton).not.toHaveClass("h-[30px]", "px-3");
    expect(outputButton).not.toHaveTextContent("完整输出");
    expect(outputButton.querySelector("svg")).not.toBeNull();
    expect(outputButton.parentElement).toHaveClass("relative", "pl-7");
    expect(screen.queryByText(/\/tmp\/private-run|run-secret/u)).not.toBeInTheDocument();
  });

  it("opens an explicit Markdown file reference in a focused right-sidebar detail", async () => {
    const loadReference = vi.fn().mockResolvedValue({
      available: true,
      path: "/Users/wing/.codex/sessions/day/rollout.jsonl",
      lines: [
        { lineNumber: 291, text: "before" },
        { lineNumber: 292, text: "target evidence" },
      ],
      reason: null,
      targetLine: 292,
      targetColumn: null,
      truncatedBefore: true,
      truncatedAfter: true,
    });
    renderConsole({
      messages: [message({
        id: 2,
        speaker: "agent",
        role: "implementer",
        body: "证据在[会话记录 (line 292)](/Users/wing/.codex/sessions/day/rollout.jsonl:292)，裸路径 /tmp/private.txt。",
      })],
      onLoadFileReference: loadReference,
    });

    fireEvent.click(screen.getByRole("button", { name: "会话记录 (line 292)" }));

    expect(await screen.findByRole("tab", { name: "rollout.jsonl:292" })).toBeVisible();
    expect(await screen.findByTestId("file-reference-target-line")).toHaveTextContent("target evidence");
    expect(loadReference).toHaveBeenCalledWith(
      "session-a",
      "/Users/wing/.codex/sessions/day/rollout.jsonl",
      292,
      null,
    );
    expect(screen.queryByText("/tmp/private.txt")).not.toBeInTheDocument();
  });

  it("preserves titled and reference-style Markdown file targets while hiding bare paths", () => {
    renderConsole({
      messages: [message({
        id: 2,
        speaker: "agent",
        role: "implementer",
        body: [
          '[带标题](/Users/wing/.codex/sessions/day/a.jsonl:12 "详情")',
          "[引用式][evidence]",
          "",
          '[evidence]: /Users/wing/.codex/sessions/day/b.jsonl:13 "证据"',
          "裸路径 /tmp/private.txt。",
        ].join("\n"),
      })],
    });

    expect(screen.getByRole("button", { name: "带标题" })).toBeVisible();
    expect(screen.getByRole("button", { name: "引用式" })).toBeVisible();
    expect(screen.queryByText("/tmp/private.txt")).not.toBeInTheDocument();
  });

  it("deduplicates alias and real-path references after canonical resolution", async () => {
    const canonicalPath = "/workspace/canonical.txt";
    const loadReference = vi.fn(async (
      _sessionId: string,
      _filePath: string,
      line: number,
      column: number | null,
    ) => ({
      available: true as const,
      path: canonicalPath,
      lines: [{ lineNumber: line, text: "same target" }],
      reason: null,
      targetLine: line,
      targetColumn: column,
      truncatedBefore: false,
      truncatedAfter: false,
    }));
    renderConsole({
      messages: [message({
        id: 2,
        speaker: "agent",
        role: "implementer",
        body: "[别名](/workspace/alias.txt:12) [真实路径](/workspace/canonical.txt:12)",
      })],
      onLoadFileReference: loadReference,
    });

    fireEvent.click(screen.getByRole("button", { name: "别名" }));
    expect(await screen.findByTestId("file-reference-target-line")).toHaveTextContent("same target");
    fireEvent.click(screen.getByRole("button", { name: "真实路径" }));

    await waitFor(() => {
      expect(loadReference).toHaveBeenCalledTimes(2);
      expect(within(screen.getByRole("tablist", { name: "右侧栏标签" }))
        .getAllByRole("tab")).toHaveLength(1);
    });
    expect(screen.getByRole("tab", { name: "canonical.txt:12" })).toBeVisible();
    expect(loadReference).toHaveBeenCalledTimes(2);
  });

  it("deduplicates alias and real-path references for canonical unavailable results", async () => {
    const canonicalPath = "/workspace/canonical.txt";
    const loadReference = vi.fn(async (
      _sessionId: string,
      _filePath: string,
      line: number,
      column: number | null,
    ): Promise<FileReferenceContent> => ({
      available: false,
      path: canonicalPath,
      lines: [],
      reason: "line-too-large",
      targetLine: line,
      targetColumn: column,
    }));
    renderConsole({
      messages: [message({
        id: 2,
        speaker: "agent",
        role: "implementer",
        body: "[别名](/workspace/alias.txt:12) [真实路径](/workspace/canonical.txt:12)",
      })],
      onLoadFileReference: loadReference,
    });

    fireEvent.click(screen.getByRole("button", { name: "别名" }));
    expect(await screen.findByText("目标附近存在过长单行，无法安全显示。")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "真实路径" }));

    await waitFor(() => {
      expect(loadReference).toHaveBeenCalledTimes(2);
      expect(within(screen.getByRole("tablist", { name: "右侧栏标签" }))
        .getAllByRole("tab")).toHaveLength(1);
    });
  });

  it("atomically retains two file tabs when deferred canonical reads complete out of order", async () => {
    const first = deferred<FileReferenceContent>();
    const second = deferred<FileReferenceContent>();
    const loadReference = vi.fn((
      _sessionId: string,
      filePath: string,
    ) => filePath.endsWith("/first.txt") ? first.promise : second.promise);
    renderControlledConsole({
      messages: [message({
        id: 2,
        speaker: "agent",
        role: "implementer",
        body: "[第一个](/workspace/first.txt:1) [第二个](/workspace/second.txt:2)",
      })],
      onLoadFileReference: loadReference,
    });

    fireEvent.click(screen.getByRole("button", { name: "第一个" }));
    fireEvent.click(screen.getByRole("button", { name: "第二个" }));
    await act(async () => {
      second.resolve(availableReference("/workspace/second.txt", 2));
      await second.promise;
      first.resolve(availableReference("/workspace/first.txt", 1));
      await first.promise;
    });

    await waitFor(() => {
      const tabs = within(screen.getByRole("tablist", { name: "右侧栏标签" })).getAllByRole("tab");
      expect(tabs).toHaveLength(2);
      expect(screen.getByRole("tab", { name: "first.txt:1" })).toBeVisible();
      expect(screen.getByRole("tab", { name: "second.txt:2" })).toBeVisible();
    });
  });

  it("shows a known Markdown mention by display name and opens the existing team detail entry", () => {
    const onOpenAgentTeam = vi.fn();
    renderConsole({
      messages: [message({
        id: 2,
        speaker: "agent",
        role: "implementer",
        body: "请 @implementer 接手，@unknown 保持原文。",
      })],
      memberIdentities: [{ slug: "implementer", displayName: "实现者" }],
      conversationAgentTeamKey: "system:development",
      onOpenAgentTeam,
    });

    fireEvent.click(screen.getByRole("button", { name: "@实现者" }));

    expect(onOpenAgentTeam).toHaveBeenCalledWith("system:development");
    expect(screen.getByRole("region", { name: "Agent 团队" })).toBeVisible();
  });

  it("routes a complete-output entry into the multi-tab right sidebar shell", () => {
    const onOpenEvidence = vi.fn();
    renderConsole({
      messages: [message({
        id: 2,
        speaker: "agent",
        role: "dev",
        runId: "run-finished",
        body: "完成实现",
      })],
      onOpenEvidence,
    });

    expect(screen.queryByTestId("right-sidebar")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "完整输出" }));

    const panel = screen.getByTestId("right-sidebar");
    expect(panel).toBeVisible();
    expect(within(panel).getByRole("tablist", { name: "右侧栏标签" })).toBeVisible();
    expect(within(panel).getByRole("tab", { name: "开发" })).toHaveAttribute("aria-selected", "true");
    expect(within(panel).getByRole("button", { name: "新建空白标签" })).toBeVisible();
    expect(onOpenEvidence).toHaveBeenCalledWith({
      kind: "run-output",
      sessionId: "session-a",
      runId: "run-finished",
      stepId: null,
      role: "dev",
      fallbackOutput: "完成实现",
    });
  });

  it("keeps interrupted and retried attempts in one correctly named process tab", () => {
    const onOpenEvidence = vi.fn();
    renderConsole({
      onOpenEvidence,
      messages: [
        message({
          id: 2,
          speaker: "system",
          role: null,
          runId: "run-retry-1",
          status: "interrupted",
          systemEventKind: "user-stopped",
          body: "你让这一步停下了",
          runTiming: {
            stepId: "message:1",
            attempt: 1,
            createdAt: "2026-07-09T00:00:00.000Z",
            startedAt: "2026-07-09T00:00:00.000Z",
            elapsedMs: 1_000,
            completedAt: "2026-07-09T00:00:01.000Z",
            status: "interrupted",
            engine: "codex",
            processOutputAvailable: true,
          },
        }),
        message({
          id: 3,
          speaker: "agent",
          role: "dev",
          runId: "run-retry-2",
          body: "第二次执行完成",
          runTiming: {
            stepId: "message:1",
            attempt: 2,
            createdAt: "2026-07-09T00:01:00.000Z",
            startedAt: "2026-07-09T00:01:00.000Z",
            elapsedMs: 2_000,
            completedAt: "2026-07-09T00:01:02.000Z",
            status: "completed",
            engine: "codex",
            processOutputAvailable: true,
          },
        }),
      ],
    });

    const outputButtons = screen.getAllByRole("button", { name: "完整输出" });
    fireEvent.click(outputButtons[0]!);
    fireEvent.click(outputButtons[1]!);

    const panel = screen.getByTestId("right-sidebar");
    expect(within(panel).getAllByRole("tab", { name: "开发" })).toHaveLength(1);
    expect(within(panel).queryByRole("tab", { name: "成员未知" })).not.toBeInTheDocument();
    expect(onOpenEvidence).toHaveBeenNthCalledWith(1, {
      kind: "run-output",
      sessionId: "session-a",
      runId: "run-retry-1",
      stepId: "message:1",
      role: "dev",
      fallbackOutput: "你让这一步停下了",
    });
    expect(onOpenEvidence).toHaveBeenNthCalledWith(2, {
      kind: "run-output",
      sessionId: "session-a",
      runId: "run-retry-2",
      stepId: "message:1",
      role: "dev",
      fallbackOutput: "第二次执行完成",
    });
  });

  it("repairs an unknown terminal process title from the aggregate response role", async () => {
    const sourceKey = "run-output-v3:session-a:message%3A1:run-stop";
    renderConsole({
      messages: [message({
        id: 2,
        speaker: "system",
        role: null,
        runId: "run-stop",
        status: "interrupted",
        systemEventKind: "user-stopped",
        body: "你让这一步停下了",
        runTiming: {
          stepId: "message:1",
          attempt: 1,
          createdAt: "2026-07-09T00:00:00.000Z",
          startedAt: "2026-07-09T00:00:00.000Z",
          elapsedMs: 1_000,
          completedAt: "2026-07-09T00:00:01.000Z",
          status: "interrupted",
          engine: "codex",
          processOutputAvailable: true,
        },
      })],
      processOutputs: {
        [sourceKey]: {
          status: "ready",
          output: {
            sessionId: "session-a",
            requestedRunId: "run-stop",
            role: "dev",
            status: "settled",
            unavailableReason: null,
            attempts: [],
            events: [],
            previousCursor: null,
            appendCursor: null,
            atLatest: true,
          },
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "完整输出" }));

    await waitFor(() => {
      expect(within(screen.getByTestId("right-sidebar")).getByRole("tab", { name: "开发" })).toBeVisible();
    });
  });

  it("renders the Codex debug chain without fallback output", () => {
    renderConsole({
      messages: [message({
        id: 2,
        speaker: "agent",
        role: "dev",
        runId: "run-retry-2",
        body: "已完成第二次执行",
      })],
      processOutputs: {
        "run-output-v2:session-a:run-retry-2": {
          status: "ready",
          output: {
            sessionId: "session-a",
            requestedRunId: "run-retry-2",
            role: "dev",
            status: "settled",
            unavailableReason: null,
            attempts: [
              {
                runId: "run-retry-1",
                attempt: 1,
                role: "dev",
                engine: "codex",
                model: "gpt-5",
                effort: "high",
                provider: null,
                cliVersion: null,
                metadataSource: "immutable-context",
                threadId: "thread-1",
                startedAt: "2026-07-09T00:00:00.000Z",
                status: "failed",
              },
              {
                runId: "run-retry-2",
                attempt: 2,
                role: "dev",
                engine: "codex",
                model: "gpt-5",
                effort: "high",
                provider: null,
                cliVersion: null,
                metadataSource: "immutable-context",
                threadId: "thread-2",
                startedAt: "2026-07-09T00:01:00.000Z",
                status: "completed",
              },
            ],
            events: [
              {
                key: "attempt-1",
                kind: "attempt-header",
                runId: "run-retry-1",
                attempt: 1,
                role: "dev",
                engine: "codex",
                model: "gpt-5",
                effort: "high",
                provider: null,
                cliVersion: null,
                metadataSource: "immutable-context",
                threadId: "thread-1",
                startedAt: "2026-07-09T00:00:00.000Z",
                status: "failed",
              },
              {
                key: "execution-1",
                kind: "execution-header",
                runId: "run-retry-1",
                attempt: 1,
              },
              {
                key: "error-1",
                kind: "error",
                timestamp: "2026-07-09T00:00:01.000Z",
                protocolType: "event_msg · stream_failure",
                rawPayload: "{\"message\":\"第一次失败\"}",
                message: "第一次失败",
                detail: "命令退出码为 1",
              },
              {
                key: "attempt-2",
                kind: "attempt-header",
                runId: "run-retry-2",
                attempt: 2,
                role: "dev",
                engine: "codex",
                model: "gpt-5",
                effort: "high",
                provider: null,
                cliVersion: null,
                metadataSource: "immutable-context",
                threadId: "thread-2",
                startedAt: "2026-07-09T00:01:00.000Z",
                status: "completed",
              },
              {
                key: "execution-2",
                kind: "execution-header",
                runId: "run-retry-2",
                attempt: 2,
              },
              {
                key: "agent-2",
                kind: "agent-output",
                timestamp: "2026-07-09T00:01:01.000Z",
                protocolType: "response_item · message",
                rawPayload: "{}",
                output: "第二次执行完成",
              },
            ],
            previousCursor: null,
            appendCursor: "append-cursor",
            atLatest: true,
          },
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "完整输出" }));

    const content = screen.getByTestId("right-sidebar-content");
    expect(within(content).getByText("开发 · 这一步的调试调用链")).toBeVisible();
    expect(content).not.toHaveTextContent("stdout");
    expect(content).not.toHaveTextContent("fallback");
    expect(within(content).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("numbers separate process tabs by member and never derives a title from step content", () => {
    renderConsole({
      messages: [
        message({ id: 2, speaker: "agent", role: "dev", runId: "run-one", body: "实现上传协议" }),
        message({ id: 3, speaker: "agent", role: "dev", runId: "run-two", body: "修复数据库迁移" }),
      ],
    });

    const outputButtons = screen.getAllByRole("button", { name: "完整输出" });
    fireEvent.click(outputButtons[0]!);
    fireEvent.click(outputButtons[1]!);

    const panel = screen.getByTestId("right-sidebar");
    expect(within(panel).getByRole("tab", { name: "开发" })).toHaveAttribute("title", "开发");
    expect(within(panel).getByRole("tab", { name: "开发 2" })).toHaveAttribute("title", "开发 2");
    expect(within(panel).queryByRole("tab", { name: /上传协议|数据库迁移/u })).not.toBeInTheDocument();
  });

  it("reuses an available member ordinal without duplicating another open process tab", () => {
    renderConsole({
      messages: [
        message({ id: 2, speaker: "agent", role: "dev", runId: "run-one", body: "one" }),
        message({ id: 3, speaker: "agent", role: "dev", runId: "run-two", body: "two" }),
        message({ id: 4, speaker: "agent", role: "dev", runId: "run-three", body: "three" }),
        message({ id: 5, speaker: "agent", role: "dev", runId: "run-four", body: "four" }),
      ],
    });

    const outputButtons = screen.getAllByRole("button", { name: "完整输出" });
    fireEvent.click(outputButtons[0]!);
    fireEvent.click(outputButtons[1]!);
    fireEvent.click(outputButtons[2]!);
    fireEvent.click(screen.getByRole("button", { name: "关闭标签：开发 2" }));
    fireEvent.click(outputButtons[3]!);

    const panel = screen.getByTestId("right-sidebar");
    expect(within(panel).getAllByRole("tab", { name: "开发" })).toHaveLength(1);
    expect(within(panel).getAllByRole("tab", { name: "开发 2" })).toHaveLength(1);
    expect(within(panel).getAllByRole("tab", { name: "开发 3" })).toHaveLength(1);
  });

  it("shows explicit Codex file unavailability without rendering the retained final reply", () => {
    renderConsole({
      messages: [message({
        id: 2,
        speaker: "agent",
        role: null,
        runId: "run-missing",
        body: "fallback result",
      })],
      processOutputs: {
        "run-output-v2:session-a:run-missing": {
          status: "ready",
          output: {
            sessionId: "session-a",
            requestedRunId: "run-missing",
            role: null,
            status: "unavailable",
            unavailableReason: "not-found",
            attempts: [],
            events: [],
            previousCursor: null,
            appendCursor: null,
            atLatest: true,
          },
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "完整输出" }));

    const panel = screen.getByTestId("right-sidebar");
    expect(within(panel).getByRole("tab", { name: "成员未知" })).toHaveAttribute("title", "成员未知");
    expect(within(panel).getByText("Codex 过程记录文件已不可用")).toBeVisible();
    expect(within(panel).getByText("这一步的最终回复仍保留在主对话区。")).toBeVisible();
    expect(panel).not.toHaveTextContent("fallback /tmp/run-missing");
  });

  it("keeps terminal outcomes readable and gives every fact a complete-output outlet", () => {
    const onOpenDiagnostics = vi.fn();
    const onOpenEvidence = vi.fn();
    const onEditAndResend = vi.fn();
    const onRetryRun = vi.fn();
    renderConsole({
      onOpenDiagnostics,
      onOpenEvidence,
      onEditAndResend,
      onRetryRun,
      messages: [
        message({ id: 1, speaker: "system", runId: "run-stop", status: "interrupted", systemEventKind: "user-stopped", body: "你让这一步停下了", error: "interrupted:user-interrupted" }),
        message({ id: 2, speaker: "system", runId: "run-fail", status: "failed", systemEventKind: "run-not-started", body: "Codex 版本过旧，无法运行模型 gpt-5.6-sol。请升级当前 Codex 后再重试。", error: "codex-cli-upgrade-required" }),
        message({ id: 3, speaker: "system", runId: "run-stuck", status: "stuck", systemEventKind: "run-stuck", body: "这一步卡住了", error: "idle-timeout:10ms" }),
        message({ id: 4, speaker: "system", runId: "run-dead", status: "failed", systemEventKind: "retry-exhausted", body: "这一步反复没跑起来，已经不再重试", error: "retry-limit" }),
      ],
    });

    expect(screen.getByText("你让这一步停下了")).toBeVisible();
    expect(screen.getByText("这一步没跑起来")).toBeVisible();
    expect(screen.getByText(
      "Codex 版本过旧，无法运行模型 gpt-5.6-sol。请升级当前 Codex 后再重试。",
    )).toBeVisible();
    expect(screen.getByText("这一步卡住了")).toBeVisible();
    expect(screen.getByText("这一步反复没跑起来，已经不再重试")).toBeVisible();
    expect(screen.queryByText("interrupted:user-interrupted")).not.toBeInTheDocument();
    expect(screen.queryByText("idle-timeout:10ms")).not.toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "查看日志" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "完整输出" })).toHaveLength(4);
    expect(onOpenDiagnostics).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "改一改重发这轮消息" }));
    expect(onEditAndResend).toHaveBeenCalledWith({
      stoppedMessageId: 1,
      sessionId: "session-a",
      runId: "run-stop",
    });
    expect(screen.getAllByRole("button", { name: /改一改重发/u })).toHaveLength(1);
    const retryButtons = screen.getAllByRole("button", { name: "重试" });
    fireEvent.click(retryButtons[0]!);
    fireEvent.click(retryButtons[1]!);
    expect(onRetryRun).toHaveBeenNthCalledWith(1, "session-a", "run-fail");
    expect(onRetryRun).toHaveBeenNthCalledWith(2, "session-a", "run-stuck");
  });

  it("explains Kimi process-output unavailability on a terminal outcome without an empty outlet", () => {
    renderConsole({
      messages: [
        message({
          id: 1,
          speaker: "system",
          runId: "run-kimi-fail",
          status: "failed",
          systemEventKind: "run-not-started",
          body: "这一步没跑起来",
          error: "Kimi ACP 已关闭。",
          runTiming: {
            stepId: "step-kimi-fail",
            attempt: 1,
            createdAt: "2026-07-26T16:07:39.136Z",
            startedAt: "2026-07-26T16:07:39.137Z",
            completedAt: "2026-07-26T16:07:39.138Z",
            elapsedMs: 1,
            status: "failed",
            engine: "kimi",
            processOutputAvailable: false,
          },
        }),
      ],
    });

    expect(screen.getByText("这一步没跑起来")).toBeVisible();
    expect(screen.getByText("完整输出不可用 · 当前 Kimi 执行不提供可恢复的完整过程记录")).toBeVisible();
    expect(screen.queryByText("Kimi ACP 已关闭。")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "完整输出" })).not.toBeInTheDocument();
  });

  it.each([
    ["kimi-cli-not-found", "没有找到 Kimi CLI。请先安装 Kimi，然后重试。"],
    ["kimi-cli-not-executable", "找到 Kimi CLI，但它不可执行。请修复文件执行权限后重试。"],
    ["kimi-cli-spawn-failed", "Kimi CLI 启动失败。请确认安装完整后重试。"],
    ["kimi-cli-exited", "Kimi CLI 启动后提前退出。请先在终端运行 Kimi 检查登录或配置，然后重试。"],
    ["kimi-acp-timeout", "Kimi CLI 启动后没有及时响应。请检查 Kimi 状态后重试。"],
  ])("shows the safe Kimi failure explanation for %s", (error, body) => {
    renderConsole({
      messages: [
        message({
          id: 1,
          speaker: "system",
          runId: "run-kimi-safe-failure",
          status: "failed",
          systemEventKind: "run-not-started",
          body,
          error,
        }),
      ],
    });

    expect(screen.getByText("这一步没跑起来")).toBeVisible();
    expect(screen.getByText(body)).toBeVisible();
    expect(screen.queryByText("/Users/private/.kimi-code/bin/kimi")).not.toBeInTheDocument();
    expect(screen.queryByText("spawn ENOENT raw provider payload")).not.toBeInTheDocument();
  });

  it("keeps derived sessions out of the sidebar and opens them from a timeline card", () => {
    const onOpenSubSession = vi.fn();
    const parentSession = {
      ...sessions[0],
      status: "idle" as const,
      runningCount: 0,
      childCount: 1,
      lastMessageMentionsAgent: true,
    };
    const childSession = { ...sessions[1], parentSessionId: sessions[0].sessionId, title: "裂变会话" };
    renderConsole({
      selectedSessionId: parentSession.sessionId,
      selectedSession: parentSession,
      project: {
        ...project,
        sessions: [parentSession, childSession],
      },
      messages: [message({
        id: 10,
        speaker: "system",
        sourceKind: "local-child-session-card",
        body: JSON.stringify({ version: 1, childSessionIds: [childSession.sessionId] }),
      })],
      childSessions: [{
        sessionId: childSession.sessionId,
        title: childSession.title,
        memberName: "测试",
        status: "not-started",
        statusLabel: "没跑起来",
      }],
      onOpenSubSession,
    });

    expect(screen.getAllByTestId("conversation-sidebar-session")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "默认会话" })).toHaveAttribute("data-status-dot", "none");
    const cardRow = screen.getByRole("button", { name: "裂变会话，负责成员：测试，状态：没跑起来" });
    expect(cardRow).toHaveAttribute("data-status", "not-started");
    fireEvent.click(cardRow);
    expect(onOpenSubSession).toHaveBeenCalledWith(childSession.sessionId);
  });

  it("keeps multiple subtask tabs and their conversation state isolated by session id", () => {
    const firstSession = { ...sessions[1], sessionId: "child-a", parentSessionId: "session-a", title: "空状态验收" };
    const secondSession = { ...sessions[1], sessionId: "child-b", parentSessionId: "session-a", title: "登录验收" };
    renderConsole({
      messages: [message({
        id: 10,
        speaker: "system",
        sourceKind: "local-child-session-card",
        body: JSON.stringify({ version: 1, childSessionIds: ["child-a", "child-b"] }),
      })],
      childSessions: [{
        sessionId: "child-a",
        title: "空状态验收",
        memberName: "测试",
        status: "waiting",
        statusLabel: "等待中",
      }, {
        sessionId: "child-b",
        title: "登录验收",
        memberName: "开发",
        status: "running",
        statusLabel: "进行中",
      }],
      subSessionViews: {
        "child-a": {
          status: "ready",
          view: {
            session: firstSession,
            messages: [message({ id: 11, sessionId: "child-a", role: "qa", speaker: "agent", body: "只属于空状态验收" })],
            activeRun: null,
          },
        },
        "child-b": {
          status: "ready",
          view: {
            session: secondSession,
            messages: [message({ id: 12, sessionId: "child-b", role: "dev", speaker: "agent", body: "只属于登录验收" })],
            activeRun: null,
          },
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /空状态验收，负责成员/u }));
    fireEvent.click(screen.getByRole("button", { name: /登录验收，负责成员/u }));
    expect(screen.getByRole("tab", { name: "空状态验收" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "登录验收" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("只属于登录验收")).toBeVisible();
    expect(screen.queryByText("只属于空状态验收")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "空状态验收" }));
    expect(screen.getByText("只属于空状态验收")).toBeVisible();
    expect(screen.queryByText("只属于登录验收")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /空状态验收，负责成员/u })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /登录验收，负责成员/u })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the parent visible in a wide split, overlays narrow windows, and restores parent scroll after close", async () => {
    setWindowWidth(1200);
    const onOpenSubSession = vi.fn();
    const onCloseSubSession = vi.fn();
    const childSession = { ...sessions[1], parentSessionId: sessions[0].sessionId, title: "空状态验收" };
    const cardMessage = message({
      id: 10,
      speaker: "system",
      sourceKind: "local-child-session-card",
      body: JSON.stringify({ version: 1, childSessionIds: [childSession.sessionId] }),
    });
    const overrides: Partial<OperatorConsoleProps> = {
      messages: [cardMessage],
      childSessions: [{
        sessionId: childSession.sessionId,
        title: childSession.title,
        memberName: "测试",
        status: "waiting",
        statusLabel: "等待中",
      }],
      onOpenSubSession,
      onCloseSubSession,
    };
    renderConsole(overrides);
    const timeline = screen.getByRole("region", { name: "会话时间线" });
    Object.defineProperty(timeline, "scrollHeight", { configurable: true, value: 1_200 });
    Object.defineProperty(timeline, "clientHeight", { configurable: true, value: 500 });
    timeline.scrollTop = 240;
    fireEvent.scroll(timeline);
    fireEvent.click(screen.getByRole("button", { name: /空状态验收，负责成员/u }));

    expect(screen.getByTestId("right-sidebar")).toHaveAttribute("data-layout", "split");
    expect(screen.getByRole("tab", { name: "空状态验收" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "会话时间线" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("告诉主理人你的目标…")).toBeEnabled();
    timeline.scrollTop = 700;

    setWindowWidth(700);
    expect(screen.getByTestId("right-sidebar")).toHaveAttribute("data-layout", "overlay");
    fireEvent.click(screen.getByRole("button", { name: "关闭右侧栏并回到会话区" }));
    expect(onCloseSubSession).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(timeline.scrollTop).toBe(240));
  });

  it("follows new content only at the bottom and offers an explicit return after upward reading", () => {
    const { rerender } = renderConsole();
    const timeline = screen.getByRole("region", { name: "会话时间线" });
    Object.defineProperty(timeline, "scrollHeight", { configurable: true, value: 1_000 });
    Object.defineProperty(timeline, "clientHeight", { configurable: true, value: 400 });
    timeline.scrollTop = 200;
    fireEvent.scroll(timeline);
    expect(screen.getByRole("button", { name: "回到底部" })).toBeVisible();

    rerender(<OperatorConsole {...baseProps({ messages: [message({ id: 1, body: "第一条" }), message({ id: 2, body: "第二条" })] })} />);
    expect(timeline.scrollTop).toBe(200);
    fireEvent.click(screen.getByRole("button", { name: "回到底部" }));
    expect(timeline.scrollTop).toBe(1_000);

    timeline.scrollTop = 600;
    fireEvent.scroll(timeline);
    rerender(<OperatorConsole {...baseProps({
      messages: [
        message({ id: 1, body: "第一条" }),
        message({ id: 2, body: "第二条" }),
        message({ id: 3, body: "第三条" }),
      ],
    })} />);
    expect(timeline.scrollTop).toBe(1_000);
  });

  it("owns one relay rail in the main conversation and keeps it out of the session sidebar", () => {
    const relayProps = {
      messages: [
        message({ id: 1, speaker: "user", role: null, body: "请开始" }),
        message({ id: 2, speaker: "agent", role: "dev", body: "已经开始" }),
      ],
      memberIdentities: [{ slug: "dev", displayName: "开发工程师" }],
    } satisfies Partial<OperatorConsoleProps>;
    const { rerender } = renderConsole(relayProps);

    const slot = screen.getByTestId("main-conversation-relay-slot");
    const rail = within(slot).getByTestId("conversation-relay-rail");
    const pane = screen.getByTestId("parent-conversation-pane");
    const timeline = screen.getByRole("region", { name: "会话时间线" });
    Object.defineProperty(timeline, "clientHeight", { configurable: true, value: 200 });
    Object.defineProperty(timeline, "scrollHeight", { configurable: true, value: 1_000 });
    timeline.scrollTop = 137;
    fireEvent.scroll(timeline);
    expect(rail).toBeInTheDocument();
    expect(slot).toHaveClass(
      "left-3",
      "top-[var(--window-header-height)]",
      "pointer-events-none",
    );
    expect(slot.parentElement).toBe(screen.getByTestId("parent-conversation-pane"));
    expect(within(screen.getByTestId("operator-sidebar")).queryByTestId(
      "conversation-relay-rail",
    )).not.toBeInTheDocument();

    fireEvent.mouseEnter(rail);
    expect(screen.getByTestId("relay-event-message-2")).toHaveAttribute(
      "data-hit-target",
      "row",
    );
    expect(screen.getByTestId("relay-branch").getAttribute("d")).toContain(" C ");

    rerender(<OperatorConsole {...baseProps({
      ...relayProps,
      rightSidebarOpen: true,
      rightSidebarTabs: { activeTabId: null, tabs: [] },
      sidebarOpen: false,
    })} />);
    expect(screen.getByTestId("parent-conversation-pane")).toBe(pane);
    expect(screen.getByRole("region", { name: "会话时间线" })).toBe(timeline);
    expect(timeline.scrollTop).toBe(137);
    expect(screen.getByTestId("main-conversation-relay-slot").parentElement).toBe(pane);
    expect(within(screen.getByTestId("operator-sidebar")).queryByTestId(
      "conversation-relay-rail",
    )).not.toBeInTheDocument();
  });

  it("keeps the timeline position unchanged when a relay target disappears", () => {
    renderConsole({
      messages: [
        message({ id: 1, speaker: "user", role: null, body: "请开始" }),
        message({ id: 2, speaker: "agent", role: "dev", body: "已经开始" }),
      ],
      memberIdentities: [{ slug: "dev", displayName: "开发工程师" }],
    });

    const timeline = screen.getByRole("region", { name: "会话时间线" });
    timeline.scrollTop = 137;
    const target = screen.getByTestId("timeline-message-2");
    const scrollIntoView = vi.fn();
    Object.defineProperty(target, "isConnected", { configurable: true, value: false });
    Object.defineProperty(target, "scrollIntoView", { configurable: true, value: scrollIntoView });

    fireEvent.mouseEnter(screen.getByTestId("conversation-relay-rail"));
    fireEvent.click(screen.getByTestId("relay-event-message-2"));

    expect(timeline.scrollTop).toBe(137);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(screen.getByTestId("conversation-relay-feedback")).toHaveTextContent(
      "无法定位到原消息，已保持当前阅读位置",
    );
  });

  it("restores each root conversation to its own saved reading message", () => {
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const onReadingMessageChange = vi.fn();

    try {
      const sessionAMessages = [
        message({ id: 1, sessionId: "session-a", body: "A 的阅读位置" }),
        message({ id: 2, sessionId: "session-a", body: "A 的最新消息" }),
      ];
      const sessionBMessages = [
        message({ id: 3, sessionId: "session-b", body: "B 的阅读位置" }),
        message({ id: 4, sessionId: "session-b", body: "B 的最新消息" }),
      ];
      const { rerender } = renderConsole({
        initialReadingMessageId: 1,
        messages: sessionAMessages,
        onReadingMessageChange,
      });

      rerender(<OperatorConsole {...baseProps({
        initialReadingMessageId: 3,
        messages: sessionBMessages,
        onReadingMessageChange,
        selectedSession: sessions[1],
        selectedSessionId: "session-b",
      })} />);
      rerender(<OperatorConsole {...baseProps({
        initialReadingMessageId: 1,
        messages: sessionAMessages,
        onReadingMessageChange,
      })} />);

      expect(scrollIntoView.mock.contexts.map((context) =>
        (context as HTMLElement).dataset.messageId)).toEqual(["1", "3", "1"]);
      expect(onReadingMessageChange.mock.calls.map((call) => call.slice(0, 2))).toEqual([
        ["session-a", 1],
        ["session-b", 3],
        ["session-a", 1],
      ]);
    } finally {
      if (originalScrollIntoView === undefined) {
        delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
      } else {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
          configurable: true,
          value: originalScrollIntoView,
        });
      }
    }
  });

  it("keeps machine terms out of the default conversation surface", () => {
    renderConsole({
      messages: [
        message({
          id: 1,
          speaker: "system",
          status: "failed",
          systemEventKind: "retry-exhausted",
          body: "dead-letter body handoff runDir",
          error: "cwd=/tmp/project runDir=/tmp/run direct worktree",
          runDir: "/tmp/moebius-run",
        }),
      ],
      activeRun: {
        ...runSnapshot,
        lastOutputSummary: "cwd /tmp/project runDir /tmp/run direct worktree",
      },
    });

    expect(screen.getByText("正在推进这一步…")).toBeVisible();
    expect(screen.getByText("这一步反复没跑起来，已经不再重试")).toBeVisible();
    expect(screen.queryByText(/\/tmp\/moebius-run/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/cwd=\/tmp/u)).not.toBeInTheDocument();
    expect(screen.queryByText("查看详情")).not.toBeInTheDocument();
  });

  it("locks the workspace but keeps the team selectable after the first message", () => {
    const onChangeSessionWorkspace = vi.fn();
    renderConsole({ onChangeSessionWorkspace });

    expect(screen.getByLabelText("工作空间：独立工作空间，已锁定")).toBeVisible();
    expect(screen.queryByRole("button", { name: /工作空间/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /工作空间/u })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Agent 团队/u })).toBeEnabled();
    expect(onChangeSessionWorkspace).not.toHaveBeenCalled();
  });

  it("keeps every record with a parent out of the root session rail, including corrupt lineage", () => {
    renderConsole({
      project: {
        ...project,
        sessions: [
          { ...sessions[0], parentSessionId: "session-b", title: "Cycle A" },
          { ...sessions[1], parentSessionId: "session-a", title: "Cycle B" },
          { ...sessions[1], sessionId: "session-c", parentSessionId: "session-c", title: "Self parent" },
          { ...sessions[1], sessionId: "session-d", parentSessionId: "missing", title: "Missing parent" },
        ],
      },
    });

    expect(screen.queryByText("Cycle A")).not.toBeInTheDocument();
    expect(screen.queryByText("Cycle B")).not.toBeInTheDocument();
    expect(screen.queryByText("Self parent")).not.toBeInTheDocument();
    expect(screen.queryByText("Missing parent")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("conversation-sidebar-session")).toHaveLength(0);
  });

  it("switches an empty session project from the composer dropdown", async () => {
    const onChangeSessionProject = vi.fn();
    const otherProject: OperatorProject = {
      ...project,
      projectId: "project-b",
      title: "project-b",
      folderPath: "/Users/example/project-b",
      sessions: [],
    };
    renderConsole({
      projects: [project, otherProject],
      messages: [],
      activeRun: null,
      onChangeSessionProject,
    });

    const trigger = screen.getByRole("button", { name: "项目：moebius，点击切换" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const target = await screen.findByRole("menuitemcheckbox", { name: "project-b" });
    fireEvent.click(target);
    expect(onChangeSessionProject).toHaveBeenCalledWith("session-a", "project-b");
  });

  it("keeps project context locked when the session has history or lineage", () => {
    const { rerender } = renderConsole({ onChangeSessionProject: vi.fn() });
    expect(screen.getByLabelText("项目：moebius，已锁定")).toBeVisible();
    expect(screen.queryByRole("button", { name: /点击切换/u })).not.toBeInTheDocument();

    const props = baseProps({
      messages: [],
      selectedSession: { ...sessions[0], parentSessionId: "parent" },
      onChangeSessionProject: vi.fn(),
    });
    rerender(<OperatorConsole {...props} />);
    expect(screen.getByLabelText("项目：moebius，已锁定")).toBeVisible();

    rerender(<OperatorConsole {...baseProps({
      messages: [],
      selectedSession: { ...sessions[0], childCount: 1 },
      onChangeSessionProject: vi.fn(),
    })} />);
    expect(screen.getByLabelText("项目：moebius，已锁定")).toBeVisible();
  });

  it("blocks every selection entry while pending and additionally blocks send during rebind", () => {
    const onSelectSession = vi.fn();
    const onSend = vi.fn();
    renderConsole({
      messages: [],
      onSelectSession,
      onChangeSessionProject: vi.fn(),
      onSend,
      isSelectionMutationPending: true,
      isSessionProjectUpdating: true,
    });

    expect(screen.getByRole("button", { name: "在 moebius 中新建会话" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "在 moebius 中新建会话" }))
      .toHaveAttribute("title", "项目正在变更，请稍后再试");
    expect(screen.getByRole("button", { name: "默认会话，正在运行" })).toBeDisabled();
    expect(screen.getByLabelText("项目：moebius，点击切换")).toBeDisabled();
    const composer = screen.getByRole("textbox");
    expect(composer).toBeDisabled();
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(onSelectSession).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("binds each project menu action to the project and supports rename reset plus safe removal", async () => {
    const onShowProjectInFolder = vi.fn();
    const onRenameProject = vi.fn().mockResolvedValue(undefined);
    const onRemoveProject = vi.fn().mockResolvedValue(undefined);
    renderConsole({
      project: { ...project, runningCount: 0 },
      onShowProjectInFolder,
      onRenameProject,
      onRemoveProject,
    });

    await openProjectMenu("moebius");
    expect(screen.getByRole("menu")).toBeVisible();
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "在文件管理器中显示",
      "修改显示名称",
      "移除项目",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "在文件管理器中显示" }));
    expect(onShowProjectInFolder).toHaveBeenCalledWith("/Users/example/moebius");

    await openProjectMenu("moebius");
    fireEvent.click(screen.getByRole("menuitem", { name: "修改显示名称" }));
    const renameDialog = screen.getByRole("dialog", { name: "修改显示名称" });
    expect(renameDialog).toHaveTextContent("不会重命名磁盘文件夹");
    fireEvent.change(screen.getByRole("textbox", { name: "显示名称" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onRenameProject).toHaveBeenCalledWith("local", ""));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "修改显示名称" })).not.toBeInTheDocument());

    await openProjectMenu("moebius");
    fireEvent.click(screen.getByRole("menuitem", { name: "移除项目" }));
    const removeDialog = screen.getByRole("dialog", { name: "移除项目？" });
    expect(removeDialog).toHaveTextContent("绝不会删除或修改磁盘上的项目文件夹");
    expect(removeDialog).toHaveTextContent("/Users/example/moebius");
    fireEvent.click(screen.getByRole("button", { name: "移除项目" }));
    await waitFor(() => expect(onRemoveProject).toHaveBeenCalledWith("local", false));
  });

  it("warns independently before forcing running agents to stop and remove the project", async () => {
    const onRemoveProject = vi.fn().mockResolvedValue(undefined);
    renderConsole({ onRemoveProject });

    await openProjectMenu("moebius");
    fireEvent.click(screen.getByRole("menuitem", { name: "移除项目" }));
    const warning = screen.getByRole("dialog", { name: "项目中仍有 Agent 正在运行" });
    expect(warning).toHaveTextContent("可以取消");
    expect(screen.queryByRole("dialog", { name: "移除项目？" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "强制中止并继续" }));
    expect(screen.queryByRole("dialog", { name: "项目中仍有 Agent 正在运行" })).not.toBeInTheDocument();
    const confirmation = screen.getByRole("dialog", { name: "移除项目？" });
    expect(confirmation).toHaveTextContent("绝不会删除或修改磁盘上的项目文件夹");
    fireEvent.click(screen.getByRole("button", { name: "中止并移除" }));
    await waitFor(() => expect(onRemoveProject).toHaveBeenCalledWith("local", true));
  });

  it("keeps history readable while blocking work and confirms folder repair with both paths", async () => {
    const onSelectSession = vi.fn();
    const onSend = vi.fn();
    const onSelectFolderForRepair = vi.fn().mockResolvedValue("/Users/example/moved-moebius");
    const onRepairProjectFolder = vi.fn().mockResolvedValue(undefined);
    renderConsole({
      project: {
        ...project,
        directoryAvailable: false,
        directoryUnavailableReason: "当前项目本地文件夹未找到，可以指定新的文件夹",
        newConversationDisabledReason: "当前项目本地文件夹不可用，无法新建对话",
      },
      activeRun: null,
      onSelectSession,
      onSend,
      onChangeSessionWorkspace: vi.fn(),
      onSelectFolderForRepair,
      onRepairProjectFolder,
    });

    expect(screen.getByRole("button", { name: "新建对话" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Agent 团队" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "在 moebius 中新建会话" })).toBeDisabled();
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByText("历史对话只读；修复文件夹后可继续")).toBeVisible();
    expect(screen.getByLabelText("工作空间：独立工作空间，已锁定")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "默认会话，需要你处理" }));
    expect(onSelectSession).toHaveBeenCalledWith({ sessionId: "session-a", projectId: "local" });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "修复 moebius 项目文件夹" }));
    expect(onSelectFolderForRepair).toHaveBeenCalledWith("local");
    const dialog = await screen.findByRole("dialog", { name: "修复项目文件夹" });
    expect(dialog).toHaveTextContent("不会移动、复制或重命名任何磁盘文件");
    expect(screen.getByTestId("repair-original-folder")).toHaveTextContent("/Users/example/moebius");
    expect(screen.getByTestId("repair-new-folder")).toHaveTextContent("/Users/example/moved-moebius");

    fireEvent.click(screen.getByRole("button", { name: "确认新位置" }));
    await waitFor(() => expect(onRepairProjectFolder).toHaveBeenCalledWith("local", "/Users/example/moved-moebius"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "修复项目文件夹" })).not.toBeInTheDocument());

  });

  it("shows an unselected new-conversation state after the current project is removed", () => {
    renderConsole({
      newConversation: {
        selectedProjectId: null,
        selectedWorkspaceMode: "direct",
        selectedTeamKey: agentTeam.teamKey,
        draft: "",
        isSubmitting: false,
        error: null,
      },
      agentTeamsState: { status: "ready", teams: [agentTeam] },
      onRemoveProject: vi.fn(),
    });

    expect(screen.getByRole("region", { name: "新建对话" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "新对话" })).toBeVisible();
    expect(screen.getByRole("button", { name: "项目：未选择，点击选择" })).toHaveTextContent("选择项目");
    expect(screen.queryByRole("region", { name: "会话时间线" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "默认会话，正在运行" })).not.toHaveAttribute("aria-current");
  });
});

async function openProjectMenu(projectName: string): Promise<void> {
  const trigger = screen.getByRole("button", { name: `${projectName} 项目菜单` });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  await screen.findByRole("menu");
}

function renderConsole(overrides: Partial<OperatorConsoleProps> = {}) {
  return render(<OperatorConsole {...baseProps(overrides)} />);
}

function renderControlledConsole(overrides: Partial<OperatorConsoleProps> = {}) {
  function ControlledConsole(): JSX.Element {
    const [rightSidebarTabs, setRightSidebarTabs] = useState<RightSidebarTabsState>({
      tabs: [],
      activeTabId: null,
    });
    return (
      <OperatorConsole
        {...baseProps(overrides)}
        rightSidebarTabs={rightSidebarTabs}
        onRightSidebarTabsChange={setRightSidebarTabs}
      />
    );
  }
  return render(<ControlledConsole />);
}

function setWindowWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  fireEvent(window, new Event("resize"));
}

function firePointer(
  element: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  input: { pointerId: number; button: number; clientX: number },
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: input.button,
    clientX: input.clientX,
  });
  Object.defineProperty(event, "pointerId", { value: input.pointerId });
  fireEvent(element, event);
}

function baseProps(overrides: Partial<OperatorConsoleProps> = {}): OperatorConsoleProps {
  return {
    project,
    selectedSessionId: "session-a",
    selectedSession: sessions[0],
    messages: [message({ id: 1, body: "@dev hello" })],
    activeRun: null,
    composerValue: "@dev next",
    runnerStatus: "running",
    sqlitePath: "/tmp/local-console.sqlite",
    lastError: null,
    onComposerChange: vi.fn(),
    onSend: vi.fn(),
    onSelectSession: vi.fn(),
    onInterrupt: vi.fn(),
    ...overrides,
  };
}

const sessions: OperatorSession[] = [
  {
    sessionId: "session-a",
    projectId: "local",
    workspaceMode: "worktree",
    workspacePendingMode: null,
    workspaceUnavailableReason: null,
    branchName: "agent/session-a",
    title: "默认会话",
    status: "running",
    awaitsHumanReason: null,
    unreadSince: null,
    runningCount: 1,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
    interruptedCount: 0,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:01.000Z",
  },
  {
    sessionId: "session-b",
    projectId: "local",
    workspaceMode: "direct",
    workspacePendingMode: null,
    workspaceUnavailableReason: null,
    branchName: "main",
    title: "验收会话",
    status: "failed",
    awaitsHumanReason: "exception",
    unresolvedSystemEventKind: "retry-exhausted",
    unreadSince: null,
    runningCount: 0,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 1,
    interruptedCount: 0,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:01.000Z",
  },
];

const project: OperatorProject = {
  projectId: "local",
  sourceType: "local-folder",
  title: "moebius",
  folderPath: "/Users/example/moebius",
  worktreeMode: true,
  workspaceCwd: "/tmp/moebius-local-worktree",
  workspaceMode: "worktree",
  worktreePath: "/tmp/moebius-local-worktree",
  worktreeUnavailableReason: null,
  workspaceUpdatedAt: "2026-07-09T00:00:01.000Z",
  branchName: "main",
  isGitRepository: true,
  directoryAvailable: true,
  directoryUnavailableReason: null,
  sessions,
  runningCount: 1,
  waitingCount: 0,
  stuckCount: 0,
  errorCount: 1,
};

const agentTeam = {
  teamKey: "system:development",
  id: "development",
  ownership: "system" as const,
  name: "开发团队",
  description: "负责软件开发任务",
  primaryAgentSlug: "manager",
  memberOrder: ["manager"],
  members: [{ slug: "manager", displayName: "开发经理", description: "默认接单" }],
  status: "usable" as const,
  canCreateConversation: true,
};

const fiveMemberTeam = {
  ...agentTeam,
  memberOrder: ["dev", "manager", "qa", "product", "security"],
  members: [
    { slug: "dev", displayName: "开发", description: "实现功能" },
    { slug: "manager", displayName: "开发经理", description: "默认接单" },
    { slug: "qa", displayName: "测试", description: "质量保证" },
    { slug: "product", displayName: "产品", description: "产品定义" },
    { slug: "security", displayName: "安全", description: "安全审查" },
  ],
};

function detailStateFor(teamKey: string) {
  return {
    teamKey,
    selectedMemberSlug: "manager",
    memberEditors: {
      manager: {
        memberSlug: "manager",
        loadStatus: "ready" as const,
        loadError: null,
        draftMarkdown: "# 开发经理\n\n默认接单\n",
        isDirty: false,
        saveStatus: "idle" as const,
        saveError: null,
        externalChangeStatus: "none" as const,
        displayName: "开发经理",
        description: "默认接单",
      },
    },
    saveAllFailures: [],
  };
}

const draftTeam = {
  teamKey: "user:draft",
  id: "draft",
  ownership: "user" as const,
  name: "新的团队",
  description: null,
  primaryAgentSlug: null,
  memberOrder: [],
  members: [],
  status: "unfinished-draft" as const,
  canCreateConversation: false,
};

const repairTeam = {
  teamKey: "user:repair",
  id: "repair",
  ownership: "user" as const,
  name: "客户支持团队",
  description: "处理客户问题",
  primaryAgentSlug: "lead",
  memberOrder: ["lead"],
  members: [],
  status: "needs-repair" as const,
  canCreateConversation: false,
};

const runSnapshot: OperatorRunSnapshot = {
  sessionId: "session-a",
  runId: "run-1",
  role: "dev",
  status: "running",
  startedAt: "2026-07-09T00:00:00.000Z",
  elapsedMs: 12_000,
  runDir: "/tmp/moebius-run",
  cwd: "/tmp/moebius-local-worktree",
  workspaceMode: "worktree",
  worktreeUnavailableReason: null,
  stdoutTail: "live tail from codex",
  stderrTail: null,
  liveMarkdown: null,
  lastOutputSummary: "live tail from codex",
  tailDiagnostic: null,
  interruptible: true,
};

function message(input: Partial<OperatorMessage> & { id: number; body: string }): OperatorMessage {
  return {
    id: input.id,
    sessionId: input.sessionId ?? "session-a",
    speaker: input.speaker ?? "user",
    role: input.role ?? null,
    body: input.body,
    sourceKind: input.sourceKind ?? null,
    sourceId: input.sourceId ?? null,
    status: input.status ?? "completed",
    runId: input.runId ?? null,
    runDir: input.runDir ?? null,
    runTiming: input.runTiming,
    error: input.error ?? null,
    systemEventKind: input.systemEventKind ?? "other",
    createdAt: input.createdAt ?? "2026-07-09T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-07-09T00:00:01.000Z",
  };
}

function availableReference(filePath: string, line: number): FileReferenceContent {
  return {
    available: true,
    path: filePath,
    lines: [{ lineNumber: line, text: filePath }],
    reason: null,
    targetLine: line,
    targetColumn: null,
    truncatedBefore: false,
    truncatedAfter: false,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
