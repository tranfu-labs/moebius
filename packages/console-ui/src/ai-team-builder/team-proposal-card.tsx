import {
  ArrowRight,
  Check,
  MessageSquarePlus,
  Sparkles,
  UserRound,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { Button } from "@/ui/button";

export interface TeamProposalMember {
  slug: string;
  name: string;
  role: string;
  responsibilities: string[];
  handoffs: string[];
}

export interface TeamProposalRelayBeat {
  speakerSlug: string;
  message: string;
}

export interface TeamProposalPreview {
  team: {
    name: string;
    purpose: string;
  };
  members: TeamProposalMember[];
  primaryAgentSlug: string;
  relayBeats: TeamProposalRelayBeat[];
}

export interface TeamProposalCardProps {
  proposal: TeamProposalPreview;
  revision: number;
  readOnly?: boolean;
  committing?: boolean;
  onAdjust?: () => void;
  onCommit?: (revision: number) => void;
}

export function TeamProposalCard({
  proposal,
  revision,
  readOnly = false,
  committing = false,
  onAdjust,
  onCommit,
}: TeamProposalCardProps): JSX.Element {
  const { t } = useI18n();
  const membersBySlug = new Map(proposal.members.map((member) => [member.slug, member]));

  return (
    <section
      aria-label={t("teamBuilder.proposalLabel")}
      className={cn(
        "ml-9 shrink-0 overflow-hidden rounded-lg border bg-card transition-colors max-sm:ml-0",
        readOnly ? "border-line" : "border-accent",
      )}
      data-testid="team-proposal"
    >
      <div className="flex items-start justify-between gap-3 border-b border-line bg-sunken p-4">
        <div className="min-w-0">
          <span className="text-xs font-semibold uppercase tracking-[0.05em] text-sub">
            {t("teamBuilder.proposalMembers", { count: proposal.members.length })}
          </span>
          <h2 className="mt-1.5 truncate text-base font-semibold tracking-[-0.01em] text-ink">
            {proposal.team.name}
          </h2>
          <p className="mt-1 text-xs leading-5 text-sub">{proposal.team.purpose}</p>
        </div>
        <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-accent/30 bg-sel px-2.5 text-xs font-medium text-accent">
          <Sparkles className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
          {t("teamBuilder.generated")}
        </span>
      </div>

      <div className="divide-y divide-line">
        {proposal.members.map((member) => {
          const primary = member.slug === proposal.primaryAgentSlug;
          return (
            <article className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 p-3" key={member.slug}>
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-sunken text-sub">
                <UserRound className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <strong className="text-sm font-medium text-ink">{member.name}</strong>
                  {primary ? (
                    <span className="rounded-full bg-sel px-2 py-0.5 text-[11px] font-medium text-accent">
                      {t("teamBuilder.primaryAgent")}
                    </span>
                  ) : null}
                  <code className="text-xs text-hint">@{member.slug}</code>
                </div>
                <p className="mt-1 text-xs leading-5 text-sub">{member.role}</p>
              </div>
            </article>
          );
        })}
      </div>

      <div
        aria-label={t("teamBuilder.relayLabel")}
        className="flex flex-wrap items-center justify-center gap-2 border-t border-line bg-sunken px-3 py-2.5 text-xs text-hint"
      >
        <span>{t("teamBuilder.you")}</span>
        {proposal.relayBeats.map((beat, index) => {
          const member = membersBySlug.get(beat.speakerSlug);
          return (
            <span className="contents" key={`${beat.speakerSlug}-${String(index)}`}>
              <ArrowRight className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
              <strong className="font-medium text-sub" title={beat.message}>
                {member?.name ?? `@${beat.speakerSlug}`}
              </strong>
            </span>
          );
        })}
      </div>

      {!readOnly ? (
        <div className="flex items-center justify-end gap-2 border-t border-line p-3 max-sm:flex-col-reverse max-sm:items-stretch">
          <Button type="button" variant="outline" onClick={onAdjust} disabled={committing}>
            <MessageSquarePlus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            {t("teamBuilder.adjust")}
          </Button>
          <Button
            type="button"
            onClick={() => onCommit?.(revision)}
            disabled={committing}
            data-testid="confirm-created-team"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            {committing ? t("teamBuilder.creating") : t("teamBuilder.createAndSelect")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
