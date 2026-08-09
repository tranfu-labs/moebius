import { AlertTriangle } from "lucide-react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

/** What went wrong with one run, as the timeline states it. */
export interface MessageIncident {
  label: string;
  /** A real engine diagnostic, when the engine produced one. */
  detail?: string | null;
  /** The visible body stops mid-thought, so it must not be read as final. */
  contentIncomplete?: boolean;
  severity?: "warning" | "danger";
}

/**
 * A one-line statement that this run ended badly — and nothing else.
 *
 * It carries no buttons and no timing: recovery lives in the message toolbar
 * where it sits on every message, and the elapsed time is already in the header.
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
      {incident.contentIncomplete ? (
        <span className="text-sub">{t("console.incidentCard.incompleteHint")}</span>
      ) : null}
      {detail ? <span className="break-words text-sub">{detail}</span> : null}
    </div>
  );
}
