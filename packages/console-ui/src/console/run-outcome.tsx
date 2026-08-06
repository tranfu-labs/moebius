import { AlertTriangle, Ban, CirclePause, Clock3, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useI18n, type TranslationKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import {
  resolveOperatorMemberName,
  type OperatorMemberIdentity,
} from "@/console/member-name";
import { RunTime } from "@/console/run-time";
import { MarkdownMessage } from "@/console/markdown-message";
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
  role?: string | null;
  memberIdentities?: readonly OperatorMemberIdentity[];
  rawReason?: string | null;
  rawOutput?: string | null;
  description?: string | null;
  partialMarkdown?: string | null;
  contentIncomplete?: boolean;
  elapsedMs?: number | null;
  completedAt?: string | null;
  defaultOpen?: boolean;
  onOpenOutput?: (rawOutput: string | null) => void;
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

const outcomeDescriptionKeys: Record<RunOutcomeStatus, TranslationKey> = {
  "retry-exhausted": "console.runOutcome.retryExhausted.description",
  "run-not-started": "console.runOutcome.notStarted.description",
  "user-stopped": "console.runOutcome.userStopped.description",
  "system-stopped": "console.runOutcome.systemStopped.description",
  "resume-unavailable": "console.runOutcome.resumeUnavailable.description",
  "run-stuck": "console.runOutcome.stuck.description",
  "quota-exhausted": "console.runOutcome.quota.description",
  "rate-limited": "console.runOutcome.rateLimited.description",
  "auth-failed": "console.runOutcome.auth.description",
  "run-crashed": "console.runOutcome.crashed.description",
};

export function RunOutcome({
  status,
  role,
  memberIdentities = [],
  rawReason: _rawReason,
  rawOutput,
  description,
  partialMarkdown,
  contentIncomplete = false,
  elapsedMs,
  completedAt,
  defaultOpen: _defaultOpen,
  onOpenOutput,
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
  const roleLabel = role
    ? resolveOperatorMemberName(role, memberIdentities, t, t("console.common.collaborator"))
    : null;
  const providerBlocked = providerUnavailable !== null;
  const outcomeLabelKey = providerUnavailable === "disabled"
    ? "console.runOutcome.providerDisabled.title"
    : providerUnavailable === "needs-attention"
      ? "console.runOutcome.providerNeedsAttention.title"
      : providerUnavailable === "missing"
        ? "console.runOutcome.providerMissing.title"
        : outcomeLabelKeys[status];
  const outcomeDescriptionKey = providerUnavailable === "disabled"
    ? "console.runOutcome.providerDisabled.description"
    : providerUnavailable === "needs-attention"
      ? "console.runOutcome.providerNeedsAttention.description"
      : providerUnavailable === "missing"
        ? "console.runOutcome.providerMissing.description"
        : outcomeDescriptionKeys[status];

  return (
    <div
      className={cn(
        "max-w-[720px] rounded-[10px] border border-line bg-card px-3.5 py-2.5",
        className,
      )}
    >
      {partialMarkdown?.trim() ? (
        <div className="mb-2.5 border-b border-line pb-2.5">
          <MarkdownMessage content={partialMarkdown} mode="static" />
          {contentIncomplete ? (
            <span className="mt-2 inline-flex rounded bg-muted px-1.5 py-0.5 text-[11px] text-sub">
              {t("console.runOutcome.incomplete")}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex shrink-0" aria-hidden="true">
          <OutcomeIcon status={status} />
        </span>
        <span className="min-w-0 flex-1 text-[13px] leading-5 text-ink">
          <span className="flex flex-wrap items-center gap-x-2">
            <span>{t(outcomeLabelKey)}</span>
            {roleLabel ? <span className="text-xs text-sub">{roleLabel}</span> : null}
            {elapsedMs !== null && elapsedMs !== undefined ? (
              <RunTime mode="completed" elapsedMs={elapsedMs} completedAt={completedAt} />
            ) : null}
          </span>
          <span className="mt-0.5 block text-xs text-sub">
            {description?.trim() || t(outcomeDescriptionKey)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
        {maintenanceAction !== undefined ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={maintenanceAction.onClick}
          >
            {maintenanceAction.label}
          </Button>
        ) : null}
        {!providerBlocked && status !== "retry-exhausted" && onRetry !== undefined ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void Promise.resolve(onRetry()).catch(() => undefined);
            }}
          >
            {t(status === "resume-unavailable" ? "console.runOutcome.rerun" : "common.retry")}
          </Button>
        ) : null}
        {onOverrideAndRetry !== undefined ? (
          <Button type="button" variant="outline" size="sm" onClick={() => {
            setOverrideAction("retry");
            setOverrideOpen((open) => !open || overrideAction !== "retry");
          }}>
            {t("console.runOutcome.overrideRerun")}
          </Button>
        ) : null}
        {!providerBlocked && onMigrateAndContinue !== undefined ? (
          <Button type="button" variant="outline" size="sm" onClick={() => {
            setOverrideAction("migrate");
            setOverrideOpen((open) => !open || overrideAction !== "migrate");
          }}>
            {t("console.runOutcome.migrateSession")}
          </Button>
        ) : null}
        {!providerBlocked && onEndContinuation !== undefined ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
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
          >
            {t("console.runOutcome.endContinuation")}
          </Button>
        ) : null}
        {providerBlocked && onSelectTeam !== undefined ? (
          <Button type="button" variant="ghost" size="sm" onClick={onSelectTeam}>
            {t("console.runOutcome.selectTeam")}
          </Button>
        ) : null}
        {status === "user-stopped" && onEditAndResend !== undefined ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t("console.runOutcome.editResendLabel")}
            onClick={onEditAndResend}
          >
            {t("console.runOutcome.editResend")}
          </Button>
        ) : null}
        {onOpenOutput ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenOutput(nonBlank(rawOutput))}>
            <FileText className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            {t("console.common.fullOutput")}
          </Button>
        ) : null}
        </span>
      </div>
      {overrideOpen && (onOverrideAndRetry !== undefined || onMigrateAndContinue !== undefined) ? (
        <div className="mt-2.5 border-t border-line pt-2.5">
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
