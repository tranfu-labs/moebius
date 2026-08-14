import { CircleCheck } from "lucide-react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";

export interface ResultCardProps {
  fileCount: number;
  onOpen(): void;
  className?: string;
}

export interface ResultCardVisibilityFacts {
  diffAvailable: boolean;
  isRunning: boolean;
  lastMessageMentionsAgent: boolean;
  hasCompletedStep: boolean;
  hasPendingWork: boolean;
}

export function shouldShowResultCard(facts: ResultCardVisibilityFacts): boolean {
  return facts.diffAvailable
    && !facts.isRunning
    && !facts.lastMessageMentionsAgent
    && facts.hasCompletedStep
    && !facts.hasPendingWork;
}

export function ResultCard({ fileCount, onOpen, className }: ResultCardProps): JSX.Element {
  const { t } = useI18n();
  const summary = fileCount === 0
    ? t("console.resultCard.noChanges")
    : t("console.resultCard.changes", { count: fileCount });

  return (
    <section
      className={cn("mt-4 flex max-w-[420px] items-center gap-2.5 rounded-md border border-line bg-card px-3.5 py-2.5", className)}
      aria-label={t("console.resultCard.label")}
      data-testid="conversation-result-card"
    >
      <CircleCheck className="h-[15px] w-[15px] shrink-0 text-pass" strokeWidth={1.5} aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm leading-5 text-ink">{summary}</p>
      <Button type="button" variant="outline" size="sm" onClick={onOpen}>
        {t("console.resultCard.view")}
      </Button>
    </section>
  );
}
