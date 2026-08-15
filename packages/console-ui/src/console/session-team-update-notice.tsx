import { AlertCircle, RefreshCw, X } from "lucide-react";

import { useI18n } from "@/i18n";
import { Button } from "@/ui/button";

export type SessionTeamUpdateCategoryKind = "agent-definition" | "execution-profile" | "team-information";
export interface SessionTeamUpdateViewState {
  status: "idle" | "available" | "waiting" | "failed" | "loading";
  categories: ReadonlyArray<{ kind: SessionTeamUpdateCategoryKind; affectedMemberCount: number }>;
  updateToken?: string | null;
  failure?: { code: string; summary: string } | null;
}

export function SessionTeamUpdateNotice({ state, onApply, onView, onDismissCategory, onRetry, onCancel }: {
  state: SessionTeamUpdateViewState;
  onApply?: () => void;
  /** Opens the "view changes" detail dialog; omit to keep today's apply-only row (no view/dismiss action rendered). */
  onView?: (kind: SessionTeamUpdateCategoryKind) => void;
  onDismissCategory?: (kind: SessionTeamUpdateCategoryKind) => void;
  onRetry?: () => void;
  onCancel?: () => void;
}): JSX.Element | null {
  const { t } = useI18n();
  if (state.status === "idle" || state.status === "loading") return null;
  if (state.status === "waiting") {
    return (
      <section
        className="mb-2 rounded-lg border border-line bg-card px-3 py-2 text-xs text-sub"
        role="status"
        aria-label={t("console.sessionTeamUpdate.label")}
      >
        <p className="font-normal text-ink">{t("console.sessionTeamUpdate.waitingTitle")}</p>
        <p className="mt-0.5">{t("console.sessionTeamUpdate.waitingDescription")}</p>
      </section>
    );
  }
  if (state.status === "failed") {
    return (
      <section
        className="mb-2 flex items-start gap-2 rounded-lg border border-line bg-card px-3 py-2 text-xs"
        role="alert"
        aria-label={t("console.sessionTeamUpdate.label")}
      >
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" strokeWidth={1.5} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-normal text-ink">{t("console.sessionTeamUpdate.failedTitle")}</p>
          <p className="mt-0.5 text-sub">{state.failure?.summary ?? t("console.sessionTeamUpdate.failedDescription")}</p>
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              <RefreshCw className="mr-1.5 h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
              {t("console.sessionTeamUpdate.retry")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>{t("console.sessionTeamUpdate.cancel")}</Button>
          </div>
        </div>
      </section>
    );
  }
  const labels: Record<SessionTeamUpdateCategoryKind, string> = {
    "agent-definition": t("console.sessionTeamUpdate.agentDefinition"),
    "execution-profile": t("console.sessionTeamUpdate.executionProfile"),
    "team-information": t("console.sessionTeamUpdate.teamInformation"),
  };
  return (
    <section className="mb-2 overflow-hidden rounded-lg border border-line bg-card" aria-label={t("console.sessionTeamUpdate.labelPlural")}>
      {state.categories.map((category) => (
        <div key={category.kind} className="flex min-h-9 items-center gap-3 border-b border-line px-3 py-1.5 text-xs last:border-b-0">
          <span className="min-w-0 flex-1 text-ink">{labels[category.kind]}</span>
          <span className="text-sub">{t("console.sessionTeamUpdate.memberCount", { count: category.affectedMemberCount })}</span>
          {onView !== undefined ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => onView(category.kind)}>
              {t("console.sessionTeamUpdate.view")}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" onClick={onApply}>{t("console.sessionTeamUpdate.apply")}</Button>
          {onDismissCategory !== undefined ? (
            <button
              type="button"
              className="rounded-sm p-1 text-hint hover:bg-hover hover:text-ink"
              aria-label={t("console.sessionTeamUpdate.dismiss", { category: labels[category.kind] })}
              onClick={() => onDismissCategory(category.kind)}
            >
              <X className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ))}
    </section>
  );
}
