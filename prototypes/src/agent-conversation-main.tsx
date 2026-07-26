import {
  AlertTriangle,
  Check,
  ChevronRight,
  CirclePause,
  Clock3,
  Code2,
  FileCode2,
  FileText,
  Folder,
  GitBranch,
  Moon,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Square,
  Sun,
  Terminal,
  UserRound,
  X
} from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from "react";
import { createRoot } from "react-dom/client";

import moebiusLogoUrl from "../../assets/brand/generated/ui-icon-64.png";
import {
  type ActivityEvent,
  ACTIVITY_FIXTURES,
  currentActivity,
  formatDuration,
  initialPrototypeState,
  prototypeReducer,
  type RunStatus
} from "./agent-conversation-state.js";
import "./tokens.css";
import "./agent-conversation.css";

type Scenario = "running" | "completed" | "stopped" | "paused" | "unable";
type Theme = "dark" | "light";

const SCENARIOS: Array<{ value: Scenario; label: string }> = [
  { value: "running", label: "运行中" },
  { value: "completed", label: "已完成" },
  { value: "stopped", label: "已停下" },
  { value: "paused", label: "可恢复" },
  { value: "unable", label: "无法继续" }
];

function App(): JSX.Element {
  const [state, dispatch] = useReducer(
    prototypeReducer,
    undefined,
    initialPrototypeState
  );
  const [theme, setTheme] = useState<Theme>("dark");
  const [scenario, setScenario] = useState<Scenario>("running");
  const [showSecondAgent, setShowSecondAgent] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [longDuration, setLongDuration] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      dispatch({ type: "tick" });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (editing) {
      composerRef.current?.focus();
    }
  }, [editing]);

  const setFixtureScenario = (next: Scenario) => {
    dispatch({ type: "reset" });
    if (next === "completed") {
      dispatch({ type: "complete" });
    } else if (next === "stopped") {
      dispatch({ type: "stop" });
    } else if (next === "paused") {
      dispatch({ type: "pause" });
    } else if (next === "unable") {
      dispatch({ type: "pause" });
      dispatch({ type: "recovery-failed" });
    }
    setScenario(next);
    setEditing(false);
  };

  const primaryElapsed = longDuration ? 3738 : state.elapsedSeconds;
  const latestActivity = currentActivity(state);

  const retry = () => {
    dispatch({ type: "retry" });
    setScenario("running");
    setLongDuration(false);
    setRightOpen(true);
  };

  const editAndResend = () => {
    setDraft("请重新核对 Agent 工作状态的活动摘要与时间语义。");
    setEditing(true);
  };

  return (
    <div className="agent-prototype">
      <PrototypeToolbar
        scenario={scenario}
        theme={theme}
        showSecondAgent={showSecondAgent}
        rightOpen={rightOpen}
        longDuration={longDuration}
        eventIndex={state.eventIndex}
        runStatus={state.status}
        onScenarioChange={setFixtureScenario}
        onThemeChange={setTheme}
        onAgentCountChange={setShowSecondAgent}
        onRightOpenChange={setRightOpen}
        onLongDurationChange={setLongDuration}
        onAdvanceEvent={() => dispatch({ type: "advance-event" })}
      />

      <div className="prototype-caption" role="note">
        <span>设计原型 · 非正式实现</span>
        <span>
          活动只由 fixture 中的结构化事件推进；按钮模拟“收到下一条真实事件”，不会循环轮播。
        </span>
      </div>

      <div className={`desktop-shell${rightOpen ? " has-process" : ""}`}>
        <ContextRail />

        <main className="conversation-pane" aria-label="团队全局会话">
          <ConversationHeader
            rightOpen={rightOpen}
            onToggleRight={() => setRightOpen((open) => !open)}
          />

          <div className="timeline-scroll">
            <div className="timeline-column">
              <UserMessage />

              <AgentMessage
                name="产品主理人"
                initial="产"
                tone="violet"
                body="我会让开发和测试并行核对运行状态。你可以直接看到每个人当前的工具活动与实际执行时长。"
              />

              <RunRecord
                name="开发"
                initial="开"
                tone="orange"
                cli="Codex"
                status={state.status}
                elapsedSeconds={primaryElapsed}
                activity={latestActivity}
                outputAvailable
                onOpenOutput={() => setRightOpen(true)}
                onStop={() => {
                  dispatch({ type: "stop" });
                  setScenario("stopped");
                }}
                onContinue={() => {
                  dispatch({ type: "continue" });
                  setScenario("running");
                }}
                onRetry={retry}
                onEditAndResend={editAndResend}
                onRerun={retry}
              />

              {showSecondAgent ? (
                <RunRecord
                  name="软件测试"
                  initial="测"
                  tone="blue"
                  cli="Kimi"
                  status="running"
                  elapsedSeconds={Math.max(37, primaryElapsed - 47)}
                  activity={{
                    id: "kimi-test",
                    at: 60,
                    kind: "read",
                    phase: "running",
                    action: "正在读取文件",
                    object: "run-block.test.tsx"
                  }}
                  outputAvailable={false}
                  onStop={() => undefined}
                />
              ) : null}

              <div className="timeline-spacer" aria-hidden="true" />
            </div>
          </div>

          <Composer
            value={draft}
            editing={editing}
            textareaRef={composerRef}
            primaryRunning={state.status === "running"}
            onChange={setDraft}
            onCancelEdit={() => {
              setEditing(false);
              setDraft("");
            }}
            onSend={() => {
              if (!draft.trim()) {
                return;
              }
              setEditing(false);
              setDraft("");
              setFixtureScenario("running");
            }}
          />
        </main>

        {rightOpen ? (
          <ProcessPanel
            attempts={state.attempts}
            latestActivity={latestActivity}
            liveElapsed={primaryElapsed}
            onClose={() => setRightOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}

function PrototypeToolbar({
  scenario,
  theme,
  showSecondAgent,
  rightOpen,
  longDuration,
  eventIndex,
  runStatus,
  onScenarioChange,
  onThemeChange,
  onAgentCountChange,
  onRightOpenChange,
  onLongDurationChange,
  onAdvanceEvent
}: {
  scenario: Scenario;
  theme: Theme;
  showSecondAgent: boolean;
  rightOpen: boolean;
  longDuration: boolean;
  eventIndex: number;
  runStatus: RunStatus;
  onScenarioChange: (scenario: Scenario) => void;
  onThemeChange: (theme: Theme) => void;
  onAgentCountChange: (show: boolean) => void;
  onRightOpenChange: (open: boolean) => void;
  onLongDurationChange: (show: boolean) => void;
  onAdvanceEvent: () => void;
}): JSX.Element {
  const isFinalEvent = eventIndex >= ACTIVITY_FIXTURES.length - 1;
  return (
    <section className="prototype-toolbar" aria-label="原型检视控制">
      <div className="prototype-toolbar__title">
        <span>单 Agent 会话</span>
        <small>状态与时间语义检视</small>
      </div>

      <div className="segmented" aria-label="运行状态 fixture">
        {SCENARIOS.map((item) => (
          <button
            type="button"
            key={item.value}
            className={scenario === item.value ? "is-active" : ""}
            aria-pressed={scenario === item.value}
            onClick={() => onScenarioChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="toolbar-actions">
        <button
          type="button"
          className="toolbar-button"
          aria-pressed={showSecondAgent}
          onClick={() => onAgentCountChange(!showSecondAgent)}
        >
          <UserRound aria-hidden="true" />
          {showSecondAgent ? "2 个 Agent" : "1 个 Agent"}
        </button>
        <button
          type="button"
          className="toolbar-button"
          aria-pressed={longDuration}
          onClick={() => onLongDurationChange(!longDuration)}
        >
          <Clock3 aria-hidden="true" />
          {longDuration ? "1:02:18" : "长任务格式"}
        </button>
        <button
          type="button"
          className="toolbar-button"
          aria-label="切换完整输出面板"
          aria-pressed={rightOpen}
          onClick={() => onRightOpenChange(!rightOpen)}
        >
          {rightOpen ? (
            <PanelRightClose aria-hidden="true" />
          ) : (
            <PanelRightOpen aria-hidden="true" />
          )}
          过程
        </button>
        <button
          type="button"
          className="toolbar-button toolbar-button--primary"
          disabled={runStatus !== "running" || isFinalEvent}
          onClick={onAdvanceEvent}
        >
          <RefreshCw aria-hidden="true" />
          {isFinalEvent ? "已到最新事件" : "接收下一事件"}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={theme === "dark" ? "切换为亮色主题" : "切换为暗色主题"}
          onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </button>
      </div>
    </section>
  );
}

function ContextRail(): JSX.Element {
  return (
    <aside className="context-rail" aria-label="项目与会话（环境上下文，不在本次范围）">
      <div className="brand-row">
        <img src={moebiusLogoUrl} alt="" />
        <span>Moebius</span>
        <MoreHorizontal aria-hidden="true" />
      </div>
      <nav aria-label="项目会话">
        <p className="rail-label">项目</p>
        <div className="project-row">
          <Folder aria-hidden="true" />
          <span>moebius</span>
          <ChevronRight aria-hidden="true" />
        </div>
        <p className="rail-label rail-label--sessions">最近会话</p>
        <div className="session-row is-selected">
          <span className="session-dot is-running" aria-hidden="true" />
          <span>Agent 工作状态</span>
        </div>
        <div className="session-row">
          <span className="session-dot" aria-hidden="true" />
          <span>首次启动流程</span>
        </div>
        <div className="session-row">
          <span className="session-dot" aria-hidden="true" />
          <span>桌面发布准备</span>
        </div>
      </nav>
      <div className="rail-foot">
        <span>本地团队</span>
        <span>3 名成员</span>
      </div>
    </aside>
  );
}

function ConversationHeader({
  rightOpen,
  onToggleRight
}: {
  rightOpen: boolean;
  onToggleRight: () => void;
}): JSX.Element {
  return (
    <header className="conversation-header">
      <div>
        <h1>Agent 工作状态</h1>
        <p>产品交付团队 · 项目文件夹</p>
      </div>
      <button
        type="button"
        className="header-icon-button"
        aria-label={rightOpen ? "关闭完整输出" : "打开完整输出"}
        aria-expanded={rightOpen}
        onClick={onToggleRight}
      >
        {rightOpen ? (
          <PanelRightClose aria-hidden="true" />
        ) : (
          <PanelRightOpen aria-hidden="true" />
        )}
      </button>
    </header>
  );
}

function UserMessage(): JSX.Element {
  return (
    <article className="timeline-entry user-entry">
      <div className="who-line user-who">
        <span>14:16</span>
        <strong>你</strong>
        <span className="identity identity--user">你</span>
      </div>
      <div className="user-bubble">
        Agent 工作时状态不够明显。请重点确认工具活动与耗时应该怎样呈现。
      </div>
    </article>
  );
}

function AgentMessage({
  name,
  initial,
  tone,
  body
}: {
  name: string;
  initial: string;
  tone: IdentityTone;
  body: string;
}): JSX.Element {
  return (
    <article className="timeline-entry agent-entry">
      <div className="who-line">
        <Identity initial={initial} tone={tone} />
        <strong>{name}</strong>
      </div>
      <p className="message-body">{body}</p>
    </article>
  );
}

type IdentityTone = "orange" | "blue" | "violet";

function Identity({
  initial,
  tone
}: {
  initial: string;
  tone: IdentityTone;
}): JSX.Element {
  return <span className={`identity identity--${tone}`}>{initial}</span>;
}

function RunRecord({
  name,
  initial,
  tone,
  cli,
  status,
  elapsedSeconds,
  activity,
  outputAvailable,
  onOpenOutput,
  onStop,
  onContinue,
  onRetry,
  onEditAndResend,
  onRerun
}: {
  name: string;
  initial: string;
  tone: IdentityTone;
  cli: "Codex" | "Kimi";
  status: RunStatus;
  elapsedSeconds: number;
  activity: ActivityEvent;
  outputAvailable: boolean;
  onOpenOutput?: () => void;
  onStop?: () => void;
  onContinue?: () => void;
  onRetry?: () => void;
  onEditAndResend?: () => void;
  onRerun?: () => void;
}): JSX.Element {
  const terminal = status === "stopped" || status === "completed" || status === "unable";
  const label = terminal ? "耗时" : "已进行";
  return (
    <article
      className={`run-record run-record--${status}`}
      data-testid={`run-record-${name}`}
    >
      <div className="run-header">
        <div className="who-line">
          <Identity initial={initial} tone={tone} />
          <strong>{name}</strong>
          <span className="cli-label">{cli}</span>
        </div>
        <DurationLabel
          label={label}
          seconds={elapsedSeconds}
          completedAt={terminal ? "完成于 14:32" : undefined}
        />
      </div>

      {status === "running" ? (
        <>
          <ActivityLine event={activity} />
          <RunActions
            name={name}
            outputAvailable={outputAvailable}
            cli={cli}
            onOpenOutput={onOpenOutput}
            onStop={onStop}
          />
        </>
      ) : status === "paused" ? (
        <>
          <div className="state-line state-line--paused">
            <CirclePause aria-hidden="true" />
            <span>已暂停，可恢复</span>
          </div>
          <RunActions
            name={name}
            outputAvailable={outputAvailable}
            cli={cli}
            onOpenOutput={onOpenOutput}
          >
            <button type="button" className="subtle-button" onClick={onContinue}>
              <Play aria-hidden="true" />
              继续
            </button>
          </RunActions>
        </>
      ) : status === "completed" ? (
        <>
          <p className="terminal-copy">
            已完成运行状态的交互梳理；工具活动、耗时与恢复语义已经逐项核对。
          </p>
          <RunActions
            name={name}
            outputAvailable={outputAvailable}
            cli={cli}
            onOpenOutput={onOpenOutput}
          />
        </>
      ) : status === "stopped" ? (
        <>
          <div className="terminal-fact">
            <CirclePause aria-hidden="true" />
            <div>
              <strong>已停下</strong>
              <p>已经产生的消息、过程与文件改动仍会保留。</p>
            </div>
          </div>
          <RunActions
            name={name}
            outputAvailable={outputAvailable}
            cli={cli}
            onOpenOutput={onOpenOutput}
          >
            <button type="button" className="subtle-button" onClick={onRetry}>
              <RotateCcw aria-hidden="true" />
              重试
            </button>
            <button
              type="button"
              className="subtle-button"
              onClick={onEditAndResend}
            >
              <FileCode2 aria-hidden="true" />
              改一改重发
            </button>
          </RunActions>
        </>
      ) : (
        <>
          <div className="terminal-fact terminal-fact--danger">
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>无法继续</strong>
              <p>原执行会话已丢失，没有自动重新运行。</p>
            </div>
          </div>
          <RunActions
            name={name}
            outputAvailable={outputAvailable}
            cli={cli}
            onOpenOutput={onOpenOutput}
          >
            <button type="button" className="subtle-button" onClick={onRerun}>
              <RefreshCw aria-hidden="true" />
              重新运行
            </button>
          </RunActions>
        </>
      )}
    </article>
  );
}

function ActivityLine({ event }: { event: ActivityEvent }): JSX.Element {
  const icon = activityIcon(event);
  return (
    <div
      className="activity-line"
      data-testid="latest-activity"
      tabIndex={0}
      title={`${event.action} · ${event.object}`}
    >
      <span className="activity-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="activity-action">{event.action}</span>
      <span className="activity-separator" aria-hidden="true">
        ·
      </span>
      <span className="activity-object">{event.object}</span>
    </div>
  );
}

function activityIcon(event: ActivityEvent): ReactNode {
  if (event.kind === "search") {
    return <Search />;
  }
  if (event.kind === "command") {
    return event.phase === "completed" ? <Check /> : <Terminal />;
  }
  if (event.kind === "edit") {
    return <FileCode2 />;
  }
  if (event.kind === "read") {
    return <FileText />;
  }
  return <Code2 />;
}

function DurationLabel({
  label,
  seconds,
  completedAt
}: {
  label: "已进行" | "耗时";
  seconds: number;
  completedAt?: string;
}): JSX.Element {
  const duration = formatDuration(seconds);
  const aria = completedAt
    ? `${label} ${duration}，${completedAt}`
    : `${label} ${duration}`;
  return (
    <span
      className={`duration-label${completedAt ? " has-completed-at" : ""}`}
      tabIndex={0}
      aria-label={aria}
      data-seconds={seconds}
    >
      <span>{label}</span>
      <strong className="tnum">{duration}</strong>
      {completedAt ? (
        <span className="time-tooltip" role="tooltip">
          {completedAt}
        </span>
      ) : null}
    </span>
  );
}

function RunActions({
  name,
  outputAvailable,
  cli,
  onOpenOutput,
  onStop,
  children
}: {
  name: string;
  outputAvailable: boolean;
  cli: "Codex" | "Kimi";
  onOpenOutput?: () => void;
  onStop?: () => void;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className="run-actions">
      {outputAvailable ? (
        <button
          type="button"
          className="text-button"
          aria-label={`${name}的完整输出`}
          onClick={onOpenOutput}
        >
          <FileText aria-hidden="true" />
          完整输出
        </button>
      ) : (
        <span className="output-unavailable" data-testid={`output-unavailable-${cli}`}>
          完整输出不可用 · 当前 Kimi 执行不提供可恢复的完整过程记录
        </span>
      )}
      <span className="action-spacer" />
      {children}
      {onStop ? (
        <button
          type="button"
          className="subtle-button stop-button"
          aria-label={`停下${name}`}
          onClick={onStop}
        >
          <Square aria-hidden="true" />
          停下
        </button>
      ) : null}
    </div>
  );
}

function Composer({
  value,
  editing,
  textareaRef,
  primaryRunning,
  onChange,
  onCancelEdit,
  onSend
}: {
  value: string;
  editing: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  primaryRunning: boolean;
  onChange: (value: string) => void;
  onCancelEdit: () => void;
  onSend: () => void;
}): JSX.Element {
  return (
    <div className="composer-wrap">
      {editing ? (
        <div className="edit-banner">
          <span>正在基于原消息改一改重发；发送后会成为新步骤。</span>
          <button type="button" onClick={onCancelEdit} aria-label="取消修改">
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <div className="composer">
        <textarea
          ref={textareaRef}
          value={value}
          aria-label="继续告诉主理人"
          placeholder="继续告诉主理人…"
          rows={1}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="composer-meta">
          {primaryRunning ? (
            <span>主理人工作中 · 新消息会排队</span>
          ) : (
            <span>消息将开始新一轮</span>
          )}
          <button
            type="button"
            className="send-button"
            disabled={!value.trim()}
            aria-label="发送"
            onClick={onSend}
          >
            <Send aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ProcessPanel({
  attempts,
  latestActivity,
  liveElapsed,
  onClose
}: {
  attempts: ReturnType<typeof initialPrototypeState>["attempts"];
  latestActivity: ActivityEvent;
  liveElapsed: number;
  onClose: () => void;
}): JSX.Element {
  const currentNumber = Math.max(
    ...attempts.map((attempt) => attempt.number),
    0
  );
  return (
    <aside className="process-panel" aria-label="开发的完整输出">
      <div className="process-tabs" role="tablist" aria-label="右侧栏标签">
        <button type="button" role="tab" aria-selected="false">
          改动
        </button>
        <button type="button" role="tab" aria-selected="true">
          开发
        </button>
        <button type="button" className="tab-add" aria-label="新建标签">
          +
        </button>
        <button type="button" className="panel-close" aria-label="关闭完整输出" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </div>
      <header className="process-header">
        <div>
          <h2>开发 · 这一步的完整输出</h2>
          <p>跟随最新 · 只读过程</p>
        </div>
      </header>
      <div className="process-scroll">
        <p className="load-earlier">↑ 向上滚动加载更早过程</p>
        {attempts.map((attempt) => {
          const isCurrent = attempt.number === currentNumber;
          const seconds = isCurrent ? liveElapsed : attempt.elapsedSeconds;
          const isTerminal =
            attempt.status === "stopped"
            || attempt.status === "completed"
            || attempt.status === "unable";
          return (
            <section
              className="attempt"
              key={attempt.number}
              data-testid={`process-attempt-${attempt.number}`}
            >
              <div className="attempt-heading">
                <span>第 {attempt.number} 次执行</span>
                <DurationLabel
                  label={isTerminal ? "耗时" : "已进行"}
                  seconds={seconds}
                  completedAt={isTerminal ? attempt.completedAt ?? "完成于 14:32" : undefined}
                />
              </div>
              <div className="attempt-input">
                <span>本轮输入</span>
                <p>请核对 Agent 工作状态的活动摘要与时间语义。</p>
              </div>
              <div className="process-events">
                <ProcessEvent icon={<FileText />} label="读取文件" body="run-block.tsx" />
                {attempt.number === 1 ? (
                  <>
                    <ProcessEvent icon={<Terminal />} label="运行命令" body="pnpm test" />
                    <ProcessEvent
                      icon={<AlertTriangle />}
                      label="命令退出"
                      body="测试进程被用户停下；已产生的输出仍保留。"
                      tone="danger"
                    />
                  </>
                ) : (
                  <>
                    <ProcessEvent
                      icon={activityIcon(latestActivity)}
                      label={latestActivity.action.replace(/^正在|^已完成/u, "")}
                      body={latestActivity.object}
                    />
                    <ProcessEvent
                      icon={<Code2 />}
                      label="Agent"
                      body="我正在按已确认的时间语义核对实现与回归用例。"
                    />
                  </>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function ProcessEvent({
  icon,
  label,
  body,
  tone = "normal"
}: {
  icon: ReactNode;
  label: string;
  body: string;
  tone?: "normal" | "danger";
}): JSX.Element {
  return (
    <div className={`process-event process-event--${tone}`}>
      <span className="process-event__icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <strong>{label}</strong>
        <p>{body}</p>
      </div>
    </div>
  );
}

const root = document.getElementById("agent-conversation-root");
if (root === null) {
  throw new Error("Agent conversation prototype root is missing.");
}
createRoot(root).render(<App />);
