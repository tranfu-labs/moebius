import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  LoaderCircle,
  MessageSquarePlus,
  RefreshCw,
  Sparkles,
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
  reduceOnboardingShell,
  resolveDefaultOnboardingTeamKey,
  type OnboardingStep,
} from "./onboarding-state";
import { RelayDemo } from "./relay-demo/relay-demo";

export type OnboardingEnvironmentState =
  | { status: "checking" }
  | { status: "ready"; detail?: string }
  | { status: "error"; kind: "missing" | "unavailable" };

export type OnboardingMode = "first-run" | "replay";

export interface OnboardingShellProps {
  mode?: OnboardingMode;
  environment: OnboardingEnvironmentState;
  teamsState: OperatorAgentTeamsState;
  teamBuilderState: TeamBuilderViewState;
  createdTeamKey?: string | null;
  onRecheckCodex: () => void | Promise<void>;
  onCopyInstallCommand: () => void | Promise<void>;
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
  teamsState,
  teamBuilderState,
  createdTeamKey = null,
  onRecheckCodex,
  onCopyInstallCommand,
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
    environment.status === "ready",
    createOnboardingShellState,
  );
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const [completionState, setCompletionState] = useState<"idle" | "saving" | "error">("idle");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const copyResetTimerRef = useRef<number | null>(null);
  const usableTeams = useMemo(
    () => teamsState.status === "ready"
      ? teamsState.teams.filter((team) => team.canCreateConversation)
      : [],
    [teamsState],
  );
  const selectedTeam = usableTeams.find((team) => team.teamKey === state.selectedTeamKey) ?? null;

  useEffect(() => {
    titleRef.current?.focus();
  }, [state.step]);

  useEffect(() => {
    if (environment.status === "ready" && !state.environmentPassed) {
      dispatch({ type: "environment-passed" });
    }
  }, [environment.status, state.environmentPassed]);

  useEffect(() => () => {
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
  }, []);

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
    || (state.step === 1 && (environment.status !== "ready" || !state.environmentPassed))
    || (state.step >= 2 && selectedTeam === null);

  const copyInstallCommand = async () => {
    try {
      await onCopyInstallCommand();
      setCopyConfirmed(true);
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = window.setTimeout(() => {
        copyResetTimerRef.current = null;
        setCopyConfirmed(false);
      }, 1_600);
    } catch {
      setCopyConfirmed(false);
    }
  };

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
        <span aria-hidden="true" />
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
              {stepTitle(state.step)}
            </h1>
            <p className="mt-2 text-[13px] leading-5 text-sub">
              {stepSubtitle(state.step)}
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
                copyConfirmed={copyConfirmed}
                onCopy={() => void copyInstallCommand()}
              />
            ) : null}
            {state.step === 2 ? (
              state.teamBuilderOpen ? (
                <TeamBuilderView
                  state={teamBuilderState}
                  contextLabel="仍在第 2 步"
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
                  onSelect={(teamKey) => dispatch({ type: "select-team", teamKey })}
                  onRetry={onRetryTeams}
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
            {state.step === 4 ? <ReadyStep /> : null}
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
          ) : environment.status === "ready" ? null : (
            <Button
              type="button"
              size="lg"
              variant="outline"
              disabled={environment.status === "checking"}
              onClick={() => void onRecheckCodex()}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", environment.status === "checking" && "animate-spin")}
                strokeWidth={1.5}
                aria-hidden="true"
              />
              {environment.status === "checking" ? "正在检查" : "重新检查"}
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
  copyConfirmed,
  onCopy,
}: {
  environment: OnboardingEnvironmentState;
  copyConfirmed: boolean;
  onCopy: () => void;
}): JSX.Element {
  if (environment.status === "checking") {
    return (
      <div className="flex min-h-32 items-center justify-center rounded-xl border border-line bg-card" role="status">
        <LoaderCircle className="h-5 w-5 animate-spin text-sub" strokeWidth={1.5} aria-hidden="true" />
        <span className="ml-2 text-sm text-sub">正在检查 Codex…</span>
      </div>
    );
  }

  if (environment.status === "ready") {
    return (
      <section className="overflow-hidden rounded-xl border border-line bg-card" aria-label="Codex 环境检查">
        <EnvironmentStatusRow
          label="Codex 已安装"
          detail="已在这台电脑上找到"
        />
        <EnvironmentStatusRow
          label="Codex 可以运行"
          detail={environment.detail ?? "Agent 团队可以正常启动"}
        />
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-line bg-card p-5" aria-label="Codex 环境检查">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--status-danger-bg)] text-danger">
          <X className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-ink">
            {environment.kind === "missing" ? "未找到 Codex" : "Codex 暂时无法运行"}
          </h2>
          <p className="mt-1 text-xs leading-5 text-sub">
            {environment.kind === "missing"
              ? "在终端运行以下命令，然后重新检查。"
              : "请在终端运行 codex，完成登录或按终端提示修复后，再回来重新检查。"}
          </p>
        </div>
      </div>
      {environment.kind === "missing" ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-line bg-sunken py-2 pl-3 pr-2">
          <code className="truncate font-mono text-xs text-ink">brew install codex</code>
          <Button type="button" size="sm" variant="outline" onClick={onCopy}>
            {copyConfirmed ? (
              <Check className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
            )}
            {copyConfirmed ? "已复制" : "复制"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function EnvironmentStatusRow({
  label,
  detail,
}: {
  label: string;
  detail: string;
}): JSX.Element {
  return (
    <div className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-4 py-3.5 last:border-b-0">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--status-pass-bg)] text-pass">
        <Check className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <strong className="block text-sm font-semibold text-ink">{label}</strong>
        <small className="mt-0.5 block truncate text-xs text-sub">{detail}</small>
      </span>
      <span className="rounded-full border border-[var(--status-pass-line)] bg-[var(--status-pass-bg)] px-2.5 py-1 text-xs font-medium text-pass">
        通过
      </span>
    </div>
  );
}

function TeamSelectionStep({
  teamsState,
  selectedTeamKey,
  onSelect,
  onRetry,
  onOpenBuilder,
}: {
  teamsState: OperatorAgentTeamsState;
  selectedTeamKey: string | null;
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
            你说一下要做什么样的活，AI 帮你把成员组齐
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
  selected,
  onSelect,
}: {
  team: OperatorAgentTeam;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const membersBySlug = new Map(team.members.map((member) => [member.slug, member]));
  const orderedMembers = team.memberOrder
    .map((slug) => membersBySlug.get(slug))
    .filter((member): member is NonNullable<typeof member> => member !== undefined)
    .slice(0, 3);
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
    </button>
  );
}

function ReadyStep(): JSX.Element {
  return (
    <div className="flex flex-col items-center py-4 text-center">
      <span className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-[var(--status-pass-bg)] text-pass">
        <Check className="h-10 w-10" strokeWidth={1.5} aria-hidden="true" />
      </span>
    </div>
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

function stepSubtitle(step: OnboardingStep): string {
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
