/*
 * 主页面左侧栏设计原型 · 纯状态模型。
 * 产品事实源：docs/product/pages/main-left-sidebar.md
 * 本文件不引入任何 IO / Git / 文件系统依赖；分支等数据全部来自 fixture。
 */

/** 最终可见状态点：红点（需要你处理）> 闪烁点（正在运行）> 蓝点（未读）> 无点。 */
export type VisibleDot = "attention" | "running" | "unread" | "none";

export interface ConversationFacts {
  /** 存在尚未被用户知晓、需要用户处理的事实 → 红点。 */
  needsHuman: boolean;
  /** Agent 正在运行 → 闪烁点（被红点压住时后台保留）。 */
  running: boolean;
  /** 未读提醒（Agent 新结果或用户手动稍后返回）→ 蓝点。 */
  unread: boolean;
}

/**
 * 对话工作空间的 Git 分支事实（fixture 提供，不读取真实 Git）。
 * - branch：真实分支名；同一项目默认工作空间与独立工作空间各自有自己的值。
 * - detached：detached HEAD，显示 `detached`。
 * - unreadable：分支暂时不可读或目录失效且无可用工作空间信息 → 「分支不可用」。
 * - nonGit：确认是非 Git 文件夹 → 浮层不显示第三行。
 */
export type BranchInfo =
  | { kind: "branch"; name: string; workspace: "default" | "isolated" }
  | { kind: "detached" }
  | { kind: "unreadable" }
  | { kind: "nonGit" };

export interface Conversation {
  id: string;
  title: string;
  projectId: string;
  /** 创建时间（升序毫秒）；项目内未置顶对话按创建时间倒序排列。 */
  createdAt: number;
  /** 置顶时间；null 表示未置顶。置顶区按置顶时间倒序。 */
  pinnedAt: number | null;
  facts: ConversationFacts;
  branch: BranchInfo;
}

export interface Project {
  id: string;
  /** 应用内显示名称（默认等于文件夹名）。 */
  name: string;
  /** 本地文件夹名，浮层第 2 行使用。 */
  folderName: string;
  isGit: boolean;
  /** 项目目录是否可用；不可用时项目行显示红色扳手与提示。 */
  available: boolean;
  expanded: boolean;
}

export interface SidebarState {
  projects: Project[];
  conversations: Conversation[];
}

/* ---------- 状态点 ---------- */

const DOT_RANK: Record<VisibleDot, number> = {
  attention: 0,
  running: 1,
  unread: 2,
  none: 3
};

/** 单行最终可见点：红点 > 闪烁点 > 蓝点 > 无点。 */
export function visibleDot(facts: ConversationFacts): VisibleDot {
  if (facts.needsHuman) return "attention";
  if (facts.running) return "running";
  if (facts.unread) return "unread";
  return "none";
}

/**
 * 折叠项目行的聚合点：只聚合仍留在项目内的对话（已置顶的不参与），
 * 优先级为红点 > 蓝点 > 闪烁点（与单行优先级不同，PRD 明确如此）。
 */
export function projectAggregateDot(conversations: Conversation[]): VisibleDot {
  const rank: Record<VisibleDot, number> = {
    attention: 0,
    unread: 1,
    running: 2,
    none: 3
  };
  let best: VisibleDot = "none";
  for (const conversation of conversations) {
    if (conversation.pinnedAt !== null) continue;
    const dot = visibleDot(conversation.facts);
    if (rank[dot] < rank[best]) best = dot;
  }
  return best;
}

export function dotA11yName(dot: VisibleDot): string {
  switch (dot) {
    case "attention":
      return "需要你处理";
    case "running":
      return "正在运行";
    case "unread":
      return "未读";
    case "none":
      return "无状态提醒";
  }
}

/* ---------- 对话菜单矩阵 ---------- */

export type MenuAction =
  | "analyze"
  | "mark-read"
  | "mark-unread"
  | "pin"
  | "unpin"
  | "rename"
  | "copy-path"
  | "archive";

export interface MenuEntry {
  action: MenuAction;
  label: string;
}

/**
 * 对话菜单（以最终可见点为准）：
 * 依次「在右侧栏分析这段对话」；阅读项（红点/蓝点只显示「标记为已读」，
 * 闪烁点不显示阅读操作，无点只显示「标记为未读」）；「置顶」或「取消置顶」；
 * 「重命名」；「复制对话记录路径」；「归档」。
 */
