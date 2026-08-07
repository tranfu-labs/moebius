import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ConversationSidebar,
  deriveProjectStatusDot,
  deriveStatusDot,
  orderProjectIdsForPointer,
  orderSessionsByCreatedAt,
  projectDirectoryName,
  type ConversationSidebarProject
} from "./conversation-sidebar";

describe("ConversationSidebar", () => {
  it("uses a display name when present and otherwise derives the project name from the directory path", () => {
    expect(projectDirectoryName({ path: "/Users/example/moebius/" })).toBe("moebius");
    expect(projectDirectoryName({ path: "C:\\Users\\example\\tranfu-site" })).toBe("tranfu-site");
    expect(projectDirectoryName({ path: "/Users/example/moebius/", label: "  展示名称  " })).toBe("展示名称");
    expect(projectDirectoryName({ path: "/Users/example/moebius/", label: "   " })).toBe("moebius");
  });

  it("orders sessions by createdAt descending without mutating input and preserves ties", () => {
    const sessions = [
      { id: "oldest", createdAt: "2026-07-09T00:00:00.000Z" },
      { id: "newest", createdAt: "2026-07-09T00:02:00.000Z" },
      { id: "same-time-a", createdAt: "2026-07-09T00:01:00.000Z" },
      { id: "same-time-b", createdAt: "2026-07-09T00:01:00.000Z" }
    ];

    expect(orderSessionsByCreatedAt(sessions).map((session) => session.id)).toEqual([
      "newest",
      "same-time-a",
      "same-time-b",
      "oldest"
    ]);
    expect(sessions.map((session) => session.id)).toEqual(["oldest", "newest", "same-time-a", "same-time-b"]);
  });

  it("derives one status dot with red, blue, blink, none priority", () => {
    expect(deriveStatusDot({ unresolvedSystemEventKind: "run-stuck", unreadSince: "2026-07-09T00:02:00.000Z", isRunning: true })).toBe("red");
    expect(deriveStatusDot({ unreadSince: "2026-07-09T00:02:00.000Z", isRunning: false, hasPendingControlWork: false })).toBe("blue");
    expect(deriveStatusDot({ unreadSince: null, isRunning: true })).toBe("blink");
    expect(deriveStatusDot({ unreadSince: null, isRunning: false })).toBe("none");
    expect(deriveStatusDot({ awaitsHumanReason: "legacy-value", unreadSince: null, isRunning: false })).toBe("none");
    expect(deriveStatusDot({ unreadSince: "2026-07-09T00:02:00.000Z", isRunning: false, hasPendingControlWork: true })).toBe("blink");
    expect(deriveStatusDot({
      hasUnacknowledgedAttention: true,
      manualUnreadAt: "2026-07-09T00:02:00.000Z",
      unreadSince: null,
      isRunning: true,
    })).toBe("red");
    expect(deriveStatusDot({
      hasUnacknowledgedAttention: false,
      manualUnreadAt: "2026-07-09T00:02:00.000Z",
      unreadSince: null,
      isRunning: false,
    })).toBe("blue");
  });

  it("shows the read action dictated by the final visible dot", async () => {
    const onUpdateReadState = vi.fn(async () => undefined);
    const cases = [
      {
        session: {
          id: "red",
          title: "红点对话",
          createdAt: "2026-07-09T00:00:00.000Z",
          hasUnacknowledgedAttention: true,
          unreadSince: null,
          isRunning: true,
        },
        expected: "标记为已读",
      },
      {
        session: {
          id: "blue",
          title: "蓝点对话",
          createdAt: "2026-07-09T00:00:00.000Z",
          hasUnacknowledgedAttention: false,
          manualUnreadAt: "2026-07-09T00:00:00.000Z",
          unreadSince: null,
          isRunning: false,
        },
        expected: "标记为已读",
      },
      {
        session: {
          id: "running",
          title: "运行对话",
          createdAt: "2026-07-09T00:00:00.000Z",
          hasUnacknowledgedAttention: false,
          unreadSince: null,
          isRunning: true,
        },
        expected: null,
      },
      {
        session: {
          id: "idle",
          title: "静止对话",
          createdAt: "2026-07-09T00:00:00.000Z",
          hasUnacknowledgedAttention: false,
          unreadSince: null,
          isRunning: false,
        },
        expected: "标记为未读",
      },
    ] as const;

    const { rerender } = render(<div />);
    for (const item of cases) {
      rerender(
        <ConversationSidebar
          projects={[{ id: "project", path: "/tmp/project", sessions: [item.session] }]}
          onUpdateReadState={onUpdateReadState}
        />,
      );
      fireEvent.contextMenu(screen.getByTestId("conversation-sidebar-session"));
      await screen.findByRole("menu");
      if (item.expected === null) {
        expect(screen.queryByRole("menuitem", { name: /标记为/u })).not.toBeInTheDocument();
      } else {
        expect(screen.getByRole("menuitem", { name: item.expected })).toBeInTheDocument();
      }
      fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    }
  });

  it("renders one shared preview surface and replaces Git context without duplicating it", () => {
    const gitProject: ConversationSidebarProject = {
      id: "git",
      path: "/workspace/git-project",
      label: "展示项目名",
      isGitRepository: true,
      sessions: [{
        id: "git-session",
        title: "Git 对话",
        branchName: "feature/sidebar",
        unreadSince: null,
        isRunning: false,
        createdAt: "2026-07-09T00:00:00.000Z",
      }],
    };
    const plainProject: ConversationSidebarProject = {
      id: "plain",
      path: "/workspace/plain-folder",
      isGitRepository: false,
      sessions: [{
        id: "plain-session",
        title: "普通对话",
        unreadSince: null,
        isRunning: false,
        createdAt: "2026-07-09T00:00:00.000Z",
      }],
    };
    const { rerender } = render(<ConversationSidebar projects={[gitProject, plainProject]} />);

    const preview = screen.getByTestId("conversation-sidebar-shared-preview");
    expect(screen.getAllByTestId("conversation-sidebar-shared-preview")).toHaveLength(1);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Git 对话" }));
    expect(preview).toHaveAttribute("data-visible", "true");
    expect(preview).toHaveTextContent("Git 对话");
    expect(preview).toHaveTextContent("git-project");
    expect(preview).toHaveTextContent("feature/sidebar");

    fireEvent.mouseEnter(screen.getByRole("button", { name: "普通对话" }));
    expect(screen.getAllByTestId("conversation-sidebar-shared-preview")).toHaveLength(1);
    expect(preview).toHaveTextContent("普通对话");
    expect(preview).toHaveTextContent("plain-folder");
    expect(preview).not.toHaveTextContent("feature/sidebar");

    rerender(<ConversationSidebar projects={[{
      ...gitProject,
      sessions: [{ ...gitProject.sessions[0]!, branchName: "detached" }],
    }]} />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Git 对话" }));
    expect(preview).toHaveTextContent("detached");

    rerender(<ConversationSidebar projects={[{
      ...gitProject,
      sessions: [{ ...gitProject.sessions[0]!, branchUnavailable: true }],
    }]} />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Git 对话" }));
    expect(preview).toHaveTextContent("分支信息不可用");

    rerender(<ConversationSidebar projects={[{
      ...gitProject,
      directoryAvailable: false,
      isGitRepository: false,
      sessions: [{
        ...gitProject.sessions[0]!,
        branchName: null,
        branchUnavailable: false,
      }],
    }]} />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Git 对话" }));
    expect(preview).toHaveTextContent("分支信息不可用");
  });

  it("moves a pinned conversation without rendering a duplicate and restores created order", async () => {
    const onSetSessionPinned = vi.fn(async () => undefined);
    const baseProject: ConversationSidebarProject = {
      id: "project",
      path: "/tmp/project",
      sessions: [
        { id: "older", title: "较早", unreadSince: null, isRunning: false, createdAt: "2026-07-09T00:00:00.000Z" },
        { id: "newer", title: "较新", unreadSince: null, isRunning: false, createdAt: "2026-07-09T00:01:00.000Z" },
      ],
    };
    const { rerender } = render(
      <ConversationSidebar projects={[baseProject]} onSetSessionPinned={onSetSessionPinned} />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "较早" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "置顶" }));
    await waitFor(() => expect(onSetSessionPinned).toHaveBeenCalledWith(
      expect.objectContaining({ id: "older" }),
      "project",
      true,
    ));

    const pinnedProject = {
      ...baseProject,
      sessions: baseProject.sessions.map((session) =>
        session.id === "older" ? { ...session, pinnedAt: "2026-07-09T00:02:00.000Z" } : session),
    };
    rerender(<ConversationSidebar projects={[pinnedProject]} onSetSessionPinned={onSetSessionPinned} />);
    expect(screen.getAllByTestId("conversation-sidebar-session")
      .filter((row) => row.dataset.sessionId === "older")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "置顶" })).toContainElement(
      screen.getByRole("button", { name: "较早" }),
    );

    rerender(<ConversationSidebar projects={[baseProject]} onSetSessionPinned={onSetSessionPinned} />);
    expect(within(screen.getByRole("list", { name: "project 对话" }))
      .getAllByTestId("conversation-sidebar-session")
      .map((row) => row.dataset.sessionId)).toEqual(["newer", "older"]);
  });

  it("keeps rename input and the original row title when persistence fails", async () => {
    const onRenameSession = vi.fn(async () => {
      throw new Error("保存失败");
    });
    render(<ConversationSidebar projects={[project]} onRenameSession={onRenameSession} />);

    fireEvent.contextMenu(screen.getByRole("button", { name: "导出功能重构" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "重命名对话" }));
    const input = screen.getByRole("textbox", { name: "对话名称" });
    fireEvent.change(input, { target: { value: "新的名称" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
    expect(screen.getByRole("textbox", { name: "对话名称" })).toHaveValue("新的名称");
    expect(screen.getByRole("button", { name: "导出功能重构" })).toBeInTheDocument();
  });

  it("places the dragged project around row midpoints without mutating input", () => {
    const projectIds = ["alpha", "beta", "gamma"];
    expect(orderProjectIdsForPointer(projectIds, "alpha", 75, [
      { id: "alpha", top: 0, bottom: 40 },
      { id: "beta", top: 40, bottom: 80 },
      { id: "gamma", top: 80, bottom: 120 },
    ])).toEqual(["beta", "alpha", "gamma"]);
    expect(orderProjectIdsForPointer(projectIds, "gamma", 10, [
      { id: "alpha", top: 0, bottom: 40 },
      { id: "beta", top: 40, bottom: 80 },
      { id: "gamma", top: 80, bottom: 120 },
    ])).toEqual(["gamma", "alpha", "beta"]);
    expect(projectIds).toEqual(["alpha", "beta", "gamma"]);
  });

  it("aggregates project status with red, blue, blink, none priority", () => {
    const none = { unreadSince: null, isRunning: false };
    const blink = { ...none, isRunning: true };
    const blue = { ...none, unreadSince: "2026-07-09T00:02:00.000Z" };
    const red = { ...none, unresolvedSystemEventKind: "retry-exhausted" as const };

    expect(deriveProjectStatusDot([blink, blue, red])).toBe("red");
    expect(deriveProjectStatusDot([blink, blue])).toBe("blue");
    expect(deriveProjectStatusDot([none, blink])).toBe("blink");
    expect(deriveProjectStatusDot([none])).toBe("none");
    expect(deriveProjectStatusDot([])).toBe("none");
  });

  it("renders every session in createdAt descending order without a completed group", () => {
    render(<ConversationSidebar projects={[project]} selectedSessionId="idle-refactor" />);

    expect(screen.getByText("moebius")).toBeInTheDocument();
    expect(screen.queryByText(/已完成/u)).not.toBeInTheDocument();

    const conversationList = screen.getByRole("list", { name: "moebius 对话" });
    expect(within(conversationList).getAllByTestId("conversation-sidebar-session").map((row) => row.dataset.sessionId)).toEqual([
      "running-progress",
      "waiting-summary",
      "idle-refactor",
      "docs-history"
    ]);
  });

  it("keeps order unchanged when selection and statuses change, then puts a new session first", () => {
    const { rerender } = render(<ConversationSidebar projects={[project]} selectedSessionId="idle-refactor" />);
    const sessionIds = () => screen.getAllByTestId("conversation-sidebar-session").map((row) => row.dataset.sessionId);
    expect(sessionIds()).toEqual(["running-progress", "waiting-summary", "idle-refactor", "docs-history"]);

    const changedProject: ConversationSidebarProject = {
      ...project,
      sessions: project.sessions.map((session) => ({
        ...session,
        unresolvedSystemEventKind: null,
        unreadSince: session.id === "waiting-summary" ? "2026-07-09T00:04:00.000Z" : null,
        isRunning: session.id === "idle-refactor"
      }))
    };
    rerender(<ConversationSidebar projects={[changedProject]} selectedSessionId="waiting-summary" />);
    expect(sessionIds()).toEqual(["running-progress", "waiting-summary", "idle-refactor", "docs-history"]);

    rerender(
      <ConversationSidebar
        projects={[{
          ...changedProject,
          sessions: [
            ...changedProject.sessions,
            {
              id: "brand-new",
              title: "刚创建的对话",
              awaitsHumanReason: null,
              unreadSince: null,
              isRunning: false,
              createdAt: "2026-07-09T00:04:00.000Z"
            }
          ]
        }]}
        selectedSessionId="brand-new"
      />
    );
    expect(sessionIds()).toEqual(["brand-new", "running-progress", "waiting-summary", "idle-refactor", "docs-history"]);
  });

  it("marks selection without changing order and reports the selected session", () => {
    const onSelectSession = vi.fn();
    render(<ConversationSidebar projects={[project]} selectedSessionId="idle-refactor" onSelectSession={onSelectSession} />);

    const selected = screen.getByRole("button", { name: "导出功能重构" });
    expect(selected).toHaveAttribute("aria-current", "page");
    expect(selected).toHaveClass("h-8", "rounded-lg", "pl-7", "bg-sel");
    expect(selected).not.toHaveTextContent(/»|>>/u);
    fireEvent.click(screen.getByRole("button", { name: "进度提示，正在运行" }));
    expect(onSelectSession).toHaveBeenCalledWith("running-progress", "moebius");
  });

  it("keeps icon hit targets while aligning project and session action glyphs", () => {
    render(
      <ConversationSidebar
        projects={[project]}
        onNewConversation={vi.fn()}
        onRenameProject={vi.fn()}
        onArchiveSession={vi.fn()}
      />,
    );

    const projectToggle = screen.getByTestId("conversation-sidebar-project-toggle");
    expect(projectToggle.querySelector("svg")).toHaveClass("h-3.5", "w-3.5");

    const newConversation = screen.getByRole("button", { name: "在 moebius 中新建会话" });
    expect(newConversation).toHaveClass("h-7", "w-7");
    expect(newConversation.querySelector("svg")).toHaveClass("h-3.5", "w-3.5");

    const projectMenu = screen.getByRole("button", { name: "moebius 项目菜单" });
    expect(projectMenu).toHaveClass("h-7", "w-7");
    expect(projectMenu.querySelector("svg")).toHaveClass("h-3.5", "w-3.5");

    const sessionMenu = screen.getByRole("button", { name: /进度提示.*菜单/u });
    expect(sessionMenu).toHaveClass("h-6", "w-6");
    expect(sessionMenu.querySelector("svg")).toHaveClass("h-3.5", "w-3.5");
  });

  it("exposes red, blue, blinking, and no-dot meanings without relying on color", () => {
    render(<ConversationSidebar projects={[project]} />);

    expect(screen.getByRole("button", { name: "失败汇总，需要你处理" })).toHaveAttribute("data-status-dot", "red");
    expect(screen.getByRole("button", { name: "文档记录，未读" })).toHaveAttribute("data-status-dot", "blue");
    expect(screen.getByRole("button", { name: "进度提示，正在运行" })).toHaveAttribute("data-status-dot", "blink");
    expect(screen.getByRole("button", { name: "导出功能重构" })).toHaveAttribute("data-status-dot", "none");
    expect(screen.getByRole("img", { name: "需要你处理" })).toHaveAttribute("title", "需要你处理");
    expect(screen.getByRole("img", { name: "未读" })).toHaveAttribute("title", "未读");
    expect(screen.getByRole("img", { name: "正在运行" })).toHaveAttribute("title", "正在运行");
    expect(screen.getByRole("img", { name: "当前静止" })).toHaveAttribute("title", "当前静止");
  });

  it("toggles a project independently and only shows its aggregated status while collapsed", () => {
    const secondProject: ConversationSidebarProject = {
      id: "second-project",
      path: "/Users/example/work/second-project",
      sessions: [{
        id: "second-running",
        title: "第二项目运行",
        awaitsHumanReason: null,
        unreadSince: null,
        isRunning: true,
        createdAt: "2026-07-09T00:00:00.000Z",
      }],
    };
    render(<ConversationSidebar projects={[project, secondProject]} selectedSessionId="idle-refactor" />);

    const [firstRow] = screen.getAllByTestId("conversation-sidebar-project");
    const firstToggle = screen.getByRole("button", { name: "moebius 项目，已展开" });
    const secondToggle = screen.getByRole("button", { name: "second-project 项目，已展开" });
    expect(firstToggle).toHaveAttribute("aria-expanded", "true");
    expect(firstToggle).toHaveAttribute("data-status-dot", "none");
    expect(secondToggle).toHaveAttribute("aria-expanded", "true");

    firePointer(firstRow!, "pointerdown", { pointerId: 10, button: 0, clientX: 10, clientY: 10 });
    firePointer(firstRow!, "pointerup", { pointerId: 10, button: 0, clientX: 10, clientY: 10 });

    const collapsedToggle = screen.getByRole("button", { name: "moebius 项目，已折叠，需要你处理" });
    expect(collapsedToggle).toHaveAttribute("aria-expanded", "false");
    expect(collapsedToggle).toHaveAttribute("data-status-dot", "red");
    expect(screen.queryByRole("list", { name: "moebius 对话" })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "second-project 对话" })).toBeVisible();
    expect(secondToggle).toHaveAttribute("aria-expanded", "true");

    firePointer(collapsedToggle, "pointerdown", { pointerId: 11, button: 0, clientX: 10, clientY: 10 });
    firePointer(collapsedToggle, "pointerup", { pointerId: 11, button: 0, clientX: 10, clientY: 10 });

    expect(screen.getByRole("button", { name: "moebius 项目，已展开" })).toHaveAttribute("data-status-dot", "none");
    expect(screen.getByRole("button", { name: "导出功能重构" })).toHaveAttribute("aria-current", "page");
  });

  it("excludes pinned conversations from a collapsed project status", () => {
    const pinnedRed = {
      id: "pinned-red",
      title: "置顶红点",
      pinnedAt: "2026-07-09T00:03:00.000Z",
      hasUnacknowledgedAttention: true,
      unreadSince: null,
      isRunning: false,
      createdAt: "2026-07-09T00:03:00.000Z",
    };
    const projectBlue = {
      id: "project-blue",
      title: "项目蓝点",
      unreadSince: "2026-07-09T00:02:00.000Z",
      isRunning: false,
      createdAt: "2026-07-09T00:02:00.000Z",
    };
    const projectRunning = {
      id: "project-running",
      title: "项目运行",
      unreadSince: null,
      isRunning: true,
      createdAt: "2026-07-09T00:01:00.000Z",
    };
    render(<ConversationSidebar projects={[{
      id: "aggregate",
      path: "/tmp/aggregate",
      sessions: [pinnedRed, projectBlue, projectRunning],
    }]} />);

    const projectRow = screen.getByTestId("conversation-sidebar-project");
    firePointer(projectRow, "pointerdown", { pointerId: 12, button: 0, clientX: 10, clientY: 10 });
    firePointer(projectRow, "pointerup", { pointerId: 12, button: 0, clientX: 10, clientY: 10 });

    expect(screen.getByRole("button", {
      name: "aggregate 项目，已折叠，未读",
    })).toHaveAttribute("data-status-dot", "blue");
  });

  it("keeps project action buttons from bubbling into the project disclosure", () => {
    const onNewConversation = vi.fn();
    const onShowProjectInFolder = vi.fn();
    const onOuterClick = vi.fn();
    render(
      <div onClick={onOuterClick}>
        <ConversationSidebar
          projects={[project]}
          onNewConversation={onNewConversation}
          onShowProjectInFolder={onShowProjectInFolder}
        />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "在 moebius 中新建会话" }));
    fireEvent.click(screen.getByRole("button", { name: "moebius 项目菜单" }));

    expect(onNewConversation).toHaveBeenCalledWith("moebius");
    expect(onOuterClick).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "moebius 项目，已展开" })).toHaveAttribute("aria-expanded", "true");
  });

  it("offers analysis, copy-path, and archive from one pointer or keyboard menu bound to the same conversation", async () => {
    const onAnalyzeConversation = vi.fn();
    const onArchiveSession = vi.fn();
    const onCopySessionLogPath = vi.fn(async () => ({ ok: true as const }));
    render(
      <ConversationSidebar
        projects={[project]}
        onAnalyzeConversation={onAnalyzeConversation}
        onArchiveSession={onArchiveSession}
        onCopySessionLogPath={onCopySessionLogPath}
      />,
    );

    const menuTrigger = screen.getByRole("button", { name: "导出功能重构 对话菜单" });
    fireEvent.focus(menuTrigger);
    expect(menuTrigger).toHaveClass("focus:opacity-100");

    const conversationRow = screen.getByRole("button", { name: "导出功能重构" });
    fireEvent.contextMenu(conversationRow);
    const analyzeItem = await screen.findByRole("menuitem", { name: "在右侧栏分析这段对话" });
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "在右侧栏分析这段对话",
      "复制对话记录路径",
      "归档",
    ]);
    fireEvent.click(analyzeItem);
    expect(onAnalyzeConversation).toHaveBeenCalledWith("idle-refactor", "moebius");
    await waitFor(() => expect(conversationRow).toHaveFocus());

    fireEvent.keyDown(screen.getByRole("button", { name: "导出功能重构" }), {
      key: "F10",
      shiftKey: true,
    });
    const keyboardCopyItem = await screen.findByRole("menuitem", { name: "复制对话记录路径" });
    fireEvent.click(keyboardCopyItem);

    expect(onCopySessionLogPath).toHaveBeenCalledWith("idle-refactor", "moebius");
    expect(await screen.findByRole("status")).toHaveTextContent("路径已复制");
    expect(document.body.textContent).not.toContain("/sessions/");

    fireEvent.contextMenu(screen.getByRole("button", { name: "导出功能重构" }));
    const reopenedArchiveItem = await screen.findByRole("menuitem", { name: "归档" });
    fireEvent.click(reopenedArchiveItem);

    expect(onArchiveSession).toHaveBeenCalledWith("idle-refactor", "moebius");
  });

  it("keeps analysis enabled for an unavailable project but disables it for an unavailable record", async () => {
    const user = userEvent.setup();
    const onAnalyzeConversation = vi.fn();
    const unavailableProject: ConversationSidebarProject = {
      ...project,
      directoryAvailable: false,
      sessions: project.sessions.map((session) => session.id === "idle-refactor"
        ? { ...session, analysisDisabledReason: "对话记录不可用，暂时无法分析" }
        : session),
    };
    const { rerender } = render(
      <ConversationSidebar
        projects={[{ ...unavailableProject, sessions: project.sessions }]}
        onAnalyzeConversation={onAnalyzeConversation}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "导出功能重构" }));
    const enabledItem = await screen.findByRole("menuitem", { name: "在右侧栏分析这段对话" });
    expect(enabledItem).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(enabledItem, { key: "Escape" });

    rerender(
      <ConversationSidebar
        projects={[unavailableProject]}
        onAnalyzeConversation={onAnalyzeConversation}
      />,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: "导出功能重构" }));
    const disabledItem = await screen.findByRole("menuitem", { name: "在右侧栏分析这段对话" });
    expect(disabledItem).toHaveAttribute("aria-disabled", "true");
    expect(disabledItem).toHaveAttribute("aria-description", "对话记录不可用，暂时无法分析");
    expect(disabledItem).toHaveAttribute("title", "对话记录不可用，暂时无法分析");
    await user.hover(disabledItem.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("对话记录不可用，暂时无法分析");
    fireEvent.click(disabledItem);
    expect(onAnalyzeConversation).not.toHaveBeenCalled();
  });

  it("reports a copy failure without rendering an error detail or path", async () => {
    const onCopySessionLogPath = vi.fn(async () => {
      throw new Error("sensitive path: /Users/example/sessions/private.jsonl");
    });
    render(<ConversationSidebar projects={[project]} onCopySessionLogPath={onCopySessionLogPath} />);

    fireEvent.contextMenu(screen.getByRole("button", { name: "导出功能重构" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "复制对话记录路径" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("无法复制对话记录路径，请稍后重试");
    expect(document.body.textContent).not.toContain("/Users/example/sessions/private.jsonl");
  });

  it("reports the safe failure reason returned by the host", async () => {
    const onCopySessionLogPath = vi.fn(async () => ({
      ok: false as const,
      reason: "record-unavailable" as const,
    }));
    render(<ConversationSidebar projects={[project]} onCopySessionLogPath={onCopySessionLogPath} />);

    fireEvent.contextMenu(screen.getByRole("button", { name: "导出功能重构" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "复制对话记录路径" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("无法复制对话记录路径：记录文件不可用");
  });

  it("keeps archive visible but disabled while the session is running", async () => {
    const onArchiveSession = vi.fn();
    const onCopySessionLogPath = vi.fn(async () => ({ ok: true as const }));
    render(
      <ConversationSidebar
        projects={[project]}
        onArchiveSession={onArchiveSession}
        onCopySessionLogPath={onCopySessionLogPath}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "进度提示，正在运行" }));
    const archiveItem = await screen.findByRole("menuitem", { name: "归档" });
    expect(archiveItem).toHaveAttribute("aria-disabled", "true");
    expect(archiveItem).toHaveAttribute("title", "当前对话正在运行，请先中止或等待运行结束");
    const copyItem = screen.getByRole("menuitem", { name: "复制对话记录路径" });
    expect(copyItem).not.toHaveAttribute("aria-disabled", "true");
    await act(async () => {
      fireEvent.click(copyItem);
    });
    expect(onCopySessionLogPath).toHaveBeenCalledWith("running-progress", "moebius");
    fireEvent.click(archiveItem);
    expect(onArchiveSession).not.toHaveBeenCalled();
  });

  it("blocks archive for managed work without showing the Agent running dot", async () => {
    const onArchiveSession = vi.fn();
    const managedProject: ConversationSidebarProject = {
      ...project,
      sessions: project.sessions.map((session) => session.id === "idle-refactor"
        ? { ...session, hasManagedProcesses: true }
        : session),
    };
    render(<ConversationSidebar projects={[managedProject]} onArchiveSession={onArchiveSession} />);

    const row = screen.getByRole("button", { name: "导出功能重构" });
    expect(row).toHaveAttribute("data-status-dot", "none");
    fireEvent.contextMenu(row);
    const archiveItem = await screen.findByRole("menuitem", { name: "归档" });
    expect(archiveItem).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(archiveItem);
    expect(onArchiveSession).not.toHaveBeenCalled();
  });

  it("requests a new conversation for the project row that owns the button", () => {
    const onNewConversation = vi.fn();
    const secondProject = {
      id: "second-project",
      path: "/Users/example/work/second-project",
      sessions: [],
    };
    render(<ConversationSidebar projects={[project, secondProject]} onNewConversation={onNewConversation} />);

    fireEvent.click(screen.getByRole("button", { name: "在 second-project 中新建会话" }));
    expect(onNewConversation).toHaveBeenCalledWith("second-project");
    expect(onNewConversation).toHaveBeenCalledTimes(1);
  });

  it("shows the no-project and expanded empty-project states", () => {
    const { rerender } = render(<ConversationSidebar projects={[]} />);

    expect(screen.getByText("从“新建对话”添加第一个项目")).toBeVisible();

    rerender(<ConversationSidebar projects={[{ id: "empty", path: "/tmp/empty", sessions: [] }]} />);
    expect(screen.getByRole("button", { name: "empty 项目，已展开" })).toBeVisible();
    expect(screen.getByText("还没有对话")).toBeVisible();
  });

  it("renders a structure-preserving loading placeholder instead of project data", () => {
    render(<ConversationSidebar projects={[project]} dataState="loading" />);

    expect(screen.getByLabelText("项目正在加载")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("conversation-sidebar-loading").children).toHaveLength(3);
    expect(screen.queryByText("moebius")).not.toBeInTheDocument();
  });

  it("renders a short load failure with a working retry action", () => {
    const onRetry = vi.fn();
    render(<ConversationSidebar projects={[project]} dataState="error" onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("项目加载失败");
    expect(screen.queryByText("moebius")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("toggles from the project row while keeping its new-conversation button independent", () => {
    const onNewConversation = vi.fn();
    render(<ConversationSidebar projects={[project]} onNewConversation={onNewConversation} />);
    const projectRow = screen.getByTestId("conversation-sidebar-project");
    const projectToggle = screen.getByRole("button", { name: "moebius 项目，已展开" });

    firePointer(projectRow, "pointerdown", { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    firePointer(projectRow, "pointerup", { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    expect(projectToggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: "在 moebius 中新建会话" }));
    expect(onNewConversation).toHaveBeenCalledWith("moebius");
    expect(projectToggle).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps every project menu action independent from row dragging and collapsing", () => {
    const onShowProjectInFolder = vi.fn();
    const onRenameProject = vi.fn();
    const onRemoveProject = vi.fn();
    render(
      <ConversationSidebar
        projects={[project]}
        onShowProjectInFolder={onShowProjectInFolder}
        onRenameProject={onRenameProject}
        onRemoveProject={onRemoveProject}
      />,
    );
    const projectRow = screen.getByTestId("conversation-sidebar-project");
    const projectToggle = screen.getByRole("button", { name: "moebius 项目，已展开" });
    const menuTrigger = screen.getByRole("button", { name: "moebius 项目菜单" });

    const openMenu = (pointerId: number): void => {
      firePointer(menuTrigger, "pointerdown", { pointerId, button: 0, clientX: 190, clientY: 10 });
      firePointer(menuTrigger, "pointerup", { pointerId, button: 0, clientX: 190, clientY: 10 });
      fireEvent.click(menuTrigger);
      expect(screen.getByRole("menu")).toBeVisible();
    };
    const selectWithPointer = (
      name: string,
      pointerId: number,
      callback: ReturnType<typeof vi.fn>,
    ): void => {
      const item = screen.getByRole("menuitem", { name });
      firePointer(item, "pointerdown", { pointerId, button: 0, clientX: 250, clientY: 10 });
      firePointer(item, "pointerup", { pointerId, button: 0, clientX: 250, clientY: 10 });
      fireEvent.click(item);
      expect(callback).toHaveBeenCalledWith(project);
      expect(projectRow).not.toHaveClass("cursor-grabbing");
      expect(projectToggle).toHaveAttribute("aria-expanded", "true");
    };

    openMenu(4);
    selectWithPointer("在文件管理器中显示", 5, onShowProjectInFolder);
    openMenu(6);
    selectWithPointer("修改显示名称", 7, onRenameProject);
    openMenu(8);
    selectWithPointer("移除项目", 9, onRemoveProject);
  });

  it("requires 5px and 150ms before reordering and does not toggle after a drag", async () => {
    vi.useFakeTimers();
    try {
      const onReorderProjects = vi.fn(async () => true);
      const secondProject: ConversationSidebarProject = {
        id: "second-project",
        path: "/Users/example/work/second-project",
        sessions: [],
      };
      render(
        <ConversationSidebar
          projects={[project, secondProject]}
          onReorderProjects={onReorderProjects}
        />,
      );
      const [firstRow, secondRow] = screen.getAllByTestId("conversation-sidebar-project");
      vi.spyOn(firstRow!, "getBoundingClientRect").mockReturnValue(rect(0, 40));
      vi.spyOn(secondRow!, "getBoundingClientRect").mockReturnValue(rect(40, 80));

      firePointer(firstRow!, "pointerdown", { pointerId: 2, button: 0, clientX: 10, clientY: 10 });
      firePointer(firstRow!, "pointermove", { pointerId: 2, button: 0, clientX: 10, clientY: 90 });
      act(() => vi.advanceTimersByTime(149));
      expect(onReorderProjects).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      firePointer(firstRow!, "pointerup", { pointerId: 2, button: 0, clientX: 10, clientY: 90 });

      expect(onReorderProjects).toHaveBeenCalledWith(["second-project", "moebius"]);
      const projectToggle = within(firstRow!).getByRole("button", { name: "moebius 项目，已展开" });
      expect(projectToggle).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await act(async () => Promise.resolve());

      firePointer(projectToggle, "pointerdown", { pointerId: 5, button: 0, clientX: 10, clientY: 10 });
      firePointer(projectToggle, "pointerup", { pointerId: 5, button: 0, clientX: 10, clientY: 10 });
      expect(
        within(firstRow!).getByRole("button", { name: "moebius 项目，已折叠，需要你处理" }),
      ).toHaveAttribute("aria-expanded", "false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a newly inserted top project expanded", () => {
    const { rerender } = render(<ConversationSidebar projects={[project]} />);
    const existingRow = screen.getByTestId("conversation-sidebar-project");
    firePointer(existingRow, "pointerdown", { pointerId: 3, button: 0, clientX: 10, clientY: 10 });
    firePointer(existingRow, "pointerup", { pointerId: 3, button: 0, clientX: 10, clientY: 10 });

    const newProject: ConversationSidebarProject = {
      id: "new-top-project",
      path: "/Users/example/work/new-top-project",
      sessions: [],
    };
    rerender(<ConversationSidebar projects={[newProject, project]} />);

    const rows = screen.getAllByTestId("conversation-sidebar-project");
    expect(rows.map((row) => row.dataset.projectId)).toEqual(["new-top-project", "moebius"]);
    expect(screen.getByRole("button", { name: "new-top-project 项目，已展开" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "moebius 项目，已折叠，需要你处理" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("blocks project creation and session selection while a selection mutation is pending", () => {
    const onNewConversation = vi.fn();
    const onSelectSession = vi.fn();
    render(
      <ConversationSidebar
        projects={[project]}
        onNewConversation={onNewConversation}
        onSelectSession={onSelectSession}
        disabled
        disabledReason="项目正在变更，请稍后再试"
      />,
    );

    const createButton = screen.getByRole("button", { name: "在 moebius 中新建会话" });
    const sessionButton = screen.getByRole("button", { name: "导出功能重构" });
    expect(createButton).toBeDisabled();
    expect(createButton).toHaveAttribute("title", "项目正在变更，请稍后再试");
    expect(createButton).toHaveAttribute("aria-description", "项目正在变更，请稍后再试");
    expect(sessionButton).toBeDisabled();
    fireEvent.click(createButton);
    fireEvent.click(sessionButton);
    expect(onNewConversation).not.toHaveBeenCalled();
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it("keeps project browsing available while only project actions are disabled", async () => {
    const onSelectSession = vi.fn();
    render(
      <ConversationSidebar
        projects={[project]}
        onSelectSession={onSelectSession}
        onNewConversation={vi.fn()}
        onShowProjectInFolder={vi.fn()}
        projectActionsDisabled
        projectActionsDisabledReason="项目配置正在更新"
      />,
    );

    expect(screen.getByRole("button", { name: "在 moebius 中新建会话" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "moebius 项目菜单" })).toBeDisabled();
    const session = screen.getByRole("button", { name: "导出功能重构" });
    expect(session).toBeEnabled();
    fireEvent.click(session);
    expect(onSelectSession).toHaveBeenCalledWith("idle-refactor", "moebius");
  });

  it("explains why a project with an unavailable directory cannot start a conversation", () => {
    const onNewConversation = vi.fn();
    render(
      <ConversationSidebar
        projects={[{
          ...project,
          newConversationDisabledReason: "当前项目本地文件夹不可用，无法新建对话",
        }]}
        onNewConversation={onNewConversation}
      />,
    );

    const createButton = screen.getByRole("button", { name: "在 moebius 中新建会话" });
    expect(createButton).toBeDisabled();
    expect(createButton).toHaveAttribute("title", "当前项目本地文件夹不可用，无法新建对话");
    expect(createButton).toHaveAttribute("aria-description", "当前项目本地文件夹不可用，无法新建对话");
    fireEvent.click(createButton);
    expect(onNewConversation).not.toHaveBeenCalled();
  });

  it("renders folder repair as an independent red wrench outside the project menu", async () => {
    const onRepairProject = vi.fn();
    render(
      <ConversationSidebar
        projects={[{
          ...project,
          directoryAvailable: false,
          directoryUnavailableReason: "当前项目本地文件夹未找到，可以指定新的文件夹",
        }]}
        onRepairProject={onRepairProject}
        onShowProjectInFolder={vi.fn()}
        onRenameProject={vi.fn()}
        onRemoveProject={vi.fn()}
      />,
    );

    const repair = screen.getByRole("button", { name: "修复 moebius 项目文件夹" });
    expect(repair).toHaveClass("text-danger");
    expect(repair).toHaveAttribute("title", "当前项目本地文件夹未找到，可以指定新的文件夹");
    fireEvent.click(repair);
    expect(onRepairProject).toHaveBeenCalledWith(expect.objectContaining({ id: "moebius" }));

    const menuTrigger = screen.getByRole("button", { name: "moebius 项目菜单" });
    fireEvent.keyDown(menuTrigger, { key: "ArrowDown" });
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByText(/修复/u)).not.toBeInTheDocument();
  });
});

const project: ConversationSidebarProject = {
  id: "moebius",
  path: "/Users/example/work/moebius",
  sessions: [
    { id: "idle-refactor", title: "导出功能重构", unreadSince: null, isRunning: false, createdAt: "2026-07-09T00:01:00.000Z" },
    { id: "docs-history", title: "文档记录", unreadSince: "2026-07-09T00:00:30.000Z", isRunning: false, lastMessageMentionsAgent: false, createdAt: "2026-07-09T00:00:00.000Z" },
    { id: "running-progress", title: "进度提示", unreadSince: null, isRunning: true, createdAt: "2026-07-09T00:03:00.000Z" },
    { id: "waiting-summary", title: "失败汇总", unresolvedSystemEventKind: "retry-exhausted", unreadSince: "2026-07-09T00:02:30.000Z", isRunning: true, createdAt: "2026-07-09T00:02:00.000Z" }
  ]
};

function rect(top: number, bottom: number): DOMRect {
  return {
    x: 0,
    y: top,
    width: 200,
    height: bottom - top,
    top,
    right: 200,
    bottom,
    left: 0,
    toJSON: () => ({}),
  };
}

function firePointer(
  element: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  input: { pointerId: number; button: number; clientX: number; clientY: number },
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: input.button,
    clientX: input.clientX,
    clientY: input.clientY,
  });
  Object.defineProperty(event, "pointerId", { value: input.pointerId });
  fireEvent(element, event);
}
