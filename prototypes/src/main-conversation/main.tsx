import {
  ArrowDown,
  Bot,
  ChevronDown,
  CirclePlus,
  Folder,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Sun,
  Users
} from "lucide-react";
import {
  type CSSProperties,
  type RefCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createRoot } from "react-dom/client";

import { ConversationRail } from "./conversation-rail-adapted.js";
import {
  CONVERSATION,
  activateEvent,
  actorById,
  deriveRailCapacity,
  overlayWidthForContainer,
  previewForEvent,
  type RailEvent
} from "./rail-model.js";
import {
  ApplyScene,
  AvatarCardScene,
  TeamMenuScene,
  TeamSaveScene
} from "./team-scenes.js";
import "./styles.css";

type Theme = "dark" | "light";
type FrameWidth = "wide" | "medium" | "narrow";
type FrameHeight = "tall" | "compact";
type FocusPreset = "start" | "middle" | "end";
type Scene = "rail" | "team-menu" | "apply" | "avatar-card" | "team-save";

const SCENE_META: Record<
  Scene,
  { label: string; title: string; eyebrow: string }
> = {
  rail: {
    label: "目录轨",
    title: CONVERSATION.title,
    eyebrow: "agent-moebius · 开发团队"
  },
  "team-menu": {
    label: "团队菜单",
    title: "团队选择器应该展示多少团队信息",
    eyebrow: "agent-moebius · 交付团队"
  },
  apply: {
    label: "变化与应用",
    title: "配置改了，这段对话用哪一版",
    eyebrow: "agent-moebius · 交付团队"
  },
  "avatar-card": {
    label: "头像信息卡",
    title: "这条发言当时用了什么配置",
    eyebrow: "agent-moebius · 开发团队"
  },
  "team-save": {
    label: "保存反馈",
    title: "保存后生效了吗",
    eyebrow: "agent-moebius · Agent 团队"
  }
};

interface Inspection {
  eventId: string;
  panelLeft: number;
  top: number;
}

