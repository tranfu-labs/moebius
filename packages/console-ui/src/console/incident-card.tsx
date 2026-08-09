import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { RunTime } from "@/console/run-time";

/** Everything that went wrong with one run, as the timeline states it. */
export interface MessageIncident {
  label: string;
  /** A real engine diagnostic, when the engine produced one. */
  detail?: string | null;
  /** The visible body stops mid-thought, so it must not be read as final. */
  contentIncomplete?: boolean;
  elapsedMs?: number | null;
  completedAt?: string | null;
  severity?: "warning" | "danger";
}

/**
 * A distinct card that follows the message it belongs to.
 *
 * It deliberately does not fold into an icon: a run that failed is not a
 * footnote on a successful message, and a lone marker leaves the user guessing.
 * The card names the state, carries the diagnostic, and puts recovery one
 * labelled click away — while the message above it stays untouched.
 */
export function IncidentCard({ incident, actions, className }: {
  incident: MessageIncident;
  actions?: ReactNode;
  className?: string;
}): JSX.Element {
  const { t } = useI18n();
  const danger = incident.severity === "danger";

  return (
    <div
      role="group"
      aria-label={incident.label}
      className={cn(
        "max-w-[720px] rounded-[10px] border bg-sunken px-3 py-2.5",
        danger ? "border-danger" : "border-line",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          className={cn("mt-0.5 h-4 w-4 shrink-0", danger ? "text-danger" : "text-[var(--status-run-fg)]")}
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 text-[13px] leading-5 text-ink">
            <span className="font-medium">{incident.label}</span>
            {incident.elapsedMs !== null && incident.elapsedMs !== undefined ? (
              <RunTime mode="completed" elapsedMs={incident.elapsedMs} completedAt={incident.completedAt} />
            ) : null}
          </div>
          {incident.contentIncomplete ? (
            <p className="mt-0.5 text-xs leading-5 text-sub">{t("console.incidentCard.incompleteHint")}</p>
          ) : null}
          {incident.detail?.trim() ? (
            <p className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-5 text-sub">
              {incident.detail.trim()}
            </p>
          ) : null}
          {actions ? <div className="mt-2">{actions}</div> : null}
        </div>
      </div>
    </div>
  );
}
