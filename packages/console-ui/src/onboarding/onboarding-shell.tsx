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
import { useI18n, type Translate } from "@/i18n";
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
  const { t } = useI18n();
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
  const compatibility = getOnboardingTeamCompatibility(selectedTeam, environment, t);
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
        aria-label={t("onboarding.windowTitle")}
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
            <span>{t("onboarding.replay")}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={t("onboarding.exitReplay")}
              title={t("onboarding.exitReplay")}
              onClick={onExit}
            >
              {t("onboarding.exit")}
            </Button>
          </span>
        ) : (
          <span className="justify-self-end text-xs tabular-nums text-hint">
            {t("onboarding.firstRun")}
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
              {t("onboarding.progress", { step: state.step })}
            </p>
            <h1
              ref={titleRef}
              className="mt-2 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink outline-none"
              tabIndex={-1}
            >
              {stepTitle(t, state.step, compatibility.affectedCount)}
            </h1>
            <p className="mt-2 text-[13px] leading-5 text-sub">
              {stepSubtitle(t, state.step, compatibility)}
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
                    ? t("onboarding.builderContext")
                    : t("onboarding.builderContextCli", {
                        cli: (teamBuilderState.builderCli ?? builderCli) === "codex"
                          ? "Codex"
                          : "Kimi",
                      })}
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
                {t("onboarding.saveProgressFailed")}
              </p>
            ) : null}
          </div>
        </div>
      </section>
      {state.teamBuilderOpen ? null : (
        <OnboardingFooter
          primaryLabel={state.step === 4
            ? completionState === "saving"
              ? mode === "replay" ? t("onboarding.savingReturn") : t("onboarding.savingEnter")
              : t("onboarding.startUsing")
            : t("onboarding.continue")}
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
              {t("onboarding.previous")}
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
              {t("onboarding.recheck")}
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
  const { t } = useI18n();
  return (
    <section
      className="overflow-hidden rounded-xl border border-line bg-card"
      aria-label={t("onboarding.environmentLabel")}
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
        <p>{t("onboarding.environmentMinimum")}</p>
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
  const { t } = useI18n();
  const name = cli === "codex" ? "Codex CLI" : "Kimi CLI";
  const installing = installation.status === "running";
  const recoverableInstall = installation.status === "failed"
    || installation.status === "cancelled"
    || installation.status === "timed-out";
  const visual = getCliVisual(t, cli, readiness, installation);
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
              {t("onboarding.cliAvailable")}
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
              aria-label={t("onboarding.installCli", { cli: name })}
              title={t("onboarding.installCli", { cli: name })}
              onClick={() => void onInstall(cli)}
            >
              <Play className="h-3 w-3" strokeWidth={1.7} aria-hidden="true" />
            </Button>
          </span>
        ) : null}
        {installing ? (
          <span className="mt-2 flex items-center justify-between gap-3 text-xs text-sub">
            <span>{t("onboarding.keepOpen")}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={t("onboarding.cancelInstall", { cli: name })}
              onClick={() => void onCancel(cli)}
            >
              <Square className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
              {t("onboarding.cancel")}
            </Button>
          </span>
        ) : null}
        {recoverableInstall ? (
          <Button
            className="mt-2"
            type="button"
            size="sm"
            variant="outline"
            aria-label={t("onboarding.retryInstall", { cli: name })}
            onClick={() => void onInstall(cli)}
          >
            <RefreshCw className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
            {t("onboarding.retryInstall", { cli: name })}
          </Button>
        ) : null}
      </span>
    </div>
  );
}