function App(): JSX.Element {
  const [theme, setTheme] = useState<Theme>("dark");
  const [scene, setScene] = useState<Scene>("team-menu");
  const [frameWidth, setFrameWidth] = useState<FrameWidth>("wide");
  const [frameHeight, setFrameHeight] = useState<FrameHeight>("tall");
  const [sessionMode, setSessionMode] = useState<"new" | "existing">(
    "existing"
  );
  const [hasOldWork, setHasOldWork] = useState(true);
  const [failNextApply, setFailNextApply] = useState(false);
  const [partialSaveFailure, setPartialSaveFailure] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [focusedEventId, setFocusedEventId] = useState(
    CONVERSATION.initialFocusId
  );
  const [inspected, setInspected] = useState<Inspection | null>(null);
  const [containerWidth, setContainerWidth] = useState(860);
  const [railViewportHeight, setRailViewportHeight] = useState(560);
  const [failureArmed, setFailureArmed] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState(
    "当前阅读位置：主会话最后一条消息"
  );

  const mainRef = useRef<HTMLElement>(null);
  const railViewportRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef(new Map<string, HTMLElement>());
  const collapseTimer = useRef<number | null>(null);
  const highlightTimer = useRef<number | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const suppressScrollSync = useRef(false);

  const capacity = useMemo(
    () => deriveRailCapacity(railViewportHeight),
    [railViewportHeight]
  );
  const overlayWidth = useMemo(
    () => overlayWidthForContainer(containerWidth),
    [containerWidth]
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useLayoutEffect(() => {
    if (scene !== "rail") return;
    const main = mainRef.current;
    const railViewport = railViewportRef.current;
    if (!main || !railViewport) return;

    const updateMeasurements = () => {
      setContainerWidth(Math.round(main.getBoundingClientRect().width));
      setRailViewportHeight(
        Math.round(railViewport.getBoundingClientRect().height)
      );
    };
    updateMeasurements();

    const observer = new ResizeObserver(updateMeasurements);
    observer.observe(main);
    observer.observe(railViewport);
    return () => observer.disconnect();
  }, [scene]);

  useEffect(() => {
    if (scene !== "rail") return;
    const timeline = timelineRef.current;
    if (!timeline) return;
    timeline.scrollTop = timeline.scrollHeight;
  }, [scene]);

  useEffect(() => {
    return () => {
      if (collapseTimer.current !== null) {
        window.clearTimeout(collapseTimer.current);
      }
      if (highlightTimer.current !== null) {
        window.clearTimeout(highlightTimer.current);
      }
      if (scrollFrame.current !== null) {
        window.cancelAnimationFrame(scrollFrame.current);
      }
    };
  }, []);

  const registerMessage =
    (eventId: string): RefCallback<HTMLElement> =>
    (element) => {
      if (element) messageRefs.current.set(eventId, element);
      else messageRefs.current.delete(eventId);
    };

  const cancelCollapse = () => {
    if (collapseTimer.current !== null) {
      window.clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
  };

  const scheduleCollapse = () => {
    cancelCollapse();
    collapseTimer.current = window.setTimeout(() => {
      setExpanded(false);
      setInspected(null);
    }, 160);
  };

  const inspectEvent = (event: RailEvent, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const panelRect = element
      .closest<HTMLElement>(".rail-stage")
      ?.getBoundingClientRect();
    setInspected({
      eventId: event.id,
      panelLeft: panelRect?.left ?? rect.left,
      top: rect.top + rect.height / 2
    });
  };

  const locateEvent = (event: RailEvent) => {
    const result = activateEvent(
      focusedEventId,
      event.id,
      failureArmed
    );
    setAnnouncement(result.feedback);
    if (!result.activated) {
      setInspected(null);
      return;
    }

    const target = messageRefs.current.get(event.id);
    if (!target) {
      setAnnouncement("无法定位到原消息，已保持当前阅读位置");
      return;
    }

    suppressScrollSync.current = true;
    setFocusedEventId(result.focusedEventId);
    target.scrollIntoView({
      block: "center",
      behavior: reducedMotion() ? "auto" : "smooth"
    });
    target.focus({ preventScroll: true });
    setHighlightId(event.id);
    setInspected(null);
    if (highlightTimer.current !== null) {
      window.clearTimeout(highlightTimer.current);
    }
    highlightTimer.current = window.setTimeout(() => {
      setHighlightId(null);
      suppressScrollSync.current = false;
    }, reducedMotion() ? 700 : 1500);
  };

  const applyFocusPreset = (preset: FocusPreset) => {
    const index =
      preset === "start"
        ? 1
        : preset === "middle"
          ? Math.floor(CONVERSATION.events.length / 2)
          : CONVERSATION.events.length - 1;
    const event = CONVERSATION.events[index];
    if (!event) return;
    locateEvent(event);
  };

  const handleTimelineScroll = () => {
    if (suppressScrollSync.current || scrollFrame.current !== null) return;
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      const timeline = timelineRef.current;
      if (!timeline) return;
      const bounds = timeline.getBoundingClientRect();
      const center = bounds.top + bounds.height / 2;
      let nearest: { id: string; distance: number } | null = null;

      CONVERSATION.events.forEach((event) => {
        const element = messageRefs.current.get(event.id);
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - center);
        if (!nearest || distance < nearest.distance) {
          nearest = { id: event.id, distance };
        }
      });

      const resolved = nearest as { id: string; distance: number } | null;
      if (resolved && resolved.id !== focusedEventId) {
        setFocusedEventId(resolved.id);
      }
    });
  };

  const frameStyle = {
    "--frame-width":
      frameWidth === "wide"
        ? "1280px"
        : frameWidth === "medium"
          ? "980px"
          : "720px",
    "--frame-height": frameHeight === "tall" ? "760px" : "580px"
  } as CSSProperties;

  return (
    <main className="prototype-page">
      <PrototypeToolbar
        failNextApply={failNextApply}
        failureArmed={failureArmed}
        frameHeight={frameHeight}
        frameWidth={frameWidth}
        hasOldWork={hasOldWork}
        onFailNextApplyChange={setFailNextApply}
        onFailureChange={setFailureArmed}
        onFocusPreset={applyFocusPreset}
        onFrameHeightChange={setFrameHeight}
        onFrameWidthChange={setFrameWidth}
        onHasOldWorkChange={setHasOldWork}
        onPartialSaveFailureChange={setPartialSaveFailure}
        onSceneChange={setScene}
        onSessionModeChange={setSessionMode}
        onThemeChange={setTheme}
        partialSaveFailure={partialSaveFailure}
        scene={scene}
        sessionMode={sessionMode}
        theme={theme}
      />

      <section
        aria-label={`主会话设计原型：${SCENE_META[scene].label}`}
        className="app-frame"
        data-frame-height={frameHeight}
        data-frame-width={frameWidth}
        style={frameStyle}
      >
        <AppSidebar />

        <section
          aria-label="当前主会话"
          className="main-conversation"
          data-container-width={containerWidth}
          ref={mainRef}
        >
          <header className="conversation-header">
            <div>
              <p className="eyebrow">{SCENE_META[scene].eyebrow}</p>
              <h1>{SCENE_META[scene].title}</h1>
            </div>
            <div aria-label="当前团队成员" className="team-avatars">
              {["product-lead", "product-reviewer", "ui-prototyper"].map(
                (actorId) => {
                  const actor = actorById(actorId);
                  return (
                    <span
                      className="team-avatar"
                      data-tone={actor.tone}
                      key={actor.id}
                      title={actor.name}
                    >
                      {actor.shortName}
                    </span>
                  );
                }
              )}
            </div>
          </header>

          {scene === "rail" ? (
            <>
              <div className="timeline-stage">
                <div
                  className="timeline-scroller"
                  data-testid="timeline"
                  onScroll={handleTimelineScroll}
                  ref={timelineRef}
                >
                  <div className="timeline-top-rule" />
                  <div className="message-stack">
                    {CONVERSATION.events.map((event) => {
                      const actor = actorById(event.actorId);
                      const current = event.id === focusedEventId;
                      const highlighted = event.id === highlightId;
                      return (
                        <article
                          aria-current={current ? "location" : undefined}
                          className={`timeline-message timeline-${event.kind}${
                            highlighted ? " is-highlighted" : ""
                          }`}
                          data-message-id={event.id}
                          data-testid={`timeline-message-${event.id}`}
                          key={event.id}
                          ref={registerMessage(event.id)}
                          tabIndex={-1}
                        >
                          <div className="message-who">
                            <span
                              aria-hidden="true"
                              className="actor-avatar"
                              data-tone={actor.tone}
                            >
                              {actor.shortName}
                            </span>
                            <strong>{actor.name}</strong>
                            <time>{event.time}</time>
                          </div>
                          <div className="message-body">{event.body}</div>
                        </article>
                      );
                    })}
                  </div>
                </div>

                <div className="rail-viewport" ref={railViewportRef}>
                  <ConversationRail
                    capacity={capacity}
                    containerWidth={containerWidth}
                    expanded={expanded}
                    focusId={focusedEventId}
                    inspectedId={inspected?.eventId ?? null}
                    onActivate={locateEvent}
                    onBrowse={(eventId) => {
                      setFocusedEventId(eventId);
                      setAnnouncement("目录焦点已移动；主时间线位置保持不变");
                    }}
                    onCancelCollapse={cancelCollapse}
                    onClearInspect={() => setInspected(null)}
                    onExpand={() => setExpanded(true)}
                    onInspect={inspectEvent}
                    onScheduleCollapse={scheduleCollapse}
                    overlayWidth={overlayWidth}
                  />
                </div>

                <button
                  className="jump-latest"
                  onClick={() => applyFocusPreset("end")}
                  type="button"
                >
                  <ArrowDown aria-hidden="true" />
                  回到最新
                </button>
              </div>

              <footer className="composer-shell" aria-label="消息输入区示意">
                <div className="composer-context">
                  <span>
                    <Folder aria-hidden="true" /> agent-moebius
                  </span>
                  <span>默认工作空间</span>
                  <span>main</span>
                  <span>
                    <Users aria-hidden="true" /> 开发团队
                  </span>
                </div>
                <div className="composer-row">
                  <span>继续告诉主理人…</span>
                  <button aria-label="添加附件" type="button">
                    <Plus aria-hidden="true" />
                  </button>
                  <button
                    aria-label="发送消息"
                    className="send-button"
                    type="button"
                  >
                    <ArrowDown aria-hidden="true" />
                  </button>
                </div>
              </footer>
            </>
          ) : null}

          {scene === "team-menu" ? (
            <TeamMenuScene
              hasOldWork={hasOldWork}
              mode={sessionMode}
              onAnnounce={setAnnouncement}
            />
          ) : null}

          {scene === "apply" ? (
            <ApplyScene
              failNext={failNextApply}
              hasOldWork={hasOldWork}
              onAnnounce={setAnnouncement}
            />
          ) : null}

          {scene === "avatar-card" ? (
            <AvatarCardScene onAnnounce={setAnnouncement} />
          ) : null}

          {scene === "team-save" ? (
            <TeamSaveScene
              onAnnounce={setAnnouncement}
              partialFailure={partialSaveFailure}
            />
          ) : null}
        </section>

        <aside aria-label="主页面右侧栏示意" className="right-inspector">
          <header>场景说明</header>
          <dl>
            <div>
              <dt>当前场景</dt>
              <dd>{SCENE_META[scene].label}</dd>
            </div>
            <div>
              <dt>项目</dt>
              <dd>agent-moebius</dd>
            </div>
            <div>
              <dt>对应 PRD</dt>
              <dd>
                {scene === "team-save"
                  ? "agent-teams.md"
                  : "main-conversation.md"}
              </dd>
            </div>
          </dl>
        </aside>
      </section>

      <p className="prototype-note">
        设计原型 · 非正式产品实现 · 对应 docs/product/pages/main-conversation.md
        与 docs/product/pages/agent-teams.md
      </p>

      {inspected && scene === "rail" ? (
        <EventPreviewCard
          inspection={inspected}
          onCancelCollapse={cancelCollapse}
          onScheduleCollapse={scheduleCollapse}
          overlayWidth={overlayWidth}
        />
      ) : null}

      <div aria-live="polite" className="toast" data-testid="announcement">
        {announcement}
      </div>
    </main>
  );
}

