import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  Copy,
  FolderPlus,
  MessageSquarePlus,
  Moon,
  RefreshCw,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Users,
  X
} from "lucide-react";
import {
  AnimatePresence,
  motion,
  useReducedMotion
} from "motion/react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from "react";
import { createRoot } from "react-dom/client";

import moebiusLogoUrl from "../../assets/brand/generated/ui-icon-64.png";
import {
  EASE_OUT,
  PrototypeButton,
  SPRING_LAYOUT,
  SPRING_PRESS
} from "./beui-button.js";
import { LoaderDots } from "./beui-loader.js";
import {
  canContinue,
  initialOnboardingState,
  onboardingReducer,
  type EnvironmentState,
  type OnboardingMode,
  type OnboardingStep,
  type TeamChoice
} from "./onboarding-state.js";
import "./tokens.css";
import "./styles.css";

/*
 * 第 3 步接力故事线冻结自 desktop 当前内置 development team：
 * 开发经理安排 → 开发执行 → 软件测试退回修改 → 开发修改 → 软件测试通过 → 开发经理收尾。
 * member 索引对应 MEMBERS：0 开发经理 / 1 开发 / 2 测试。
 */
const DEVELOPMENT_MEMBERS = [
  { name: "开发经理", slug: "dev-manager", initial: "经", duty: "主 Agent" },
  { name: "开发", slug: "dev", initial: "开", duty: "负责方案落地、代码实现与验证。" },
  { name: "软件测试", slug: "qa", initial: "测", duty: "负责测试执行、风险复核与质量意见。" }
] as const;

const CREATED_TEAM: TeamChoice = {
  id: "product-launch",
  name: "产品发布团队",
  primaryAgent: "策略负责人",
  members: ["研究员", "内容作者", "品牌审校"]
};

function membersForTeam(team: TeamChoice) {
  if (team.id === CREATED_TEAM.id) {
    return [
      { name: "策略负责人", slug: "launch-lead", initial: "策", duty: "主 Agent" },
      { name: "研究员", slug: "researcher", initial: "研", duty: "收集资料，核对产品信息和关键事实" },
      { name: "内容作者", slug: "content-writer", initial: "写", duty: "撰写发布内容，并根据审校意见修改" },
      { name: "品牌审校", slug: "brand-reviewer", initial: "审", duty: "检查事实、表达和品牌一致性" }
    ];
  }

  return DEVELOPMENT_MEMBERS.map((member) => ({ ...member }));
}

type PillTone = "success" | "amber" | "danger" | "info" | "neutral";

interface RelayBeat {
  member: number;
  tag: string;
  body: string;
  pill?: { tone: PillTone; label: string };
  handoff?: { kind: "交给" | "退回修改"; to: number };
}

const DEVELOPMENT_RELAY_BEATS: RelayBeat[] = [
  {
    member: 0,
    tag: "第 1 棒",
    body: "我先把时长统计问题拆成计算口径、边界样本和回归证据，开发先定位并提交修复。",
    handoff: { kind: "交给", to: 1 }
  },
  {
    member: 1,
    tag: "第 2 棒",
    body: "已经定位到暂停区间被重复计入，修正实现并补上基础回归用例，请测试复核。",
    handoff: { kind: "交给", to: 2 }
  },
  {
    member: 2,
    tag: "第 3 棒",
    pill: { tone: "danger", label: "测试未通过" },
    body: "第一轮复核未通过：跨日运行仍有一分钟偏差，现有用例没有覆盖这个边界。",
    handoff: { kind: "退回修改", to: 1 }
  },
  {
    member: 1,
    tag: "第 4 棒",
    body: "收到，已统一跨日取整口径并加入午夜边界用例，重新提交复核。",
    handoff: { kind: "交给", to: 2 }
  },
  {
    member: 2,
    tag: "第 5 棒",
    pill: { tone: "success", label: "测试通过" },
    body: "第二轮复核通过：暂停、跨日和取整边界都已覆盖，结果与预期一致。",
    handoff: { kind: "交给", to: 0 }
  },
  {
    member: 0,
    tag: "第 6 棒",
    pill: { tone: "success", label: "已完成" },
    body: "收尾：统计口径已修正，两轮复核及通过证据都保留在时间线中，本次目标完成。"
  }
];

const PRODUCT_LAUNCH_RELAY_BEATS: RelayBeat[] = [
  {
    member: 0,
    tag: "安排工作",
    body: "我来负责这次发布。先核对资料，再起草内容并完成审校；未通过的内容会退回修改。",
    handoff: { kind: "交给", to: 1 }
  },
  {
    member: 1,
    tag: "整理资料",
    body: "功能变化、发布时间和适用范围已核对，待确认信息已单独标出。",
    handoff: { kind: "交给", to: 2 }
  },
  {
    member: 2,
    tag: "起草内容",
    body: "公告、更新说明和渠道文案已完成初稿，提交审校。",
    handoff: { kind: "交给", to: 3 }
  },
  {
    member: 3,
    tag: "审校",
    pill: { tone: "danger", label: "审校未通过" },
    body: "两处功能表述与产品资料不一致，主标题也不符合品牌语气。请修改后再次提交。",
    handoff: { kind: "退回修改", to: 2 }
  },
  {
    member: 2,
    tag: "修改",
    body: "已修正功能表述和主标题，并补充来源说明，重新提交审校。",
    handoff: { kind: "交给", to: 3 }
  },
  {
    member: 3,
    tag: "再次审校",
    pill: { tone: "success", label: "审校通过" },
    body: "事实、表达和品牌语气均已通过，可以交付。",
    handoff: { kind: "交给", to: 0 }
  },
  {
    member: 0,
    tag: "交付结果",
    pill: { tone: "success", label: "已完成" },
    body: "发布内容已完成并通过审校。最终版本、修改记录和检查结果都在这里。"
  }
];

