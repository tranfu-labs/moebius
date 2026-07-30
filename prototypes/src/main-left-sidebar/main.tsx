/*
 * 主页面左侧栏设计原型 · React 入口。
 * 产品事实源：docs/product/pages/main-left-sidebar.md
 * 探索对象：整份侧边栏共享的单一对话信息浮层（连续跟随、原位替换内容）。
 */
import {
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Folder,
  GitBranch,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  Users,
  Wrench,
  X
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { createRoot } from "react-dom/client";

import moebiusLogoUrl from "../../../assets/brand/generated/ui-icon-64.png";
import {
  applyMarkRead,
  applyMarkUnread,
  applyPin,
  applyUnpin,
  createFixtureState,
  dotA11yName,
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
  type MenuAction,
  type Project,
  type SidebarState
} from "./sidebar-state.js";
import "./styles.css";

type Theme = "dark" | "light";
type FrameWidth = "wide" | "narrow";
type MenuTrigger = "keyboard" | "pointer";

const PERSIST_DELAY_MS = 120;
const INITIAL_RIGHT_TAB_IDS = [
  "c-quarterly",
  "c-copy",
  "c-dmg",
  "c-sync",
  "c-detached",
  "c-unreadable"
] as const;

interface OverlayTarget {
  id: string;
  top: number;
}

interface MenuState {
  conversationId: string;
  x: number;
  y: number;
  trigger: MenuTrigger;
}

interface RenameState {
  conversationId: string;
  top: number;
  value: string;
  error: string | null;
  pending: boolean;
}

interface FailureNotice {
  message: string;
  retry: () => void;
}

interface PendingFocus {
  type: "row" | "project-toggle";
  id: string;
}

function fixtureTime(createdAt: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC"
  }).format(createdAt);
}

