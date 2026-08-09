import { AlertTriangle } from "lucide-react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { RunTime } from "@/console/run-time";

/** What went wrong with one run, as the timeline states it. */
export interface MessageIncident {
  label: string;
  /** A real engine diagnostic, when the engine produced one. */
  detail?: string | null;
  /** The visible body stops mid-thought, so it must not be read as final. */
  contentIncomplete?: boolean;
  severity?: "warning" | "danger";
  /**
   * How long the run took, for the case where the message has no identity header
   * to carry it. Leave unset when the header already shows it — the elapsed time
   * belongs to the run and must appear exactly once.
   */
  elapsedMs?: number | null;
  completedAt?: string | null;
}

/**
 * A one-line statement that this run ended badly — and nothing else.
 *
 * It carries no buttons: recovery lives in the message toolbar, where it sits on
 * every message. Timing normally comes from the identity header; the notice only
 * shows it when there is no header to carry it, never both.
 * Keeping the notice to a single content-width line stops a two-word state from
 * claiming a full-width box, and stops the same situation from having two
 * different shapes depending on how it ended.
 */
export function IncidentNotice({ incident, className }: {
  incident: MessageIncident;
  className?: string;
}): JSX.Element {
  const { t } = useI18n();
  const danger = incident.severity === "danger";
  const detail = incident.detail?.trim();

  return (
    <div
      role="status"
      className={cn(
        "inline-flex max-w-full flex-wrap items-center gap-x-1.5 rounded-md bg-sunken px-2 py-1 text-[12.5px] leading-5",
        className,
      )}
    >
      <AlertTriangle
        className={cn("h-3.5 w-3.5 shrink-0", danger ? "text-danger" : "text-[var(--status-run-fg)]")}
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <span className="text-ink">{incident.label}</span>
      {incident.elapsedMs !== null && incident.elapsedMs !== undefined ? (
        <RunTime mode="completed" elapsedMs={incident.elapsedMs} completedAt={incident.completedAt} />
      ) : null}
      {incident.contentIncomplete ? (
        <span className="text-sub">{t("console.incidentCard.incompleteHint")}</span>
      ) : null}
      {detail ? <span className="break-words text-sub">{detail}</span> : null}
    </div>
  );
}
