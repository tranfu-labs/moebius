import { useI18n } from "@/i18n";
import { Button } from "@/ui/button";

export interface AgentMarkdownRevisionEntry {
  id: string;
  authorLabel: string;
  timeLabel: string;
  summary: string | null;
  summaryStatus: "pending" | "ready" | "unavailable";
  /**
   * True only for the current (newest) revision. The current version has no
   * restore action; EVERY historical revision, including the earliest, can be
   * restored to (「当前版本无回退，所有历史版本可回退」).
   */
  isLatest?: boolean;
}

export interface AgentMarkdownRevisionTimelineProps {
  memberDisplayName: string;
  entries: readonly AgentMarkdownRevisionEntry[];
  onRestore?(revisionId: string): void;
}

/**
 * Presentational, most-recent-first revision list. Purely a list — it never
 * renders content fingerprints, save-time technical detail or line diffs
 * (see the change-timeline section of `docs/product/pages/agent-teams.md`).
 */
export function AgentMarkdownRevisionTimeline({
  memberDisplayName,
  entries,
  onRestore,
}: AgentMarkdownRevisionTimelineProps): JSX.Element {
  const { t } = useI18n();
  return (
    <section
      className="mb-3 border border-line bg-sunken px-4 py-3"
      aria-label={t("console.agentMarkdownTimeline.label", { member: memberDisplayName })}
      data-testid="agent-markdown-revision-timeline"
    >
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-hint">
        {t("console.agentMarkdownTimeline.title", { member: memberDisplayName })}
      </h3>
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-sub">{t("console.agentMarkdownTimeline.empty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {entries.map((entry) => (
            <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-ink">{entry.authorLabel}</span>
                <span className="text-xs text-hint">{entry.timeLabel}</span>
              </div>
              <p className="mt-1 text-sm leading-6 text-sub" role={entry.summaryStatus === "pending" ? "status" : undefined}>
                {entry.summaryStatus === "pending"
                  ? t("console.agentMarkdownTimeline.summaryPending")
                  : entry.summaryStatus === "unavailable"
                    ? t("console.agentMarkdownTimeline.summaryUnavailable")
                    : entry.summary}
              </p>
              {!entry.isLatest && onRestore !== undefined ? (
                <div className="mt-2 flex justify-end">
                  <Button type="button" variant="ghost" size="sm" onClick={() => onRestore(entry.id)}>
                    {t("console.agentMarkdownTimeline.restore")}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
