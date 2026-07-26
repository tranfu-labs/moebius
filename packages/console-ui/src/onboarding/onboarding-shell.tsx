import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  LoaderCircle,
  MessageSquarePlus,
  Play,
  RefreshCw,
  Square,
  Sparkles,
  Terminal,
  Users,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  type OperatorAgentTeam,
  type OperatorAgentTeamsState,
} from "@/console/agent-teams-page";
import { MoebiusLogo } from "@/brand/moebius-logo";
import {
  TeamBuilderView,
  type TeamBuilderViewState,
} from "@/ai-team-builder/team-builder-view";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import {
  createOnboardingShellState,
  canContinueOnboardingEnvironment,
  chooseOnboardingBuilderCli,
  getOnboardingTeamCompatibility,
  isOnboardingCliReady,
  reduceOnboardingShell,
  resolveDefaultOnboardingTeamKey,
  runningOnboardingInstallations,
  type OnboardingCli,
  type OnboardingCliInstallation,
  type OnboardingEnvironmentState,
  type OnboardingInstallationState,
  type OnboardingStep,
} from "./onboarding-state";
import { RelayDemo } from "./relay-demo/relay-demo";

export type OnboardingMode = "first-run" | "replay";

export interface OnboardingShellProps {
  mode?: OnboardingMode;
  environment: OnboardingEnvironmentState;
  installations: OnboardingInstallationState;
  teamsState: OperatorAgentTeamsState;
  teamBuilderState: TeamBuilderViewState;
  createdTeamKey?: string | null;
  onRecheckEnvironment: () => void | Promise<void>;
  onInstallCli: (cli: OnboardingCli) => void | Promise<void>;
  onCancelCliInstallation: (cli: OnboardingCli) => void | Promise<void>;
  onRetryTeams?: () => void | Promise<void>;
  onOpenTeamBuilder: () => void | Promise<void>;
  onTeamBuilderSubmit: (text: string) => void | Promise<void>;
  onTeamBuilderAdjust: (text: string) => void | Promise<void>;
  onTeamBuilderRetry: () => void | Promise<void>;
  onTeamBuilderCommit: (revision: number) => void | Promise<void>;
  onCreatedTeamConsumed?: () => void;
  onExit?: () => void;
  onComplete: (teamKey: string) => void | Promise<void>;
}