export function menuEntriesFor(conversation: Conversation): MenuEntry[] {
  const dot = visibleDot(conversation.facts);
  const entries: MenuEntry[] = [{ action: "analyze", label: "在右侧栏分析这段对话" }];
  if (dot === "attention" || dot === "unread") {
    entries.push({ action: "mark-read", label: "标记为已读" });
  } else if (dot === "none") {
    entries.push({ action: "mark-unread", label: "标记为未读" });
  }
  entries.push(
    conversation.pinnedAt === null
      ? { action: "pin", label: "置顶" }
      : { action: "unpin", label: "取消置顶" },
    { action: "rename", label: "重命名" },
    { action: "copy-path", label: "复制对话记录路径" },
    { action: "archive", label: "归档" }
  );
  return entries;
}

/**
 * 菜单打开期间状态可能变化：选择操作时必须按最新可见状态重新判断。
 * 返回 false 表示该操作已陈旧，不得执行（菜单收起）。
 */
export function isMenuActionCurrent(
  conversation: Conversation,
  action: MenuAction
): boolean {
  return menuEntriesFor(conversation).some((entry) => entry.action === action);
}

/* ---------- 已读 / 未读 ---------- */

/**
 * 标记为已读：红点消失（若仍在运行转闪烁点）；蓝点消失。
 * 事实本身保留在时间线中，这里只停止侧栏提醒。
 */
export function applyMarkRead(facts: ConversationFacts): ConversationFacts {
  return { ...facts, needsHuman: false, unread: false };
}

/** 标记为未读：无点对话转为蓝点，作为用户稍后返回的提醒。 */
export function applyMarkUnread(facts: ConversationFacts): ConversationFacts {
  return { ...facts, unread: true };
}

/* ---------- 置顶迁移与排序 ---------- */

export function pinnedConversations(state: SidebarState): Conversation[] {
  return state.conversations
    .filter((conversation) => conversation.pinnedAt !== null)
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
}

