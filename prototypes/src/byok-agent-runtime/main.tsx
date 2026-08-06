import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDashed,
  CircleX,
  Clock3,
  Code2,
  FileCode2,
  FileText,
  KeyRound,
  ListChecks,
  LoaderCircle,
  MessageSquareText,
  Moon,
  MoreHorizontal,
  Network,
  PanelLeft,
  Paperclip,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  TerminalSquare,
  Trash2,
  Users,
  Wrench,
  X
} from "lucide-react";
import {
  type Dispatch,
  type ReactNode,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from "react";
import { createRoot } from "react-dom/client";
import {
  createByokPrototypeState,
  reduceByokPrototypeState,
  type ByokPrototypeEvent,
  type ByokPrototypeState,
  type ConversationFixture,
  type PrototypeScene,
  type ProviderStatus
} from "./state.js";
import "./styles.css";

declare global {
  interface Window {
    __byokPrototype: {
      setScene: (scene: PrototypeScene) => void;
      setProviderStatus: (status: ProviderStatus) => void;
      setConversationFixture: (fixture: ConversationFixture) => void;
      failNextValidation: () => void;
      reset: () => void;
    };
  }
}

const scenes: Array<{
  id: PrototypeScene;
  label: string;
  icon: typeof Bot;
  shortcut: string;
}> = [
  { id: "onboarding", label: "首次引导", icon: Sparkles, shortcut: "1" },
  { id: "settings", label: "AI 服务商", icon: Settings, shortcut: "2" },
  { id: "teams", label: "Agent 团队", icon: Users, shortcut: "3" },
  { id: "conversation", label: "主对话", icon: MessageSquareText, shortcut: "4" },
  { id: "agent", label: "单 Agent", icon: Bot, shortcut: "5" }
];

const providerStatusCopy: Record<ProviderStatus, string> = {
  ready: "已就绪",
  attention: "需要处理",
  disabled: "已停用",
  removed: "服务商已下架"
};

function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="brand-mark"
      height={size}
      viewBox="0 0 32 32"
      width={size}
    >
      <rect fill="currentColor" height="32" rx="8" width="32" />
      <path
        d="M7.6 18.9c1.2-5.9 4.4-9.4 8.4-9.4 4.1 0 7.3 3.5 8.4 9.4M7.6 13.1c1.2 5.9 4.4 9.4 8.4 9.4 4.1 0 7.3-3.5 8.4-9.4"
        fill="none"
        stroke="var(--canvas)"
        strokeLinecap="round"
        strokeWidth="3.2"
      />
    </svg>
  );
}

function StatusPill({
  children,
  tone = "neutral",
  icon
}: {
  children: ReactNode;
  tone?: "run" | "info" | "danger" | "pass" | "neutral" | "violet";
  icon?: ReactNode;
}) {
  return (
    <span className={`status-pill status-${tone}`}>
      {icon}
      {children}
    </span>
  );
}

function ReviewBar({
  state,
  dispatch,
  theme,
  setTheme
}: {
  state: ByokPrototypeState;
  dispatch: Dispatch<ByokPrototypeEvent>;
  theme: "dark" | "light";
  setTheme: (theme: "dark" | "light") => void;
}) {
  return (
    <aside aria-label="原型评审控制器" className="review-bar">
      <div className="review-identity">
        <span className="review-dot" />
        <span>
          <strong>原型评审台</strong>
          <small>不属于产品界面</small>
        </span>
      </div>
      <nav aria-label="原型场景">
        {scenes.map((scene) => {
          const Icon = scene.icon;
          return (
            <button
              aria-current={state.scene === scene.id ? "page" : undefined}
              className="review-scene"
              key={scene.id}
              onClick={() => dispatch({ type: "scene", scene: scene.id })}
              type="button"
            >
              <Icon aria-hidden="true" size={14} strokeWidth={1.7} />
              <span>{scene.label}</span>
              <kbd>⌥{scene.shortcut}</kbd>
            </button>
          );
        })}
      </nav>
      <div className="review-actions">
        <button
          aria-label={theme === "dark" ? "切换到亮色主题" : "切换到暗色主题"}
          className="icon-button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          type="button"
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          className="review-reset"
          onClick={() => window.__byokPrototype.reset()}
          type="button"
        >
          <RotateCcw size={14} /> 重置
        </button>
      </div>
    </aside>
  );
}

function WindowHeader({
  title,
  trailing
}: {
  title?: string;
  trailing?: ReactNode;
}) {
  return (
    <header className="window-header">
      <div aria-hidden="true" className="traffic-lights">
        <span />
        <span />
        <span />
      </div>
      <div className="window-brand">
        <BrandMark size={22} />
        <strong>Moebius</strong>
      </div>
      {title ? <div className="window-title">{title}</div> : null}
      <div className="window-trailing">{trailing}</div>
    </header>
  );
}