function AppSidebar(): JSX.Element {
  return (
    <aside aria-label="项目与会话导航" className="app-sidebar">
      <div className="traffic-row">
        <span aria-hidden="true" className="traffic traffic-red" />
        <span aria-hidden="true" className="traffic traffic-amber" />
        <span aria-hidden="true" className="traffic traffic-green" />
        <button aria-label="关闭侧边栏" type="button">
          <PanelLeft aria-hidden="true" />
        </button>
      </div>
      <nav aria-label="应用入口" className="sidebar-nav">
        <button type="button">
          <CirclePlus aria-hidden="true" /> 新建对话
        </button>
        <button type="button">
          <Search aria-hidden="true" /> 搜索
        </button>
        <button type="button">
          <Bot aria-hidden="true" /> Agent 团队
        </button>
      </nav>
      <div className="project-heading">
        <span>项目</span>
        <button aria-label="添加项目" type="button">
          <Plus aria-hidden="true" />
        </button>
      </div>
      <section className="project-list">
        <div className="project-row">
          <ChevronDown aria-hidden="true" />
          <strong>agent-moebius</strong>
          <button aria-label="项目更多操作" type="button">
            <MoreHorizontal aria-hidden="true" />
          </button>
        </div>
        <button className="session-row is-selected" type="button">
          主会话目录轨应该放在哪里
        </button>
        <button className="session-row" type="button">
          首次引导文案收口
        </button>
        <button className="session-row" type="button">
          桌面发布流程检查
        </button>
      </section>
      <button className="settings-row" type="button">
        <Settings aria-hidden="true" /> 设置
      </button>
    </aside>
  );
}