function relayBeatsForTeam(team: TeamChoice): RelayBeat[] {
  return team.id === CREATED_TEAM.id
    ? PRODUCT_LAUNCH_RELAY_BEATS
    : DEVELOPMENT_RELAY_BEATS;
}

function App() {
  const search = useMemo(
    () => new URLSearchParams(window.location.search),
    []
  );
  const requestedScenario = search.get("scenario");
  const initialEnvironment: EnvironmentState = requestedScenario === "missing"
    ? "missing"
    : requestedScenario === "unavailable"
      ? "unavailable"
      : "ready";
  const initialMode: OnboardingMode =
    search.get("mode") === "replay" ? "replay" : "first-run";
  const [state, dispatch] = useReducer(
    onboardingReducer,
    initialOnboardingState(initialEnvironment, initialMode)
  );
  const [theme, setTheme] = useState<"dark" | "light">(
    search.get("theme") === "light" ? "light" : "dark"
  );
  const [reviewOpen, setReviewOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [teamBuilderOpen, setTeamBuilderOpen] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  useEffect(() => {
    window.requestAnimationFrame(() => titleRef.current?.focus());
  }, [state.view]);

  const continueJourney = useCallback(() => {
    dispatch({ type: "continue" });
  }, []);

  const returnToPreviousStep = useCallback(() => {
    dispatch({ type: "back" });
  }, []);

  const recheck = useCallback(() => {
    dispatch({ type: "set-environment", value: "checking" });
    window.setTimeout(() => {
      dispatch({ type: "set-environment", value: "ready" });
    }, 1500);
  }, []);

  const copyInstallCommand = useCallback(async () => {
    try {
      await navigator.clipboard.writeText("brew install codex");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, []);

  return (
    <div className="prototype-root">
      <ReviewControls
        open={reviewOpen}
        theme={theme}
        onToggleOpen={() => setReviewOpen((current) => !current)}
        onThemeChange={setTheme}
        onScenarioChange={(environment, mode = "first-run") => {
          dispatch({ type: "reset", environment, mode });
          setTeamBuilderOpen(false);
          setReviewOpen(false);
        }}
      />

      <AnimatePresence mode="wait" initial={false}>
        {state.view === "conversation" ? (
          <ConversationDestination
            key="conversation"
            team={state.selectedTeam}
            titleRef={titleRef}
            onRestart={() => {
              dispatch({ type: "enter-replay" });
              setTeamBuilderOpen(false);
            }}
          />
        ) : state.view === "main" ? (
          <ReplayMainFixture
            key="replay-main"
            team={state.selectedTeam}
            titleRef={titleRef}
            onEnterReplay={() => {
              dispatch({ type: "enter-replay" });
              setTeamBuilderOpen(false);
            }}
          />
        ) : (
          <OnboardingShell
            key="onboarding"
            mode={state.mode}
            step={state.view}
            titleRef={titleRef}
            title={stepTitle(state.view)}
            subtitle={stepSubtitle(state.view, state.selectedTeam)}
            primaryLabel={state.view === 4 ? "开始使用" : "继续"}
            primaryDisabled={!canContinue(state) || teamBuilderOpen}
            actionsHidden={teamBuilderOpen}
            onPrimary={continueJourney}
            onExit={() => {
              dispatch({ type: "exit-replay" });
              setTeamBuilderOpen(false);
            }}
            secondary={
              state.view > 1 ? (
                <PrototypeButton
                  variant="secondary"
                  onClick={returnToPreviousStep}
                  disabled={teamBuilderOpen}
                  data-testid="back-action"
                >
                  <ArrowLeft size={14} />
                  上一步
                </PrototypeButton>
              ) : state.environment !== "ready" ? (
                <PrototypeButton
                  variant="secondary"
                  onClick={recheck}
                  disabled={state.environment === "checking"}
                  data-testid="recheck"
                >
                  <RefreshCw
                    size={14}
                    className={
                      state.environment === "checking" ? "is-spinning" : ""
                    }
                  />
                  {state.environment === "checking" ? "正在检查" : "重新检查"}
                </PrototypeButton>
              ) : null
            }
          >
            {state.view === 1 ? (
              <EnvironmentStep
                environment={state.environment}
                copied={copied}
                onCopy={copyInstallCommand}
              />
            ) : null}
            {state.view === 2 ? (
              <TeamStep
                selectedTeam={state.selectedTeam}
                onSelect={(team) => dispatch({ type: "select-team", team })}
                onSubflowChange={setTeamBuilderOpen}
              />
            ) : null}
            {state.view === 3 ? (
              <RelayStep
                key={state.relayRun}
                team={state.selectedTeam}
                run={state.relayRun}
                onReplay={() => dispatch({ type: "replay-relay" })}
              />
            ) : null}
            {state.view === 4 ? <ReadyStep /> : null}
          </OnboardingShell>
        )}
      </AnimatePresence>
    </div>
  );
}

function stepTitle(step: OnboardingStep): string {
  switch (step) {
    case 1:
      return "环境准备";
    case 2:
      return "选择一支团队";
    case 3:
      return "看看团队如何完成一次接力";
    case 4:
      return "准备就绪";
  }
}

function stepSubtitle(step: OnboardingStep, _team: TeamChoice): string {
  switch (step) {
    case 1:
      return "moebius 用 codex 来运行每一位团队成员";
    case 2:
      return "先选一支最接近你当前工作的团队，之后随时可以切换";
    case 3:
      return "每一次交接都会留下过程、结论和复核证据";
    case 4:
      return "团队已经就位，说出你的目标就能开工";
  }
}

function Pill({
  tone,
  children
}: {
  tone: PillTone;
  children: ReactNode;
}) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}

interface OnboardingShellProps {
  mode: OnboardingMode;
  step: OnboardingStep;
  title: string;
  subtitle: string;
  titleRef: React.RefObject<HTMLHeadingElement>;
  primaryLabel: string;
  primaryDisabled: boolean;
  actionsHidden: boolean;
  onPrimary: () => void;
  onExit: () => void;
  secondary: ReactNode;
  children: ReactNode;
}

function OnboardingShell({
  mode,
  step,
  title,
  subtitle,
  titleRef,
  primaryLabel,
  primaryDisabled,
  actionsHidden,
  onPrimary,
  onExit,
  secondary,
  children
}: OnboardingShellProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.main
      className="onboarding-shell"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
      transition={{ duration: reduceMotion ? 0.12 : 0.3, ease: EASE_OUT }}
      data-testid={`step-${step}`}
    >
      <PrototypeChrome mode={mode} onExit={onExit} />

      <section className="onboarding-stage">
        <div className="onboarding-frame">
          <div className="stage-heading">
            <motion.div
              className="stage-kicker"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: reduceMotion ? 0 : 0.08 }}
            >
              第 {step} 步，共 4 步
            </motion.div>
            <h1 ref={titleRef} tabIndex={-1}>
              {title}
            </h1>
            <p>{subtitle}</p>
          </div>

          <div
            className={[
              "stage-content",
              step === 3 || actionsHidden ? "stage-content--wide" : ""
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {children}
          </div>
        </div>
      </section>
      {actionsHidden ? null : (
        <footer className="onboarding-footer">
          <nav className="onboarding-actions" aria-label="引导步骤操作">
            {secondary}
            <PrototypeButton
              ripple
              onClick={onPrimary}
              disabled={primaryDisabled}
              data-testid="primary-action"
            >
              {primaryLabel}
              <ArrowRight size={15} />
            </PrototypeButton>
          </nav>
        </footer>
      )}
    </motion.main>
  );
}

function PrototypeChrome({
  mode = "first-run",
  onExit
}: {
  mode?: OnboardingMode | "main";
  onExit?: () => void;
}) {
  return (
    <header className="prototype-chrome" aria-label="应用标题栏">
      <div className="traffic-lights" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <div className="brand-mark">
        <img className="brand-glyph" src={moebiusLogoUrl} alt="" />
        <span>Moebius</span>
      </div>
      {mode === "replay" ? (
        <span className="prototype-label prototype-label--replay">
          <span>回看引导</span>
          <button
            type="button"
            onClick={onExit}
            aria-label="退出引导回看"
          >
            退出
          </button>
        </span>
      ) : (
        <span className="prototype-label">
          {mode === "main" ? "操作台" : "首次启动"}
        </span>
      )}
    </header>
  );
}

/* ---------- 第 1 步 · 环境 ---------- */

interface EnvironmentStepProps {
  environment: EnvironmentState;
  copied: boolean;
  onCopy: () => void;
}

function EnvironmentStep({
  environment,
  copied,
  onCopy
}: EnvironmentStepProps) {
  if (environment === "checking") {
    return (
      <motion.div
        className="environment-card environment-card--checking"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING_LAYOUT}
        role="status"
        data-testid="environment-checking"
      >
        <RefreshCw size={17} className="is-spinning" />
        <div>
          <strong>正在检查 Codex</strong>
          <p>检查完成后才会显示对应的恢复方式。</p>
        </div>
      </motion.div>
    );
  }

  if (environment === "ready") {
    return (
      <motion.div
        className="environment-card"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING_LAYOUT, delay: 0.05 }}
        data-testid="environment-ready"
      >
        <StatusRow
          icon={<Check size={15} />}
          label="Codex 已安装"
          meta="已在这台电脑上找到"
        />
        <StatusRow
          icon={<Check size={15} />}
          label="Codex 可以运行"
          meta="Agent 团队可以正常启动"
        />
      </motion.div>
    );
  }

  return (
    <motion.div
      className="environment-card environment-card--error"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING_LAYOUT}
      data-testid={`environment-${environment}`}
    >
      <div className="missing-head">
        <span className="status-icon status-icon--danger">
          <X size={15} />
        </span>
        <div>
          <strong>
            {environment === "missing" ? "未找到 Codex" : "Codex 暂时无法运行"}
          </strong>
          <p>
            {environment === "missing"
              ? "在终端运行以下命令，然后重新检查。"
              : "请在终端运行 codex，完成登录或按终端提示修复后，再回来重新检查。"}
          </p>
        </div>
      </div>

      {environment === "missing" ? (
        <div className="install-command">
          <code>brew install codex</code>
          <button
            type="button"
            className="copy-action"
            onClick={onCopy}
            aria-live="polite"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "已复制" : "复制"}
          </button>
        </div>
      ) : null}
    </motion.div>
  );
}

