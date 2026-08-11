import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  LoaderCircle,
  MessageSquarePlus,
  Play,
  RefreshCw,
  Search,
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
import { getAgentTeamSelectionLabel } from "@/console/team-selection-label";
import { MoebiusLogo } from "@/brand/moebius-logo";
import {
  TeamBuilderView,
  type TeamBuilderViewState,
} from "@/ai-team-builder/team-builder-view";
import { cn } from "@/lib/utils";
import { useI18n, type Translate } from "@/i18n";
import { Button } from "@/ui/button";
import { ProviderSettingsPanel, type ProviderSettingsController } from "@/console/provider-settings-panel";
import {
  createOnboardingShellState,
  canContinueOnboardingEnvironment,
  chooseOnboardingBuilderCli,
  getOnboardingTeamCompatibility,
  isOnboardingCliReady,
  onboardingCliLabel,
  reduceOnboardingShell,
  resolveDefaultOnboardingTeamKey,
  runningOnboardingInstallations,
  type OnboardingCli,
  type OnboardingEngine,
  type OnboardingCliInstallation,
  type OnboardingEnvironmentState,
  type OnboardingInstallationState,
  type OnboardingStep,
} from "./onboarding-state";
import { RelayDemo } from "./relay-demo/relay-demo";
import { projectOnboardingTeamList } from "./onboarding-team-list-model";
import { NotificationPermissionStep } from "./notification-permission-step";
import type { TaskReminderSettingsController } from "@/console/settings-dialog";

export type OnboardingMode = "first-run" | "replay";

