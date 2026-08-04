/*
 * 主页面右侧栏设计原型 · React 入口。
 * 产品事实源：docs/product/pages/main-right-sidebar.md
 * 探索对象（本次评审范围，不含 Markdown / 下载按钮 / Rich Diff）：
 * - 默认 50% 与双面最小 480px、最大 75% 与主会话保底
 * - 分隔线鼠标拖拽与键盘调整（16/64px、Home/End、边界反馈）
 * - 并排 / 覆盖布局（可用内容宽度 960px 边界，跨界不动画）
 * - 150ms 无弹性开合、中途反向以最后意图为准
 * - 关掉最后一个标签的不可交互视觉快照
 * - 减少动态效果立即完成
 * 状态使用本地确定性 fixture + localStorage（模拟跨重启保留）。
 */
import { PanelRightClose, PanelRightOpen, Plus, X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { createRoot } from "react-dom/client";

import {
  MIN_SIDEBAR_WIDTH,
  beginToggle,
  isToggleComplete,
  keyboardWidthTarget,
  layoutForAvailableWidth,
  maxSidebarWidth,
  presentSidebarWidth,
  toggleProgressAt,
  type ResizerKey,
  type ToggleMotion
} from "./right-sidebar-model.js";
import "./styles.css";

type Theme = "dark" | "light";
type TabKind = "changes" | "process" | "files" | "chat" | "blank";

interface Tab {
  id: string;
  kind: TabKind;
  title: string;
}

interface PersistedScene {
  open: boolean;
  widthPreference: number | null;
  tabs: Tab[];
  activeTabId: string | null;
}

const LEFT_NAV_WIDTH = 240;
const WIDTH_FIXTURES = [1440, 1200, 960, 959] as const;
const STORAGE_KEY = "moebius-prototype.main-right-sidebar";

const TYPE_OPTIONS: Array<{ kind: TabKind; name: string; desc: string }> = [
  { kind: "chat", name: "＋ 新会话", desc: "开始一段普通对话" },
  { kind: "changes", name: "⇄ 改动", desc: "这段对话期间变了什么" },
  { kind: "files", name: "▸ 项目文件", desc: "浏览完整项目树" }
];

const CHANGE_FILES = [
  { path: "sites/marketeam/index.html", add: 12, del: 3 },
  { path: "tests/landing.test.ts", add: 40, del: 0 }
] as const;

const DIFF_LINES: Array<{ kind: "ctx" | "add" | "del"; old: number | null; nu: number | null; text: string }> = [
  { kind: "ctx", old: 36, nu: 36, text: "  it('空状态展示默认文案', () => {" },
  { kind: "ctx", old: 37, nu: 37, text: "    render(<LandingPage projects={[]} />);" },
  { kind: "del", old: 38, nu: null, text: "    // 空状态没有断言，回归时无从发现" },
  { kind: "add", old: null, nu: 38, text: "    expect(screen.getByText('还没有项目')).toBeInTheDocument();" },
  { kind: "add", old: null, nu: 39, text: "    expect(screen.getByRole('button', { name: '新建项目' })).toBeEnabled(); // 空态主操作必须可用" },
  { kind: "ctx", old: 39, nu: 40, text: "  });" }
];

const SOURCE_LINES = [
  "export const config = {",
  "  port: 4317,",
  "  dataRoot: join(homedir(), '.moebius'),",
  "  updateChannel: 'stable',",
  "  sidebarDefaultRatio: 0.5, // 无偏好时右侧栏取可用内容宽度的一半",
  "};"
];

const PROCESS_EVENTS = [
  { time: "14:30:02.114", meta: "第 1 次执行 · completed · 耗时 02:18 · model gpt-5 · effort high", body: "SYSTEM_PROMPT / DEVELOPER_PROMPT / USER_INPUT 已按 rollout 原值折叠" },
  { time: "14:30:05.031", meta: "response_item · function_call · call_01 · exec_command", body: "arguments: pnpm exec vitest run tests/landing.test.ts --reporter=verbose --testTimeout=20000" },
  { time: "14:30:06.408", meta: "response_item · function_call_output · call_01 · completed", body: "output: ✓ 空状态展示默认文案 (2 assertions) · 1 passed · duration 812ms" },
  { time: "14:32:20.411", meta: "response_item · assistant", body: "原始输出：空状态断言已补齐，覆盖默认文案与主操作可用性两条路径。" }
];

function loadPersisted(): PersistedScene {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedScene>;
      return {
        open: parsed.open === true,
        widthPreference:
          typeof parsed.widthPreference === "number"
            ? parsed.widthPreference
            : null,
        tabs: Array.isArray(parsed.tabs) ? (parsed.tabs as Tab[]) : [],
        activeTabId:
          typeof parsed.activeTabId === "string" ? parsed.activeTabId : null
      };
    }
  } catch {
    /* localStorage 不可用时按全新现场处理 */
  }
  return { open: false, widthPreference: null, tabs: [], activeTabId: null };
}