function getCliVisual(
  t: Translate,
  cli: OnboardingCli,
  readiness: OnboardingEnvironmentState[OnboardingCli],
  installation: OnboardingCliInstallation,
): { icon: ReactNode; tone: "pass" | "danger" | "neutral"; title: string; detail: string } {
  const name = cli === "codex" ? "Codex CLI" : "Kimi CLI";
  if (installation.status === "running") {
    return {
      icon: <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" strokeWidth={1.6} aria-hidden="true" />,
      tone: "neutral",
      title: t("onboarding.installingTitle", { cli: name }),
      detail: installStageCopy(t, installation.stage),
    };
  }
  if (installation.status === "failed" || installation.status === "cancelled" || installation.status === "timed-out") {
    return {
      icon: <X className="h-4 w-4" strokeWidth={1.6} aria-hidden="true" />,
      tone: "danger",
      title: installation.status === "cancelled"
        ? t("onboarding.installCancelledTitle", { cli: name })
        : installation.status === "timed-out"
          ? t("onboarding.installTimedOutTitle", { cli: name })
          : t("onboarding.installFailedTitle", { cli: name }),
      detail: t("onboarding.installStoppedDetail"),
    };
  }
  switch (readiness.status) {
    case "ready":
      return {
        icon: <Check className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />,
        tone: "pass",
        title: t("onboarding.cliReadyTitle", { cli: name }),
        detail: readiness.version ?? t("onboarding.cliReadyDetail"),
      };
    case "checking":
      return {
        icon: <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" strokeWidth={1.6} aria-hidden="true" />,
        tone: readiness.lastKnownReady === true ? "pass" : "neutral",
        title: t("onboarding.cliCheckingTitle", { cli: name }),
        detail: readiness.lastKnownReady === true
          ? t("onboarding.cliRecheckingDetail")
          : t("onboarding.cliCheckingDetail"),
      };
    case "missing":
      return {
        icon: <X className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />,
        tone: "danger",
        title: t("onboarding.cliMissingTitle", { cli: name }),
        detail: t("onboarding.cliMissingDetail"),
      };
    case "needs-login":
      return {
        icon: <Terminal className="h-4 w-4" strokeWidth={1.6} aria-hidden="true" />,
        tone: "neutral",
        title: t("onboarding.cliNeedsLoginTitle", { cli: name }),
        detail: cli === "codex"
          ? t("onboarding.codexLoginDetail")
          : t("onboarding.kimiLoginDetail"),
      };
    case "unavailable":
      return {
        icon: <CircleAlert className="h-4 w-4" strokeWidth={1.6} aria-hidden="true" />,
        tone: "neutral",
        title: t("onboarding.cliUnavailableTitle", { cli: name }),
        detail: t("onboarding.cliUnavailableDetail"),
      };
  }
}

