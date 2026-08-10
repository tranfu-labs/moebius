import { X } from "lucide-react";

import { useI18n } from "@/i18n";
import { Button } from "@/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/ui/dialog";

export interface SessionTeamUpdateDetailChange {
  summary: string;
  authorLabel: string;
  previousText?: string | null;
}

export interface SessionTeamUpdateDetailMember {
  memberSlug: string;
  displayName: string;
  changes: readonly SessionTeamUpdateDetailChange[];
}

export interface SessionTeamUpdateDetailView {
  teamName: string;
  members: readonly SessionTeamUpdateDetailMember[];
}

/**
 * "View changes" popup for the composer's team-change notice. Reuses the same
 * paragraph-marker + authorship vocabulary as the `AGENT.md` editor (see the
 * detail-dialog structure in `docs/product/pages/main-conversation.md`). The
 * dialog's own apply action MUST carry the identical whole-team apply
 * semantics as the notice's apply action — it is not a per-item apply, see
 * `onApply`.
 */
export function SessionTeamUpdateDetailDialog({
  open,
  view,
  onOpenChange,
  onCancel,
  onApply,
}: {
  open: boolean;
  view: SessionTeamUpdateDetailView | null;
  onOpenChange(open: boolean): void;
  onCancel(): void;
  onApply?(): void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="grid max-h-[calc(100vh-64px)] w-[min(560px,calc(100vw-32px))] grid-rows-[auto_minmax(0,1fr)_auto]"
        aria-label={view === null ? undefined : t("console.sessionTeamUpdate.detailTitle", { team: view.teamName })}
      >
        <header className="flex min-h-[52px] items-center justify-between border-b border-line bg-card px-4">
          <DialogTitle className="font-semibold">
            {view === null ? "" : t("console.sessionTeamUpdate.detailTitle", { team: view.teamName })}
          </DialogTitle>
          <DialogClose asChild>
            <button
              type="button"
              className="rounded-sm p-2 text-sub hover:bg-hover"
              aria-label={t("common.close")}
              onClick={onCancel}
            >
              <X className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            </button>
          </DialogClose>
        </header>
        <div className="scroll-thin min-h-0 overflow-auto p-4">
          {view === null ? null : view.members.map((member) => (
            <div key={member.memberSlug} className="mb-4 last:mb-0">
              <p className="text-sm font-medium text-ink">{member.displayName || `@${member.memberSlug}`}</p>
              <ul className="mt-1.5 space-y-2">
                {member.changes.map((change, index) => (
                  <li key={index} className="border-l-2 border-accent/50 pl-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span className="text-ink">{change.summary}</span>
                      <span className="shrink-0 text-xs text-hint">{change.authorLabel}</span>
                    </div>
                    {change.previousText != null && change.previousText.length > 0 ? (
                      <p className="mt-1 text-xs leading-5 text-hint">
                        {t("console.sessionTeamUpdate.previouslyPrefix", { text: change.previousText })}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("console.sessionTeamUpdate.detailCancel")}
          </Button>
          <Button type="button" onClick={onApply}>
            {t("console.sessionTeamUpdate.apply")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
