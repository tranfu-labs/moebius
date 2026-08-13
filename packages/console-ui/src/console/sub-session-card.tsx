import { ChevronRight } from "lucide-react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/badge";

export type SubSessionStatus =
  | "running"
  | "waiting"
  | "finished"
  | "not-started"
  | "stuck"
  | "stopped"
  | "retry-exhausted"
  | "unavailable";

export interface SubSessionCardItem {
  sessionId: string;
  title: string;
  memberName: string;
  status: SubSessionStatus;
  statusLabel: string;
}

export function SubSessionCard({
  items,
  openedSessionId,
  onOpen,
  className,
}: {
  items: readonly SubSessionCardItem[];
  openedSessionId?: string | null;
  onOpen?: (sessionId: string) => void;
  className?: string;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <section
      className={cn("overflow-hidden rounded-md border border-line bg-card", className)}
      aria-label={t("console.subSession.label")}
      data-testid="sub-session-card"
    >
      {items.map((item) => {
        const opened = item.sessionId === openedSessionId;
        return (
          <button
            key={item.sessionId}
            type="button"
            className={cn(
              "grid min-h-11 w-full grid-cols-[minmax(0,1fr)_minmax(5rem,auto)_auto] items-center gap-3 border-b border-line px-3.5 text-left text-sm last:border-b-0 hover:bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent",
              opened && "bg-sel",
            )}
            aria-label={t("console.subSession.itemLabel", {
              title: item.title,
              member: item.memberName,
              status: item.statusLabel,
            })}
            aria-pressed={opened}
            data-session-id={item.sessionId}
            data-status={item.status}
            data-testid="sub-session-card-row"
            onClick={() => onOpen?.(item.sessionId)}
          >
            <span className="flex min-w-0 items-center gap-1.5 font-normal text-ink">
              <ChevronRight
                className={cn("h-3.5 w-3.5 shrink-0 text-hint", opened && "rotate-90 text-accent")}
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <span className="truncate" title={item.title}>{item.title}</span>
            </span>
            <span className="truncate text-sm text-sub" title={item.memberName}>{item.memberName}</span>
            <span className="flex justify-end">
              <Badge variant={statusBadgeVariant(item.status)}>{item.statusLabel}</Badge>
            </span>
          </button>
        );
      })}
    </section>
  );
}

function statusBadgeVariant(status: SubSessionStatus): "running" | "waiting" | "completed" | "interrupted" | "failed" {
  switch (status) {
    case "running":
      return "running";
    case "waiting":
      return "waiting";
    case "finished":
      return "completed";
    case "stopped":
      return "interrupted";
    default:
      return "failed";
  }
}