export function OnboardingShell({
  mode = "first-run",
  environment,
  installations,
  teamsState,
  teamBuilderState,
  createdTeamKey = null,
  onRecheckEnvironment,
  onInstallCli,
  onCancelCliInstallation,
  onRetryTeams,
  onOpenTeamBuilder,
  onTeamBuilderSubmit,
  onTeamBuilderAdjust,
  onTeamBuilderRetry,
  onTeamBuilderCommit,
  onCreatedTeamConsumed,
  onExit,
  onComplete,
}: OnboardingShellProps): JSX.Element {
  const [state, dispatch] = useReducer(
    reduceOnboardingShell,
    canContinueOnboardingEnvironment(environment),
    createOnboardingShellState,
  );
  const [completionState, setCompletionState] = useState<"idle" | "saving" | "error">("idle");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const usableTeams = useMemo(
    () => teamsState.status === "ready"
      ? teamsState.teams.filter((team) => team.canCreateConversation)
      : [],
    [teamsState],
  );
  const selectedTeam = usableTeams.find((team) => team.teamKey === state.selectedTeamKey) ?? null;
  const compatibility = getOnboardingTeamCompatibility(selectedTeam, environment);
  const builderCli = chooseOnboardingBuilderCli(environment);

  useEffect(() => {
    titleRef.current?.focus();
  }, [state.step]);

  useEffect(() => {
    if (canContinueOnboardingEnvironment(environment) && !state.environmentPassed) {
      dispatch({ type: "environment-passed" });
    }
  }, [environment, state.environmentPassed]);

  useEffect(() => {
    if (state.selectedTeamKey !== null || usableTeams.length === 0) {
      return;
    }
    const defaultTeamKey = resolveDefaultOnboardingTeamKey(usableTeams);
    if (defaultTeamKey !== null) {
      dispatch({ type: "select-team", teamKey: defaultTeamKey });
    }
  }, [state.selectedTeamKey, usableTeams]);

  useEffect(() => {
    if (
      createdTeamKey === null
      || !usableTeams.some((team) => team.teamKey === createdTeamKey)
    ) {
      return;
    }
    dispatch({ type: "select-team", teamKey: createdTeamKey });
    dispatch({ type: "close-team-builder" });
    onCreatedTeamConsumed?.();
  }, [createdTeamKey, onCreatedTeamConsumed, usableTeams]);

  const primaryDisabled = state.teamBuilderOpen
    || completionState === "saving"
    || (state.step === 1 && !canContinueOnboardingEnvironment(environment))
    || (state.step >= 2 && selectedTeam === null);

  const advance = async () => {
    if (primaryDisabled) {
      return;
    }
    if (state.step !== 4) {
      dispatch({ type: "next" });
      return;
    }
    if (selectedTeam === null) {
      return;
    }
    setCompletionState("saving");
    try {
      await onComplete(selectedTeam.teamKey);
    } catch {
      setCompletionState("error");
    }
  };

  return (
    <main
      className="flex h-screen min-h-[560px] flex-col overflow-hidden bg-canvas text-ink"
      data-testid={`onboarding-step-${String(state.step)}`}
      data-onboarding-mode={mode}
    >
      <header
        className="window-drag-region grid h-[var(--window-header-height)] shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-line px-4"
        aria-label="应用标题栏"
      >
        <InstallationAggregate
          installations={installations}
          onCancel={onCancelCliInstallation}
        />
        <span className="flex items-center gap-2 text-xs font-semibold text-sub">
          <MoebiusLogo className="h-6 w-6" decorative />
          Moebius
        </span>
        {mode === "replay" ? (
          <span className="window-no-drag flex items-center justify-self-end gap-1 text-xs text-hint">
            <span>回看引导</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="退出引导回看"
              title="退出引导回看"
              onClick={onExit}
            >
              退出
            </Button>
          </span>
        ) : (
          <span className="justify-self-end text-xs tabular-nums text-hint">
            首次启动
          </span>
        )}
      </header>

      <section
        className={cn(
          "flex min-h-0 flex-1 justify-center overflow-y-auto px-6 max-sm:px-4",
          state.step === 3 ? "py-4 max-sm:py-5" : "py-10 max-sm:py-7",
        )}
        data-testid="onboarding-stage"
      >
        <div
          className={cn(
            "flex w-full max-w-[780px] flex-col",
            state.step === 3
              ? "justify-start"
              : "justify-center",
          )}
          data-testid="onboarding-layout-frame"
        >
          <header className="mx-auto w-full max-w-lg text-center">
            <p className="text-xs font-medium tabular-nums text-hint">
              第 {state.step} 步，共 4 步
            </p>
            <h1
              ref={titleRef}
              className="mt-2 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink outline-none"
              tabIndex={-1}
            >
              {stepTitle(state.step, compatibility.affectedCount)}
            </h1>
            <p className="mt-2 text-[13px] leading-5 text-sub">
              {stepSubtitle(state.step, compatibility)}
            </p>
          </header>

          <div
            className={cn(
              "w-full",
              state.step === 3 ? "mt-5" : "mt-7",
              state.step === 3 || state.teamBuilderOpen ? null : "mx-auto max-w-lg",
            )}
            data-testid="onboarding-content-column"
          >
            {state.step === 1 ? (
              <EnvironmentStep
                environment={environment}
                installations={installations}
                onInstall={onInstallCli}
                onCancel={onCancelCliInstallation}
              />
            ) : null}
            {state.step === 2 ? (
              state.teamBuilderOpen ? (
                <TeamBuilderView
                  state={teamBuilderState}
                  contextLabel={(teamBuilderState.builderCli ?? builderCli) === null
                    ? "仍在第 2 步"
                    : `使用 ${(teamBuilderState.builderCli ?? builderCli) === "codex" ? "Codex" : "Kimi"} CLI · 仍在第 2 步`}
                  onBack={() => dispatch({ type: "close-team-builder" })}
                  onSubmit={onTeamBuilderSubmit}
                  onAdjust={onTeamBuilderAdjust}
                  onRetry={onTeamBuilderRetry}
                  onCommit={onTeamBuilderCommit}
                />
              ) : (
                <TeamSelectionStep
                  teamsState={teamsState}
                  selectedTeamKey={state.selectedTeamKey}
                  environment={environment}
                  onSelect={(teamKey) => dispatch({ type: "select-team", teamKey })}
                  onRetry={onRetryTeams}
                  builderCli={builderCli}
                  onOpenBuilder={() => {
                    dispatch({ type: "open-team-builder" });
                    void onOpenTeamBuilder();
                  }}
                />
              )
            ) : null}
            {state.step === 3 ? (
              selectedTeam === null ? null : (
                <RelayDemo
                  relayRun={state.relayRun}
                  team={selectedTeam}
                  onReplay={() => dispatch({ type: "replay-relay" })}
                />
              )
            ) : null}
            {state.step === 4 ? <ReadyStep compatibility={compatibility} /> : null}
            {completionState === "error" ? (
              <p className="mt-4 text-center text-sm text-danger" role="alert">
                暂时无法保存引导进度，请重试。
              </p>
            ) : null}
          </div>
        </div>
      </section>
      {state.teamBuilderOpen ? null : (
        <OnboardingFooter
          primaryLabel={state.step === 4
            ? completionState === "saving"
              ? mode === "replay" ? "正在返回…" : "正在进入…"
              : "开始使用"
            : "继续"}
          primaryDisabled={primaryDisabled}
          secondary={state.step > 1 ? (
            <Button
              type="button"
              size="lg"
              variant="outline"
              disabled={completionState === "saving"}
              onClick={() => dispatch({ type: "back" })}
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              上一步
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={() => void onRecheckEnvironment()}
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5",
                  environment.codex.status === "checking"
                    && environment.kimi.status === "checking"
                    && "motion-safe:animate-spin",
                )}
                strokeWidth={1.5}
                aria-hidden="true"
              />
              重新检查
            </Button>
          )}
          onPrimary={() => void advance()}
        />
      )}
    </main>
  );
}