function PrototypeToolbar({
  failNextApply,
  failureArmed,
  frameHeight,
  frameWidth,
  hasOldWork,
  onFailNextApplyChange,
  onFailureChange,
  onFocusPreset,
  onFrameHeightChange,
  onFrameWidthChange,
  onHasOldWorkChange,
  onPartialSaveFailureChange,
  onSceneChange,
  onSessionModeChange,
  onThemeChange,
  partialSaveFailure,
  scene,
  sessionMode,
  theme
}: {
  failNextApply: boolean;
  failureArmed: boolean;
  frameHeight: FrameHeight;
  frameWidth: FrameWidth;
  hasOldWork: boolean;
  onFailNextApplyChange: (value: boolean) => void;
  onFailureChange: (value: boolean) => void;
  onFocusPreset: (preset: FocusPreset) => void;
  onFrameHeightChange: (height: FrameHeight) => void;
  onFrameWidthChange: (width: FrameWidth) => void;
  onHasOldWorkChange: (value: boolean) => void;
  onPartialSaveFailureChange: (value: boolean) => void;
  onSceneChange: (scene: Scene) => void;
  onSessionModeChange: (mode: "new" | "existing") => void;
  onThemeChange: (theme: Theme) => void;
  partialSaveFailure: boolean;
  scene: Scene;
  sessionMode: "new" | "existing";
  theme: Theme;
}): JSX.Element {
  return (
    <section aria-label="原型场景控制" className="prototype-toolbar">
      <div className="toolbar-label">
        <span>主会话 · 团队版本</span>
        <small>原型场景控制</small>
      </div>
      <ControlGroup label="场景">
        {(
          ["rail", "team-menu", "apply", "avatar-card", "team-save"] as Scene[]
        ).map((candidate) => (
          <button
            aria-pressed={scene === candidate}
            data-testid={`scene-${candidate}`}
            key={candidate}
            onClick={() => onSceneChange(candidate)}
            type="button"
          >
            {SCENE_META[candidate].label}
          </button>
        ))}
      </ControlGroup>
      <ControlGroup label="主会话宽度">
        {(["wide", "medium", "narrow"] as FrameWidth[]).map((width) => (
          <button
            aria-pressed={frameWidth === width}
            key={width}
            onClick={() => onFrameWidthChange(width)}
            type="button"
          >
            {width === "wide" ? "宽" : width === "medium" ? "中" : "窄"}
          </button>
        ))}
      </ControlGroup>
      <ControlGroup label="时间线高度">
        {(["tall", "compact"] as FrameHeight[]).map((height) => (
          <button
            aria-pressed={frameHeight === height}
            key={height}
            onClick={() => onFrameHeightChange(height)}
            type="button"
          >
            {height === "tall" ? "高" : "矮"}
          </button>
        ))}
      </ControlGroup>
      {scene === "rail" ? (
        <>
          <ControlGroup label="阅读焦点">
            {(["start", "middle", "end"] as FocusPreset[]).map((preset) => (
              <button
                key={preset}
                onClick={() => onFocusPreset(preset)}
                type="button"
              >
                {preset === "start"
                  ? "开头"
                  : preset === "middle"
                    ? "中段"
                    : "末尾"}
              </button>
            ))}
          </ControlGroup>
          <button
            aria-pressed={failureArmed}
            className="failure-toggle"
            onClick={() => onFailureChange(!failureArmed)}
            type="button"
          >
            下次定位失败
          </button>
        </>
      ) : null}
      {scene === "team-menu" ? (
        <ControlGroup label="会话状态">
          <button
            aria-pressed={sessionMode === "new"}
            data-testid="mode-new"
            onClick={() => onSessionModeChange("new")}
            type="button"
          >
            新对话
          </button>
          <button
            aria-pressed={sessionMode === "existing"}
            data-testid="mode-existing"
            onClick={() => onSessionModeChange("existing")}
            type="button"
          >
            已有会话
          </button>
        </ControlGroup>
      ) : null}
      {scene === "team-menu" || scene === "apply" ? (
        <button
          aria-pressed={hasOldWork}
          className="failure-toggle"
          data-testid="toggle-old-work"
          onClick={() => onHasOldWorkChange(!hasOldWork)}
          type="button"
        >
          旧工作运行中
        </button>
      ) : null}
      {scene === "apply" ? (
        <button
          aria-pressed={failNextApply}
          className="failure-toggle"
          data-testid="toggle-apply-failure"
          onClick={() => onFailNextApplyChange(!failNextApply)}
          type="button"
        >
          下次应用失败
        </button>
      ) : null}
      {scene === "team-save" ? (
        <button
          aria-pressed={partialSaveFailure}
          className="failure-toggle"
          data-testid="toggle-partial-failure"
          onClick={() => onPartialSaveFailureChange(!partialSaveFailure)}
          type="button"
        >
          部分保存失败
        </button>
      ) : null}
      <button
        aria-label={theme === "dark" ? "切换为亮色主题" : "切换为暗色主题"}
        className="theme-toggle"
        onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}
        type="button"
      >
        {theme === "dark" ? (
          <Sun aria-hidden="true" />
        ) : (
          <Moon aria-hidden="true" />
        )}
      </button>
    </section>
  );
}

