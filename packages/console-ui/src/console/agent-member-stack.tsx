import { AgentPortrait } from "@/console/agent-portrait";
import { type ExecutionEngine } from "@/console/provider-mark";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export interface AgentMemberStackMember {
  slug: string;
  displayName: string;
  portraitId?: string | null;
  engine?: { cli: ExecutionEngine; providerId?: string };
}

/**
 * Avatar row for team members. Names stay out of the avatars: a list row has no
 * stable width for them, and the earlier fixed-width chips truncated CJK names
 * down to a single glyph. The full names ride on `title` plus the group's
 * accessible name; only the identity-colored portrait shows.
 *
 * The engine mark rides on each avatar rather than being summarised for the team, because
 * which model an agent runs on is a fact about that agent — a team-level roll-up tells you
 * the set in play but never which member is which.
 */
export function AgentMemberStack({
  members,
  primarySlug,
  allMembers,
  limit = 3,
  className,
}: {
  members: readonly AgentMemberStackMember[];
  primarySlug?: string | null;
  /** Full roster for the accessible name, when the visible stack omits the primary agent. */
  allMembers?: readonly AgentMemberStackMember[];
  limit?: number;
  className?: string;
}): JSX.Element {
  const { t } = useI18n();
  const visibleMembers = members.slice(0, limit);
  const hiddenCount = Math.max(0, members.length - visibleMembers.length);
  const named = allMembers ?? members;

  return (
    <span
      className={cn("flex min-w-0 items-center gap-1.5", className)}
      role="group"
      aria-label={t("console.agentTeams.memberStackLabel", {
        names: named
          .map((member) => member.displayName || `@${member.slug}`)
          .join(t("console.agentTeams.memberSeparator")),
      })}
    >
      {visibleMembers.map((member) => {
        const name = member.displayName || `@${member.slug}`;
        const title = member.slug === primarySlug
          ? `${name} ${t("console.agentTeams.primarySuffix")}`
          : name;
        return (
          <AgentPortrait
            key={member.slug}
            size="stack"
            displayName={member.displayName}
            slug={member.slug}
            portraitId={member.portraitId}
            engine={member.engine}
            title={title}
          />
        );
      })}
      {hiddenCount > 0 ? (
        <span
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] font-medium text-hint"
          aria-label={t("console.agentTeams.moreMembers", { count: hiddenCount })}
        >
          ＋{hiddenCount}
        </span>
      ) : null}
    </span>
  );
}