function EnvironmentStep({
  environment,
  installations,
  onInstall,
  onCancel,
}: {
  environment: OnboardingEnvironmentState;
  installations: OnboardingInstallationState;
  onInstall: (cli: OnboardingCli) => void | Promise<void>;
  onCancel: (cli: OnboardingCli) => void | Promise<void>;
}): JSX.Element {
  return (
    <section
      className="overflow-hidden rounded-xl border border-line bg-card"
      aria-label="CLI 环境检查"
      aria-live="polite"
    >
      {(["codex", "kimi"] as const).map((cli) => (
        <CliReadinessRow
          key={cli}
          cli={cli}
          readiness={environment[cli]}
          installation={installations[cli]}
          onInstall={onInstall}
          onCancel={onCancel}
        />
      ))}
      <div className="flex items-start gap-2 border-t border-line bg-sunken px-4 py-3 text-xs leading-5 text-sub">
        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
        <p>至少一个可用即可继续；未就绪的 CLI 只影响绑定它的团队成员。</p>
      </div>
    </section>
  );
}

function CliReadinessRow({
  cli,
  readiness,
  installation,
  onInstall,
  onCancel,
}: {
  cli: OnboardingCli;
  readiness: OnboardingEnvironmentState[OnboardingCli];
  installation: OnboardingCliInstallation;
  onInstall: (cli: OnboardingCli) => void | Promise<void>;
  onCancel: (cli: OnboardingCli) => void | Promise<void>;
}): JSX.Element {
  const name = cli === "codex" ? "Codex CLI" : "Kimi CLI";
  const installing = installation.status === "running";
  const recoverableInstall = installation.status === "failed"
    || installation.status === "cancelled"
    || installation.status === "timed-out";
  const visual = getCliVisual(cli, readiness, installation);
  return (
    <div
      className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 border-b border-line px-4 py-3.5"
      data-testid={`cli-${cli}-${installing ? "installing" : readiness.status}`}
    >
      <span className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full",
        visual.tone === "pass" && "bg-[var(--status-pass-bg)] text-pass",
        visual.tone === "danger" && "bg-[var(--status-danger-bg)] text-danger",
        visual.tone === "neutral" && "bg-sunken text-sub",
      )}>
        {visual.icon}
      </span>
      <span className="min-w-0">
        <span className="flex items-center justify-between gap-3">
          <strong className="block text-sm font-semibold text-ink">{visual.title}</strong>
          {isOnboardingCliReady(readiness) && !installing ? (
            <span className="rounded-full border border-[var(--status-pass-line)] bg-[var(--status-pass-bg)] px-2.5 py-1 text-xs font-medium text-pass">
              可用
            </span>
          ) : null}
        </span>
        <small className="mt-0.5 block text-xs leading-5 text-sub">{visual.detail}</small>
        {readiness.status === "missing" && !installing && !recoverableInstall ? (
          <span className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-sunken py-1.5 pl-2.5 pr-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">
              {cli === "codex"
                ? "npm install -g @openai/codex"
                : "curl -LsSf https://code.kimi.com/install.sh | bash"}
            </code>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-7 w-7 shrink-0"
              aria-label={`安装 ${name}`}
              title={`安装 ${name}`}
              onClick={() => void onInstall(cli)}
            >
              <Play className="h-3 w-3" strokeWidth={1.7} aria-hidden="true" />
            </Button>
          </span>
        ) : null}
        {installing ? (
          <span className="mt-2 flex items-center justify-between gap-3 text-xs text-sub">
            <span>请保持 Moebius 打开</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`取消安装 ${name}`}
              onClick={() => void onCancel(cli)}
            >
              <Square className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
              取消
            </Button>
          </span>
        ) : null}
        {recoverableInstall ? (
          <Button
            className="mt-2"
            type="button"
            size="sm"
            variant="outline"
            aria-label={`重试安装 ${name}`}
            onClick={() => void onInstall(cli)}
          >
            <RefreshCw className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
            重试安装
          </Button>
        ) : null}
      </span>
    </div>
  );
}