function App(): JSX.Element {
  const [state, setState] = useState<SidebarState>(createFixtureState);
  const [selectedId, setSelectedId] = useState<string>("c-quarterly");
  const [theme, setTheme] = useState<Theme>("dark");
  const [frame, setFrame] = useState<FrameWidth>("wide");
  const [motionReduced, setMotionReduced] = useState(false);
  const [failureArmed, setFailureArmed] = useState(false);
  const [overlay, setOverlay] = useState<OverlayTarget | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [rename, setRename] = useState<RenameState | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [failure, setFailure] = useState<FailureNotice | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [rightTabIds, setRightTabIds] = useState<string[]>([
    ...INITIAL_RIGHT_TAB_IDS
  ]);
  const [selectedRightTabId, setSelectedRightTabId] =
    useState<string>("c-quarterly");
  const [unreadableTabTitles, setUnreadableTabTitles] = useState<Set<string>>(
    () => new Set()
  );

  const frameRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuReturnFocus = useRef<HTMLElement | null>(null);
  const renameReturnFocus = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef<PendingFocus | null>(null);
  const rightTabStripRef = useRef<HTMLDivElement>(null);
  const failureArmedRef = useRef(false);
  failureArmedRef.current = failureArmed;

  const findConversation = useCallback(
    (id: string): Conversation => {
      const conversation = state.conversations.find((entry) => entry.id === id);
      if (!conversation) throw new Error(`unknown conversation ${id}`);
      return conversation;
    },
    [state.conversations]
  );

  const findProject = useCallback(
    (id: string): Project => {
      const project = state.projects.find((entry) => entry.id === id);
      if (!project) throw new Error(`unknown project ${id}`);
      return project;
    },
    [state.projects]
  );

  const hideOverlay = useCallback(() => setOverlay(null), []);

  /* ---------- 浮层定位 ---------- */

  const showOverlayFor = useCallback(
    (id: string, row: HTMLElement) => {
      if (menu || rename) return; // 菜单或重命名弹层打开期间浮层保持收起
      const frameEl = frameRef.current;
      if (!frameEl) return;
      const top =
        row.getBoundingClientRect().top - frameEl.getBoundingClientRect().top;
      setOverlay({ id, top });
    },
    [menu, rename]
  );

  const refreshOverlayTop = useCallback(() => {
    setOverlay((current) => {
      if (!current) return current;
      const frameEl = frameRef.current;
      const row = frameEl?.querySelector<HTMLElement>(
        `[data-conversation-row][data-conversation-id="${current.id}"]`
      );
      if (!frameEl || !row) return null;
      return {
        id: current.id,
        top: row.getBoundingClientRect().top - frameEl.getBoundingClientRect().top
      };
    });
  }, []);

  // 列表因置顶迁移等原因重排后，浮层继续跟随同一目标行。
  useLayoutEffect(() => {
    refreshOverlayTop();
  }, [state, refreshOverlayTop]);

  // 主题写到根元素，亮暗令牌成对切换。
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // 键盘置顶 / 取消置顶后的焦点跟随。
  useLayoutEffect(() => {    const target = pendingFocus.current;
    if (!target) return;
    const frameEl = frameRef.current;
    if (!frameEl) return;
    const selector =
      target.type === "row"
        ? `[data-conversation-row][data-conversation-id="${target.id}"]`
        : `[data-project-toggle="${target.id}"]`;
    const element = frameEl.querySelector<HTMLElement>(selector);
    if (element) {
      pendingFocus.current = null;
      element.focus();
    }
  }, [state]);

  // 菜单打开时焦点进入菜单。
  useLayoutEffect(() => {
    if (!menu) return;
    const first = menuRef.current?.querySelector<HTMLElement>(
      '[role="menuitem"]:not([aria-disabled="true"])'
    );
    first?.focus();
  }, [menu]);

  /* ---------- 模拟持久化 ---------- */

  const simulatePersist = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      window.setTimeout(() => {
        if (failureArmedRef.current) {
          failureArmedRef.current = false;
          setFailureArmed(false);
          reject(new Error("simulated persistence failure"));
        } else {
          resolve();
        }
      }, PERSIST_DELAY_MS);
    });
  }, []);

  /* ---------- 右侧栏标签探索 ---------- */

  const revealRelevantRightTab = useCallback(
    (fallbackConversationId: string) => {
      window.requestAnimationFrame(() => {
        const strip = rightTabStripRef.current;
        if (!strip) return;
        const active = document.activeElement as HTMLElement | null;
        const focusedTab =
          active && strip.contains(active)
            ? active.closest<HTMLElement>("[data-right-tab-id]")
            : null;
        const target =
          focusedTab ??
          strip.querySelector<HTMLElement>(
            `[data-right-tab-id="${selectedRightTabId || fallbackConversationId}"]`
          );
        target?.scrollIntoView({
          block: "nearest",
          inline: "nearest",
          behavior: motionReduced ? "auto" : "smooth"
        });
      });
    },
    [motionReduced, selectedRightTabId]
  );

  const updateConversationTitleForReview = useCallback(
    (
      conversationId: string,
      title: string,
      preserveUnselectedScroll = false
    ) => {
      const priorScrollLeft = rightTabStripRef.current?.scrollLeft ?? 0;
      setUnreadableTabTitles((current) => {
        const next = new Set(current);
        next.delete(conversationId);
        return next;
      });
      setState((current) => ({
        ...current,
        conversations: current.conversations.map((entry) =>
          entry.id === conversationId ? { ...entry, title } : entry
        )
      }));
      window.requestAnimationFrame(() => {
        if (preserveUnselectedScroll && rightTabStripRef.current) {
          rightTabStripRef.current.scrollLeft = priorScrollLeft;
        } else {
          revealRelevantRightTab(conversationId);
        }
      });
    },
    [revealRelevantRightTab]
  );

  const toggleUnreadableTabTitles = useCallback(() => {
    setUnreadableTabTitles((current) => {
      const bothFailed =
        current.has("c-quarterly") && current.has("c-copy");
      return bothFailed
        ? new Set()
        : new Set(["c-quarterly", "c-copy"]);
    });
    revealRelevantRightTab(selectedRightTabId);
  }, [revealRelevantRightTab, selectedRightTabId]);

  const retryTabTitle = useCallback(
    (conversationId: string) => {
      setUnreadableTabTitles((current) => {
        const next = new Set(current);
        next.delete(conversationId);
        return next;
      });
      setAnnouncement("标签标题已恢复，新名称在原标签中显示");
      revealRelevantRightTab(conversationId);
    },
    [revealRelevantRightTab]
  );

  const closeRightTab = useCallback(
    (conversationId: string) => {
      const index = rightTabIds.indexOf(conversationId);
      const remaining = rightTabIds.filter((id) => id !== conversationId);
      setRightTabIds(remaining);
      if (selectedRightTabId === conversationId) {
        const next = remaining[index] ?? remaining[index - 1] ?? "";
        setSelectedRightTabId(next);
        window.requestAnimationFrame(() => {
          rightTabStripRef.current
            ?.querySelector<HTMLElement>(`[data-right-tab-id="${next}"] [role="tab"]`)
            ?.focus();
        });
      }
      setAnnouncement("已关闭右侧栏标签；会话本身仍保留");
    },
    [rightTabIds, selectedRightTabId]
  );

  /* ---------- 阅读状态 ---------- */

  const runReadAction = useCallback(
    (conversationId: string, action: "mark-read" | "mark-unread") => {
      const label = action === "mark-read" ? "标记为已读" : "标记为未读";
      const attempt = () => {
        setPendingAction(`${conversationId}:${action}`);
        simulatePersist()
          .then(() => {
            setState((current) => ({
              ...current,
              conversations: current.conversations.map((entry) =>
                entry.id === conversationId
                  ? {
                      ...entry,
                      facts:
                        action === "mark-read"
                          ? applyMarkRead(entry.facts)
                          : applyMarkUnread(entry.facts)
                    }
                  : entry
              )
            }));
            setAnnouncement(`${label}成功`);
          })
          .catch(() => {
            // 保存失败：保留原圆点，显示可理解说明并允许重试。
            setFailure({
              message: `${label}没有保存成功，圆点保持原样。`,
              retry: () => {
                setFailure(null);
                attempt();
              }
            });
          })
          .finally(() => setPendingAction(null));
      };
      attempt();
    },
    [simulatePersist]
  );

  /* ---------- 置顶 / 取消置顶 ---------- */

  const runPinAction = useCallback(
    (conversationId: string, action: "pin" | "unpin", trigger: MenuTrigger) => {
      const label = action === "pin" ? "置顶" : "取消置顶";
      const attempt = () => {
        setPendingAction(`${conversationId}:${action}`);
        simulatePersist()
          .then(() => {
            const conversation = state.conversations.find(
              (entry) => entry.id === conversationId
            );
            const project = conversation
              ? state.projects.find((entry) => entry.id === conversation.projectId)
              : undefined;
            setState((current) =>
              action === "pin"
                ? applyPin(current, conversationId, Date.now())
                : applyUnpin(current, conversationId)
            );
            // 目标行因置顶迁移离开当前位置时，浮层立即收起。
            setOverlay((current) =>
              current?.id === conversationId ? null : current
            );
            if (trigger === "keyboard") {
              if (action === "pin") {
                pendingFocus.current = { type: "row", id: conversationId };
                setAnnouncement("已置顶，焦点已跟随对话进入置顶区");
              } else if (project?.expanded) {
                pendingFocus.current = { type: "row", id: conversationId };
                setAnnouncement("已取消置顶，对话已按创建时间归位");
              } else if (project) {
                pendingFocus.current = { type: "project-toggle", id: project.id };
                setAnnouncement(`已取消置顶，对话已回到折叠的项目「${project.name}」`);
              }
            } else {
              setAnnouncement(`${label}成功`);
            }
          })
          .catch(() => {
            // 失败：不产生丢失或双份条目，保留原位置并允许重试。
            setFailure({
              message: `${label}没有保存成功，对话保持原位置。`,
              retry: () => {
                setFailure(null);
                attempt();
              }
            });
          })
          .finally(() => setPendingAction(null));
      };
      attempt();
    },
    [simulatePersist, state.conversations, state.projects]
  );

  /* ---------- 菜单 ---------- */

  const openMenu = useCallback(
    (
      conversationId: string,
      x: number,
      y: number,
      trigger: MenuTrigger,
      returnFocus: HTMLElement | null
    ) => {
      setOverlay(null); // 打开对话菜单时浮层立即收起
      menuReturnFocus.current = returnFocus;
      setMenu({ conversationId, x, y, trigger });
    },
    []
  );

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setMenu(null);
    if (restoreFocus) menuReturnFocus.current?.focus();
  }, []);

  const framePoint = useCallback((clientX: number, clientY: number) => {
    const frameEl = frameRef.current;
    if (!frameEl) return { x: 0, y: 0 };
    const rect = frameEl.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const handleMenuAction = useCallback(
    (conversation: Conversation, action: MenuAction) => {
      // 选择时按最新可见状态重新判断；陈旧操作不执行，菜单收起。
      const fresh = state.conversations.find(
        (entry) => entry.id === conversation.id
      );
      const trigger = menu?.trigger ?? "pointer";
      if (!fresh || !isMenuActionCurrent(fresh, action)) {
        closeMenu(true);
        setAnnouncement("对话状态已变化，菜单已收起，请重新打开");
        return;
      }
      if (action === "mark-read" || action === "mark-unread") {
        closeMenu(true);
        runReadAction(fresh.id, action);
        return;
      }
      if (action === "pin" || action === "unpin") {
        closeMenu(false);
        runPinAction(fresh.id, action, trigger);
        return;
      }
      if (action === "rename") {
        const frameEl = frameRef.current;
        const row = frameEl?.querySelector<HTMLElement>(
          `[data-conversation-row][data-conversation-id="${fresh.id}"]`
        );
        const top =
          frameEl && row
            ? row.getBoundingClientRect().top - frameEl.getBoundingClientRect().top
            : 80;
        closeMenu(false);
        renameReturnFocus.current = menuReturnFocus.current;
        setOverlay(null); // 打开重命名弹层时浮层立即收起
        setRename({
          conversationId: fresh.id,
          top,
          value: fresh.title,
          error: null,
          pending: false
        });
        return;
      }
      closeMenu(true);
      if (action === "analyze") {
        setAnnouncement(`已在右侧栏分析「${fresh.title}」（原型占位）`);
      } else if (action === "copy-path") {
        setAnnouncement("路径已复制");
      } else if (action === "archive") {
        if (fresh.facts.running) {
          setAnnouncement("运行中的对话不能归档，请先中止或等待运行结束");
          return;
        }
        setState((current) => ({
          ...current,
          conversations: current.conversations.filter(
            (entry) => entry.id !== fresh.id
          )
        }));
        setOverlay((current) => (current?.id === fresh.id ? null : current));
        if (selectedId === fresh.id) {
          const siblings = projectConversations(
            {
              ...state,
              conversations: state.conversations.filter(
                (entry) => entry.id !== fresh.id
              )
            },
            fresh.projectId
          );
          setSelectedId(siblings[0]?.id ?? "");
        }
        setAnnouncement(`已归档「${fresh.title}」`);
      }
    },
    [closeMenu, menu?.trigger, runPinAction, runReadAction, selectedId, state]
  );

  /* ---------- 重命名 ---------- */

  const submitRename = useCallback(() => {
    setRename((current) => {
      if (!current || current.pending) return current;
      const normalized = normalizeRename(current.value);
      if (normalized === null) {
        return { ...current, error: "名称不能为空，请输入对话名称。" };
      }
      const conversationId = current.conversationId;
      setPendingAction(`${conversationId}:rename`);
      simulatePersist()
        .then(() => {
          setState((previous) => ({
            ...previous,
            conversations: previous.conversations.map((entry) =>
              entry.id === conversationId ? { ...entry, title: normalized } : entry
            )
          }));
          setRename(null);
          setAnnouncement("已重命名");
          renameReturnFocus.current?.focus();
          revealRelevantRightTab(conversationId);
        })
        .catch(() => {
          // 保存失败：弹层不关闭、输入不丢失、各处保留原名。
          setRename((latest) =>
            latest
              ? { ...latest, pending: false, error: "保存失败，请重试。" }
              : latest
          );
        })
        .finally(() => setPendingAction(null));
      return { ...current, pending: true, error: null };
    });
  }, [revealRelevantRightTab, simulatePersist]);

  const cancelRename = useCallback(() => {
    setRename(null);
    renameReturnFocus.current?.focus();
  }, []);

  /* ---------- 行事件 ---------- */

  const selectConversation = useCallback((id: string, title: string) => {
    setSelectedId(id);
    setAnnouncement(`已选择「${title}」`);
  }, []);

  const focusSiblingRow = useCallback(
    (current: HTMLElement, direction: 1 | -1) => {
      const rows = Array.from(
        scrollRef.current?.querySelectorAll<HTMLElement>(
          "[data-conversation-row]"
        ) ?? []
      );
      const index = rows.indexOf(current);
      const next = rows[index + direction];
      next?.focus();
    },
    []
  );

  const handleRowKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>, conversation: Conversation) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectConversation(conversation.id, conversation.title);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        focusSiblingRow(event.currentTarget, 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusSiblingRow(event.currentTarget, -1);
      } else if (event.key === "ContextMenu") {
        event.preventDefault();
        const point = framePoint(
          event.currentTarget.getBoundingClientRect().left + 24,
          event.currentTarget.getBoundingClientRect().bottom
        );
        openMenu(
          conversation.id,
          point.x,
          point.y,
          "keyboard",
          event.currentTarget
        );
      }
    },
    [focusSiblingRow, framePoint, openMenu, selectConversation]
  );

  const handleRowContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, conversation: Conversation) => {
      event.preventDefault();
      const point = framePoint(event.clientX, event.clientY);
      openMenu(conversation.id, point.x, point.y, "pointer", event.currentTarget);
    },
    [framePoint, openMenu]
  );

  /* ---------- 渲染辅助 ---------- */

  const renderStatusDot = (conversation: Conversation): JSX.Element => {
    const dot = visibleDot(conversation.facts);
    return (
      <span
        aria-label={dotA11yName(dot)}
        className="status-dot"
        data-dot={dot}
        role="img"
        title={dotA11yName(dot)}
      />
    );
  };

  const renderConversationRow = (conversation: Conversation): JSX.Element => {
    const isSelected = selectedId === conversation.id;
    return (
      <div
        aria-describedby={
          overlay?.id === conversation.id && overlayInfo
            ? "shared-overlay"
            : undefined
        }
        aria-label={`对话 ${conversation.title}，${dotA11yName(visibleDot(conversation.facts))}`}
        className={`conversation-row${isSelected ? " is-selected" : ""}${
          menu?.conversationId === conversation.id ? " menu-open" : ""
        }`}
        data-conversation-id={conversation.id}
        data-conversation-row
        key={conversation.id}
        onBlurCapture={(event) => {
          const next = event.relatedTarget as HTMLElement | null;
          if (next && scrollRef.current?.contains(next)) return;
          hideOverlay();
        }}
        onClick={() => selectConversation(conversation.id, conversation.title)}
        onContextMenu={(event) => handleRowContextMenu(event, conversation)}
        onFocusCapture={(event) =>
          showOverlayFor(conversation.id, event.currentTarget)
        }
        onKeyDown={(event) => handleRowKeyDown(event, conversation)}
        onMouseEnter={(event) =>
          showOverlayFor(conversation.id, event.currentTarget)
        }
        tabIndex={0}
      >
        <span className="conv-title">{conversation.title}</span>
        <span className="row-actions">
          <button
            aria-label={`${conversation.title} 的更多操作`}
            className="icon-button"
            onClick={(event) => {
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              const point = framePoint(rect.left - 180, rect.bottom + 4);
              openMenu(
                conversation.id,
                point.x,
                point.y,
                event.detail === 0 ? "keyboard" : "pointer",
                event.currentTarget
              );
            }}
            title="更多操作"
            type="button"
          >
            <MoreHorizontal aria-hidden="true" />
          </button>
        </span>
        {renderStatusDot(conversation)}
      </div>
    );
  };

  const pinned = pinnedConversations(state);
  const selected = state.conversations.find((entry) => entry.id === selectedId);
  const selectedProject = selected
    ? state.projects.find((entry) => entry.id === selected.projectId)
    : undefined;

  const overlayConversation = overlay
    ? state.conversations.find((entry) => entry.id === overlay.id)
    : undefined;
  const overlayProject = overlayConversation
    ? state.projects.find((entry) => entry.id === overlayConversation.projectId)
    : undefined;
  const overlayInfo =
    overlayConversation && overlayProject
      ? overlayInfoFor(overlayConversation, overlayProject)
      : null;

  const rightTabConversations = rightTabIds
    .map((id) => state.conversations.find((entry) => entry.id === id))
    .filter((entry): entry is Conversation => Boolean(entry));
  const displayedRightTitles = rightTabConversations.map((conversation) =>
    unreadableTabTitles.has(conversation.id)
      ? "标题更新中"
      : conversation.title
  );
  const rightTitleCounts = new Map<string, number>();
  for (const title of displayedRightTitles) {
    rightTitleCounts.set(title, (rightTitleCounts.get(title) ?? 0) + 1);
  }
  const rightTabs = rightTabConversations.map((conversation, index) => {
    const project = findProject(conversation.projectId);
    const displayTitle = displayedRightTitles[index] ?? conversation.title;
    const branchContext =
      conversation.branch.kind === "branch"
        ? conversation.branch.name
        : conversation.branch.kind === "detached"
          ? "detached"
          : conversation.branch.kind === "unreadable"
            ? "分支不可用"
            : null;
    const discriminator = [
      project.folderName,
      branchContext,
      fixtureTime(conversation.createdAt)
    ]
      .filter(Boolean)
      .join(" · ");
    const showDiscriminator =
      unreadableTabTitles.has(conversation.id) ||
      (rightTitleCounts.get(displayTitle) ?? 0) > 1;
    return {
      conversation,
      displayTitle,
      discriminator,
      showDiscriminator,
      accessibleLabel: showDiscriminator
        ? `${displayTitle}，${discriminator}`
        : displayTitle
    };
  });
  const selectedRightTab = rightTabs.find(
    (entry) => entry.conversation.id === selectedRightTabId
  );

  const frameHeight = frameRef.current?.getBoundingClientRect().height ?? 720;
  const overlayHeight = overlayRef.current?.offsetHeight ?? 76;
  const overlayTop = overlay
    ? Math.max(8, Math.min(overlay.top, frameHeight - overlayHeight - 8))
    : 0;

  return (
    <main
      className="prototype-shell"
      data-frame={frame}
      data-motion={motionReduced ? "reduced" : "full"}
    >
      {/* 评审工具：明确标注为产品界面之外 */}
      <section aria-label="原型评审工具" className="review-toolbar">
        <span className="review-tag">评审工具 · 产品界面之外</span>
        <div className="review-group">
          <span>主题</span>
          <button
            aria-label={theme === "dark" ? "切换为亮色主题" : "切换为暗色主题"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            type="button"
          >
            {theme === "dark" ? "亮色" : "暗色"}
          </button>
        </div>
        <div className="review-group">
          <span>视口宽度</span>
          <button
            aria-pressed={frame === "wide"}
            onClick={() => setFrame("wide")}
            type="button"
          >
            宽 1180
          </button>
          <button
            aria-pressed={frame === "narrow"}
            onClick={() => setFrame("narrow")}
            type="button"
          >
            窄 900
          </button>
        </div>
        <div className="review-group">
          <span>动效</span>
          <button
            aria-pressed={motionReduced}
            onClick={() => setMotionReduced(!motionReduced)}
            type="button"
          >
            减少动态效果
          </button>
        </div>
        <div className="review-group">
          <span>fixture</span>
          <button
            aria-pressed={failureArmed}
            className="failure-toggle"
            onClick={() => setFailureArmed(!failureArmed)}
            type="button"
          >
            下一次保存失败
          </button>
          <button
            aria-pressed={
              !state.projects.find((entry) => entry.id === "legacy-import")
                ?.available
            }
            onClick={() =>
              setState((current) => ({
                ...current,
                projects: current.projects.map((entry) =>
                  entry.id === "legacy-import"
                    ? { ...entry, available: !entry.available }
                    : entry
                )
              }))
            }
            type="button"
          >
            「旧版导入」目录不可用
          </button>
        </div>
        <div className="review-group">
          <span>右栏标签</span>
          <button
            data-testid="expand-selected-tab-title"
            onClick={() =>
              updateConversationTitleForReview(
                selectedRightTabId,
                "发布日上线前的完整核对清单与跨团队交付状态确认"
              )
            }
            type="button"
          >
            选中标签扩成长标题
          </button>
          <button
            data-testid="expand-background-tab-title"
            onClick={() =>
              updateConversationTitleForReview(
                "c-unreadable",
                "后台标签的长标题更新不应抢走当前横向位置",
                true
              )
            }
            type="button"
          >
            后台标签扩宽
          </button>
          <button
            aria-pressed={
              unreadableTabTitles.has("c-quarterly") &&
              unreadableTabTitles.has("c-copy")
            }
            data-testid="toggle-tab-title-failures"
            onClick={toggleUnreadableTabTitles}
            type="button"
          >
            两项标题读取失败
          </button>
        </div>
      </section>

      <div className="app-frame" ref={frameRef}>
        <aside aria-label="主页面左侧栏" className="sidebar">
          <div className="traffic-row">
            <span aria-hidden="true" className="traffic traffic-red" />
            <span aria-hidden="true" className="traffic traffic-amber" />
            <span aria-hidden="true" className="traffic traffic-green" />
            <button
              aria-label="关闭侧边栏"
              className="icon-button sidebar-close"
              title="关闭侧边栏"
              type="button"
            >
              <PanelLeftClose aria-hidden="true" />
            </button>
          </div>
          <div className="brand-row">
            <img alt="" src={moebiusLogoUrl} />
            <strong>Moebius</strong>
          </div>
          <nav aria-label="应用级操作" className="app-actions">
            <button className="nav-row" type="button">
              <Plus aria-hidden="true" /> 新建对话
            </button>
            <button className="nav-row" type="button">
              <Search aria-hidden="true" /> 搜索
            </button>
            <button className="nav-row" type="button">
              <Users aria-hidden="true" /> Agent 团队
            </button>
          </nav>

          <div
            aria-label="置顶与项目对话列表"
            className="scroll-region"
            onMouseLeave={hideOverlay}
            onScroll={refreshOverlayTop}
            ref={scrollRef}
          >
            {pinned.length > 0 ? (
              <section aria-label="置顶" className="pinned-section">
                <div className="section-heading">置顶</div>
                {pinned.map(renderConversationRow)}
              </section>
            ) : null}

            <section aria-label="项目" className="project-section">
              <div className="section-heading">项目</div>
              {state.projects.map((project) => {
                const conversations = projectConversations(state, project.id);
                const listState = projectListState(state, project.id);
                const aggregate = projectAggregateDot(
                  state.conversations.filter(
                    (entry) => entry.projectId === project.id
                  )
                );
                return (
                  <div className="project-block" key={project.id}>
                    <div className="project-row">
                      <button
                        aria-expanded={project.expanded}
                        aria-label={`${project.expanded ? "折叠" : "展开"}项目 ${project.name}`}
                        className="project-toggle"
                        data-project-toggle={project.id}
                        onClick={() =>
                          setState((current) => ({
                            ...current,
                            projects: current.projects.map((entry) =>
                              entry.id === project.id
                                ? { ...entry, expanded: !entry.expanded }
                                : entry
                            )
                          }))
                        }
                        type="button"
                      >
                        {project.expanded ? (
                          <ChevronDown aria-hidden="true" />
                        ) : (
                          <ChevronRight aria-hidden="true" />
                        )}
                        <span className="project-name">{project.name}</span>
                      </button>
                      {!project.expanded && aggregate !== "none" ? (
                        <span
                          aria-label={`项目内有对话${dotA11yName(aggregate)}`}
                          className="status-dot"
                          data-dot={aggregate}
                          role="img"
                          title={dotA11yName(aggregate)}
                        />
                      ) : null}
                      <span className="row-actions">
                        {!project.available ? (
                          <button
                            aria-label={`修复项目文件夹 ${project.name}`}
                            className="icon-button wrench-button"
                            onClick={() =>
                              setAnnouncement(
                                "原型占位：选择项目移动后的新文件夹位置"
                              )
                            }
                            title="当前项目本地文件夹未找到，可以指定新的文件夹"
                            type="button"
                          >
                            <Wrench aria-hidden="true" />
                          </button>
                        ) : null}
                        <button
                          aria-label={`在 ${project.name} 中新建对话`}
                          className="icon-button"
                          disabled={!project.available}
                          onClick={() =>
                            setAnnouncement(`打开新建对话窗口并预选「${project.name}」（原型占位）`)
                          }
                          title={
                            project.available
                              ? "项目内新建对话"
                              : "项目目录不可用，暂时无法新建对话"
                          }
                          type="button"
                        >
                          <Plus aria-hidden="true" />
                        </button>
                        <button
                          aria-label={`项目 ${project.name} 的更多操作`}
                          className="icon-button"
                          onClick={() =>
                            setAnnouncement("项目菜单：在文件管理器中显示 / 修改显示名称 / 移除项目（原型占位）")
                          }
                          title="项目更多操作"
                          type="button"
                        >
                          <MoreHorizontal aria-hidden="true" />
                        </button>
                      </span>
                    </div>
                    {project.expanded ? (
                      <>
                        {!project.available ? (
                          <p className="project-unavailable-note">
                            原文件夹已不可用
                          </p>
                        ) : null}
                        {listState === "all-pinned" ? (
                          <p className="project-empty-note">对话均在置顶区</p>
                        ) : null}
                        {listState === "empty" ? (
                          <p className="project-empty-note">还没有对话</p>
                        ) : null}
                        {conversations.map(renderConversationRow)}
                      </>
                    ) : null}
                  </div>
                );
              })}
            </section>
          </div>

          <div className="sidebar-footer">
            <button className="nav-row" type="button">
              <CircleHelp aria-hidden="true" /> 重新查看引导
            </button>
            <button className="nav-row" type="button">
              <Settings aria-hidden="true" /> 设置
            </button>
          </div>
        </aside>

        <section aria-label="主内容区" className="main-content">
          <header>
            <span className="main-title" data-testid="main-title">
              {selected ? selected.title : "未选择对话"}
            </span>
            {selectedProject ? (
              <span className="main-folder">{selectedProject.folderName}</span>
            ) : null}
          </header>
          <div className="main-placeholder">
            主内容区占位：显示当前选中对话标题，用于验证重命名后各处一致更新。
          </div>
        </section>

        <aside aria-label="主页面右侧栏标签探索" className="right-sidebar">
          <header className="right-sidebar-header">
            <span>会话标签</span>
            <span className="right-sidebar-purpose">
              同名区分与标题扩宽定位
            </span>
          </header>
          <div className="right-tab-bar">
            <div
              aria-label="右侧栏会话标签"
              className="right-tab-strip"
              data-testid="right-tab-strip"
              ref={rightTabStripRef}
              role="tablist"
            >
              {rightTabs.map((tab) => {
                const isSelected =
                  selectedRightTabId === tab.conversation.id;
                const titleUnreadable = unreadableTabTitles.has(
                  tab.conversation.id
                );
                return (
                  <div
                    className={`right-tab${isSelected ? " is-selected" : ""}`}
                    data-right-tab-id={tab.conversation.id}
                    key={tab.conversation.id}
                  >
                    <button
                      aria-label={tab.accessibleLabel}
                      aria-selected={isSelected}
                      className="right-tab-select"
                      onClick={() => {
                        setSelectedRightTabId(tab.conversation.id);
                        setAnnouncement(
                          `已选择右侧栏标签「${tab.accessibleLabel}」`
                        );
                      }}
                      role="tab"
                      title={tab.accessibleLabel}
                      type="button"
                    >
                      <span className="right-tab-title">
                        {tab.displayTitle}
                      </span>
                      {tab.showDiscriminator ? (
                        <span className="right-tab-discriminator">
                          {tab.discriminator}
                        </span>
                      ) : null}
                    </button>
                    <button
                      aria-label={`关闭“${tab.accessibleLabel}”`}
                      className="right-tab-close"
                      onClick={() => closeRightTab(tab.conversation.id)}
                      title={`关闭“${tab.accessibleLabel}”`}
                      type="button"
                    >
                      <X aria-hidden="true" />
                    </button>
                    {titleUnreadable ? (
                      <span
                        aria-label="新标题暂时无法读取"
                        className="right-tab-warning"
                        role="img"
                      >
                        !
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <button
              aria-label="新建右侧栏标签"
              className="right-tab-add"
              onClick={() => setAnnouncement("打开右侧栏内容选择（原型占位）")}
              type="button"
            >
              <Plus aria-hidden="true" />
            </button>
          </div>
          <div
            aria-labelledby={
              selectedRightTab
                ? `right-tab-content-${selectedRightTab.conversation.id}`
                : undefined
            }
            className="right-tab-content"
            role="tabpanel"
          >
            {selectedRightTab ? (
              <>
                <p
                  className="right-tab-content-title"
                  id={`right-tab-content-${selectedRightTab.conversation.id}`}
                >
                  {selectedRightTab.displayTitle}
                </p>
                <p className="right-tab-content-meta">
                  稳定标签身份：{selectedRightTab.conversation.id}
                </p>
                {unreadableTabTitles.has(
                  selectedRightTab.conversation.id
                ) ? (
                  <div className="tab-title-recovery" role="status">
                    <p>
                      新标题已保存，但这个标签组暂时未能读取；旧标题不会回显。
                    </p>
                    <button
                      onClick={() =>
                        retryTabTitle(selectedRightTab.conversation.id)
                      }
                      type="button"
                    >
                      重试标题读取
                    </button>
                  </div>
                ) : (
                  <p className="right-tab-content-copy">
                    标签标题变化只更新可见名称；标签身份、顺序、选中态、内容与阅读位置保持。
                  </p>
                )}
              </>
            ) : (
              <p className="right-tab-content-copy">右侧栏没有已打开标签。</p>
            )}
          </div>
        </aside>

        {/* 共享跟随浮层：整份侧边栏同一时刻只有这一份 */}
        <div
          aria-hidden="true"
          className={`shared-overlay${overlayInfo ? " is-visible" : ""}`}
          data-testid="shared-overlay"
          ref={overlayRef}
          style={{ transform: `translate3d(0, ${overlayInfo ? overlayTop : 0}px, 0)` }}
        >
          {overlayInfo ? (
            <>
              <p className="overlay-title" data-overlay-line="title">
                {overlayInfo.title}
              </p>
              <p className="overlay-folder" data-overlay-line="folder">
                <Folder aria-hidden="true" />
                {overlayInfo.folderName}
              </p>
              {overlayInfo.branchLine !== null ? (
                <p
                  className="overlay-branch"
                  data-overlay-line="branch"
                  data-variant={
                    overlayInfo.branchLine === "分支不可用" ? "unavailable" : "branch"
                  }
                >
                  <GitBranch aria-hidden="true" />
                  {overlayInfo.branchLine}
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        {menu ? (
          <div
            aria-label={`对话菜单`}
            className="context-menu"
            data-testid="context-menu"
            onKeyDown={(event) => {
              const items = Array.from(
                menuRef.current?.querySelectorAll<HTMLElement>(
                  '[role="menuitem"]:not([aria-disabled="true"])'
                ) ?? []
              );
              const index = items.indexOf(document.activeElement as HTMLElement);
              if (event.key === "ArrowDown") {
                event.preventDefault();
                items[(index + 1) % items.length]?.focus();
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                items[(index - 1 + items.length) % items.length]?.focus();
              } else if (event.key === "Escape") {
                event.preventDefault();
                closeMenu(true);
              } else if (event.key === "Tab") {
                closeMenu(false);
              }
            }}
            ref={menuRef}
            role="menu"
            style={{ left: menu.x, top: menu.y }}
          >
            {menuEntriesFor(findConversation(menu.conversationId)).map((entry) => {
              const conversation = findConversation(menu.conversationId);
              const disabled =
                pendingAction === `${conversation.id}:${entry.action}`;
              return (
                <div
                  aria-disabled={disabled}
                  key={entry.action}
                  onClick={() => {
                    if (!disabled) handleMenuAction(conversation, entry.action);
                  }}
                  onKeyDown={(event) => {
                    if ((event.key === "Enter" || event.key === " ") && !disabled) {
                      event.preventDefault();
                      handleMenuAction(conversation, entry.action);
                    }
                  }}
                  role="menuitem"
                  tabIndex={-1}
                >
                  {entry.label}
                </div>
              );
            })}
          </div>
        ) : null}

        {rename ? (
          <div
            aria-label="重命名对话"
            className="rename-popover"
            data-testid="rename-popover"
            role="dialog"
            style={{ left: 12, top: Math.max(8, rename.top) }}
          >
            <label htmlFor="rename-input">对话名称</label>
            <input
              aria-invalid={rename.error !== null}
              autoFocus
              disabled={rename.pending}
              id="rename-input"
              onChange={(event) =>
                setRename((current) =>
                  current
                    ? { ...current, value: event.target.value, error: null }
                    : current
                )
              }
              onFocus={(event) => event.target.select()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitRename();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  cancelRename();
                }
              }}
              value={rename.value}
            />
            {rename.error ? (
              <p className="rename-error" role="alert">
                {rename.error}
              </p>
            ) : null}
            <div className="rename-actions">
              <button onClick={cancelRename} type="button">
                取消
              </button>
              <button
                className="primary"
                disabled={rename.pending || normalizeRename(rename.value) === null}
                onClick={submitRename}
                type="button"
              >
                {rename.pending ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        ) : null}

        {failure ? (
          <div className="failure-notice" role="alert">
            <span>{failure.message}</span>
            <button onClick={failure.retry} type="button">
              重试
            </button>
            <button
              aria-label="关闭提示"
              onClick={() => setFailure(null)}
              type="button"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>

      <p className="prototype-note">
        设计原型 · 非正式产品实现 · 对应 docs/product/pages/main-left-sidebar.md
      </p>

      <div aria-live="polite" className="sr-only" data-testid="announcement">
        {announcement}
      </div>
    </main>
  );
}

const root = document.getElementById("main-left-sidebar-root");
if (!root) throw new Error("Missing main-left-sidebar prototype root.");
createRoot(root).render(<App />);