let tabSerial = 0;
function nextTabId(prefix: string): string {
  tabSerial += 1;
  return `${prefix}-${tabSerial}`;
}

function App(): JSX.Element {
  const [theme, setTheme] = useState<Theme>("dark");
  const [availableWidth, setAvailableWidth] = useState<number>(1440);
  const [motionReduced, setMotionReduced] = useState(false);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className={motionReduced ? "reduced-motion" : undefined}>
      <div className="harness">
        <span className="harness-note">
          设计原型 · 非正式产品实现 · 事实源 docs/product/pages/main-right-sidebar.md
        </span>
        <span className="width-label">可用内容宽度</span>
        {WIDTH_FIXTURES.map((width) => (
          <button
            key={width}
            type="button"
            aria-pressed={availableWidth === width}
            onClick={() => setAvailableWidth(width)}
          >
            {width}
          </button>
        ))}
        <button
          type="button"
          onClick={() => window.localStorage.removeItem(STORAGE_KEY)}
        >
          清除已保存现场
        </button>
        <button type="button" onClick={() => setEpoch((value) => value + 1)}>
          模拟重启
        </button>
        <button
          type="button"
          aria-pressed={theme === "light"}
          onClick={() =>
            setTheme((value) => (value === "dark" ? "light" : "dark"))
          }
        >
          {theme === "dark" ? "切换为亮色主题" : "切换为暗色主题"}
        </button>
        <button
          type="button"
          aria-pressed={motionReduced}
          onClick={() => setMotionReduced((value) => !value)}
        >
          减少动态效果
        </button>
      </div>
      <div className="stage">
        <div
          className="app-frame"
          style={{ width: availableWidth + LEFT_NAV_WIDTH }}
        >
          <LeftNav />
          <RightSidebarScene
            key={epoch}
            availableWidth={availableWidth}
            motionReduced={motionReduced}
          />
        </div>
      </div>
    </div>
  );
}

function LeftNav(): JSX.Element {
  return (
    <nav className="left-nav" aria-label="主页面左侧栏">
      <div className="nav-project">▾ 项目 A</div>
      <div className="nav-conversation">官网落地页验收</div>
      <div className="nav-conversation dim">发布检查清单</div>
    </nav>
  );
}

interface SceneProps {
  availableWidth: number;
  motionReduced: boolean;
}

