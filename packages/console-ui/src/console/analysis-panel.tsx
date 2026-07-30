import { AlertCircle, MessagesSquare, RefreshCw } from "lucide-react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export const ANALYSIS_PANEL_WIDTH_PX = 288;
export const ANALYSIS_PANEL_SPLIT_MIN_WIDTH_PX = 900;

export interface AnalysisPanelEntry {
  sessionId: string;
  title: string;
  createdLabel?: string;
  duplicateLabel?: string;
}

export type AnalysisPanelState =
  | { status: "loading" }
  | { status: "failed"; message?: string }
  | {
      status: "ready";
      entries: readonly AnalysisPanelEntry[];
      actionError?: string | null;
    };

export interface AnalysisPanelProps {
  id?: string;
  state: AnalysisPanelState;
  layout: "split" | "overlay";
  onOpenEntry(entry: AnalysisPanelEntry): void;
  onRetry?: () => void;
  className?: string;
}

export function AnalysisPanel({
  id = "conversation-analysis-panel",
  state,
  layout,
  onOpenEntry,
  onRetry,
  className,
}: AnalysisPanelProps): JSX.Element {
  const { t } = useI18n();

  return (
    <aside
      id={id}
      className={cn(
        "absolute right-3 top-[var(--window-header-height)] z-20 flex max-h-[min(420px,calc(100%_-_var(--window-header-height)_-_16px))] min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-card",
        layout === "split" ? "w-72" : "left-3",
        className,
      )}
      aria-label={t("console.analysisPanel.label")}
      data-layout={layout}
      data-testid="analysis-panel"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3.5">
        <MessagesSquare className="h-3.5 w-3.5 text-sub" strokeWidth={1.5} aria-hidden="true" />
        <h2 className="text-[12.5px] font-semibold text-ink">
          {t("console.analysisPanel.title")}
        </h2>
      </header>

      <div className="scroll-thin min-h-0 overflow-y-auto p-1.5">
        {state.status === "loading" ? (
          <div
            className="flex items-center gap-2 px-2 py-3 text-xs leading-5 text-sub"
            role="status"
          >
            <RefreshCw className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
            <span>{t("console.analysisPanel.loading")}</span>
          </div>
        ) : state.status === "failed" ? (
          <div className="px-2 py-3" role="alert">
            <div className="flex items-start gap-2 text-xs leading-5 text-danger">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <span>{state.message ?? t("console.analysisPanel.failed")}</span>
            </div>
            {onRetry ? (
              <button
                type="button"
                className="mt-2 rounded-sm border border-line px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                onClick={onRetry}
              >
                {t("console.analysisPanel.retry")}
              </button>
            ) : null}
          </div>
        ) : state.entries.length === 0 ? (
          <p className="px-2 py-3 text-xs leading-5 text-sub">
            {t("console.analysisPanel.empty")}
          </p>
        ) : (
          <>
            <div className="space-y-0.5">
              {state.entries.map((entry) => {
                const metadata = [entry.createdLabel, entry.duplicateLabel].filter(Boolean).join(" · ");
                const accessibleName = metadata === ""
                  ? entry.title
                  : t("console.analysisPanel.entryWithMetadata", {
                      title: entry.title,
                      metadata,
                    });
                return (
                  <button
                    key={entry.sessionId}
                    type="button"
                    className="block w-full rounded-md px-2.5 py-2 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    aria-label={accessibleName}
                    title={accessibleName}
                    onClick={() => onOpenEntry(entry)}
                  >
                    <span className="block truncate text-[12.5px] font-medium text-ink">
                      {entry.title}
                    </span>
                    {metadata === "" ? null : (
                      <span className="mt-0.5 block truncate text-[11.5px] text-sub">
                        {metadata}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {state.actionError ? (
              <p className="mx-2 mt-1 border-t border-line py-2 text-xs leading-5 text-danger" role="alert">
                {state.actionError}
              </p>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