function getCliVisual(
  cli: OnboardingCli,
  readiness: OnboardingEnvironmentState[OnboardingCli],
  installation: OnboardingCliInstallation,
): { icon: ReactNode; tone: "pass" | "danger" | "neutral"; title: string; detail: string } {
  const name = cli === "codex" ? "Codex CLI" : "Kimi CLI";
  if (installation.status === "running") {
    return {
      icon: <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" strokeWidth={1.6} aria-hidden="true" />,
      tone: "neutral",
      title: `${name} 正在安装`,
      detail: installStageCopy(installation.stage),
    };
  }
  if (installation.status === "failed" || installation.status === "cancelled" || installation.status === "timed-out") {
    const ending = installation.status === "cancelled"
      ? "已取消"
      : installation.status === "timed-out" ? "已超时" : "未完成";
    return {
      icon: <X className="h-4 w-4" strokeWidth={1.6} aria-hidden="true" />,
      tone: "danger",
      title: `${name} 安装${ending}`,
      detail: "安装已安全停止，没有改变另一套 CLI；可以独立重试。",
    };
  }
  switch (readiness.status) {
    case "ready":
      return {
        icon: <Check className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />,
        tone: "pass",
        title: `${name} 可用`,
        detail: readiness.version ?? "已登录，可用于运行",
      };
    case "checking":
      return {
        icon: <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" strokeWidth={1.6} aria-hidden="true" />,
        tone: readiness.lastKnownReady === true ? "pass" : "neutral",
        title: `正在检查 ${name}`,
        detail: readiness.lastKnownReady === true
          ? "复检期间保留最近一次可用结果"
          : "正在确认版本、登录和真实模型能力",
      };
    case "missing":
      return {
        icon: <X className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />,
        tone: "danger",
        title: `${name} 未安装`,
        detail: "可选安装，不影响已就绪 CLI 的继续使用。",
      };
    case "needs-login":
      return {
        icon: <Terminal className="h-4 w-4" strokeWidth={1.6} aria-hidden="true" />,
        tone: "neutral",
        title: `${name} 已安装，需要登录`,
        detail: cli === "codex"
          ? "请在终端运行 codex 完成登录，修复后重新检查。"
          : "请在终端运行 kimi 并完成 /login，修复后重新检查。",
      };
    case "unavailable":
      return {
        icon: <CircleAlert className="h-4 w-4" strokeWidth={1.6} aria-hidden="true" />,
        tone: "neutral",
        title: `${name} 暂时无法验证`,
        detail: "暂时无法确认 Agent 可启动，请按终端提示修复后重新检查。",
      };
  }
}

