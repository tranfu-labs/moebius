import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export interface ConversationEmptyStateProps {
  projectName: string;
  className?: string;
}

export function ConversationEmptyState({ projectName, className }: ConversationEmptyStateProps): JSX.Element {
  const { t } = useI18n();
  return (
    <div className={cn("grid min-h-full place-items-center px-6 pb-12 text-center", className)}>
      <div className="max-w-xl">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-hint">
          {t("console.emptyState.eyebrow")}
        </p>
        <h1 className="font-sans text-lg font-normal leading-9 tracking-[-0.025em] text-ink">
          {t("console.emptyState.promptBefore")} <span className="font-semibold">{projectName}</span> {t("console.emptyState.promptAfter")}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-sub">
          {t("console.emptyState.description")}
        </p>
      </div>
    </div>
  );
}