function ControlGroup({
  children,
  label
}: {
  children: React.ReactNode;
  label: string;
}): JSX.Element {
  return (
    <div aria-label={label} className="control-group">
      <span>{label}</span>
      <div>{children}</div>
    </div>
  );
}

function EventPreviewCard({
  inspection,
  onCancelCollapse,
  onScheduleCollapse,
  overlayWidth
}: {
  inspection: Inspection;
  onCancelCollapse: () => void;
  onScheduleCollapse: () => void;
  overlayWidth: number;
}): JSX.Element | null {
  const event = CONVERSATION.events.find(({ id }) => id === inspection.eventId);
  if (!event) return null;
  const actor = actorById(event.actorId);
  const preview = previewForEvent(CONVERSATION, event);
  const cardWidth = 296;
  const rightCandidate = inspection.panelLeft + overlayWidth + 12;
  const left = rightCandidate + cardWidth < window.innerWidth - 12
    ? rightCandidate
    : Math.max(12, inspection.panelLeft - cardWidth - 12);
  const top = Math.max(
    64,
    Math.min(inspection.top - 54, window.innerHeight - 172)
  );

  return (
    <aside
      className="event-preview-card"
      data-testid="event-preview-card"
      onMouseEnter={onCancelCollapse}
      onMouseLeave={onScheduleCollapse}
      style={{ left, top }}
    >
      {preview.title === null ? null : (
        <p className="preview-title">{preview.title}</p>
      )}
      <p className="preview-meta">
        <span className="preview-dot" data-tone={actor.tone} />
        {preview.actorName} · {event.time}
      </p>
      <p className="preview-body">{preview.body}</p>
    </aside>
  );
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const root = document.getElementById("main-conversation-root");
if (!root) throw new Error("Missing main conversation prototype root.");
createRoot(root).render(<App />);