function installStageCopy(stage: OnboardingCliInstallation["stage"]): string {
  switch (stage) {
    case "starting":
      return "正在启动受信任安装程序…";
    case "downloading":
      return "正在下载安装内容…";
    case "installing":
      return "正在写入并准备自动复检…";
    case "verifying":
      return "安装完成，正在自动复检登录与模型能力…";
    default:
      return "安装正在进行…";
  }
}

function TeamSelectionStep({
  teamsState,
  selectedTeamKey,
  environment,
  builderCli,
  onSelect,
  onRetry,
  onOpenBuilder,
}: {
  teamsState: OperatorAgentTeamsState;
  selectedTeamKey: string | null;
  environment: OnboardingEnvironmentState;
  builderCli: OnboardingCli | null;
  onSelect: (teamKey: string) => void;
  onRetry?: () => void | Promise<void>;
  onOpenBuilder: () => void;
}): JSX.Element {
  if (teamsState.status === "loading") {
    return (
      <div className="flex min-h-32 items-center justify-center rounded-xl border border-line bg-card" role="status">
        <LoaderCircle className="h-5 w-5 animate-spin text-sub" strokeWidth={1.5} aria-hidden="true" />
        <span className="ml-2 text-sm text-sub">正在载入团队…</span>
      </div>
    );
  }
  if (teamsState.status !== "ready") {
    return (
      <div className="rounded-xl border border-line bg-card p-5 text-center">
        <p className="text-sm text-sub">内置团队暂时不可用。</p>
        {onRetry ? (
          <Button className="mt-4" type="button" variant="outline" onClick={() => void onRetry()}>
            重新载入
          </Button>
        ) : null}
      </div>
    );
  }

  const teams = teamsState.teams.filter((team) => team.canCreateConversation);
  return (
    <div className="grid gap-3">
      {teams.map((team) => (
        <TeamChoiceCard
          key={team.teamKey}
          team={team}
          environment={environment}
          selected={team.teamKey === selectedTeamKey}
          onSelect={() => onSelect(team.teamKey)}
        />
      ))}
      <button
        type="button"
        className="flex w-full items-center gap-3 rounded-xl border border-dashed border-line-strong bg-card px-4 py-3 text-left transition-colors hover:bg-hover"
        onClick={onOpenBuilder}
        data-testid="open-onboarding-team-builder"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sunken text-sub">
          <MessageSquarePlus className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block text-sm font-semibold text-ink">跟 AI 聊出一支新团队</strong>
          <small className="mt-0.5 block text-xs leading-5 text-sub">
            你说一下要做什么样的活，
            {builderCli === null
              ? "环境就绪后 AI 帮你把成员组齐"
              : `AI 将使用 ${builderCli === "codex" ? "Codex" : "Kimi"} 帮你把成员组齐`}
          </small>
        </span>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--status-info-bg)] px-2.5 py-1 text-xs font-medium text-[var(--status-info-fg)]">
          <Sparkles className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
          开始对话
        </span>
      </button>
    </div>
  );
}