export interface OnboardingShellProps {
  mode?: OnboardingMode;
  environment: OnboardingEnvironmentState;
  installations: OnboardingInstallationState;
  teamsState: OperatorAgentTeamsState;
  teamBuilderState: TeamBuilderViewState;
  createdTeamKey?: string | null;
  providerSettings?: ProviderSettingsController;
  taskReminder?: TaskReminderSettingsController;
  onRecheckEnvironment: () => void | Promise<void>;
  onInstallCli: (cli: OnboardingCli) => void | Promise<void>;
  onUpdateClaude?: () => void | Promise<void>;
  onCancelCliInstallation: (cli: OnboardingCli) => void | Promise<void>;
  onRetryTeams?: () => void | Promise<void>;
  onReplaceTeamWithProvider?: (input: {
    teamId: string;
    ownership: "system" | "user";
    memberSlugs: string[];
    providerProfileId: string;
    model: "deepseek-v4-flash" | "deepseek-v4-pro";
    effort: "high" | "max";
  }) => void | Promise<void>;
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
  providerSettings,
  taskReminder,
  onRecheckEnvironment,
  onInstallCli,
  onUpdateClaude,
  onCancelCliInstallation,
  onRetryTeams,
  onReplaceTeamWithProvider,
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
    canContinueOnboardingEnvironment(environment, readyProviderProfiles(providerSettings)),
    createOnboardingShellState,
  );
  const [completionState, setCompletionState] = useState<"idle" | "saving" | "error">("idle");
  const [teamQuery, setTeamQuery] = useState("");
  const [pendingCreatedTeamFocus, setPendingCreatedTeamFocus] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const teamCardRefs = useRef(new Map<string, HTMLButtonElement>());
  const usableTeams = useMemo(
    () => teamsState.status === "ready"
      ? teamsState.teams.filter((team) => team.canCreateConversation)
      : [],
    [teamsState],
  );
  const selectedTeam = usableTeams.find((team) => team.teamKey === state.selectedTeamKey) ?? null;
  const providerProfiles = readyProviderProfiles(providerSettings);
  const compatibility = getOnboardingTeamCompatibility(selectedTeam, environment, t, providerProfiles);
  const builderCli = chooseOnboardingBuilderCli(environment, providerProfiles);

  useEffect(() => {
    titleRef.current?.focus();
  }, [state.step]);

  useEffect(() => {
    if (canContinueOnboardingEnvironment(environment, providerProfiles) && !state.environmentPassed) {
      dispatch({ type: "environment-passed" });
    }
  }, [environment, providerProfiles, state.environmentPassed]);

  useEffect(() => {
    if (
      usableTeams.length === 0
      || usableTeams.some((team) => team.teamKey === state.selectedTeamKey)
    ) {
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
    setTeamQuery("");
    setPendingCreatedTeamFocus(createdTeamKey);
    onCreatedTeamConsumed?.();
  }, [createdTeamKey, onCreatedTeamConsumed, usableTeams]);

  useEffect(() => {
    if (pendingCreatedTeamFocus === null || state.selectedTeamKey !== pendingCreatedTeamFocus) {
      return;
    }
    const target = teamCardRefs.current.get(pendingCreatedTeamFocus);
    if (target === undefined) return;
    target.focus();
    setPendingCreatedTeamFocus(null);
  }, [pendingCreatedTeamFocus, state.selectedTeamKey, teamQuery]);

  const primaryDisabled = state.teamBuilderOpen
    || completionState === "saving"
    || (state.step === 1 && !canContinueOnboardingEnvironment(environment, providerProfiles))
    || (state.step >= 2 && state.step <= 3 && selectedTeam === null);

  const advance = async () => {
    if (primaryDisabled) {
      return;
    }
    if (state.step !== 5) {
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

  if (state.step === 4) {
    return (
      <div data-testid="onboarding-step-4">
        <NotificationPermissionStep
          masterSwitchEnabled={taskReminder?.enabled ?? true}
          permission={taskReminder === undefined
            ? "undetermined"
            : taskReminder.channelAnomaly
              ? "unavailable"
              : taskReminder.permission}
          waitingForSystem={taskReminder?.modal.phase === "requesting"}
          checking={taskReminder?.checking}
          onAllow={() => taskReminder?.onModalAction({ kind: "request" })}
          onSkip={() => dispatch({ type: "next" })}
          onRecheck={() => taskReminder?.onRecheckChannel?.()}
          onBack={() => dispatch({ type: "back" })}
          onContinue={() => dispatch({ type: "next" })}
        />
      </div>
    );
  }

  return (
    <main
      className="flex h-screen h-dvh min-h-0 flex-col overflow-hidden bg-canvas text-ink"
      data-testid={`onboarding-step-${String(state.step)}`}
      data-onboarding-mode={mode}
    >
      <header
        className="window-drag-region relative flex h-[var(--window-header-height)] shrink-0 items-center border-b border-line pl-[78px] pr-4"
        aria-label={t("onboarding.windowTitle")}
      >
        <span className="flex items-center gap-2 text-xs font-semibold text-sub">
          <MoebiusLogo className="h-6 w-6" decorative />
          Moebius
        </span>
        <span className="window-no-drag absolute left-1/2 -translate-x-1/2">
          <InstallationAggregate
            installations={installations}
            onCancel={onCancelCliInstallation}
          />
        </span>
        {mode === "replay" ? (
          <span className="window-no-drag ml-auto flex items-center gap-1 text-xs text-hint">
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
          <span className="ml-auto text-xs tabular-nums text-hint">
            {t("onboarding.firstRun")}
          </span>
        )}
      </header>

      <section
        className={cn(
          "flex min-h-0 flex-1 justify-center px-6 max-sm:px-4",
          state.step === 2 && !state.teamBuilderOpen
            ? "overflow-hidden py-5 [@media(max-height:520px)]:py-3"
            : "overflow-y-auto",
          state.step === 3 ? "py-4 max-sm:py-5" : state.step === 2 ? null : "py-10 max-sm:py-7",
        )}
        data-testid="onboarding-stage"
      >
        <div
          className={cn(
            "flex w-full max-w-[780px] flex-col",
            state.step === 2 && !state.teamBuilderOpen
              ? "min-h-0 justify-start"
              : state.step === 3
              ? "justify-start"
              : "justify-center",
          )}
          data-testid="onboarding-layout-frame"
        >
          <header className="mx-auto w-full max-w-lg text-center">
            <div className="mb-3 flex justify-center gap-1" aria-hidden="true" data-testid="onboarding-progress-bars">
              {([1, 2, 3, 4, 5] as const).map((step) => (
                <i
                  className={cn(
                    "h-[3px] w-[22px] rounded-full",
                    step < state.step ? "bg-sub" : step === state.step ? "bg-ink" : "bg-line",
                  )}
                  key={step}
                />
              ))}
            </div>
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
              state.step === 3
                ? "mt-5"
                : state.step === 2
                ? "mt-5 [@media(max-height:520px)]:mt-3"
                : "mt-7",
              state.step === 2 && !state.teamBuilderOpen ? "flex min-h-0 flex-1 flex-col" : null,
              state.step === 3 || state.teamBuilderOpen ? null : "mx-auto max-w-[640px]",
            )}
            data-testid="onboarding-content-column"
          >
            {state.step === 1 ? (
            <EnvironmentStep
              environment={environment}
              installations={installations}
              providerSettings={providerSettings}
              onInstall={onInstallCli}
              onUpdateClaude={onUpdateClaude}
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
                        cli: onboardingCliLabel(teamBuilderState.builderCli ?? builderCli!),
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
                  providerProfiles={providerProfiles}
                  onSelect={(teamKey) => dispatch({ type: "select-team", teamKey })}
                  onRetry={onRetryTeams}
                  onReplaceTeamWithProvider={onReplaceTeamWithProvider}
                  builderCli={builderCli}
                  query={teamQuery}
                  onQueryChange={setTeamQuery}
                  teamCardRefs={teamCardRefs.current}
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
            {state.step === 5 ? <ReadyStep compatibility={compatibility} /> : null}
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
          primaryLabel={state.step === 5
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
                    && environment.claude.status === "checking"
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
  providerSettings,
  onInstall,
  onUpdateClaude,
  onCancel,
}: {
  environment: OnboardingEnvironmentState;
  installations: OnboardingInstallationState;
  providerSettings?: ProviderSettingsController;
  onInstall: (cli: OnboardingCli) => void | Promise<void>;
  onUpdateClaude?: () => void | Promise<void>;
  onCancel: (cli: OnboardingCli) => void | Promise<void>;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <section
      className="overflow-hidden rounded-xl border border-line bg-card"
      aria-label={t("onboarding.environmentLabel")}
      aria-live="polite"
    >
      {(["codex", "claude", "kimi"] as const).map((cli) => (
        <CliReadinessRow
          key={cli}
          cli={cli}
          readiness={environment[cli]}
          installation={installations[cli]}
          onInstall={onInstall}
          onUpdateClaude={onUpdateClaude}
          onCancel={onCancel}
        />
      ))}
      {providerSettings !== undefined ? (
        <div className="border-b border-line p-4">
          <ProviderSettingsPanel controller={providerSettings} />
        </div>
      ) : null}
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
  onUpdateClaude,
  onCancel,
}: {
  cli: OnboardingCli;
  readiness: OnboardingEnvironmentState[OnboardingCli];
  installation: OnboardingCliInstallation;
  onInstall: (cli: OnboardingCli) => void | Promise<void>;
  onUpdateClaude?: () => void | Promise<void>;
  onCancel: (cli: OnboardingCli) => void | Promise<void>;
}): JSX.Element {
  const { t } = useI18n();
  const name = onboardingCliFullName(cli);
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
                : cli === "claude"
                  ? "curl -fsSL https://claude.ai/install.sh | bash"
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
        {cli === "claude"
          && readiness.code === "version-unsupported"
          && !installing
          && !recoverableInstall
          && onUpdateClaude !== undefined ? (
            <Button
              className="mt-2"
              type="button"
              size="sm"
              variant="outline"
              aria-label={t("onboarding.updateClaude")}
              onClick={() => void onUpdateClaude()}
            >
              <RefreshCw className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
              {t("onboarding.updateClaude")}
            </Button>
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
            aria-label={cli === "claude" && readiness.code === "version-unsupported"
              ? t("onboarding.updateClaude")
              : t("onboarding.retryInstall", { cli: name })}
            onClick={() => {
              if (
                cli === "claude"
                && readiness.code === "version-unsupported"
                && onUpdateClaude !== undefined
              ) {
                void onUpdateClaude();
                return;
              }
              void onInstall(cli);
            }}
          >
            <RefreshCw className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
            {cli === "claude" && readiness.code === "version-unsupported"
              ? t("onboarding.updateClaude")
              : t("onboarding.retryInstall", { cli: name })}
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
  const name = onboardingCliFullName(cli);
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
          : cli === "claude"
            ? t("onboarding.claudeLoginDetail")
            : t("onboarding.kimiLoginDetail"),
      };
    case "unavailable":
      if (readiness.code === "version-unsupported") {
        return {
          icon: <CircleAlert className="h-4 w-4" strokeWidth={1.6} aria-hidden="true" />,
          tone: "neutral",
          title: cli === "claude"
            ? t("onboarding.claudeUpgradeTitle")
            : t("onboarding.codexUpgradeTitle"),
          detail: t(cli === "claude"
            ? "onboarding.claudeUpgradeDetail"
            : "onboarding.codexUpgradeDetail", {
            version: readiness.version ?? t("onboarding.versionUnknown"),
          }),
        };
      }
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
  providerProfiles,
  builderCli,
  query,
  onQueryChange,
  teamCardRefs,
  onSelect,
  onRetry,
  onReplaceTeamWithProvider,
  onOpenBuilder,
}: {
  teamsState: OperatorAgentTeamsState;
  selectedTeamKey: string | null;
  environment: OnboardingEnvironmentState;
  providerProfiles: readonly import("@/console/provider-settings-panel").ProviderSettingsProfile[];
  builderCli: OnboardingEngine | null;
  query: string;
  onQueryChange: (value: string) => void;
  teamCardRefs: Map<string, HTMLButtonElement>;
  onSelect: (teamKey: string) => void;
  onRetry?: () => void | Promise<void>;
  onReplaceTeamWithProvider?: OnboardingShellProps["onReplaceTeamWithProvider"];
  onOpenBuilder: () => void;
}): JSX.Element {
  const { t, locale } = useI18n();
  const teams = teamsState.status === "ready" ? teamsState.teams : [];
  const projection = projectOnboardingTeamList({ teams, selectedTeamKey, query });
  const ready = teamsState.status === "ready";
  const canBuild = ready && projection.total > 0;
  const countCopy = projection.query === ""
    ? t("onboarding.teamCount", { count: projection.total })
    : t("onboarding.teamMatchCount", { matched: projection.matched, total: projection.total });
  const [replacementState, setReplacementState] = useState<"idle" | "saving" | "error">("idle");
  const selectedTeam = ready
    ? teams.find((team) => team.canCreateConversation && team.teamKey === selectedTeamKey) ?? null
    : null;
  const selectedCompatibility = getOnboardingTeamCompatibility(selectedTeam, environment, t, providerProfiles);
  const replacementTarget = providerProfiles.flatMap((profile) => {
    const model = profile.defaultModel ?? profile.verifiedModels[0];
    return profile.readiness === "ready" && model !== undefined
      ? [{ profileId: profile.id, model }]
      : [];
  })[0];
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="onboarding-team-selector">
      <div className="mb-3 flex shrink-0 items-center gap-2.5">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{t("onboarding.searchTeams")}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-hint" strokeWidth={1.5} aria-hidden="true" />
          <input
            className="h-9 w-full rounded-sm border border-line bg-card pl-8 pr-9 text-[13px] text-ink outline-none placeholder:text-hint focus:border-accent disabled:cursor-not-allowed disabled:opacity-50"
            type="search"
            value={query}
            disabled={!ready}
            placeholder={t("onboarding.searchTeamsPlaceholder")}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query !== "") {
                event.preventDefault();
                onQueryChange("");
              }
            }}
          />
          {query !== "" ? (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-sub hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              aria-label={t("onboarding.clearTeamSearch")}
              onClick={() => onQueryChange("")}
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            </button>
          ) : null}
        </label>
        <span className="shrink-0 text-xs tabular-nums text-hint" data-testid="onboarding-team-count">
          {countCopy}
        </span>
      </div>
      <div
        className="scroll-thin min-h-[120px] min-w-0 flex-1 shrink-0 overflow-x-hidden overflow-y-auto overscroll-contain pr-1"
        data-testid="onboarding-team-scroll"
      >
        {teamsState.status === "loading" ? (
          <div className="flex min-h-[120px] items-center justify-center rounded-lg border border-line bg-card" role="status" aria-busy="true">
            <LoaderCircle className="h-5 w-5 motion-safe:animate-spin text-sub" strokeWidth={1.5} aria-hidden="true" />
            <span className="ml-2 text-sm text-sub">{t("onboarding.teamsLoading")}</span>
          </div>
        ) : teamsState.status !== "ready" ? (
          <div className="flex min-h-[120px] flex-col items-center justify-center rounded-lg border border-line bg-card p-5 text-center" role="alert">
            <p className="text-sm text-sub">{t("onboarding.teamsUnavailable")}</p>
            {onRetry ? (
              <Button className="mt-4" type="button" variant="outline" onClick={() => void onRetry()}>
                {t("onboarding.teamsReload")}
              </Button>
            ) : null}
          </div>
        ) : projection.total === 0 ? (
          <div className="flex min-h-[120px] flex-col items-center justify-center rounded-lg border border-line bg-card p-5 text-center" role="alert">
            <p className="text-sm font-medium text-ink">{t("onboarding.noUsableTeams")}</p>
            <p className="mt-1 text-xs leading-5 text-sub">{t("onboarding.noUsableTeamsDetail")}</p>
            {onRetry ? (
              <Button className="mt-4" type="button" variant="outline" onClick={() => void onRetry()}>
                {t("onboarding.teamsReload")}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-2 py-0.5">
            {projection.selectedOutsideResults ? (
              <TeamGroup
                label={t("onboarding.currentSelection")}
                teams={[projection.selectedOutsideResults]}
                allTeams={teams}
                locale={locale}
                environment={environment}
                providerProfiles={providerProfiles}
                selectedTeamKey={selectedTeamKey}
                teamCardRefs={teamCardRefs}
                onSelect={onSelect}
              />
            ) : null}
            <TeamGroup
              label={t("onboarding.builtInTeams")}
              teams={projection.builtInTeams}
              allTeams={teams}
              locale={locale}
              environment={environment}
              providerProfiles={providerProfiles}
              selectedTeamKey={selectedTeamKey}
              teamCardRefs={teamCardRefs}
              onSelect={onSelect}
            />
            <TeamGroup
              label={t("onboarding.myTeams")}
              teams={projection.userTeams}
              allTeams={teams}
              locale={locale}
              environment={environment}
              providerProfiles={providerProfiles}
              selectedTeamKey={selectedTeamKey}
              teamCardRefs={teamCardRefs}
              onSelect={onSelect}
            />
            {projection.matched === 0 ? (
              <div className="rounded-lg border border-dashed border-line px-5 py-6 text-center text-xs leading-5 text-sub" role="status">
                {t("onboarding.noTeamMatches", { query: query.trim() })}
              </div>
            ) : null}
          </div>
        )}
      </div>
      {selectedTeam !== null
        && selectedCompatibility.affectedCount > 0
        && replacementTarget !== undefined
        && onReplaceTeamWithProvider !== undefined ? (
          <div className="mt-3 shrink-0 rounded-xl border border-line bg-sunken p-3" data-testid="onboarding-api-replacement">
            <p className="text-xs leading-5 text-sub">
              {t("onboarding.replaceTeamWithApiDescription", { count: selectedCompatibility.affectedCount })}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={replacementState === "saving"}
                onClick={async () => {
                  setReplacementState("saving");
                  try {
                    await onReplaceTeamWithProvider({
                      teamId: selectedTeam.id,
                      ownership: selectedTeam.ownership,
                      memberSlugs: selectedCompatibility.memberSlugs,
                      providerProfileId: replacementTarget.profileId,
                      model: replacementTarget.model,
                      effort: "high",
                    });
                    setReplacementState("idle");
                  } catch {
                    setReplacementState("error");
                  }
                }}
              >
                {replacementState === "saving"
                  ? t("onboarding.replacingTeamWithApi")
                  : t("onboarding.replaceTeamWithApi")}
              </Button>
              <span className="text-xs text-hint">{t("onboarding.keepTeamForNow")}</span>
            </div>
            {replacementState === "error" ? (
              <p className="mt-2 text-xs text-danger" role="alert">{t("onboarding.replaceTeamWithApiFailed")}</p>
            ) : null}
          </div>
        ) : null}
      <button
        type="button"
        className="mt-3 flex w-full shrink-0 items-center gap-3 rounded-lg border border-dashed border-line-strong bg-card px-4 py-3 text-left transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 [@media(max-height:520px)]:mt-2 [@media(max-height:520px)]:py-2"
        onClick={onOpenBuilder}
        disabled={!canBuild}
        data-testid="open-onboarding-team-builder"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sunken text-sub [@media(max-height:520px)]:h-8 [@media(max-height:520px)]:w-8">
          <MessageSquarePlus className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block text-sm font-semibold text-ink">{t("onboarding.buildTeam")}</strong>
          <small className="mt-0.5 block text-xs leading-5 text-sub [@media(max-height:520px)]:hidden">
            {builderCli === null
              ? t("onboarding.buildTeamWaiting")
              : t("onboarding.buildTeamWithCli", {
                  cli: onboardingCliLabel(builderCli),
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

function TeamGroup({
  label,
  teams,
  allTeams,
  locale,
  environment,
  providerProfiles,
  selectedTeamKey,
  teamCardRefs,
  onSelect,
}: {
  label: string;
  teams: readonly OperatorAgentTeam[];
  allTeams: readonly OperatorAgentTeam[];
  locale: string;
  environment: OnboardingEnvironmentState;
  providerProfiles: readonly import("@/console/provider-settings-panel").ProviderSettingsProfile[];
  selectedTeamKey: string | null;
  teamCardRefs: Map<string, HTMLButtonElement>;
  onSelect: (teamKey: string) => void;
}): JSX.Element | null {
  if (teams.length === 0) return null;
  return (
    <section className="min-w-0 max-w-full" aria-label={label}>
      <h2 className="px-1 pb-1 pt-1 text-[11.5px] font-medium tracking-[0.04em] text-hint">
        {label} · {teams.length}
      </h2>
      <div className="grid min-w-0 max-w-full gap-2">
        {teams.map((team) => (
          <TeamChoiceCard
            key={team.teamKey}
            team={team}
            allTeams={allTeams}
            locale={locale}
            environment={environment}
            providerProfiles={providerProfiles}
            selected={team.teamKey === selectedTeamKey}
            buttonRef={(element) => {
              if (element === null) teamCardRefs.delete(team.teamKey);
              else teamCardRefs.set(team.teamKey, element);
            }}
            onSelect={() => onSelect(team.teamKey)}
          />
        ))}
      </div>
    </section>
  );
}

function TeamChoiceCard({
  team,
  allTeams,
  locale,
  environment,
  providerProfiles,
  selected,
  buttonRef,
  onSelect,
}: {
  team: OperatorAgentTeam;
  allTeams: readonly OperatorAgentTeam[];
  locale: string;
  environment: OnboardingEnvironmentState;
  providerProfiles: readonly import("@/console/provider-settings-panel").ProviderSettingsProfile[];
  selected: boolean;
  buttonRef: (element: HTMLButtonElement | null) => void;
  onSelect: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const label = getAgentTeamSelectionLabel({
    team,
    teams: allTeams,
    locale,
    untitledLabel: t("onboarding.unnamedTeam"),
    officialLabel: t("onboarding.builtInTeam"),
    userLabel: t("onboarding.myTeam"),
  });
  const membersBySlug = new Map(team.members.map((member) => [member.slug, member]));
  const orderedMembers = team.memberOrder
    .map((slug) => membersBySlug.get(slug))
    .filter((member): member is NonNullable<typeof member> => member !== undefined)
    .slice(0, 3);
  const compatibility = getOnboardingTeamCompatibility(team, environment, t, providerProfiles);
  return (
    <button
      type="button"
      ref={buttonRef}
      className={cn(
        "min-w-0 w-full max-w-full rounded-lg border bg-card px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        selected ? "border-accent bg-sel" : "border-line hover:bg-hover",
      )}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="flex min-w-0 w-full items-start justify-between gap-4">
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
            <strong className="block truncate text-sm font-semibold text-ink" title={label}>
              {label}
            </strong>
            {orderedMembers.length > 0 ? (
              <small className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-sub">
                {orderedMembers.map((member, index) => (
                  <span className={cn(member.slug === team.primaryAgentSlug && "font-medium text-ink")} key={member.slug}>
                    {index > 0 ? <span className="mr-1.5 text-hint" aria-hidden="true">│</span> : null}
                    {member.slug === team.primaryAgentSlug ? <i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" aria-hidden="true" /> : null}
                    {member.displayName || `@${member.slug}`}
                  </span>
                ))}
              </small>
            ) : null}
            {team.description ? (
              <small className="mt-0.5 block truncate text-xs text-hint">{team.description}</small>
            ) : null}
          </span>
        </span>
        {selected ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-sunken px-2.5 py-1 text-xs font-medium text-sub">
            <Check className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
            {t("onboarding.selected")}
          </span>
        ) : null}
      </span>
      {compatibility.affectedCount > 0 ? (
        <span
          className="mt-2 flex items-start gap-2 pl-[30px] text-xs leading-5 text-sub"
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

function readyProviderProfiles(controller: ProviderSettingsController | undefined) {
  return controller?.state.status === "ready" ? controller.state.profiles : [];
}

export function ReadyStep({
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
        cli: onboardingCliLabel(running[0]!.cli),
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
            const name = onboardingCliFullName(installation.cli);
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
      return t("notification.settings.title");
    case 5:
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
      return t("notification.settings.description");
    case 5:
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
      .map(onboardingCliLabel)
      .join(" / "),
  });
}

function onboardingCliFullName(cli: OnboardingCli): string {
  return cli === "claude" ? "Claude Code" : `${onboardingCliLabel(cli)} CLI`;
}