/** 项目内未置顶对话，按创建时间倒序（最新创建在最上面）。 */
export function projectConversations(
  state: SidebarState,
  projectId: string
): Conversation[] {
  return state.conversations
    .filter(
      (conversation) =>
        conversation.projectId === projectId && conversation.pinnedAt === null
    )
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** 置顶：从项目列表移入置顶区，返回新状态（调用方负责持久化成功后再提交）。 */
export function applyPin(
  state: SidebarState,
  conversationId: string,
  pinnedAt: number
): SidebarState {
  return {
    ...state,
    conversations: state.conversations.map((conversation) =>
      conversation.id === conversationId
        ? { ...conversation, pinnedAt }
        : conversation
    )
  };
}

/** 取消置顶：离开置顶区，按原创建时间归位回所属项目（排序由 projectConversations 保证）。 */
export function applyUnpin(
  state: SidebarState,
  conversationId: string
): SidebarState {
  return {
    ...state,
    conversations: state.conversations.map((conversation) =>
      conversation.id === conversationId
        ? { ...conversation, pinnedAt: null }
        : conversation
    )
  };
}

export type ProjectListState = "all-pinned" | "empty" | "normal";

/**
 * 项目展开后的列表状态：对话全部置顶时显示「对话均在置顶区」，
 * 只有真的没有任何对话时才显示「还没有对话」。
 */
export function projectListState(
  state: SidebarState,
  projectId: string
): ProjectListState {
  const owned = state.conversations.filter(
    (conversation) => conversation.projectId === projectId
  );
  if (owned.length === 0) return "empty";
  if (owned.every((conversation) => conversation.pinnedAt !== null)) {
    return "all-pinned";
  }
  return "normal";
}

/* ---------- 浮层目标解析 ---------- */

export interface OverlayInfo {
  /** 第 1 行：完整对话名称。 */
  title: string;
  /** 第 2 行：项目文件夹名称。 */
  folderName: string;
  /**
   * 第 3 行：对话实际工作空间的真实 Git 分支。
   * null 表示确认非 Git 文件夹，不显示第三行（无占位）。
   */
  branchLine: string | null;
}

export function overlayInfoFor(
  conversation: Conversation,
  project: Project
): OverlayInfo {
  let branchLine: string | null;
  if (!project.isGit || conversation.branch.kind === "nonGit") {
    branchLine = null;
  } else if (!project.available || conversation.branch.kind === "unreadable") {
    branchLine = "分支不可用";
  } else if (conversation.branch.kind === "detached") {
    branchLine = "detached";
  } else {
    branchLine = conversation.branch.name;
  }
  return { title: conversation.title, folderName: project.folderName, branchLine };
}

/* ---------- 重命名校验 ---------- */

/** 新名称去除首尾空白后必须非空；允许重名。 */
export function normalizeRename(input: string): string | null {
  const trimmed = input.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/* ---------- Fixture：本地确定性数据 ---------- */

const T0 = Date.UTC(2026, 6, 28, 9, 0, 0);
const MIN = 60_000;

export function createFixtureState(): SidebarState {
  return {
    projects: [
      {
        id: "moebius-app",
        name: "moebius-app",
        folderName: "moebius-app",
        isGit: true,
        available: true,
        expanded: true
      },
      {
        id: "docs-notes",
        name: "文档笔记",
        folderName: "docs-notes",
        isGit: false,
        available: true,
        expanded: true
      },
      {
        id: "legacy-import",
        name: "旧版导入",
        folderName: "legacy-import",
        isGit: true,
        available: false,
        expanded: true
      },
      {
        id: "playground",
        name: "实验沙盒",
        folderName: "playground",
        isGit: true,
        available: true,
        expanded: false
      },
      {
        id: "quick-notes",
        name: "随手记",
        folderName: "quick-notes",
        isGit: false,
        available: true,
        expanded: true
      }
    ],
    conversations: [
      {
        id: "c-sync",
        title: "重构状态同步层：会话与运行事实拆分",
        projectId: "moebius-app",
        createdAt: T0 + 9 * MIN,
        pinnedAt: null,
        facts: { needsHuman: true, running: true, unread: false },
        branch: { kind: "branch", name: "main", workspace: "default" }
      },
      {
        id: "c-dmg",
        title: "桌面打包签名验证（独立工作空间）",
        projectId: "moebius-app",
        createdAt: T0 + 8 * MIN,
        pinnedAt: null,
        facts: { needsHuman: false, running: false, unread: true },
        branch: {
          kind: "branch",
          name: "feature/dmg-signing",
          workspace: "isolated"
        }
      },
      {
        id: "c-detached",
        title: "排查游离提交上的构建失败",
        projectId: "moebius-app",
        createdAt: T0 + 7 * MIN,
        pinnedAt: null,
        facts: { needsHuman: false, running: true, unread: false },
        branch: { kind: "detached" }
      },
      {
        id: "c-unreadable",
        title: "工作副本暂不可读的性能实验",
        projectId: "moebius-app",
        createdAt: T0 + 6 * MIN,
        pinnedAt: null,
        facts: { needsHuman: false, running: false, unread: false },
        branch: { kind: "unreadable" }
      },
      {
        id: "c-standup",
        title: "每日验收站会纪要整理",
        projectId: "moebius-app",
        createdAt: T0 + 1 * MIN,
        pinnedAt: T0 + 30 * MIN,
        facts: { needsHuman: true, running: false, unread: false },
        branch: { kind: "branch", name: "main", workspace: "default" }
      },
      {
        id: "c-quarterly",
        title: "发布日待办",
        projectId: "docs-notes",
        createdAt: T0 + 5 * MIN,
        pinnedAt: null,
        facts: { needsHuman: false, running: false, unread: false },
        branch: { kind: "nonGit" }
      },
      {
        id: "c-copy",
        title: "发布日待办",
        projectId: "docs-notes",
        createdAt: T0 + 4 * MIN,
        pinnedAt: null,
        facts: { needsHuman: false, running: false, unread: true },
        branch: { kind: "nonGit" }
      },
      {
        id: "c-legacy",
        title: "历史：旧版数据导入核对",
        projectId: "legacy-import",
        createdAt: T0 + 3 * MIN,
        pinnedAt: null,
        facts: { needsHuman: false, running: false, unread: false },
        // 目录可用时读到的真实分支；目录失效时浮层第 3 行显示「分支不可用」。
        branch: {
          kind: "branch",
          name: "hotfix/legacy-import",
          workspace: "default"
        }
      },
      {
        id: "c-sandbox-blue",
        title: "沙盒实验一：提示词对照",
        projectId: "playground",
        createdAt: T0 + 2 * MIN,
        pinnedAt: null,
        facts: { needsHuman: false, running: false, unread: true },
        branch: { kind: "branch", name: "sandbox/a", workspace: "default" }
      },
      {
        id: "c-sandbox-run",
        title: "沙盒实验二：长任务压测",
        projectId: "playground",
        createdAt: T0 + 1.5 * MIN,
        pinnedAt: null,
        facts: { needsHuman: false, running: true, unread: false },
        branch: { kind: "branch", name: "sandbox/b", workspace: "isolated" }
      },
      {
        id: "c-quick",
        title: "随手记：发布日待办",
        projectId: "quick-notes",
        createdAt: T0 + 0.5 * MIN,
        pinnedAt: null,
        facts: { needsHuman: false, running: false, unread: false },
        branch: { kind: "nonGit" }
      }
    ]
  };
}