function TeamChoiceCard({
  team,
  environment,
  selected,
  onSelect,
}: {
  team: OperatorAgentTeam;
  environment: OnboardingEnvironmentState;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const membersBySlug = new Map(team.members.map((member) => [member.slug, member]));
  const orderedMembers = team.memberOrder
    .map((slug) => membersBySlug.get(slug))
    .filter((member): member is NonNullable<typeof member> => member !== undefined)
    .slice(0, 3);
  const compatibility = getOnboardingTeamCompatibility(team, environment);
  return (
    <button
      type="button"
      className={cn(
        "w-full rounded-xl border bg-card p-4 text-left transition-colors",
        selected ? "border-accent bg-sel" : "border-line hover:bg-hover",
      )}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="flex items-center justify-between gap-4">
        <span className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border",
              selected ? "border-accent" : "border-line-strong",
            )}
          >
            {selected ? <i className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" /> : null}
          </span>
          <span className="min-w-0">
            <strong className="block truncate text-sm font-semibold text-ink">
              {team.name ?? "未命名团队"}
            </strong>
            <small className="mt-0.5 block text-xs text-sub">
              {team.ownership === "system" ? "内置团队" : "我的团队"}
            </small>
          </span>
        </span>
        {selected ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-sunken px-2.5 py-1 text-xs font-medium text-sub">
            <Check className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
            已选择
          </span>
        ) : null}
      </span>
      {orderedMembers.length > 0 ? (
        <span className="mt-4 grid grid-cols-3 gap-2 pl-[30px] max-sm:grid-cols-1">
          {orderedMembers.map((member) => (
            <span className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-sunken px-2.5 py-2" key={member.slug}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-card text-xs font-semibold text-sub">
                {(member.displayName || member.slug).slice(0, 1)}
              </span>
              <span className="min-w-0">
                <strong className="block truncate text-xs font-semibold text-ink">
                  {member.displayName || `@${member.slug}`}
                </strong>
                <small className="block truncate text-[11px] text-hint">
                  {member.slug === team.primaryAgentSlug ? "主 Agent" : member.description}
                </small>
              </span>
            </span>
          ))}
        </span>
      ) : null}
      {team.description ? (
        <span className="mt-3 block pl-[30px] text-xs leading-5 text-sub">{team.description}</span>
      ) : null}
      {compatibility.affectedCount > 0 ? (
        <span
          className="mt-3 flex items-start gap-2 rounded-lg border border-line bg-sunken px-3 py-2 text-xs leading-5 text-sub"
          data-testid="team-compatibility-warning"
        >
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          <span>{compatibility.copy}；之后可在 Agent 团队页调整</span>
        </span>
      ) : null}
    </button>
  );
}

function ReadyStep({
  compatibility,
}: {
  compatibility: ReturnType<typeof getOnboardingTeamCompatibility>;
}): JSX.Element {
  const partial = compatibility.affectedCount > 0;
  return (
    <div className="flex flex-col items-center py-4 text-center">
      <span className={cn(
        "flex h-[88px] w-[88px] items-center justify-center rounded-full",
        partial ? "bg-sunken text-sub" : "bg-[var(--status-pass-bg)] text-pass",
      )}>
        {partial ? (
          <Users className="h-9 w-9" strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <Check className="h-10 w-10" strokeWidth={1.5} aria-hidden="true" />
        )}
      </span>
      {partial ? (
        <p className="mt-4 max-w-md text-sm leading-6 text-sub" data-testid="ready-compatibility">
          进入新对话后仍会保留这条兼容性提示，直到环境或团队配置恢复。
        </p>
      ) : null}
    </div>
  );
}