function StatusRow({
  icon,
  label,
  meta
}: {
  icon: ReactNode;
  label: string;
  meta: string;
}) {
  return (
    <div className="status-row">
      <span className="status-icon status-icon--pass">{icon}</span>
      <div>
        <strong>{label}</strong>
        <span>{meta}</span>
      </div>
      <Pill tone="success">通过</Pill>
    </div>
  );
}

/* ---------- 第 2 步 · 团队 ---------- */

interface TeamStepProps {
  selectedTeam: TeamChoice;
  onSelect: (team: TeamChoice) => void;
  onSubflowChange: (open: boolean) => void;
}

function TeamStep({
  selectedTeam,
  onSelect,
  onSubflowChange
}: TeamStepProps) {
  const reduceMotion = useReducedMotion();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [phase, setPhase] = useState<"goal" | "proposal">("goal");
  const [goalDraft, setGoalDraft] = useState("");
  const [goal, setGoal] = useState("");
  const [adjustment, setAdjustment] = useState("");
  const [adjustmentTurns, setAdjustmentTurns] = useState<Array<{
    id: number;
    text: string;
    replied: boolean;
  }>>([]);
  const [aiPending, setAiPending] = useState(false);
  const [proposalLocked, setProposalLocked] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const adjustmentRef = useRef<HTMLTextAreaElement>(null);
  const aiTurnTimerRef = useRef<number | null>(null);
  const nextAdjustmentIdRef = useRef(1);

  useEffect(
    () => () => onSubflowChange(false),
    [onSubflowChange]
  );

  useEffect(
    () => () => {
      if (aiTurnTimerRef.current !== null) {
        window.clearTimeout(aiTurnTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const thread = threadRef.current;
      if (thread) {
        thread.scrollTop = thread.scrollHeight;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [phase, goal, adjustmentTurns, aiPending]);

  /*
   * 模拟 AI 处理一轮消息：先露出「正在输入」气泡，短暂延迟后再落地回复。
   * 减少动态效果时仍保留处理节奏，只缩短等待。
   */
  const runAiTurn = (apply: () => void) => {
    setAiPending(true);
    aiTurnTimerRef.current = window.setTimeout(
      () => {
        aiTurnTimerRef.current = null;
        apply();
        setAiPending(false);
      },
      reduceMotion ? 300 : 950
    );
  };

  const submitGoal = (event: React.FormEvent) => {
    event.preventDefault();
    const nextGoal = goalDraft.trim();
    if (!nextGoal || aiPending) {
      return;
    }
    setGoal(nextGoal);
    runAiTurn(() => setPhase("proposal"));
  };

  const submitAdjustment = (event: React.FormEvent) => {
    event.preventDefault();
    const nextAdjustment = adjustment.trim();
    if (!nextAdjustment || aiPending) {
      return;
    }
    const turnId = nextAdjustmentIdRef.current;
    nextAdjustmentIdRef.current += 1;
    setAdjustmentTurns((turns) => [
      ...turns,
      { id: turnId, text: nextAdjustment, replied: false }
    ]);
    setAdjustment("");
    runAiTurn(() => {
      setAdjustmentTurns((turns) => turns.map((turn) =>
        turn.id === turnId ? { ...turn, replied: true } : turn
      ));
      setProposalLocked(false);
    });
  };

  const startAdjustment = () => {
    setProposalLocked(true);
    const textarea = adjustmentRef.current;
    if (textarea) {
      textarea.focus();
      textarea.scrollIntoView({ block: "nearest" });
    }
  };

  const openBuilder = () => {
    setBuilderOpen(true);
    onSubflowChange(true);
  };

  const closeBuilder = () => {
    setBuilderOpen(false);
    onSubflowChange(false);
  };

  if (builderOpen) {
    return (
      <motion.section
        className="team-builder"
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0.12 : 0.28, ease: EASE_OUT }}
        data-testid="team-builder"
      >
        <div className="team-builder__header">
          <button
            type="button"
            className="builder-back"
            onClick={closeBuilder}
            aria-label="返回选团队"
          >
            <ArrowLeft size={14} />
          </button>
          <div>
            <strong>AI 团队设计器</strong>
            <span>
              <i />
              独立只读 AI 会话
            </span>
          </div>
          <span className="builder-context-label">仍在第 2 步</span>
        </div>

        <div className="builder-thread" aria-live="polite" ref={threadRef}>
          <BuilderMessage>
            <p>你希望这支团队长期替你完成什么工作？</p>
            <small>先说目标就好，不需要想好角色和分工。</small>
          </BuilderMessage>

          {goal ? (
            <BuilderMessage from="user">
              <p>{goal}</p>
            </BuilderMessage>
          ) : null}

          {phase === "proposal" ? (
            <>
              <BuilderMessage>
                <p>我整理了一版团队方案。</p>
              </BuilderMessage>
              <section
                className={`team-proposal ${proposalLocked ? "team-proposal--readonly" : ""}`}
                aria-label="AI 生成的团队提案"
                data-testid="team-proposal"
              >
                <div className="team-proposal__head">
                  <div>
                    <span>团队提案 · 4 名成员</span>
                    <strong>{CREATED_TEAM.name}</strong>
                    <p>从资料研究到上线前复核，交付可直接发布的产品内容</p>
                  </div>
                  <Pill tone="info">
                    <Sparkles size={11} />
                    AI 生成
                  </Pill>
                </div>

                <div className="proposal-members">
                  <ProposalMember
                    name="策略负责人"
                    slug="launch-lead"
                    duty="统筹发布并确认最终版本"
                    primary
                  />
                  <ProposalMember
                    name="研究员"
                    slug="researcher"
                    duty="收集并核对关键信息"
                  />
                  <ProposalMember
                    name="内容作者"
                    slug="content-writer"
                    duty="起草并按反馈修改内容"
                  />
                  <ProposalMember
                    name="品牌审校"
                    slug="brand-reviewer"
                    duty="复核事实、表达和品牌一致性"
                  />
                </div>

                <div
                  className="proposal-collaboration"
                  aria-label="团队接力关系"
                >
                  <p>
                    你 → 策略负责人 → 研究员 → 内容作者 → 品牌审校 →
                    内容作者 → 品牌审校 → 策略负责人
                  </p>
                </div>

                {proposalLocked ? null : (
                  <div className="proposal-actions">
                    <PrototypeButton
                      variant="secondary"
                      onClick={startAdjustment}
                      data-testid="adjust-proposal"
                    >
                      <MessageSquarePlus size={14} />
                      继续聊着调整
                    </PrototypeButton>
                    <PrototypeButton
                      ripple
                      onClick={() => {
                        onSelect(CREATED_TEAM);
                        closeBuilder();
                      }}
                      data-testid="confirm-created-team"
                    >
                      <Check size={14} />
                      创建并选中
                    </PrototypeButton>
                  </div>
                )}
              </section>
            </>
          ) : null}

          {adjustmentTurns.map((turn) => (
            <div className="builder-adjustment-turn" key={turn.id}>
              <BuilderMessage from="user" testId="builder-adjustment-user">
                <p>{turn.text}</p>
              </BuilderMessage>
              {turn.replied ? (
                <BuilderMessage testId="builder-adjustment-reply">
                  <p>已按要求调整方案。</p>
                </BuilderMessage>
              ) : null}
            </div>
          ))}

          {aiPending ? (
            <motion.div
              className="builder-message builder-message--ai"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduceMotion ? { duration: 0.12 } : SPRING_LAYOUT}
              role="status"
              aria-label="AI 正在处理"
              data-testid="builder-typing"
            >
              <span className="builder-avatar">
                <Sparkles size={13} />
              </span>
              <div>
                <LoaderDots size={14} />
              </div>
            </motion.div>
          ) : null}
        </div>

        {phase === "goal" ? (
          <form className="builder-composer" onSubmit={submitGoal}>
            <textarea
              value={goalDraft}
              onChange={(event) => setGoalDraft(event.target.value)}
              placeholder="描述这支团队要长期完成的工作…"
              aria-label="描述团队目标或回答问题"
              rows={2}
              data-testid="builder-goal"
            />
            <button
              type="submit"
              aria-label="发送"
              disabled={!goalDraft.trim() || aiPending}
            >
              <Send size={15} />
            </button>
          </form>
        ) : null}

        {phase === "proposal" ? (
          <form className="builder-composer" onSubmit={submitAdjustment}>
            <textarea
              ref={adjustmentRef}
              value={adjustment}
              onChange={(event) => setAdjustment(event.target.value)}
              placeholder="继续聊着调整，比如“让负责人最后给我一份发布清单”…"
              aria-label="调整团队提案"
              rows={2}
            />
            <button
              type="submit"
              aria-label="发送"
              disabled={!adjustment.trim() || aiPending}
            >
              <Send size={15} />
            </button>
          </form>
        ) : null}
      </motion.section>
    );
  }

  const selectedIsCreated = selectedTeam.id === CREATED_TEAM.id;
  return (
    <div className="team-list">
      <motion.button
        type="button"
        className={`team-card ${selectedIsCreated ? "" : "is-selected"}`}
        aria-pressed={!selectedIsCreated}
        onClick={() =>
          onSelect({
            id: "development",
            name: "开发团队",
            primaryAgent: "开发经理",
            members: ["开发", "软件测试"]
          })
        }
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING_LAYOUT, delay: 0.03 }}
      >
        <div className="team-card__top">
          <div className="team-identity">
            <span className="selection-dot">
              {!selectedIsCreated ? <span /> : null}
            </span>
            <div>
              <strong>开发团队</strong>
              <span>内置团队</span>
            </div>
          </div>
          {!selectedIsCreated ? (
            <Pill tone="neutral">
              <Check size={12} />
              已选择
            </Pill>
          ) : null}
        </div>

        <div className="team-members">
          {membersForTeam({
            id: "development",
            name: "开发团队",
            primaryAgent: "开发经理",
            members: ["开发", "软件测试"]
          }).map(({ name, initial, duty }) => (
            <div className="member-chip" key={name}>
              <span className="member-avatar" aria-hidden>
                {initial}
              </span>
              <span>
                <strong>{name}</strong>
                <small>{duty}</small>
              </span>
            </div>
          ))}
        </div>
        <p className="team-card__description">
          负责软件方案、实现、测试、复核和主理收尾
        </p>
      </motion.button>

      {selectedIsCreated ? (
        <motion.div
          className="team-card is-selected created-team-card"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING_LAYOUT, delay: 0.06 }}
          data-testid="created-team-card"
        >
          <div className="team-card__top">
            <div className="team-identity">
              <span className="selection-dot">
                <span />
              </span>
              <div>
                <strong>{CREATED_TEAM.name}</strong>
                <span>我的团队</span>
              </div>
            </div>
            <Pill tone="neutral">
              <Check size={12} />
              已选择
            </Pill>
          </div>
          <div className="team-members">
            {membersForTeam(CREATED_TEAM).map(({ name, initial, duty }) => (
              <div className="member-chip" key={name}>
                <span className="member-avatar" aria-hidden>
                  {initial}
                </span>
                <span>
                  <strong>{name}</strong>
                  <small>{duty}</small>
                </span>
              </div>
            ))}
          </div>
          <p className="team-card__description">
            从资料研究到上线前复核，交付可直接发布的产品内容
          </p>
        </motion.div>
      ) : null}

      <motion.button
        type="button"
        className="create-team-card"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING_LAYOUT, delay: 0.09 }}
        onClick={openBuilder}
        data-testid="open-team-builder"
      >
        <span className="create-team-icon">
          <MessageSquarePlus size={16} />
        </span>
        <span>
          <strong>跟 AI 聊出一支新团队</strong>
          <small>你说一下要做什么样的活，AI 帮你把成员组齐</small>
        </span>
        <Pill tone="info">
          <Sparkles size={10} />
          开始对话
        </Pill>
      </motion.button>
    </div>
  );
}