function RightSidebarScene({
  availableWidth,
  motionReduced
}: SceneProps): JSX.Element {
  const [persisted] = useState(loadPersisted);
  const [openIntent, setOpenIntent] = useState(persisted.open);
  const [progress, setProgress] = useState(persisted.open ? 1 : 0);
  const [widthPreference, setWidthPreference] = useState<number | null>(
    persisted.widthPreference
  );
  const [tabs, setTabs] = useState<Tab[]>(persisted.tabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(
    persisted.activeTabId
  );
  const [closingLastTab, setClosingLastTab] = useState(false);

  const layout = layoutForAvailableWidth(availableWidth);
  const settledWidth = presentSidebarWidth(widthPreference, availableWidth);
  const currentMax = Math.max(
    maxSidebarWidth(availableWidth),
    MIN_SIDEBAR_WIDTH
  );

  const progressRef = useRef(progress);
  progressRef.current = progress;
  const motionRef = useRef<ToggleMotion | null>(null);
  const rafRef = useRef<number | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const toggleButtonRef = useRef<HTMLButtonElement | null>(null);
  const conversationScrollRef = useRef<HTMLDivElement | null>(null);
  const savedScrollTop = useRef(0);
  const closingRef = useRef(false);
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const motionReducedRef = useRef(motionReduced);
  motionReducedRef.current = motionReduced;

  /* 跨对话切换与重启保留：开关状态、宽度偏好、标签现场。 */
  useEffect(() => {
    const scene: PersistedScene = {
      open: openIntent,
      widthPreference,
      tabs,
      activeTabId
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scene));
    } catch {
      /* 原型忽略持久化失败 */
    }
  }, [openIntent, widthPreference, tabs, activeTabId]);

  const finalizeMotion = useCallback((target: 0 | 1) => {
    motionRef.current = null;
    progressRef.current = target;
    setProgress(target);
    if (target === 0) {
      /* 动效结束后才从页面结构移除，并恢复主会话原滚动位置。 */
      if (closingRef.current) {
        closingRef.current = false;
        setClosingLastTab(false);
        setTabs([]);
        setActiveTabId(null);
      }
      requestAnimationFrame(() => {
        if (conversationScrollRef.current) {
          conversationScrollRef.current.scrollTop = savedScrollTop.current;
        }
      });
    }
  }, []);

  const runMotion = useCallback(
    (target: 0 | 1) => {
      const now = performance.now();
      const motion = beginToggle(progressRef.current, target, now);
      if (!motion) {
        finalizeMotion(target);
        return;
      }
      motionRef.current = motion;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      const step = (): void => {
        const current = motionRef.current;
        if (!current) return;
        const timestamp = performance.now();
        const value = toggleProgressAt(current, timestamp);
        progressRef.current = value;
        setProgress(value);
        if (isToggleComplete(current, timestamp)) {
          finalizeMotion(current.to);
          return;
        }
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [finalizeMotion]
  );

  /* 关闭一开始：内容立即停止交互，内部焦点移到显示/隐藏按钮。 */
  const beginCloseSideEffects = useCallback(() => {
    if (conversationScrollRef.current) {
      savedScrollTop.current = conversationScrollRef.current.scrollTop;
    }
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      sidebarRef.current?.contains(activeElement)
    ) {
      toggleButtonRef.current?.focus();
    }
  }, []);

  const requestToggle = useCallback(
    (targetOpen: boolean) => {
      const target: 0 | 1 = targetOpen ? 1 : 0;
      setOpenIntent(targetOpen);
      if (targetOpen) {
        /* 中途反向重开：撤销「最后标签关闭」标记，快照现场恢复为正式现场。 */
        closingRef.current = false;
        setClosingLastTab(false);
      } else {
        beginCloseSideEffects();
      }
      if (motionReducedRef.current) {
        /* 减少动态效果：立即完成开关与焦点转移。 */
        motionRef.current = null;
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        finalizeMotion(target);
        return;
      }
      runMotion(target);
    },
    [beginCloseSideEffects, finalizeMotion, runMotion]
  );

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  const openSidebar = useCallback(() => {
    if (!openIntent) requestToggle(true);
  }, [openIntent, requestToggle]);

  const focusTab = useCallback(
    (id: string) => {
      setActiveTabId(id);
      openSidebar();
    },
    [openSidebar]
  );

  const upsertTab = useCallback(
    (tab: Tab) => {
      setTabs((current) =>
        current.some((entry) => entry.id === tab.id)
          ? current
          : [...current, tab]
      );
      focusTab(tab.id);
    },
    [focusTab]
  );

  const addBlankTab = useCallback(() => {
    const tab: Tab = { id: nextTabId("blank"), kind: "blank", title: "新标签" };
    setTabs((current) => [...current, tab]);
    focusTab(tab.id);
  }, [focusTab]);

  const convertTab = useCallback((id: string, kind: TabKind) => {
    const titles: Record<TabKind, string> = {
      chat: "新会话",
      changes: "改动",
      files: "项目文件",
      process: "开发",
      blank: "新标签"
    };
    setTabs((current) =>
      current.map((entry) =>
        entry.id === id ? { ...entry, kind, title: titles[kind] } : entry
      )
    );
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      const index = tabs.findIndex((entry) => entry.id === id);
      if (index < 0) return;
      if (tabs.length === 1) {
        /* 最后一个标签：标签数归零，立即开始收起动效；
           出场期间保留最后内容的不可交互视觉快照。 */
        closingRef.current = true;
        setClosingLastTab(true);
        requestToggle(false);
        return;
      }
      const next = tabs.filter((entry) => entry.id !== id);
      setTabs(next);
      if (activeTabId === id) {
        const neighbor = next[index] ?? next[index - 1];
        setActiveTabId(neighbor.id);
        requestAnimationFrame(() => {
          tabStripRef.current
            ?.querySelector<HTMLElement>(
              `[data-right-tab-id="${neighbor.id}"] [role="tab"]`
            )
            ?.focus();
        });
      }
    },
    [tabs, activeTabId, requestToggle]
  );

  /* ---------------- 分隔线：鼠标拖拽与键盘调整 ---------------- */

  const applyWidth = useCallback(
    (width: number) => {
      setWidthPreference(
        Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), currentMax)
      );
    },
    [currentMax]
  );

  const onResizerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: settledWidth
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    },
    [settledWidth]
  );

  const onResizerPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      /* 分隔线向左拖扩大右侧栏，向右拖缩小；抵达边界保持不越界。 */
      applyWidth(drag.startWidth + (drag.startX - event.clientX));
    },
    [applyWidth]
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  }, []);

  const onResizerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const keys: ResizerKey[] = ["ArrowLeft", "ArrowRight", "Home", "End"];
      if (!keys.includes(event.key as ResizerKey)) return;
      event.preventDefault();
      setWidthPreference(
        keyboardWidthTarget(
          settledWidth,
          event.key as ResizerKey,
          event.shiftKey,
          availableWidth
        )
      );
    },
    [settledWidth, availableWidth]
  );

  const atBound =
    settledWidth <= MIN_SIDEBAR_WIDTH
      ? "min"
      : settledWidth >= currentMax
        ? "max"
        : undefined;

  /* ---------------- 渲染 ---------------- */

  const sidebarVisible = progress > 0 || openIntent;
  const inert = openIntent === false || closingLastTab;
  const activeTab = tabs.find((entry) => entry.id === activeTabId) ?? null;

  const asideStyle =
    layout === "side-by-side"
      ? { width: progress * settledWidth }
      : {
          width: availableWidth,
          transform: `translateX(${(1 - progress) * 100}%)`
        };

  return (
    <div className="content-region">
      <section className="conversation" aria-label="主页面会话区">
        <header className="conversation-header">
          <h1>官网落地页验收</h1>
          <button
            ref={toggleButtonRef}
            type="button"
            className="sidebar-toggle"
            aria-expanded={openIntent}
            aria-label={openIntent ? "隐藏右侧栏" : "显示右侧栏"}
            onClick={() => requestToggle(!openIntent)}
          >
            {openIntent ? (
              <PanelRightClose size={14} aria-hidden />
            ) : (
              <PanelRightOpen size={14} aria-hidden />
            )}
            {openIntent ? "隐藏右侧栏" : "显示右侧栏"}
          </button>
        </header>
        <div className="conversation-scroll" ref={conversationScrollRef}>
          <div className="message">
            <div className="speaker">(开) 开发</div>
            <div className="bubble">
              已补上空状态验收语句，两条断言都过了。
              <div className="step-entry">
                <span>这一步的调试调用链</span>
                <button
                  type="button"
                  onClick={() =>
                    upsertTab({ id: "process-dev-1", kind: "process", title: "开发" })
                  }
                >
                  完整输出
                </button>
              </div>
              <div className="result-card">
                <span className="result-summary">✓ 已结束 · 2 个文件有改动</span>
                <button
                  type="button"
                  onClick={() =>
                    upsertTab({ id: "changes-card", kind: "changes", title: "改动" })
                  }
                >
                  查看
                </button>
              </div>
            </div>
          </div>
          {Array.from({ length: 12 }, (_, index) => (
            <div className="message" key={index}>
              <div className="speaker">(开) 开发 · 更早的一轮 {index + 1}</div>
              <div className="bubble">
                这一轮的填充内容用于让主会话可以滚动，验证关闭右侧栏后滚动位置恢复原值。
              </div>
            </div>
          ))}
        </div>
      </section>

      {layout === "side-by-side" && sidebarVisible && (
        <div
          className="resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整右侧栏宽度"
          aria-valuenow={Math.round(settledWidth)}
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={currentMax}
          tabIndex={inert ? -1 : 0}
          data-dragging={dragging || undefined}
          data-bound={atBound}
          data-inert={inert || undefined}
          onPointerDown={onResizerPointerDown}
          onPointerMove={onResizerPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onResizerKeyDown}
        />
      )}

      {sidebarVisible && (
        <aside
          ref={sidebarRef}
          className={`right-sidebar${layout === "overlay" ? " overlay" : ""}`}
          style={asideStyle}
          aria-label="主页面右侧栏"
          data-layout={layout}
          data-inert={inert || undefined}
          {...(inert ? { inert: "" } : {})}
        >
          <div
            className="sidebar-inner"
            style={{
              width: layout === "side-by-side" ? settledWidth : availableWidth
            }}
          >
            <div
              className="right-tab-strip"
              role="tablist"
              aria-label="右侧栏标签"
              data-testid="right-tab-strip"
              ref={tabStripRef}
            >
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  className="right-tab"
                  data-right-tab-id={tab.id}
                  data-active={tab.id === activeTabId}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab.id === activeTabId}
                    aria-label={tab.title}
                    title={tab.title}
                    onClick={() => setActiveTabId(tab.id)}
                  >
                    {tab.title}
                  </button>
                  <button
                    type="button"
                    className="right-tab-close"
                    aria-label={`关闭“${tab.title}”`}
                    onClick={() => closeTab(tab.id)}
                  >
                    <X size={12} aria-hidden />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="add-tab"
                aria-label="新建标签"
                onClick={addBlankTab}
              >
                <Plus size={14} aria-hidden />
              </button>
              {layout === "overlay" && (
                <button
                  type="button"
                  className="overlay-close"
                  aria-label="关闭右侧栏"
                  onClick={() => requestToggle(false)}
                >
                  <X size={13} aria-hidden /> 关闭
                </button>
              )}
            </div>

            {tabs.length === 0 ? (
              <TypePicker
                heading="这个标签要看什么"
                onPick={(kind) => {
                  const tab: Tab = {
                    id: nextTabId(kind),
                    kind,
                    title:
                      kind === "chat"
                        ? "新会话"
                        : kind === "changes"
                          ? "改动"
                          : "项目文件"
                  };
                  setTabs([tab]);
                  setActiveTabId(tab.id);
                }}
              />
            ) : (
              <TabBody
                tab={activeTab ?? tabs[tabs.length - 1]}
                onPickType={convertTab}
              />
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

function TypePicker({
  heading,
  onPick
}: {
  heading: string;
  onPick: (kind: TabKind) => void;
}): JSX.Element {
  return (
    <div className="type-picker">
      <h2>{heading}</h2>
      <div className="type-options">
        {TYPE_OPTIONS.map((option) => (
          <button
            key={option.kind}
            type="button"
            className="type-option"
            onClick={() => onPick(option.kind)}
          >
            <span className="type-name">{option.name}</span>
            <span className="type-desc">{option.desc}</span>
          </button>
        ))}
      </div>
      <p className="type-hint">成员的完整输出和子任务，从左边的对话里点开。</p>
    </div>
  );
}

function TabBody({
  tab,
  onPickType
}: {
  tab: Tab;
  onPickType: (id: string, kind: TabKind) => void;
}): JSX.Element {
  if (tab.kind === "blank") {
    return (
      <TypePicker
        heading="这个标签要看什么"
        onPick={(kind) => onPickType(tab.id, kind)}
      />
    );
  }
  if (tab.kind === "changes") return <ChangesTab />;
  if (tab.kind === "process") return <ProcessTab />;
  if (tab.kind === "files") return <FilesTab />;
  return (
    <div className="chat-placeholder">
      <div className="chat-empty">新会话 · 首次发送后此标签原地成为已有会话</div>
      <div className="chat-composer">说点什么，或 @ 一个成员…</div>
    </div>
  );
}

function ChangesTab(): JSX.Element {
  const [selected, setSelected] = useState(0);
  return (
    <div className="tab-body">
      <div className="tab-section-note">
        这段对话期间，项目发生了这些改动（项目文件夹）
      </div>
      <div className="tab-scroll">
        {CHANGE_FILES.map((file, index) => (
          <div
            key={file.path}
            className="change-file"
            data-selected={selected === index}
            onClick={() => setSelected(index)}
          >
            <span>{file.path}</span>
            <span className="delta">
              <span className="add">+{file.add}</span>{" "}
              <span className="del">-{file.del}</span>
            </span>
          </div>
        ))}
        <hr style={{ border: "none", borderTop: "1px solid var(--border)" }} />
        <div className="diff-view">
          <div className="code-lines">
            {DIFF_LINES.map((line, index) => (
              <div className="code-line" data-kind={line.kind} key={index}>
                <span className="ln old">{line.old ?? ""}</span>
                <span className="ln">{line.nu ?? ""}</span>
                <span className="lc">{line.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProcessTab(): JSX.Element {
  return (
    <div className="tab-body">
      <div className="tab-section-note">开发 · 这一步的调试调用链</div>
      <div className="tab-scroll">
        <div className="process-view">
          {PROCESS_EVENTS.map((event, index) => (
            <div className="process-event" key={index}>
              <div className="event-meta">
                {event.time} · {event.meta}
              </div>
              <div>{event.body}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FilesTab(): JSX.Element {
  const [selected, setSelected] = useState("src/config.ts");
  return (
    <div className="tab-body">
      <div className="tab-section-note">项目文件夹 · 当前文件 · 只读</div>
      <div className="tab-scroll">
        {["src/config.ts", "src/server.ts", "docs/README.md"].map((path) => (
          <div
            key={path}
            className="file-tree-row"
            data-selected={selected === path}
            onClick={() => setSelected(path)}
          >
            {path}
            {path === "src/config.ts" && (
              <span className="dirty-dot" title="这段对话期间有改动">
                ●
              </span>
            )}
          </div>
        ))}
        <hr style={{ border: "none", borderTop: "1px solid var(--border)" }} />
        <div className="source-view">
          <div className="code-lines">
            {SOURCE_LINES.map((text, index) => (
              <div className="code-line" key={index}>
                <span className="ln">{index + 1}</span>
                <span className="lc">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("main-right-sidebar-root")!).render(<App />);