function InstallationAggregate({
  installations,
  onCancel,
}: {
  installations: OnboardingInstallationState;
  onCancel: (cli: OnboardingCli) => void | Promise<void>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const running = runningOnboardingInstallations(installations);
  if (running.length === 0) {
    return <span aria-hidden="true" />;
  }
  const label = running.length === 1
    ? `正在安装 ${running[0]!.cli === "codex" ? "Codex" : "Kimi"}…`
    : `${String(running.length)} 项 CLI 正在安装…`;
  return (
    <span className="window-no-drag relative justify-self-start text-xs text-sub">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-expanded={open}
        aria-label={`${label}，查看安装详情`}
        data-testid="install-aggregate"
        onClick={() => setOpen((current) => !current)}
      >
        <RefreshCw className="h-3 w-3 motion-safe:animate-spin" strokeWidth={1.5} aria-hidden="true" />
        {label}
      </Button>
      {open ? (
        <span
          className="absolute left-0 top-full z-20 mt-2 grid w-72 gap-2 rounded-lg border border-line bg-card p-3 shadow-lg"
          role="dialog"
          aria-label="CLI 安装详情"
          data-testid="install-details"
        >
          <span className="flex items-center justify-between">
            <strong className="text-xs font-semibold text-ink">CLI 安装</strong>
            <small className="text-xs text-hint">{running.length} 项进行中</small>
          </span>
          {running.map((installation) => {
            const name = installation.cli === "codex" ? "Codex CLI" : "Kimi CLI";
            return (
              <span
                className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2"
                key={installation.cli}
              >
                <LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin text-sub" strokeWidth={1.5} aria-hidden="true" />
                <span className="min-w-0">
                  <strong className="block text-xs font-medium text-ink">{name}</strong>
                  <small className="block truncate text-[11px] text-hint">
                    {installStageCopy(installation.stage)}
                  </small>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`取消安装 ${name}`}
                  onClick={() => void onCancel(installation.cli)}
                >
                  取消
                </Button>
              </span>
            );
          })}
        </span>
      ) : null}
    </span>
  );
}

function OnboardingFooter({
  primaryLabel,
  primaryDisabled,
  secondary,
  onPrimary,
}: {
  primaryLabel: string;
  primaryDisabled: boolean;
  secondary: ReactNode;
  onPrimary: () => void;
}): JSX.Element {
  return (
    <footer
      className="shrink-0 border-t border-line bg-canvas px-6 py-3.5 max-sm:px-4"
      data-testid="onboarding-footer"
    >
      <nav
        className="mx-auto flex w-full max-w-[780px] items-center justify-end gap-2"
        aria-label="引导步骤操作"
        data-testid="onboarding-actions"
      >
        {secondary}
        <Button type="button" size="lg" disabled={primaryDisabled} onClick={onPrimary}>
          {primaryLabel}
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </nav>
    </footer>
  );
}

function stepTitle(step: OnboardingStep, affectedMembers: number): string {
  switch (step) {
    case 1:
      return "环境准备";
    case 2:
      return "选择一支团队";
    case 3:
      return "看看团队如何完成一次接力";
    case 4:
      return affectedMembers > 0 ? "团队已选好" : "准备就绪";
  }
}

function stepSubtitle(
  step: OnboardingStep,
  compatibility: ReturnType<typeof getOnboardingTeamCompatibility>,
): string {
  switch (step) {
    case 1:
      return "Codex 或 Kimi 至少一个可用，就可以启动团队";
    case 2:
      return "先选一支最接近你当前工作的团队，之后随时可以切换";
    case 3:
      return "每一次交接都会留下过程、结论和复核证据";
    case 4:
      return compatibility.affectedCount > 0
        ? compatibility.copy
        : "团队已经就位，说出你的目标就能开工";
  }
}