function Field({
  label,
  children,
  hint
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function ValidationSteps({ stage }: { stage: ByokPrototypeState["validation"] }) {
  const order = ["reply", "tools", "saving"] as const;
  const labels = {
    reply: "模型回复",
    tools: "受控工具调用",
    saving: "本地安全保存"
  };
  const currentIndex = order.indexOf(stage as (typeof order)[number]);
  return (
    <div aria-live="polite" className="validation-steps">
      {order.map((item, index) => {
        const done = currentIndex > index || stage === "idle";
        const active = stage === item;
        const failed = stage === "failed" && item === "tools";
        return (
          <div className="validation-row" key={item}>
            <span className={`validation-icon ${done ? "done" : ""} ${failed ? "failed" : ""}`}>
              {done ? (
                <Check size={13} strokeWidth={2.4} />
              ) : failed ? (
                <X size={13} strokeWidth={2.4} />
              ) : active ? (
                <LoaderCircle className="spin" size={13} />
              ) : (
                <Circle size={11} />
              )}
            </span>
            <span>{labels[item]}</span>
            <small>{done ? "已通过" : failed ? "未通过" : active ? "进行中" : "等待"}</small>
          </div>
        );
      })}
    </div>
  );
}

function ProviderForm({
  state,
  dispatch,
  onCancel,
  compact = false
}: {
  state: ByokPrototypeState;
  dispatch: Dispatch<ByokPrototypeEvent>;
  onCancel: () => void;
  compact?: boolean;
}) {
  const [name, setName] = useState(state.provider.name);
  const [key, setKey] = useState("");
  const [model, setModel] = useState(state.provider.defaultModel);
  const busy = ["reply", "tools", "saving"].includes(state.validation);
  const submit = () => {
    if (!name.trim() || !key.trim()) return;
    dispatch({ type: "start-validation", name: name.trim(), model });
  };

  return (
    <section aria-label="添加 DeepSeek 服务商" className={`provider-form ${compact ? "compact" : ""}`}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">应用级档案</span>
          <h3>{state.provider.exists ? "替换 API Key" : "添加 API 服务商"}</h3>
        </div>
        <button aria-label="关闭服务商表单" className="icon-button" onClick={onCancel} type="button">
          <X size={16} />
        </button>
      </div>
      <div className="provider-grid">
        <Field label="服务商">
          <button className="select-control" disabled type="button">
            <span className="provider-glyph">D</span>
            DeepSeek
            <ChevronDown size={14} />
          </button>
        </Field>
        <Field label="档案名称">
          <input
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </Field>
        <Field label="API Key" hint="完整 Key 只会写入系统凭据存储，不会在保存后回显。">
          <input
            autoComplete="off"
            disabled={busy}
            onChange={(event) => setKey(event.target.value)}
            placeholder="sk-••••••••••••••••"
            type="password"
            value={key}
          />
        </Field>
        <Field label="模型">
          <select disabled={busy} onChange={(event) => setModel(event.target.value)} value={model}>
            <option value="deepseek-chat">deepseek-chat</option>
            <option value="deepseek-reasoner">deepseek-reasoner</option>
          </select>
        </Field>
      </div>
      <div className="data-boundary">
        <ShieldCheck size={17} />
        <div>
          <strong>验证会产生极少量 API 用量，但不会读取你的项目。</strong>
          <span>真实任务会把必要项目内容、附件和工具结果发送给 DeepSeek。</span>
        </div>
      </div>
      {state.validation !== "idle" ? <ValidationSteps stage={state.validation} /> : null}
      {state.validation === "failed" ? (
        <div className="inline-alert danger" role="alert">
          <CircleX size={16} />
          <div>
            <strong>工具调用没有通过</strong>
            <span>档案尚未创建。请确认模型支持 Agent 工具调用后重试。</span>
          </div>
          <button className="button secondary small" onClick={() => dispatch({ type: "retry-validation" })} type="button">
            重试验证
          </button>
        </div>
      ) : null}
      <div className="form-actions">
        <button className="button ghost" disabled={busy} onClick={onCancel} type="button">
          取消
        </button>
        <button className="button primary" disabled={busy || !name.trim() || !key.trim()} onClick={submit} type="button">
          {busy ? <LoaderCircle className="spin" size={15} /> : <KeyRound size={15} />}
          {state.validation === "saving" ? "正在安全保存" : busy ? "正在验证" : "验证并保存"}
        </button>
      </div>
    </section>
  );
}

function ProviderRow({ state }: { state: ByokPrototypeState }) {
  const status = state.provider.status;
  const tone = status === "ready" ? "pass" : status === "disabled" ? "neutral" : "danger";
  return (
    <div className="provider-row">
      <span className="provider-glyph large">D</span>
      <div className="provider-row-main">
        <div>
          <strong>DeepSeek · {state.provider.name}</strong>
          <StatusPill
            icon={status === "ready" ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
            tone={tone}
          >
            {providerStatusCopy[status]}
          </StatusPill>
        </div>
        <span>{state.provider.defaultModel} · {state.provider.lastVerified}</span>
      </div>
      <ChevronDown size={15} />
    </div>
  );
}

function Onboarding({
  state,
  dispatch
}: {
  state: ByokPrototypeState;
  dispatch: Dispatch<ByokPrototypeEvent>;
}) {
  const [formOpen, setFormOpen] = useState(!state.provider.exists);
  const [replaceOpen, setReplaceOpen] = useState(false);

  useEffect(() => {
    if (state.provider.exists && state.validation === "idle") setFormOpen(false);
  }, [state.provider.exists, state.validation]);

  const next = () => {
    if (state.onboardingStep < 4) {
      dispatch({ type: "onboarding-step", step: (state.onboardingStep + 1) as 2 | 3 | 4 });
    } else {
      dispatch({ type: "scene", scene: "conversation" });
    }
  };
  const previous = () => {
    if (state.onboardingStep > 1) {
      dispatch({ type: "onboarding-step", step: (state.onboardingStep - 1) as 1 | 2 | 3 });
    }
  };

  return (
    <main className="product-surface onboarding" data-testid="onboarding-scene">
      <WindowHeader title="首次启动" />
      <div className="onboarding-scroll">
        <div className="onboarding-heading">
          <span>第 {state.onboardingStep} 步，共 4 步</span>
          <h1>
            {state.onboardingStep === 1
              ? "环境准备"
              : state.onboardingStep === 2
                ? "选择一支团队"
                : state.onboardingStep === 3
                  ? "看看团队如何完成一次接力"
                  : state.teamBound
                    ? "准备就绪"
                    : "团队已选好"}
          </h1>
          <p>
            {state.onboardingStep === 1
              ? "准备一套 CLI 或添加 API，就可以启动团队"
              : state.onboardingStep === 2
                ? "先选一支最接近你当前工作的团队，之后随时可以切换"
                : state.onboardingStep === 3
                  ? "每一次交接都会留下过程、结论和复核证据"
                  : state.teamBound
                    ? "团队已经就位，说出你的目标就能开工"
                    : "其中 3 名成员仍需调整执行配置"}
          </p>
        </div>

        {state.onboardingStep === 1 ? (
          <div className="onboarding-column">
            <section className="setup-group" aria-label="CLI 准备状态">
              <div className="setup-row muted">
                <TerminalSquare size={17} />
                <div><strong>Codex CLI</strong><span>未安装</span></div>
                <button className="button ghost small" type="button">安装</button>
              </div>
              <div className="setup-row muted">
                <TerminalSquare size={17} />
                <div><strong>Claude Code</strong><span>已安装 · 需要登录</span></div>
                <button className="button ghost small" type="button">查看指引</button>
              </div>
              <div className="setup-row muted">
                <TerminalSquare size={17} />
                <div><strong>Kimi CLI</strong><span>未安装</span></div>
                <button className="button ghost small" type="button">安装</button>
              </div>
            </section>
            <section className="setup-group provider-setup" aria-label="API 服务商准备状态">
              {state.provider.exists ? <ProviderRow state={state} /> : null}
              {!formOpen ? (
                <button className="add-provider-row" onClick={() => setFormOpen(true)} type="button">
                  <Plus size={16} />
                  <span><strong>添加 API 服务商</strong><small>只需选择服务商、填写 Key 和模型</small></span>
                  <ArrowRight size={15} />
                </button>
              ) : (
                <ProviderForm state={state} dispatch={dispatch} onCancel={() => setFormOpen(false)} />
              )}
            </section>
          </div>
        ) : null}

        {state.onboardingStep === 2 ? (
          <div className="onboarding-column">
            <article className="team-card selected">
              <div className="team-card-title">
                <div><span className="selection-dot" /><strong>开发团队</strong><small>内置团队</small></div>
                <Check size={16} />
              </div>
              <p>开发经理 · 主 Agent　开发　软件测试</p>
              <span>负责软件方案、实现、测试、复核和主理收尾</span>
              {!state.teamBound ? (
                <div className="team-warning">
                  <AlertTriangle size={16} />
                  <div><strong>3 名成员的 Codex 配置不可用</strong><span>你可以改用刚刚验证的 DeepSeek API，或暂不替换继续。</span></div>
                  <button className="button secondary small" disabled={!state.provider.exists} onClick={() => setReplaceOpen(true)} type="button">改用这个 API</button>
                </div>
              ) : (
                <div className="team-success">
                  <CheckCircle2 size={16} />
                  <span>3 名成员已更新为 Pi API · {state.provider.name} · {state.provider.defaultModel}</span>
                </div>
              )}
            </article>
            <button className="ai-team-card" type="button">
              <Sparkles size={18} />
              <span><strong>跟 AI 聊出一支新团队</strong><small>说一下长期目标，AI 帮你把成员组齐</small></span>
              <ArrowRight size={15} />
            </button>
            {replaceOpen ? (
              <div className="inline-sheet" role="dialog" aria-modal="true" aria-label="改用这个 API">
                <div className="section-heading"><div><span className="eyebrow">原子更新</span><h3>把 3 名成员改用 Pi API</h3></div><button aria-label="关闭" className="icon-button" onClick={() => setReplaceOpen(false)} type="button"><X size={16} /></button></div>
                <div className="member-preview">
                  {["开发经理 · 主 Agent", "开发", "软件测试"].map((member) => <div key={member}><span className="avatar">{member[0]}</span><strong>{member}</strong><span>Pi API · DeepSeek · {state.provider.defaultModel}</span></div>)}
                </div>
                <p className="muted-copy">全部成员会一起保存；任一失败都不会改变现有团队。</p>
                <div className="form-actions"><button className="button ghost" onClick={() => setReplaceOpen(false)} type="button">取消</button><button className="button primary" disabled={state.teamUpdateState === "saving"} onClick={() => dispatch({ type: "start-team-update" })} type="button">{state.teamUpdateState === "saving" ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}确认更新</button></div>
              </div>
            ) : null}
          </div>
        ) : null}

        {state.onboardingStep === 3 ? <RelayDemo /> : null}

        {state.onboardingStep === 4 ? (
          <div className="ready-state">
            <div className={state.teamBound ? "ready-icon pass" : "ready-icon"}>{state.teamBound ? <Check size={30} /> : <Users size={28} />}</div>
            <strong>{state.teamBound ? "开发团队的 3 名成员都能直接开工" : "开发团队已选中"}</strong>
            <span>{state.teamBound ? `统一使用 DeepSeek · ${state.provider.defaultModel}` : "仍可进入产品，在对应成员接到任务时再处理配置。"}</span>
          </div>
        ) : null}
      </div>
      <footer className="onboarding-footer">
        <div>
          {state.onboardingStep === 1 ? <button className="button secondary" type="button">重新检查</button> : <button className="button secondary" onClick={previous} type="button"><ArrowLeft size={15} />上一步</button>}
          <button className="button primary" disabled={state.onboardingStep === 1 && !state.provider.exists} onClick={next} type="button">{state.onboardingStep === 4 ? "开始使用" : "继续"}<ArrowRight size={15} /></button>
        </div>
      </footer>
    </main>
  );
}

function RelayDemo() {
  const beats = [
    ["开发经理", "梳理影响范围并安排实现与验收"],
    ["开发", "定位 Provider 适配入口并完成修改"],
    ["软件测试", "发现模型下线后的恢复路径遗漏"],
    ["开发", "补齐迁移与只读历史状态"],
    ["软件测试", "回归通过，证据已记录"],
    ["开发经理", "核对结果并向用户收尾"]
  ];
  const [visible, setVisible] = useState(beats.length);
  useEffect(() => {
    if (visible >= beats.length) return;
    const timer = window.setTimeout(() => setVisible((value) => value + 1), 480);
    return () => window.clearTimeout(timer);
  }, [visible]);
  return (
    <section className="relay-card">
      <div className="section-heading"><div><span className="eyebrow">接力演示</span><h3>开发团队</h3></div><button className="button ghost small" onClick={() => setVisible(1)} type="button"><RotateCcw size={14} />重新播放</button></div>
      <div className="relay-members"><span>开发经理</span><span>开发</span><span>软件测试</span></div>
      <div className="relay-list">
        {beats.map(([role, copy], index) => (
          <div className={index < visible ? "relay-beat visible" : "relay-beat"} key={`${role}-${index}`}>
            <span className={`relay-node lane-${role === "开发经理" ? 0 : role === "开发" ? 1 : 2}`} />
            <strong>{role}</strong><p>{copy}</p><small>第 {index + 1} 棒</small>
          </div>
        ))}
      </div>
      <p className="relay-caption">动画不会拦住你；看懂后可以随时继续。</p>
    </section>
  );
}

function AppSidebar({ active }: { active: "teams" | "conversation" | "none" }) {
  return (
    <aside className="app-sidebar">
      <div className="sidebar-spacer" />
      <div className="sidebar-brand"><BrandMark size={24} /><strong>Moebius</strong></div>
      <nav aria-label="应用导航">
        <button className={active === "conversation" ? "active" : ""} type="button"><MessageSquareText size={16} />新对话</button>
        <button className={active === "teams" ? "active" : ""} type="button"><Users size={16} />Agent 团队</button>
        <button type="button"><Search size={16} />搜索</button>
      </nav>
      <div className="project-section"><span>项目</span><button type="button"><ChevronDown size={14} /> Moebius</button><button className="conversation-link" type="button">BYOK Agent 运行时</button></div>
      <div className="sidebar-bottom"><button type="button"><Settings size={16} />设置</button></div>
    </aside>
  );
}

function WorkspaceShell({
  children,
  active = "none",
  right
}: {
  children: ReactNode;
  active?: "teams" | "conversation" | "none";
  right?: ReactNode;
}) {
  return (
    <main className="product-surface workspace-shell">
      <WindowHeader trailing={<><button className="top-action" type="button"><CircleDashed size={14} />1 个运行项</button><button aria-label="更多" className="icon-button" type="button"><MoreHorizontal size={16} /></button></>} />
      <div className="workspace-body">
        <AppSidebar active={active} />
        <section className="workspace-main">{children}</section>
        {right}
      </div>
    </main>
  );
}

type SettingsOverlay = "none" | "key" | "rotate" | "disable" | "delete" | "references";

function SettingsScene({
  state,
  dispatch,
  returnToConversation,
  onReturn
}: {
  state: ByokPrototypeState;
  dispatch: Dispatch<ByokPrototypeEvent>;
  returnToConversation: boolean;
  onReturn: () => void;
}) {
  const [overlay, setOverlay] = useState<SettingsOverlay>(returnToConversation ? "key" : "none");
  const [tab, setTab] = useState<"profile" | "models" | "references">("profile");
  const [newDefault, setNewDefault] = useState(state.provider.defaultModel);
  const status = state.provider.status;

  useEffect(() => {
    if (returnToConversation) setOverlay("key");
  }, [returnToConversation]);

  return (
    <WorkspaceShell active="conversation">
      <div className="workspace-placeholder">
        <div className="placeholder-title">BYOK Agent 运行时</div>
        <div className="placeholder-message"><span className="avatar colored">开</span><div><strong>开发</strong><p>我会先核对 Provider 配置，再继续完成这次修改。</p></div></div>
        <div className="placeholder-composer">说点什么，或 @ 一个成员…</div>
      </div>
      <div className="modal-backdrop" data-testid="settings-backdrop" />
      <section aria-label="设置" aria-modal="true" className="settings-dialog" role="dialog">
        <header><h2>设置</h2><button aria-label="关闭设置" className="icon-button" onClick={onReturn} type="button"><X size={17} /></button></header>
        <div className="settings-layout">
          <nav aria-label="设置分类" className="settings-nav">
            <button type="button"><Settings size={15} />常规</button>
            <button aria-current="page" className="active" type="button"><Bot size={15} />AI 服务商</button>
            <button type="button"><Circle size={15} />关于</button>
          </nav>
          <div className="settings-content">
            <div className="settings-title-row"><div><h3>AI 服务商</h3><p>让 Agent 使用你自己的 API Key</p></div><button className="button secondary small" onClick={() => setOverlay("key")} type="button"><Plus size={14} />添加服务商</button></div>
            <div className="provider-master-detail">
              <div className="provider-list">
                <button className="provider-list-item active" type="button"><span className="provider-glyph large">D</span><span><strong>DeepSeek · {state.provider.name}</strong><small>{state.provider.defaultModel}</small></span><StatusPill tone={status === "ready" ? "pass" : status === "disabled" ? "neutral" : "danger"}>{providerStatusCopy[status]}</StatusPill></button>
                <button className="provider-list-item" type="button"><span className="provider-glyph alt">D</span><span><strong>DeepSeek · 备用档案</strong><small>deepseek-chat</small></span><StatusPill tone="neutral">已停用</StatusPill></button>
              </div>
              <div className="provider-detail">
                <div className="detail-identity"><span className="provider-glyph xlarge">D</span><div><h4>{state.provider.name}</h4><p>DeepSeek · {state.provider.lastVerified}</p></div><StatusPill tone={status === "ready" ? "pass" : status === "disabled" ? "neutral" : "danger"}>{providerStatusCopy[status]}</StatusPill></div>
                {status === "attention" || status === "removed" ? <div className="inline-alert danger"><AlertTriangle size={16} /><div><strong>{status === "removed" ? "该服务商已不再支持" : "API Key 需要重新验证"}</strong><span>{status === "removed" ? "请先添加另一服务商，再迁移团队与会话引用。" : "新运行已停止；历史和现有引用保持不变。"}</span></div><button className="button secondary small" onClick={() => setOverlay("key")} type="button">{status === "removed" ? "添加新档案" : "修复 Key"}</button></div> : null}
                <div className="detail-tabs" role="tablist"><button aria-selected={tab === "profile"} onClick={() => setTab("profile")} role="tab" type="button">档案</button><button aria-selected={tab === "models"} onClick={() => setTab("models")} role="tab" type="button">模型</button><button aria-selected={tab === "references"} onClick={() => setTab("references")} role="tab" type="button">引用</button></div>
                {tab === "profile" ? (
                  <div className="detail-panel">
                    <div className="definition-list"><div><span>服务商</span><strong>DeepSeek</strong><small>创建后不可更换</small></div><div><span>API Key</span><strong>{status === "attention" ? "需要重新输入" : "已安全保存"}</strong><button onClick={() => setOverlay("key")} type="button">替换 Key</button></div><div><span>默认模型</span><strong>{state.provider.defaultModel}</strong><small>只影响未来选择时的预选</small></div><div><span>团队成员</span><strong>3 名</strong><button onClick={() => { setTab("references"); setOverlay("references"); }} type="button">查看引用</button></div></div>
                    <div className="danger-zone"><div><strong>档案状态</strong><span>停用会阻止新绑定和新运行，但保留所有引用。</span></div><button className="button secondary small" onClick={() => setOverlay("disable")} type="button">{status === "disabled" ? "重新启用" : "停用档案"}</button><button className="button danger small" onClick={() => setOverlay("delete")} type="button"><Trash2 size={14} />删除</button></div>
                  </div>
                ) : null}
                {tab === "models" ? (
                  <div className="detail-panel">
                    <div className="model-row"><div><strong>deepseek-chat</strong><span>默认模型 · 模型回复与工具调用已通过</span></div><StatusPill tone="pass">已验证</StatusPill></div>
                    <div className="model-row"><div><strong>deepseek-reasoner</strong><span>2 个会话引用 · 最近验证成功</span></div><StatusPill tone="pass">已验证</StatusPill></div>
                    <div className="model-actions"><label>默认模型<select value={newDefault} onChange={(event) => setNewDefault(event.target.value)}><option>deepseek-chat</option><option>deepseek-reasoner</option></select></label><button className="button secondary small" type="button"><Plus size={14} />验证并添加模型</button></div>
                  </div>
                ) : null}
                {tab === "references" ? <ReferenceList /> : null}
              </div>
            </div>
          </div>
        </div>
      </section>
      {overlay === "key" ? <Modal title={state.provider.exists ? "替换 API Key" : "添加服务商"} onClose={() => setOverlay("none")}><ProviderForm compact state={state} dispatch={dispatch} onCancel={() => setOverlay("none")} />{returnToConversation && state.provider.status === "ready" && state.validation === "idle" ? <button className="button primary full" onClick={onReturn} type="button">返回原会话重试<ArrowRight size={15} /></button> : null}</Modal> : null}
      {overlay === "disable" ? <Modal title={status === "disabled" ? "重新启用档案" : "停用档案"} onClose={() => setOverlay("none")}><div className="confirm-copy"><AlertTriangle size={20} /><p>{status === "disabled" ? "重新启用会对 2 个模型执行固定能力测试，每个模型都会产生少量 API 用量。" : "停用后 3 名团队成员、1 份草稿和 2 段会话仍保留引用，但不会发起新请求。"}</p></div><div className="form-actions"><button className="button ghost" onClick={() => setOverlay("none")} type="button">取消</button><button className="button primary" onClick={() => { dispatch({ type: "provider-status", status: status === "disabled" ? "ready" : "disabled" }); setOverlay("none"); }} type="button">{status === "disabled" ? "验证并重新启用" : "确认停用"}</button></div></Modal> : null}
      {overlay === "delete" ? <Modal title="无法删除这份档案" onClose={() => setOverlay("none")}><div className="inline-alert danger"><CircleX size={17} /><div><strong>仍有运行引用</strong><span>先迁移或结束下面对象的继续能力，才能删除。</span></div></div><ReferenceList /><button className="button secondary full" onClick={() => { setOverlay("none"); setTab("references"); }} type="button">查看并处理引用</button></Modal> : null}
      {overlay === "references" ? null : null}
    </WorkspaceShell>
  );
}

function ReferenceList() {
  const groups = [
    ["团队成员", "开发团队 · 开发经理、开发、软件测试", "3"],
    ["AI 建队草稿", "产品发布团队 · 8 分钟前", "1"],
    ["排队任务", "迁移回归 · 等待开始", "1"],
    ["可恢复会话", "BYOK Agent 运行时、模型恢复", "2"]
  ];
  return <div className="reference-list">{groups.map(([label, body, count]) => <button key={label} type="button"><span><strong>{label}</strong><small>{body}</small></span><StatusPill tone="neutral">{count}</StatusPill><ArrowRight size={14} /></button>)}</div>;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const listener = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose]);
  return <div className="nested-backdrop"><section aria-label={title} aria-modal="true" className="nested-dialog" role="dialog"><header><h3>{title}</h3><button aria-label="关闭" className="icon-button" onClick={onClose} ref={closeRef} type="button"><X size={16} /></button></header><div className="nested-content">{children}</div></section></div>;
}

function TeamsScene({ state, dispatch }: { state: ByokPrototypeState; dispatch: Dispatch<ByokPrototypeEvent> }) {
  const [engine, setEngine] = useState(state.teamBound ? "Pi API" : "Codex");
  const [saved, setSaved] = useState(false);
  const status = state.provider.status;
  return <WorkspaceShell active="teams"><div className="page-scroll"><div className="page-title"><div><h1>Agent 团队</h1><p>管理成员职责与每名 Agent 的实际运行配置</p></div><button className="button primary"><Plus size={15} />新建团队</button></div><div className="team-page-grid"><aside className="team-list"><button className="active"><span className="avatar colored">开</span><span><strong>开发团队</strong><small>开发经理 · 主 Agent · 3 名成员</small></span>{status !== "ready" ? <AlertTriangle size={15} /> : null}</button><button><span className="avatar">通</span><span><strong>通用助手</strong><small>1 名成员 · 官方来源</small></span></button></aside><section className="team-editor"><div className="team-editor-header"><div><span className="eyebrow">开发团队</span><h2>开发经理</h2><p>@dev-manager · 主 Agent</p></div><span className="avatar hero colored">开</span></div><div className="member-tabs"><button className="active"><span className="avatar small colored">开</span>开发经理</button><button><span className="avatar small">开</span>开发</button><button><span className="avatar small">测</span>软件测试</button></div><section className="runtime-card"><div className="section-heading"><div><span className="eyebrow">用户覆盖</span><h3>运行配置</h3></div>{saved ? <StatusPill tone="pass"><Check size={12} />已保存</StatusPill> : null}</div><div className="runtime-grid"><Field label="执行引擎"><select value={engine} onChange={(event) => { setEngine(event.target.value); setSaved(false); }}><option>Codex</option><option>Claude Code</option><option>Kimi</option><option>Pi API</option></select></Field>{engine === "Pi API" ? <><Field label="Provider"><select disabled={status !== "ready"}><option>DeepSeek · {state.provider.name}</option></select></Field><Field label="模型"><select disabled={status !== "ready"}><option>{state.provider.defaultModel}</option><option>deepseek-reasoner</option></select></Field><Field label="思考程度"><select disabled={status !== "ready"}><option>标准</option><option>高</option></select></Field></> : <><Field label="模型"><select><option>gpt-5.6-sol</option></select></Field><Field label="思考程度"><select><option>high</option></select></Field></>}</div>{engine === "Pi API" && status !== "ready" ? <div className="inline-alert danger"><AlertTriangle size={16} /><div><strong>{providerStatusCopy[status]}</strong><span>原档案、模型和思考程度会保留；修复前不能把异常值重新保存。</span></div><button className="button secondary small" onClick={() => dispatch({ type: "scene", scene: "settings" })}>前往设置</button></div> : null}<div className="runtime-note"><ShieldCheck size={15} /><span>这里不会显示或要求重新输入 API Key；保存配置也不会调用服务商。</span></div><div className="form-actions"><button className="button ghost">恢复推荐配置</button><button className="button primary" disabled={engine === "Pi API" && status !== "ready"} onClick={() => { setSaved(true); if (engine === "Pi API") dispatch({ type: "team-update-succeeded" }); }}>保存运行配置</button></div></section><section className="agent-file"><div><strong>AGENT.md</strong><span>角色内容</span></div><pre># 开发经理{`\n\n`}负责架构边界、方案复核与最终交付收尾。</pre></section></section></div></div></WorkspaceShell>;
}

function ConversationScene({ state, dispatch, agentOnly = false, onRepair }: { state: ByokPrototypeState; dispatch: Dispatch<ByokPrototypeEvent>; agentOnly?: boolean; onRepair: () => void }) {
  const [overlay, setOverlay] = useState<"none" | "rerun" | "migrate" | "end">("none");
  const [stopped, setStopped] = useState(false);
  const fixture = state.conversationFixture;
  const right = agentOnly ? <AgentDetail state={state} dispatch={dispatch} onRepair={onRepair} /> : undefined;
  return <WorkspaceShell active="conversation" right={right}><div className="conversation-page"><header className="conversation-header"><div><span className="eyebrow">Moebius · 默认工作空间</span><h1>{agentOnly ? "空状态验收" : "BYOK Agent 运行时"}</h1></div><div className="conversation-context"><button><Code2 size={14} />main</button><button><Users size={14} />开发团队<ChevronDown size={13} /></button></div></header><div className="timeline"><div className="user-entry"><div><strong>你</strong><span>刚刚</span></div><p>请接入 DeepSeek Provider，并核对模型下线后的恢复路径。</p></div><div className="agent-entry"><div className="who"><span className="avatar colored">开</span><strong>开发经理</strong><StatusPill tone="neutral">已完成</StatusPill></div><p>我会先让开发完成 Provider 接入，再由测试独立核对恢复路径。</p></div>{fixture === "compressed" || fixture === "migrated" ? <div className="system-fact"><CircleDashed size={14} />{fixture === "compressed" ? "已整理较早上下文" : `已迁移到 DeepSeek / ${state.provider.name} / ${state.provider.defaultModel}；原生上下文已重新建立`}</div> : null}<RunCard fixture={fixture} stopped={stopped} onRepair={onRepair} onRerun={() => setOverlay("rerun")} onMigrate={() => setOverlay("migrate")} onEnd={() => setOverlay("end")} onStop={() => setStopped(true)} /><div className="agent-entry compact"><div className="who"><span className="avatar">测</span><strong>软件测试</strong><StatusPill tone="info"><Clock3 size={12} />等待</StatusPill></div><p>已收到验证任务，将在开发结果可用后检查迁移与一次性重跑是否互不混淆。</p></div></div><div className="composer"><div className="composer-context"><button><Paperclip size={14} />添加附件</button><span>Pi API · DeepSeek · {state.provider.defaultModel}</span></div><textarea aria-label="消息" placeholder="说点什么，或 @ 一个成员…" rows={2} /><button aria-label="发送" className="send-button"><ArrowRight size={16} /></button></div></div>{overlay === "rerun" ? <Modal title="换执行配置重跑" onClose={() => setOverlay("none")}><div className="runtime-grid single"><Field label="执行引擎"><select><option>Pi API</option><option>Codex</option></select></Field><Field label="Provider"><select><option>DeepSeek · {state.provider.name}</option></select></Field><Field label="模型"><select><option>deepseek-chat</option><option>deepseek-reasoner</option></select></Field></div><div className="inline-alert info"><CircleDashed size={16} /><div><strong>只用于这一次重跑</strong><span>不会修改当前会话的冻结配置或团队成员设置。</span></div></div><div className="form-actions"><button className="button ghost" onClick={() => setOverlay("none")}>取消</button><button className="button primary" onClick={() => { dispatch({ type: "conversation-fixture", fixture: "running" }); setOverlay("none"); }}>仅本次重跑</button></div></Modal> : null}{overlay === "migrate" ? <Modal title="迁移当前会话" onClose={() => setOverlay("none")}><div className="migration-compare"><div><span>当前冻结配置</span><strong>DeepSeek · {state.provider.name}</strong><small>deepseek-reasoner · 已不可用</small></div><ArrowRight size={18} /><div><span>新的后续配置</span><strong>DeepSeek · {state.provider.name}</strong><small>deepseek-chat · 已验证</small></div></div><ul className="plain-list"><li>保留 Moebius 时间线、附件、旧过程和文件结果</li><li>从当前可见时间线重新建立 Pi 原生上下文</li><li>不会修改团队默认配置</li></ul><div className="form-actions"><button className="button ghost" onClick={() => setOverlay("none")}>取消</button><button className="button primary" onClick={() => { dispatch({ type: "migration-succeeded", model: "deepseek-chat" }); setOverlay("none"); }}>确认迁移</button></div></Modal> : null}{overlay === "end" ? <Modal title="结束继续能力并保留历史" onClose={() => setOverlay("none")}><div className="confirm-copy"><AlertTriangle size={20} /><p>这名 Agent 将不能继续、重试或恢复；消息、附件、过程与文件结果仍可阅读。</p></div><div className="form-actions"><button className="button ghost" onClick={() => setOverlay("none")}>取消</button><button className="button danger" onClick={() => { setStopped(true); setOverlay("none"); }}>结束并保留历史</button></div></Modal> : null}</WorkspaceShell>;
}

function RunCard({ fixture, stopped, onRepair, onRerun, onMigrate, onEnd, onStop }: { fixture: ConversationFixture; stopped: boolean; onRepair: () => void; onRerun: () => void; onMigrate: () => void; onEnd: () => void; onStop: () => void }) {
  if (stopped) return <article className="run-card"><div className="run-header"><span className="avatar colored">开</span><strong>开发</strong><span className="run-time">耗时 02:41</span></div><p>已经完成 Provider 档案映射，迁移状态还需要补齐。</p><div className="system-line"><Square size={13} />你让这一步停下了</div><div className="run-actions"><button>完整输出</button><button onClick={onRerun}>换执行配置重跑…</button></div></article>;
  if (fixture === "key-invalid") return <article className="run-card error"><div className="run-header"><span className="avatar colored">开</span><strong>开发</strong><StatusPill tone="danger"><CircleX size={12} />需要处理</StatusPill></div><div className="run-error"><AlertTriangle size={18} /><div><strong>DeepSeek · 工作档案需要处理</strong><p>这一步没有再次请求服务商。修复后可从这里重试。</p></div></div><div className="run-actions"><button onClick={onRerun}>换执行配置重跑…</button><button className="primary-link" onClick={onRepair}>前往设置修复</button></div></article>;
  if (fixture === "model-removed") return <article className="run-card error"><div className="run-header"><span className="avatar colored">开</span><strong>开发</strong><StatusPill tone="danger"><CircleX size={12} />无法继续</StatusPill></div><div className="run-error"><AlertTriangle size={18} /><div><strong>deepseek-reasoner 已不可用</strong><p>原生 Pi 会话不能继续。迁移会保留 Moebius 时间线，并重新建立原生上下文。</p></div></div><div className="run-actions"><button onClick={onRerun}>一次性换配置重跑…</button><button onClick={onEnd}>结束并保留历史</button><button className="primary-link" onClick={onMigrate}>迁移当前会话…</button></div></article>;
  if (fixture === "migrated") return <article className="run-card"><div className="run-header"><span className="avatar colored">开</span><strong>开发</strong><span className="run-time">已进行 00:48</span></div><div className="latest-activity"><LoaderCircle className="spin" size={14} /><span>正在运行命令 · pnpm test</span></div><div className="run-actions"><button>完整输出</button><button onClick={onStop}>停下</button></div></article>;
  return <article className="run-card"><div className="run-header"><span className="avatar colored">开</span><strong>开发</strong><StatusPill tone="run"><span className="half-dot" />运行中</StatusPill><span className="run-time">已进行 02:18</span></div><div className="plan-progress"><div><Check size={13} />读取 Provider 与会话契约</div><div><Check size={13} />接入 DeepSeek 模型配置</div><div className="active"><LoaderCircle className="spin" size={13} />补齐迁移与恢复状态</div></div><div className="latest-activity"><TerminalSquare size={14} /><span>正在运行命令 · pnpm test</span></div><div className="run-actions"><button>完整输出</button><button onClick={onStop}>停下</button></div></article>;
}

function AgentDetail({ state, dispatch, onRepair }: { state: ByokPrototypeState; dispatch: Dispatch<ByokPrototypeEvent>; onRepair: () => void }) {
  const [tab, setTab] = useState<"conversation" | "output">("conversation");
  return <aside className="agent-panel"><header><div><span className="avatar colored">开</span><span><strong>开发</strong><small>Pi API · {state.provider.defaultModel}</small></span></div><button aria-label="关闭单 Agent" className="icon-button"><X size={16} /></button></header><div className="agent-tabs"><button aria-selected={tab === "conversation"} onClick={() => setTab("conversation")}>会话</button><button aria-selected={tab === "output"} onClick={() => setTab("output")}>完整输出</button></div>{tab === "conversation" ? <div className="agent-mini-timeline"><div className="mini-user"><strong>你</strong><p>请核对空状态的验收语句。</p></div><RunCard fixture={state.conversationFixture} stopped={false} onRepair={onRepair} onRerun={() => dispatch({ type: "conversation-fixture", fixture: "running" })} onMigrate={() => dispatch({ type: "migration-succeeded", model: "deepseek-chat" })} onEnd={() => undefined} onStop={() => dispatch({ type: "conversation-fixture", fixture: "key-invalid" })} /></div> : <FullOutput state={state} />}</aside>;
}

function FullOutput({ state }: { state: ByokPrototypeState }) {
  const events = [
    ["计划", "拆分 Provider 接入、会话迁移与验收"],
    ["读取文件", "docs/product/flows/byok-agent-runtime.md"],
    ["Skill", "已加载项目适用的开发约束"],
    ["并行子 Agent", "2 个子任务已汇总"],
    ["命令", "pnpm test · 42 项通过"],
    ["上下文", "已整理较早上下文 · 同一 Pi 会话继续"]
  ];
  return <div className="full-output"><div className="output-meta"><span><Bot size={14} />Pi API</span><span>DeepSeek · {state.provider.name}</span><span>{state.provider.defaultModel}</span></div><div className="safe-note"><ShieldCheck size={14} />安全清洗后的详细过程；凭据、原始 Provider 错误与内部载荷不会显示。</div>{events.map(([label, body], index) => <div className="output-event" key={label}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{label}</strong><p>{body}</p></div></div>)}</div>;
}

function PrototypeApp() {
  const [state, dispatch] = useReducer(reduceByokPrototypeState, undefined, createByokPrototypeState);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [returnToConversation, setReturnToConversation] = useState(false);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    if (!["reply", "tools", "saving"].includes(state.validation)) return;
    const timer = window.setTimeout(() => dispatch({ type: "advance-validation" }), 520);
    return () => window.clearTimeout(timer);
  }, [state.validation]);
  useEffect(() => {
    if (state.teamUpdateState !== "saving") return;
    const timer = window.setTimeout(() => dispatch({ type: "team-update-succeeded" }), 620);
    return () => window.clearTimeout(timer);
  }, [state.teamUpdateState]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!event.altKey) return;
      const scene = scenes.find((item) => item.shortcut === event.key);
      if (scene) { event.preventDefault(); dispatch({ type: "scene", scene: scene.id }); }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    window.__byokPrototype = {
      setScene: (scene) => dispatch({ type: "scene", scene }),
      setProviderStatus: (status) => dispatch({ type: "provider-status", status }),
      setConversationFixture: (fixture) => dispatch({ type: "conversation-fixture", fixture }),
      failNextValidation: () => dispatch({ type: "fail-next-validation" }),
      reset: () => window.location.reload()
    };
  }, []);

  const scene = useMemo(() => {
    if (state.scene === "onboarding") return <Onboarding state={state} dispatch={dispatch} />;
    if (state.scene === "settings") return <SettingsScene state={state} dispatch={dispatch} returnToConversation={returnToConversation} onReturn={() => { setReturnToConversation(false); dispatch({ type: "scene", scene: returnToConversation ? "conversation" : "conversation" }); }} />;
    if (state.scene === "teams") return <TeamsScene state={state} dispatch={dispatch} />;
    const repair = () => { setReturnToConversation(true); dispatch({ type: "provider-status", status: "attention" }); dispatch({ type: "scene", scene: "settings" }); };
    if (state.scene === "agent") return <ConversationScene agentOnly state={state} dispatch={dispatch} onRepair={repair} />;
    return <ConversationScene state={state} dispatch={dispatch} onRepair={repair} />;
  }, [state, returnToConversation]);

  return <div className="prototype-app"><ReviewBar state={state} dispatch={dispatch} theme={theme} setTheme={setTheme} />{scene}<div aria-live="polite" className="sr-only">{state.validation === "idle" && state.provider.exists ? "DeepSeek 工作档案已就绪" : ""}</div></div>;
}

createRoot(document.getElementById("root")!).render(<PrototypeApp />);
