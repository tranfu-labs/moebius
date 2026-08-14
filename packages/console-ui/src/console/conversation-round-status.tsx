import { ChevronRight } from "lucide-react";

import { useI18n, type TranslationKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { ConversationStatusIndicator } from "@/console/conversation-sidebar";
import type { ConversationStatusDot } from "@/console/status-dot";

/**
 * Review display component for the sidebar mapping "round state → a single
 * final visible dot" plus a Dock count. Each conversation shows exactly one
 * dot; the Dock badge counts only currently visible red and blue dots.
 * The project row can be interactive (collapse/expand) when onToggleProject
 * is provided. It performs no derivation and shows no reviewer hints.
 * The new-semantics derivation belongs to the upcoming feature change and
 * must not replace the existing `deriveStatusDot` here.
 */
export interface ConversationRoundStatusRow {
  id: string;
  title: string;
  dot: ConversationStatusDot;
}

export interface ConversationRoundStatusListProps {
  rows: readonly ConversationRoundStatusRow[];
  dockCount: number;
  /** Aggregated dot for a collapsed project row (red > blue > blink), display only. */
  projectStatus?: ConversationStatusDot | null;
  /** Whether the project row starts collapsed (only meaningful with onToggleProject). */
  projectCollapsed?: boolean;
  onToggleProject?: () => void;
}

const dotLabelKey: Record<"red" | "blue" | "blink", TranslationKey> = {
  red: "notification.dot.red",
  blue: "notification.dot.blue",
  blink: "notification.dot.blink",
};

export function ConversationRoundStatusList({
  rows,
  dockCount,
  projectStatus = null,
  projectCollapsed = false,
  onToggleProject,
}: ConversationRoundStatusListProps): JSX.Element {
  const { t } = useI18n();
  const collapsed = projectCollapsed && onToggleProject !== undefined;
  const projectLabel = projectStatus === null || projectStatus === "none"
    ? t("console.conversationSidebar.projects")
    : t("console.conversationSidebar.projectState", {
        project: t("console.conversationSidebar.projects"),
        expanded: t(collapsed ? "console.conversationSidebar.collapsed" : "console.conversationSidebar.expanded"),
        status: t(dotLabelKey[projectStatus]),
      });
  const projectContent = projectStatus !== null ? (
    <div
      className={cn(
        "flex h-8 items-center gap-2 border-b border-line px-3",
        onToggleProject !== undefined && "w-full text-left",
      )}
    >
      <span className="h-3 w-3 rounded-md bg-line" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-sm font-normal text-ink">
        {t("console.conversationSidebar.projects")}
      </span>
      {projectStatus !== "none" ? (
        <RoundStatusDot dot={projectStatus} label={t(dotLabelKey[projectStatus])} />
      ) : null}
      {onToggleProject !== undefined ? (
        <ChevronRight
          className={cn("h-3.5 w-3.5 shrink-0 text-sub transition-transform", !collapsed && "rotate-90")}
          strokeWidth={1.5}
          aria-hidden="true"
        />
      ) : null}
    </div>
  ) : null;

  return (
    <section
      className="w-[252px] rounded-lg border border-line bg-canvas text-ink"
      aria-label={t("notification.status.title")}
      data-testid="conversation-round-status"
    >
      <header className="flex h-9 items-center border-b border-line px-3">
        <h2 className="text-xs font-normal uppercase tracking-[0.06em] text-sub">
          {t("notification.status.title")}
        </h2>
      </header>

      {projectContent !== null ? (
        onToggleProject !== undefined ? (
          <button
            type="button"
            className="flex w-full cursor-pointer items-stretch border-b border-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            aria-expanded={!collapsed}
            aria-label={projectLabel}
            data-testid="project-collapse-toggle"
            onClick={onToggleProject}
          >
            {projectContent}
          </button>
        ) : (
          projectContent
        )
      ) : null}

      {!collapsed ? (
        <ul className="space-y-0.5 p-1.5" role="list">
          {rows.map((row) => (
            <li key={row.id}>
              <div
                className="flex h-8 min-w-0 items-center gap-1.5 rounded-xl px-2"
                data-testid="conversation-round-status-row"
                data-dot={row.dot}
              >
                <span className="min-w-0 flex-1 truncate text-sm text-sub" title={row.title}>
                  {row.title}
                </span>
                {row.dot !== "none" ? (
                  <RoundStatusDot dot={row.dot} label={t(dotLabelKey[row.dot])} />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <footer className="flex h-9 items-center justify-between border-t border-line px-3">
        <span className="text-xs text-sub">{t("notification.dock.label")}</span>
        <span className="tnum text-sm text-ink" data-testid="conversation-round-dock-count">
          {t("notification.dock.count", { count: dockCount })}
        </span>
      </footer>
    </section>
  );
}

function RoundStatusDot({
  dot,
  label,
}: {
  dot: "red" | "blue" | "blink";
  label: string;
}): JSX.Element {
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center" role="img" aria-label={label} title={label}>
      <span aria-hidden="true">
        <ConversationStatusIndicator status={dot} />
      </span>
    </span>
  );
}