function installStageCopy(t: Translate, stage: OnboardingCliInstallation["stage"]): string {
  switch (stage) {
    case "starting":
      return t("onboarding.installStarting");
    case "downloading":
      return t("onboarding.installDownloading");
    case "installing":
      return t("onboarding.installWriting");
    case "verifying":
      return t("onboarding.installVerifying");
    default:
      return t("onboarding.installInProgress");
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
  const { t } = useI18n();
  if (teamsState.status === "loading") {
    return (
      <div className="flex min-h-32 items-center justify-center rounded-xl border border-line bg-card" role="status">
        <LoaderCircle className="h-5 w-5 animate-spin text-sub" strokeWidth={1.5} aria-hidden="true" />
        <span className="ml-2 text-sm text-sub">{t("onboarding.teamsLoading")}</span>
      </div>
    );
  }
  if (teamsState.status !== "ready") {
    return (
      <div className="rounded-xl border border-line bg-card p-5 text-center">
        <p className="text-sm text-sub">{t("onboarding.teamsUnavailable")}</p>
        {onRetry ? (
          <Button className="mt-4" type="button" variant="outline" onClick={() => void onRetry()}>
            {t("onboarding.teamsReload")}
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
          <strong className="block text-sm font-semibold text-ink">{t("onboarding.buildTeam")}</strong>
          <small className="mt-0.5 block text-xs leading-5 text-sub">
            {builderCli === null
              ? t("onboarding.buildTeamWaiting")
              : t("onboarding.buildTeamWithCli", {
                  cli: builderCli === "codex" ? "Codex" : "Kimi",
                })}
          </small>
        </span>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--status-info-bg)] px-2.5 py-1 text-xs font-medium text-[var(--status-info-fg)]">
          <Sparkles className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
          {t("onboarding.startConversation")}
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
  const { t } = useI18n();
  const membersBySlug = new Map(team.members.map((member) => [member.slug, member]));
  const orderedMembers = team.memberOrder
    .map((slug) => membersBySlug.get(slug))
    .filter((member): member is NonNullable<typeof member> => member !== undefined)
    .slice(0, 3);
  const compatibility = getOnboardingTeamCompatibility(team, environment, t);
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
              {team.name ?? t("onboarding.unnamedTeam")}
            </strong>
            <small className="mt-0.5 block text-xs text-sub">
              {team.ownership === "system"
                ? t("onboarding.builtInTeam")
                : t("onboarding.myTeam")}
            </small>
          </span>
        </span>
        {selected ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-sunken px-2.5 py-1 text-xs font-medium text-sub">
            <Check className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
            {t("onboarding.selected")}
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
                  {member.slug === team.primaryAgentSlug
                    ? t("onboarding.primaryAgent")
                    : member.description}
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
          <span>{t("onboarding.adjustTeamLater", {
            compatibility: compatibilityCopy(t, compatibility),
          })}</span>
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
  const { t } = useI18n();
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
          {t("onboarding.readyCompatibility")}
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
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const running = runningOnboardingInstallations(installations);
  if (running.length === 0) {
    return <span aria-hidden="true" />;
  }
  const label = running.length === 1
    ? t("onboarding.installingOne", {
        cli: running[0]!.cli === "codex" ? "Codex" : "Kimi",
      })
    : t("onboarding.installingMany", { count: running.length });
  return (
    <span className="window-no-drag relative justify-self-start text-xs text-sub">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-expanded={open}
        aria-label={t("onboarding.installDetailsAction", { label })}
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
          aria-label={t("onboarding.installDetails")}
          data-testid="install-details"
        >
          <span className="flex items-center justify-between">
            <strong className="text-xs font-semibold text-ink">{t("onboarding.installation")}</strong>
            <small className="text-xs text-hint">
              {t("onboarding.itemsInProgress", { count: running.length })}
            </small>
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
                    {installStageCopy(t, installation.stage)}
                  </small>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={t("onboarding.cancelInstall", { cli: name })}
                  onClick={() => void onCancel(installation.cli)}
                >
                  {t("onboarding.cancel")}
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
  const { t } = useI18n();
  return (
    <footer
      className="shrink-0 border-t border-line bg-canvas px-6 py-3.5 max-sm:px-4"
      data-testid="onboarding-footer"
    >
      <nav
        className="mx-auto flex w-full max-w-[780px] items-center justify-end gap-2"
        aria-label={t("onboarding.actions")}
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

function stepTitle(t: Translate, step: OnboardingStep, affectedMembers: number): string {
  switch (step) {
    case 1:
      return t("onboarding.step1Title");
    case 2:
      return t("onboarding.step2Title");
    case 3:
      return t("onboarding.step3Title");
    case 4:
      return affectedMembers > 0
        ? t("onboarding.step4PartialTitle")
        : t("onboarding.step4ReadyTitle");
  }
}

function stepSubtitle(
  t: Translate,
  step: OnboardingStep,
  compatibility: ReturnType<typeof getOnboardingTeamCompatibility>,
): string {
  switch (step) {
    case 1:
      return t("onboarding.step1Subtitle");
    case 2:
      return t("onboarding.step2Subtitle");
    case 3:
      return t("onboarding.step3Subtitle");
    case 4:
      return compatibility.affectedCount > 0
        ? compatibilityCopy(t, compatibility)
        : t("onboarding.step4ReadySubtitle");
  }
}

function compatibilityCopy(
  t: Translate,
  compatibility: ReturnType<typeof getOnboardingTeamCompatibility>,
): string {
  return t("onboarding.teamCompatibility", {
    count: compatibility.affectedCount,
    clis: compatibility.clis
      .map((cli) => cli === "codex" ? "Codex" : "Kimi")
      .join(" / "),
  });
}
