import { describe, expect, it } from "vitest";

import {
  applyMarkRead,
  applyMarkUnread,
  applyPin,
  applyUnpin,
  createFixtureState,
  isMenuActionCurrent,
  menuEntriesFor,
  normalizeRename,
  overlayInfoFor,
  pinnedConversations,
  projectAggregateDot,
  projectConversations,
  projectListState,
  visibleDot,
  type Conversation,
  type SidebarState
} from "./sidebar-state.js";

const fixture = createFixtureState();
const byId = (state: SidebarState, id: string): Conversation => {
  const conversation = state.conversations.find((entry) => entry.id === id);
  if (!conversation) throw new Error(`missing fixture conversation ${id}`);
  return conversation;
};
const projectOf = (state: SidebarState, id: string) => {
  const project = state.projects.find((entry) => entry.id === id);
  if (!project) throw new Error(`missing fixture project ${id}`);
  return project;
};

describe("最终可见状态点", () => {
  it("单行优先级为红点 > 闪烁点 > 蓝点 > 无点", () => {
    expect(visibleDot({ needsHuman: true, running: true, unread: true })).toBe("attention");
    expect(visibleDot({ needsHuman: false, running: true, unread: true })).toBe("running");
    expect(visibleDot({ needsHuman: false, running: false, unread: true })).toBe("unread");
    expect(visibleDot({ needsHuman: false, running: false, unread: false })).toBe("none");
  });

  it("折叠项目聚合优先级为红点 > 蓝点 > 闪烁点，且已置顶对话不参与聚合", () => {
    // playground：蓝点对话 + 闪烁点对话 → 聚合为蓝点。
    expect(projectAggregateDot(fixture.conversations.filter((c) => c.projectId === "playground"))).toBe("unread");
    // 红点已置顶的对话移出项目后，moebius-app 剩余最高为红点（c-sync 未置顶且红点）。
    const appConversations = fixture.conversations.filter((c) => c.projectId === "moebius-app");
    expect(projectAggregateDot(appConversations)).toBe("attention");
    // 把红点对话全部置顶后，聚合结果不再包含它们（剩余最高为蓝点）。
    const pinned = applyPin(fixture, "c-sync", Number.MAX_SAFE_INTEGER);
    expect(projectAggregateDot(pinned.conversations.filter((c) => c.projectId === "moebius-app"))).toBe("unread");
  });
});

describe("对话菜单矩阵", () => {
  const actions = (id: string) => menuEntriesFor(byId(fixture, id)).map((entry) => entry.action);

  it("菜单依次：分析 → 阅读项 → 置顶项 → 重命名 → 复制记录路径 → 归档", () => {
    expect(menuEntriesFor(byId(fixture, "c-quick")).map((entry) => entry.action)).toEqual([
      "analyze",
      "mark-unread",
      "pin",
      "rename",
      "copy-path",
      "archive"
    ]);
  });

  it("红点与蓝点只提供「标记为已读」，闪烁点不提供阅读操作，无点只提供「标记为未读」", () => {
    expect(actions("c-standup")).toContain("mark-read"); // 红点
    expect(actions("c-standup")).not.toContain("mark-unread");
    expect(actions("c-copy")).toContain("mark-read"); // 蓝点
    expect(actions("c-copy")).not.toContain("mark-unread");
    expect(actions("c-detached")).not.toContain("mark-read"); // 闪烁点
    expect(actions("c-detached")).not.toContain("mark-unread");
    expect(actions("c-quick")).toContain("mark-unread"); // 无点
    expect(actions("c-quick")).not.toContain("mark-read");
  });

  it("红点与后台运行重叠时仍按红点提供「标记为已读」", () => {
    expect(actions("c-sync")).toContain("mark-read");
  });

  it("已置顶对话显示「取消置顶」，未置顶显示「置顶」", () => {
    expect(actions("c-standup")).toContain("unpin");
    expect(actions("c-sync")).toContain("pin");
  });

  it("菜单打开后状态变化时，陈旧操作被判定为不可执行", () => {
    const conversation = byId(fixture, "c-detached"); // 闪烁点
    expect(isMenuActionCurrent(conversation, "mark-read")).toBe(false);
    // 运行结束后转为无点，此时「标记为已读」仍陈旧，「标记为未读」有效。
    const finished: Conversation = {
      ...conversation,
      facts: { needsHuman: false, running: false, unread: false }
    };
    expect(isMenuActionCurrent(finished, "mark-read")).toBe(false);
    expect(isMenuActionCurrent(finished, "mark-unread")).toBe(true);
  });
});

