import { AlertTriangle, Ban, CirclePause, Clock3, FileText } from "lucide-react";

import { useI18n, type TranslationKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import {
  resolveOperatorMemberName,
  type OperatorMemberIdentity,
} from "@/console/member-name";
import { RunTime } from "@/console/run-time";

export type RunOutcomeStatus =
  | "run-not-started"
  | "run-stuck"
  | "user-stopped"
  | "resume-unavailable"
  | "retry-exhausted";

export interface RunOutcomeProps {
  status: RunOutcomeStatus;
  role?: string | null;
  memberIdentities?: readonly OperatorMemberIdentity[];
  rawReason?: string | null;
  rawOutput?: string | null;
  description?: string | null;
  elapsedMs?: number | null;
  completedAt?: string | null;
  defaultOpen?: boolean;
  onOpenOutput?: (rawOutput: string | null) => void;
  onOpenDiagnostics?: () => void;
  onRetry?: () => void;
  onEditAndResend?: () => void;
  className?: string;
}

const outcomeLabelKeys: Record<RunOutcomeStatus, TranslationKey> = {
  "retry-exhausted": "console.runOutcome.retryExhausted.title",
  "run-not-started": "console.runOutcome.notStarted.title",
  "user-stopped": "console.runOutcome.userStopped.title",
  "resume-unavailable": "console.runOutcome.resumeUnavailable.title",
  "run-stuck": "console.runOutcome.stuck.title",
};

const outcomeDescriptionKeys: Record<RunOutcomeStatus, TranslationKey> = {
  "retry-exhausted": "console.runOutcome.retryExhausted.description",
  "run-not-started": "console.runOutcome.notStarted.description",
  "user-stopped": "console.runOutcome.userStopped.description",
  "resume-unavailable": "console.runOutcome.resumeUnavailable.description",
  "run-stuck": "console.runOutcome.stuck.description",
};

export function RunOutcome({
  status,
  role,
  memberIdentities = [],
  rawReason: _rawReason,
  rawOutput,
  description,
  elapsedMs,
  completedAt,
  defaultOpen: _defaultOpen,
  onOpenOutput,
  onOpenDiagnostics: _onOpenDiagnostics,
  onRetry,
  onEditAndResend,
  className,
}: RunOutcomeProps): JSX.Element {
  const { t } = useI18n();
  const roleLabel = role
    ? resolveOperatorMemberName(role, memberIdentities, t, t("console.common.collaborator"))
    : null;

  return (
    <div
      className={cn(
        "flex max-w-[720px] items-start gap-2.5 rounded-[10px] border border-line bg-card px-3.5 py-2.5",
        className,
      )}
    >
      <span className="mt-0.5 flex shrink-0" aria-hidden="true">
        <OutcomeIcon status={status} />
      </span>
      <span className="min-w-0 flex-1 text-[13px] leading-5 text-ink">
        <span className="flex flex-wrap items-center gap-x-2">
          <span>{t(outcomeLabelKeys[status])}</span>
          {roleLabel ? <span className="text-xs text-sub">{roleLabel}</span> : null}
          {elapsedMs !== null && elapsedMs !== undefined ? (
            <RunTime mode="completed" elapsedMs={elapsedMs} completedAt={completedAt} />
          ) : null}
        </span>
        <span className="mt-0.5 block text-xs text-sub">
          {description?.trim() || t(outcomeDescriptionKeys[status])}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {status === "run-not-started" || status === "run-stuck" || status === "resume-unavailable" ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t(status === "resume-unavailable" ? "console.runOutcome.rerun" : "common.retry")}
          </Button>
        ) : status === "user-stopped" && onEditAndResend !== undefined ? (
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
  );
}

function nonBlank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function OutcomeIcon({ status }: { status: RunOutcomeStatus }): JSX.Element {
  if (status === "run-not-started") {
    return <AlertTriangle className="h-[15px] w-[15px] text-[var(--status-run-fg)]" strokeWidth={1.5} />;
  }
  if (status === "run-stuck") {
    return <Clock3 className="h-[15px] w-[15px] text-[var(--status-run-fg)]" strokeWidth={1.5} />;
  }
  if (status === "user-stopped") {
    return <CirclePause className="h-[15px] w-[15px] text-sub" strokeWidth={1.5} />;
  }
  if (status === "resume-unavailable") {
    return <Ban className="h-[15px] w-[15px] text-danger" strokeWidth={1.5} />;
  }
  return <Ban className="h-[15px] w-[15px] text-danger" strokeWidth={1.5} />;
}
