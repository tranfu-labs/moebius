import {
  AlertTriangle,
  Archive,
  ArrowRightLeft,
  Ban,
  CirclePause,
  Clock3,
  FileText,
  PenLine,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useI18n, type TranslationKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/ui/tooltip";
import {
  findExecutionModel,
  findPiExecutionModel,
  listExecutionModels,
  resolveProfileForCli,
  resolveProfileForModel,
  EXECUTION_MODEL_REGISTRY,
  type ExecutionRegistryState,
  type ExecutionModelRegistry,
  type RegistryExecutionProfile,
  type RegistryProviderProfile,
} from "@/console/execution-profile-registry";

export type RunOutcomeStatus =
  | "run-not-started"
  | "run-stuck"
  | "user-stopped"
  | "system-stopped"
  | "resume-unavailable"
  | "retry-exhausted"
  | "quota-exhausted"
  | "rate-limited"
  | "auth-failed"
  | "run-crashed";

export type ProviderUnavailableKind = "disabled" | "needs-attention" | "missing";

export interface RunOutcomeProps {
  status: RunOutcomeStatus;
  rawReason?: string | null;
  defaultOpen?: boolean;
  onRetry?: () => void | Promise<void>;
  onEditAndResend?: () => void;
  initialProfile?: RegistryExecutionProfile | null;
  executionRegistryState?: ExecutionRegistryState;
  providerProfiles?: readonly RegistryProviderProfile[];
  onReloadExecutionRegistry?: () => void;
  onOverrideAndRetry?: (profile: RegistryExecutionProfile) => void | Promise<void>;
  onMigrateAndContinue?: (profile: RegistryExecutionProfile) => void | Promise<void>;
  onEndContinuation?: () => void | Promise<void>;
  providerUnavailable?: ProviderUnavailableKind | null;
  onSelectTeam?: () => void;
  maintenanceAction?: { label: string; onClick: () => void };
  className?: string;
}

const outcomeLabelKeys: Record<RunOutcomeStatus, TranslationKey> = {
  "retry-exhausted": "console.runOutcome.retryExhausted.title",
  "run-not-started": "console.runOutcome.notStarted.title",
  "user-stopped": "console.runOutcome.userStopped.title",
  "system-stopped": "console.runOutcome.systemStopped.title",
  "resume-unavailable": "console.runOutcome.resumeUnavailable.title",
  "run-stuck": "console.runOutcome.stuck.title",
  "quota-exhausted": "console.runOutcome.quota.title",
  "rate-limited": "console.runOutcome.rateLimited.title",
  "auth-failed": "console.runOutcome.auth.title",
  "run-crashed": "console.runOutcome.crashed.title",
};

// null = the title already says it all and the card collapses to one line;
// descriptions are reserved for facts the title cannot carry.
const outcomeDescriptionKeys: Record<RunOutcomeStatus, TranslationKey | null> = {
  "retry-exhausted": null,
  "run-not-started": null,
  "user-stopped": null,
  "system-stopped": null,
  "resume-unavailable": null,
  "run-stuck": null,
  "quota-exhausted": null,
  "rate-limited": null,
  "auth-failed": null,
  "run-crashed": "console.runOutcome.crashed.description",
};

export function resolveOutcomeLabelKey(
  status: RunOutcomeStatus,
  providerUnavailable: ProviderUnavailableKind | null,
): TranslationKey {
  if (providerUnavailable === "disabled") return "console.runOutcome.providerDisabled.title";
  if (providerUnavailable === "needs-attention") return "console.runOutcome.providerNeedsAttention.title";
  if (providerUnavailable === "missing") return "console.runOutcome.providerMissing.title";
  return outcomeLabelKeys[status];
}

export function resolveOutcomeDescriptionKey(
  status: RunOutcomeStatus,
  providerUnavailable: ProviderUnavailableKind | null,
): TranslationKey | null {
  if (providerUnavailable === "disabled") return "console.runOutcome.providerDisabled.description";
  if (providerUnavailable === "needs-attention") return "console.runOutcome.providerNeedsAttention.description";
  if (providerUnavailable === "missing") return "console.runOutcome.providerMissing.description";
  return outcomeDescriptionKeys[status];
}

/** A terminal state severe enough that the incident marker reads as an error, not a warning. */
export function outcomeSeverity(status: RunOutcomeStatus): "warning" | "danger" {
  return status === "resume-unavailable" || status === "auth-failed" || status === "quota-exhausted"
    ? "danger"
    : "warning";
}

export function RunOutcome({
  status,
  rawReason: _rawReason,
  defaultOpen: _defaultOpen,
  onRetry,
  onEditAndResend,
  initialProfile,
  executionRegistryState = { status: "ready", registry: EXECUTION_MODEL_REGISTRY },
  providerProfiles = [],
  onReloadExecutionRegistry,
  onOverrideAndRetry,
  onMigrateAndContinue,
  onEndContinuation,
  providerUnavailable = null,
  onSelectTeam,
  maintenanceAction,
  className,
}: RunOutcomeProps): JSX.Element {
  const { t } = useI18n();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideAction, setOverrideAction] = useState<"retry" | "migrate">("retry");
  const [overrideProfile, setOverrideProfile] = useState<RegistryExecutionProfile>(
    initialProfile ?? resolveProfileForCli("codex"),
  );
  const [submittingOverride, setSubmittingOverride] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const overrideCallbackRef = useRef(onOverrideAndRetry);
  const migrateCallbackRef = useRef(onMigrateAndContinue);
  const endCallbackRef = useRef(onEndContinuation);
  useEffect(() => {
    overrideCallbackRef.current = onOverrideAndRetry;
  }, [onOverrideAndRetry]);
  useEffect(() => { migrateCallbackRef.current = onMigrateAndContinue; }, [onMigrateAndContinue]);
  useEffect(() => { endCallbackRef.current = onEndContinuation; }, [onEndContinuation]);
  useEffect(() => {
    if (executionRegistryState.status !== "ready") return;
    if (overrideProfile.cli === "pi") {
      const provider = providerProfiles.find((candidate) =>
        candidate.id === overrideProfile.providerProfileId && candidate.readiness === "ready");
      const model = findPiExecutionModel(overrideProfile.model);
      if (
        provider === undefined
        || !provider.verifiedModels.includes(overrideProfile.model as "deepseek-v4-flash" | "deepseek-v4-pro")
        || model === null
        || !model.efforts.includes(overrideProfile.effort)
      ) {
        setOverrideProfile(resolveRetryProfile("pi", executionRegistryState.registry, providerProfiles));
      }
      return;
    }
    const current = findExecutionModel(
      overrideProfile.cli,
      overrideProfile.model,
      executionRegistryState.registry,
    );
    if (current === null || !current.efforts.includes(overrideProfile.effort)) {
      setOverrideProfile(resolveProfileForCli(
        overrideProfile.cli,
        executionRegistryState.registry,
      ));
    }
  }, [executionRegistryState, overrideProfile, providerProfiles]);
  const providerBlocked = providerUnavailable !== null;

  return (
    <div className={cn("max-w-[720px]", className)}>
      <TooltipProvider delayDuration={200} skipDelayDuration={100}>
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="flex shrink-0 items-center">
            {maintenanceAction !== undefined ? (
              <OutcomeAction icon={Settings} label={maintenanceAction.label} onClick={maintenanceAction.onClick} />
            ) : null}
            {!providerBlocked && status !== "retry-exhausted" && onRetry !== undefined ? (
              <OutcomeAction
                icon={RotateCcw}
                label={t(status === "resume-unavailable" ? "console.runOutcome.rerun" : "common.retry")}
                onClick={() => {
                  void Promise.resolve(onRetry()).catch(() => undefined);
                }}
              />
            ) : null}
            {onOverrideAndRetry !== undefined ? (
              <OutcomeAction
                icon={SlidersHorizontal}
                label={t("console.runOutcome.overrideRerun")}
                onClick={() => {
                  setOverrideAction("retry");
                  setOverrideOpen((open) => !open || overrideAction !== "retry");
                }}
              />
            ) : null}
            {!providerBlocked && onMigrateAndContinue !== undefined ? (
              <OutcomeAction
                icon={ArrowRightLeft}
                label={t("console.runOutcome.migrateSession")}
                onClick={() => {
                  setOverrideAction("migrate");
                  setOverrideOpen((open) => !open || overrideAction !== "migrate");
                }}
              />
            ) : null}
            {!providerBlocked && onEndContinuation !== undefined ? (
              <OutcomeAction
                icon={Archive}
                label={t("console.runOutcome.endContinuation")}
                disabled={submittingOverride}
                onClick={() => {
                  const callback = endCallbackRef.current;
                  if (callback === undefined || submittingOverride) return;
                  setSubmittingOverride(true);
                  setOverrideError(null);
                  void Promise.resolve(callback())
                    .catch((error: unknown) => setOverrideError(error instanceof Error ? error.message : t("console.runOutcome.endContinuationFailed")))
                    .finally(() => setSubmittingOverride(false));
                }}
              />
            ) : null}
            {providerBlocked && onSelectTeam !== undefined ? (
              <OutcomeAction icon={Users} label={t("console.runOutcome.selectTeam")} onClick={onSelectTeam} />
            ) : null}
            {status === "user-stopped" && onEditAndResend !== undefined ? (
              <OutcomeAction
                icon={PenLine}
                label={t("console.runOutcome.editResendLabel")}
                onClick={onEditAndResend}
              />
            ) : null}
          </span>
        </div>
      </TooltipProvider>
      {overrideOpen && (onOverrideAndRetry !== undefined || onMigrateAndContinue !== undefined) ? (
        <div className="mt-2.5 rounded-md bg-sunken p-2.5">
          {executionRegistryState.status === "loading" ? (
            <p className="text-xs text-sub" role="status">
              {t("console.runOutcome.registryLoading")}
            </p>
          ) : executionRegistryState.status === "error" ? (
            <div className="flex items-center justify-between gap-3" role="alert">
              <p className="text-xs text-sub">
                {executionRegistryState.message || t("console.runOutcome.registryError")}
              </p>
              {onReloadExecutionRegistry === undefined ? null : (
                <Button type="button" variant="outline" size="sm" onClick={onReloadExecutionRegistry}>
                  {t("common.retry")}
                </Button>
              )}
            </div>
          ) : (
          <div className="grid gap-2 sm:grid-cols-4">
          <label className="grid gap-1 text-[11px] text-hint">
            {t("console.agentTeamDetail.executionEngineLabel")}
            <select
              aria-label="CLI"
              className="h-8 rounded-md border border-line bg-card px-2 text-xs text-ink"
              value={overrideProfile.cli}
              onChange={(event) => setOverrideProfile(
                resolveRetryProfile(
                  event.currentTarget.value as RegistryExecutionProfile["cli"],
                  executionRegistryState.registry,
                  providerProfiles,
                ),
              )}
            >
              <option value="codex">Codex</option>
              <option value="claude">Claude Code</option>
              <option value="kimi">Kimi</option>
              {providerProfiles.some((profile) => profile.readiness === "ready") ? (
                <option value="pi">Pi API</option>
              ) : null}
            </select>
          </label>
          {overrideProfile.cli === "pi" ? (
            <label className="grid gap-1 text-[11px] text-hint">
              {t("settings.providers")}
              <select
                aria-label={t("settings.providers")}
                className="h-8 rounded-md border border-line bg-card px-2 text-xs text-ink"
                value={overrideProfile.providerProfileId}
                onChange={(event) => {
                  const provider = providerProfiles.find((candidate) => candidate.id === event.currentTarget.value);
                  if (provider !== undefined) setOverrideProfile(resolvePiRetryProfile(provider));
                }}
              >
                {providerProfiles.filter((profile) => profile.readiness === "ready").map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.displayName}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="grid gap-1 text-[11px] text-hint">
            Model
            <select
              aria-label="Model"
              className="h-8 rounded-md border border-line bg-card px-2 text-xs text-ink"
              value={overrideProfile.model}
              onChange={(event) => setOverrideProfile(overrideProfile.cli === "pi"
                ? resolvePiRetryModel(overrideProfile, event.currentTarget.value)
                : resolveProfileForModel(
                    overrideProfile,
                    event.currentTarget.value,
                    executionRegistryState.registry,
                  ))}
            >
              {(overrideProfile.cli === "pi"
                ? providerProfiles.find((profile) => profile.id === overrideProfile.providerProfileId)?.verifiedModels
                    .map((model) => findPiExecutionModel(model)).filter(isDefined) ?? []
                : listExecutionModels(overrideProfile.cli, executionRegistryState.registry)).map((model) => (
                <option key={model.value} value={model.value}>{model.label}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[11px] text-hint">
            {t("console.agentTeamDetail.effort")}
            <select
              aria-label={t("console.agentTeamDetail.effort")}
              className="h-8 rounded-md border border-line bg-card px-2 text-xs text-ink"
              value={overrideProfile.effort}
              onChange={(event) => setOverrideProfile({
                ...overrideProfile,
                effort: event.currentTarget.value,
              })}
            >
              {(overrideProfile.cli === "pi"
                ? findPiExecutionModel(overrideProfile.model)?.efforts ?? []
                : findExecutionModel(
                    overrideProfile.cli,
                    overrideProfile.model,
                    executionRegistryState.registry,
                  )?.efforts ?? []).map((effort) => (
                <option key={effort} value={effort}>{effort}</option>
              ))}
            </select>
          </label>
          <div className="flex justify-end sm:col-span-4">
            <Button
              type="button"
              size="sm"
              disabled={submittingOverride}
              onClick={() => {
                if (submittingOverride) return;
                const callback = overrideAction === "migrate"
                  ? migrateCallbackRef.current
                  : overrideCallbackRef.current;
                if (callback === undefined) return;
                const selectedProfile = { ...overrideProfile };
                setSubmittingOverride(true);
                setOverrideError(null);
                void Promise.resolve(callback(selectedProfile))
                  .then(() => setOverrideOpen(false))
                  .catch((error: unknown) => {
                    setOverrideError(error instanceof Error
                      ? error.message
                      : t("console.runOutcome.overrideSubmitError"));
                  })
                  .finally(() => setSubmittingOverride(false));
              }}
            >
              {overrideAction === "migrate" ? t("console.runOutcome.confirmMigrateAndContinue") : t("console.runOutcome.confirmOverrideRerun")}
            </Button>
          </div>
          {overrideError === null ? null : (
            <p className="sm:col-span-3 text-xs text-[var(--status-danger-fg)]" role="alert">
              {overrideError}
            </p>
          )}
          </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function nonBlank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resolveRetryProfile(
  cli: RegistryExecutionProfile["cli"],
  registry: ExecutionModelRegistry,
  providers: readonly RegistryProviderProfile[],
): RegistryExecutionProfile {
  if (cli !== "pi") return resolveProfileForCli(cli, registry);
  const provider = providers.find((candidate) => candidate.readiness === "ready");
  return provider === undefined ? resolveProfileForCli("codex", registry) : resolvePiRetryProfile(provider);
}

function resolvePiRetryProfile(provider: RegistryProviderProfile): Extract<RegistryExecutionProfile, { cli: "pi" }> {
  const model = provider.defaultModel ?? provider.verifiedModels[0] ?? "deepseek-v4-pro";
  return {
    cli: "pi",
    providerId: provider.providerId,
    providerProfileId: provider.id,
    model,
    effort: findPiExecutionModel(model)?.defaultEffort ?? "high",
  };
}

function resolvePiRetryModel(
  profile: Extract<RegistryExecutionProfile, { cli: "pi" }>,
  model: string,
): Extract<RegistryExecutionProfile, { cli: "pi" }> {
  const definition = findPiExecutionModel(model);
  if (definition === null) return profile;
  return {
    ...profile,
    model,
    effort: definition.efforts.includes(profile.effort)
      ? profile.effort
      : definition.defaultEffort,
  };
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/** Icon-only recovery action; the label lives in the tooltip and the accessible name. */
function OutcomeAction({ icon: Icon, label, onClick, disabled }: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          <Icon className="h-[15px] w-[15px]" strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function OutcomeIcon({ status }: { status: RunOutcomeStatus }): JSX.Element {
  if (status === "run-not-started" || status === "run-crashed") {
    return <AlertTriangle className="h-[15px] w-[15px] text-[var(--status-run-fg)]" strokeWidth={1.5} />;
  }
  if (status === "run-stuck" || status === "rate-limited") {
    return <Clock3 className="h-[15px] w-[15px] text-[var(--status-run-fg)]" strokeWidth={1.5} />;
  }
  if (status === "user-stopped" || status === "system-stopped") {
    return <CirclePause className="h-[15px] w-[15px] text-sub" strokeWidth={1.5} />;
  }
  if (status === "resume-unavailable") {
    return <Ban className="h-[15px] w-[15px] text-danger" strokeWidth={1.5} />;
  }
  return <Ban className="h-[15px] w-[15px] text-danger" strokeWidth={1.5} />;
}