function BuilderMessage({
  from = "ai",
  testId,
  children
}: {
  from?: "ai" | "user";
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`builder-message builder-message--${from}`}
      data-testid={testId}
    >
      {from === "ai" ? (
        <span className="builder-avatar">
          <Sparkles size={13} />
        </span>
      ) : null}
      <div>{children}</div>
    </div>
  );
}

function ProposalMember({
  name,
  slug,
  duty,
  primary = false
}: {
  name: string;
  slug: string;
  duty: string;
  primary?: boolean;
}) {
  return (
    <div className="proposal-member">
      <span className="proposal-member__avatar">
        {primary ? <Users size={14} /> : <Bot size={14} />}
      </span>
      <div>
        <strong>
          {name}
          {primary ? <small>主 Agent</small> : null}
          <code>@{slug}</code>
        </strong>
        <p>{duty}</p>
      </div>
    </div>
  );
}

/* ---------- 第 3 步 · 团队接力（迷你会话时间线） ---------- */

/*
 * 节拍编排：每个 beat 先出现「正在输入」气泡（beUI Loader dots 适配版），
 * 角色表头的接力棒下划线用 beUI shared-layout（layoutId）技法提前滑到
 * 即将发言的成员列，随后消息弹入、相邻节点间的 S 形连接线描画到位。
 * 减少动态效果：跳过打字气泡与描画，逐条淡入，信息等价。
 */