describe("已读 / 未读结果", () => {
  it("红点标记已读后红点消失；仍在运行则转为闪烁点", () => {
    const next = applyMarkRead(byId(fixture, "c-sync").facts);
    expect(next.needsHuman).toBe(false);
    expect(visibleDot(next)).toBe("running");
  });

  it("蓝点标记已读后蓝点消失", () => {
    expect(visibleDot(applyMarkRead(byId(fixture, "c-copy").facts))).toBe("none");
  });

  it("无点标记未读后转为蓝点", () => {
    expect(visibleDot(applyMarkUnread(byId(fixture, "c-quick").facts))).toBe("unread");
  });
});

describe("置顶迁移与排序", () => {
  it("置顶后从项目列表移入置顶区且全局只出现一次，置顶区按置顶时间倒序", () => {
    const pinned = applyPin(fixture, "c-sync", Number.MAX_SAFE_INTEGER);
    const occurrences = pinned.conversations.filter((c) => c.id === "c-sync");
    expect(occurrences).toHaveLength(1);
    expect(projectConversations(pinned, "moebius-app").map((c) => c.id)).not.toContain("c-sync");
    expect(pinnedConversations(pinned).map((c) => c.id)).toEqual(["c-sync", "c-standup"]);
  });

  it("项目内未置顶对话只按创建时间倒序", () => {
    expect(projectConversations(fixture, "moebius-app").map((c) => c.id)).toEqual([
      "c-sync",
      "c-dmg",
      "c-detached",
      "c-unreadable"
    ]);
  });

  it("取消置顶后按原创建时间归位回所属项目", () => {
    const pinned = applyPin(fixture, "c-sync", Number.MAX_SAFE_INTEGER);
    const restored = applyUnpin(pinned, "c-sync");
    expect(projectConversations(restored, "moebius-app").map((c) => c.id)).toEqual(
      projectConversations(fixture, "moebius-app").map((c) => c.id)
    );
    expect(pinnedConversations(restored).map((c) => c.id)).toEqual(["c-standup"]);
  });

  it("项目对话全部置顶时展开显示「对话均在置顶区」，而不是「还没有对话」", () => {
    const pinned = applyPin(fixture, "c-quick", 8_888);
    expect(projectListState(pinned, "quick-notes")).toBe("all-pinned");
    expect(projectListState(fixture, "quick-notes")).toBe("normal");
  });

  it("真正没有对话的项目才是 empty", () => {
    const empty: SidebarState = {
      ...fixture,
      projects: [...fixture.projects, { id: "blank", name: "空白", folderName: "blank", isGit: false, available: true, expanded: true }]
    };
    expect(projectListState(empty, "blank")).toBe("empty");
  });
});

describe("浮层三行字段规则", () => {
  const info = (conversationId: string, state: SidebarState = fixture) => {
    const conversation = byId(state, conversationId);
    return overlayInfoFor(conversation, projectOf(state, conversation.projectId));
  };

  it("第 1 行完整对话名称，第 2 行项目文件夹名称，第 3 行真实分支", () => {
    expect(info("c-sync")).toEqual({
      title: "重构状态同步层：会话与运行事实拆分",
      folderName: "moebius-app",
      branchLine: "main"
    });
  });

  it("独立工作空间对话显示自己的分支，而不是项目默认分支", () => {
    expect(info("c-dmg").branchLine).toBe("feature/dmg-signing");
  });

  it("detached HEAD 显示 detached", () => {
    expect(info("c-detached").branchLine).toBe("detached");
  });

  it("确认非 Git 文件夹不显示第三行", () => {
    expect(info("c-quarterly").branchLine).toBeNull();
  });

  it("分支暂时不可读显示「分支不可用」", () => {
    expect(info("c-unreadable").branchLine).toBe("分支不可用");
  });

  it("项目目录失效时第三行显示「分支不可用」，不冒充项目分支", () => {
    expect(info("c-legacy").branchLine).toBe("分支不可用");
  });
});

describe("重命名校验", () => {
  it("去首尾空白后为空禁止保存", () => {
    expect(normalizeRename("   ")).toBeNull();
    expect(normalizeRename("\t\n ")).toBeNull();
  });

  it("合法名称去首尾空白后返回", () => {
    expect(normalizeRename("  新标题  ")).toBe("新标题");
  });
});