const BEAT_FIRST_MS = 420;
const BEAT_STEP_MS = 1700;
const BEAT_TYPING_MS = 640;

function RelayStep({
  team,
  run,
  onReplay
}: {
  team: TeamChoice;
  run: number;
  onReplay: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [beatIndex, setBeatIndex] = useState(-1);
  const [typingIndex, setTypingIndex] = useState(-1);
  const timelineRef = useRef<HTMLDivElement>(null);
  const members = useMemo(() => membersForTeam(team), [team]);
  const relayBeats = useMemo(() => relayBeatsForTeam(team), [team]);

  useEffect(() => {
    const timers = relayBeats.flatMap((_, index) => {
      if (reduceMotion) {
        return [
          window.setTimeout(() => setBeatIndex(index), 250 + index * 900)
        ];
      }
      const start = BEAT_FIRST_MS + index * BEAT_STEP_MS;
      return [
        window.setTimeout(() => setTypingIndex(index), start),
        window.setTimeout(() => {
          setTypingIndex(-1);
          setBeatIndex(index);
        }, start + BEAT_TYPING_MS)
      ];
    });
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [reduceMotion, relayBeats, run]);

  useEffect(() => {
    const current = timelineRef.current?.querySelector(".relay-msg.is-current");
    current?.scrollIntoView({
      block: "end",
      behavior: reduceMotion ? "auto" : "smooth"
    });
  }, [beatIndex, reduceMotion]);

  const holder =
    typingIndex >= 0
      ? relayBeats[typingIndex].member
      : beatIndex >= 0
        ? relayBeats[beatIndex].member
        : -1;
  const graphWidth = members.length * 100;
  const relayStyle = {
    "--graph-width": `calc(var(--graph-column-width) * ${members.length})`
  } as CSSProperties;
  const roleColumnsStyle = {
    gridTemplateColumns: `repeat(${members.length}, var(--graph-column-width))`
  };

  return (
    <div className="relay-card" style={relayStyle}>
      <div className="relay-topline">
        <div>
          <span className="live-indicator">
            <span />
            接力演示
          </span>
          <strong>{team.name}</strong>
        </div>
        <button
          type="button"
          className="replay-action"
          onClick={onReplay}
          data-testid="replay-relay"
        >
          <RotateCcw size={13} />
          重新播放
        </button>
      </div>

      <div className="relay-grid-heading">
        <div
          className="relay-role-columns"
          style={roleColumnsStyle}
          aria-label="团队成员"
        >
          {members.map(({ name, initial }, index) => (
            <span className={index === holder ? "is-holder" : ""} key={name}>
              <b aria-hidden>{initial}</b>
              <small>{name}</small>
              {index === holder ? (
                reduceMotion ? (
                  <i className="relay-holder-glide" aria-hidden />
                ) : (
                  /*
                   * 接力棒下划线：layoutId 共享布局滑行，
                   * 技法改编自 beUI shared-layout-bg
                   * https://beui.dev/components/motion/shared-layout-bg
                   */
                  <motion.i
                    className="relay-holder-glide"
                    layoutId="relay-holder-glide"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={SPRING_LAYOUT}
                    aria-hidden
                  />
                )
              ) : null}
            </span>
          ))}
        </div>
        <span>对话记录</span>
      </div>

      <div className="relay-timeline" ref={timelineRef}>
        <ol
          className="relay-history"
          aria-label="协作记录"
          aria-live="polite"
          data-testid="relay-stage"
        >
          {/*
           * popLayout：退出中的「正在输入」气泡立即脱离布局流，
           * 不与新消息同时占位，避免高度先撑开再塌回的闪烁。
           */}
          <AnimatePresence initial={false} mode="popLayout">
            {relayBeats.slice(0, beatIndex + 1).map((beat, index) => {
              const member = members[beat.member];
              const previousMember =
                index > 0 ? relayBeats[index - 1].member : null;
              const isCurrent = index === beatIndex;
              const isComplete = index < beatIndex;
              const isLast = index === relayBeats.length - 1;
              const graphStyle = {
                "--role-index": beat.member
              } as CSSProperties;
              const nodeX = (beat.member + 0.5) * 100;
              const previousX =
                previousMember === null ? nodeX : (previousMember + 0.5) * 100;
              return (
                <motion.li
                  className={[
                    "relay-msg",
                    isCurrent ? "is-current" : "",
                    isComplete ? "is-complete" : "",
                    isCurrent && isLast ? "is-last" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={`${run}-${index}`}
                  data-member={member.name}
                  data-testid="relay-beat"
                  initial={
                    reduceMotion
                      ? { opacity: 0 }
                      : { opacity: 0, y: 12, filter: "blur(4px)" }
                  }
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={
                    reduceMotion
                      ? { duration: 0.12 }
                      : { ...SPRING_LAYOUT, filter: { duration: 0.3 } }
                  }
                >
                  <div
                    className="relay-graph-cell"
                    style={graphStyle}
                    aria-label={
                      previousMember === null
                        ? `${member.name}开始处理`
                        : `${members[previousMember].name}交给${member.name}`
                    }
                  >
                    {previousMember !== null ? (
                      <svg
                        className="relay-graph-svg"
                        viewBox={`0 0 ${graphWidth} 31`}
                        preserveAspectRatio="none"
                        aria-hidden
                      >
                        <motion.path
                          className="relay-graph-connector"
                          d={`M ${previousX} 0 C ${previousX} 20 ${nodeX} 11 ${nodeX} 31`}
                          initial={reduceMotion ? false : { pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={
                            reduceMotion
                              ? { duration: 0.12 }
                              : { duration: 0.5, ease: EASE_OUT, delay: 0.1 }
                          }
                        />
                      </svg>
                    ) : null}
                    <motion.span
                      className={[
                        "relay-graph-node",
                        isCurrent ? "is-current" : "",
                        isComplete ? "is-complete" : ""
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      initial={
                        reduceMotion
                          ? { opacity: 0 }
                          : { opacity: 0, scale: 0.3 }
                      }
                      animate={{ opacity: 1, scale: 1 }}
                      transition={
                        reduceMotion
                          ? { duration: 0.12 }
                          : { ...SPRING_PRESS, delay: 0.32 }
                      }
                      aria-hidden
                    />
                    {index < beatIndex ? (
                      <span className="relay-graph-tail" aria-hidden />
                    ) : null}
                  </div>
                  <div className="relay-msg__body">
                    <div className="relay-msg__head">
                      <strong>{member.name}</strong>
                      <small>第 {index + 1} 棒</small>
                      {isCurrent ? (
                        <Pill tone="amber">
                          {isLast ? "收尾" : "处理中"}
                        </Pill>
                      ) : null}
                    </div>
                    <p className="relay-msg__text">{beat.body}</p>
                  </div>
                </motion.li>
              );
            })}
            {typingIndex >= 0 && typingIndex > beatIndex ? (
              <motion.li
                className="relay-typing"
                key={`typing-${run}-${typingIndex}`}
                initial={
                  reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }
                }
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
                transition={
                  reduceMotion ? { duration: 0.12 } : SPRING_LAYOUT
                }
                aria-hidden
              >
                <div className="relay-graph-cell" />
                <div className="relay-typing__bubble">
                  <span className="relay-typing__avatar">
                    {members[relayBeats[typingIndex].member].initial}
                  </span>
                  <LoaderDots size={14} />
                </div>
              </motion.li>
            ) : null}
          </AnimatePresence>
        </ol>
      </div>

      <div className="relay-caption">
        <Users size={12} />
        {beatIndex === relayBeats.length - 1
          ? "这支团队已带着复核证据完成接力。"
          : "动画不会拦住你；看懂后可以随时继续。"}
      </div>
    </div>
  );
}

/* ---------- 第 4 步 · 准备就绪 ---------- */

function ReadyStep() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="ready-state">
      <motion.div
        className="ready-mark"
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.82 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={reduceMotion ? { duration: 0.12 } : SPRING_LAYOUT}
      >
        <Check size={38} />
      </motion.div>
    </div>
  );
}

/* ---------- 去向：新建对话 ---------- */

interface ConversationDestinationProps {
  team: TeamChoice;
  titleRef: React.RefObject<HTMLHeadingElement>;
  onRestart: () => void;
}

function ConversationDestination({
  team,
  titleRef,
  onRestart
}: ConversationDestinationProps) {
  const reduceMotion = useReducedMotion();
  const members = membersForTeam(team);

  return (
    <motion.main
      className="conversation-shell"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0.12 : 0.32, ease: EASE_OUT }}
      data-testid="conversation-destination"
    >
      <PrototypeChrome />

      <div className="conversation-layout">
        <aside className="conversation-sidebar">
          <div className="sidebar-action is-active">
            <MessageSquarePlus size={16} />
            <span>新对话</span>
          </div>
          <div className="sidebar-action">
            <Users size={16} />
            <span>Agent 团队</span>
          </div>
          <div className="sidebar-section">
            <span>项目</span>
            <small>还没有项目</small>
          </div>
          <button type="button" className="restart-link" onClick={onRestart}>
            重新查看引导
          </button>
        </aside>

        <section className="conversation-main">
          <div className="conversation-heading">
            <Pill tone="success">
              <Check size={12} />
              引导完成
            </Pill>
            <h1 ref={titleRef} tabIndex={-1}>
              新对话
            </h1>
            <p>描述你的目标，团队会从这里开始推进。</p>
          </div>

          <div className="conversation-composer">
            <div className="composer-context">
              <button type="button" className="context-chip context-chip--empty">
                <FolderPlus size={13} />
                选择项目
                <ChevronDown size={12} />
              </button>
              <button
                type="button"
                className="context-chip"
                data-testid="selected-team"
              >
                <Users size={13} />
                {team.name}
                <ChevronDown size={12} />
              </button>
            </div>
            <div className="composer-input">
              <span>描述你的目标…</span>
              <button type="button" aria-label="发送" disabled>
                <Send size={15} />
              </button>
            </div>
            <p>选择一个项目后才能发送</p>
          </div>
        </section>

        <aside className="conversation-inspector">
          <span>开始前</span>
          <div>
            <strong>{team.name}</strong>
            <p>{team.primaryAgent}会先理解目标，再决定由谁接棒。</p>
          </div>
          <div className="inspector-member-row">
            {members.map(({ name, initial }) => (
              <span key={name} title={name}>
                {initial}
              </span>
            ))}
          </div>
        </aside>
      </div>
    </motion.main>
  );
}

/* ---------- 回看入口：确定性主页面 fixture ---------- */

function ReplayMainFixture({
  team,
  titleRef,
  onEnterReplay
}: {
  team: TeamChoice;
  titleRef: React.RefObject<HTMLHeadingElement>;
  onEnterReplay: () => void;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.main
      className="conversation-shell"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0.12 : 0.32, ease: EASE_OUT }}
      data-testid="replay-main-fixture"
    >
      <PrototypeChrome mode="main" />

      <div className="conversation-layout">
        <aside className="conversation-sidebar">
          <div className="sidebar-action">
            <MessageSquarePlus size={16} />
            <span>新对话</span>
          </div>
          <div className="sidebar-section">
            <span>项目</span>
            <small data-testid="replay-project">Moebius Desktop</small>
          </div>
          <div className="sidebar-action is-active" data-testid="replay-conversation">
            <Bot size={16} />
            <span>整理发布计划</span>
          </div>
          <button
            type="button"
            className="restart-link"
            onClick={onEnterReplay}
          >
            重新查看引导
          </button>
        </aside>

        <section className="conversation-main">
          <div className="conversation-heading">
            <h1 ref={titleRef} tabIndex={-1}>
              整理发布计划
            </h1>
            <p>项目与对话保持在进入回看前的状态。</p>
          </div>

          <div className="conversation-composer">
            <div className="composer-context">
              <span className="context-chip">Moebius Desktop</span>
              <span className="context-chip" data-testid="replay-team">
                <Users size={13} />
                {team.name}
              </span>
            </div>
            <textarea
              className="replay-draft"
              value="把本周发布清单拆成可验收任务"
              aria-label="未提交草稿"
              data-testid="replay-draft"
              readOnly
            />
            <p>未提交草稿</p>
          </div>
        </section>

        <aside className="conversation-inspector">
          <span>当前上下文</span>
          <div>
            <strong>Moebius Desktop</strong>
            <p>整理发布计划 · {team.name}</p>
          </div>
        </aside>
      </div>
    </motion.main>
  );
}

/* ---------- 原型评审浮动控制（不属于产品界面） ---------- */

interface ReviewControlsProps {
  open: boolean;
  theme: "dark" | "light";
  onToggleOpen: () => void;
  onThemeChange: (theme: "dark" | "light") => void;
  onScenarioChange: (
    environment: EnvironmentState,
    mode?: OnboardingMode
  ) => void;
}

function ReviewControls({
  open,
  theme,
  onToggleOpen,
  onThemeChange,
  onScenarioChange
}: ReviewControlsProps) {
  return (
    <div className="review-controls">
      <AnimatePresence>
        {open ? (
          <motion.div
            className="review-panel"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={SPRING_LAYOUT}
            role="dialog"
            aria-label="原型评审场景"
          >
            <div className="review-panel__head">
              <strong>原型场景</strong>
              <span>不属于产品界面</span>
            </div>
            <div className="review-panel__row">
              <button type="button" onClick={() => onScenarioChange("ready")}>
                正常路径
              </button>
              <button type="button" onClick={() => onScenarioChange("missing")}>
                缺少 codex
              </button>
              <button type="button" onClick={() => onScenarioChange("unavailable")}>
                codex 不可运行
              </button>
              <button
                type="button"
                onClick={() => onScenarioChange("ready", "replay")}
              >
                回看引导
              </button>
            </div>
            <div className="review-panel__row">
              <button
                type="button"
                onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
                切换为{theme === "dark" ? "亮色" : "暗色"}
              </button>
            </div>
            <p>减少动态效果请使用系统辅助功能设置。</p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <button
        type="button"
        className="review-trigger"
        onClick={onToggleOpen}
        aria-expanded={open}
        aria-label="打开原型评审场景"
      >
        <SlidersHorizontal size={14} />
        <span>原型场景</span>
      </button>
    </div>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing onboarding prototype root.");
}

createRoot(root).render(<App />);
