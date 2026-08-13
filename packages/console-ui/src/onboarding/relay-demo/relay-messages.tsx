import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import type {
  OperatorAgentTeamMember,
  OperatorAgentTeamRelayBeat,
} from "@/console/agent-teams-page";

export function RelayMessages({
  activeIndex,
  beats,
  members,
  reducedMotion,
  typingIndex,
  visibleCount,
}: {
  activeIndex: number;
  beats: readonly OperatorAgentTeamRelayBeat[];
  members: readonly OperatorAgentTeamMember[];
  reducedMotion: boolean;
  typingIndex: number;
  visibleCount: number;
}): JSX.Element {
  const { t } = useI18n();
  const membersBySlug = new Map(members.map((member) => [member.slug, member]));
  return (
    <>
      {beats.map((beat, index) => {
        const member = membersBySlug.get(beat.speakerSlug);
        if (member === undefined) {
          throw new Error(`Relay speaker is not a current team member: ${beat.speakerSlug}`);
        }
        const visible = index < visibleCount;
        const current = index === activeIndex;
        const typing = index === typingIndex && !visible;
        return (
          <article
            className={cn(
              "min-w-0 border-b border-line px-3 py-2.5 transition-[opacity,background-color] last:border-b-0",
              visible || typing ? "opacity-100" : "opacity-0",
              current && "rounded-lg bg-sunken",
            )}
            style={{ gridColumn: 2, gridRow: index + 1 }}
            data-testid="relay-message-row"
            data-relay-row={index}
            data-grid-row={index + 1}
            data-visible={visible ? "true" : "false"}
            data-typing={typing ? "true" : "false"}
            aria-hidden={!visible && !typing}
            key={`message-${String(index)}`}
          >
            {typing ? (
              <div
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-sunken px-2.5 py-2"
                data-testid="relay-typing"
                role="status"
                aria-label={t("onboarding.relay.typing", {
                  name: member.displayName || member.slug,
                })}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sel text-meta font-semibold text-sub">
                  {(member.displayName || member.slug).slice(0, 1)}
                </span>
                <span className="flex items-center gap-1" aria-hidden="true">
                  {[0, 1, 2].map((dot) => (
                    <i
                      className={cn(
                        "h-1 w-1 rounded-full bg-sub",
                        !reducedMotion && "animate-pulse",
                      )}
                      style={reducedMotion ? undefined : { animationDelay: `${String(dot * 120)}ms` }}
                      key={dot}
                    />
                  ))}
                </span>
              </div>
            ) : (
              <>
                <header className="flex min-w-0 items-center gap-2">
                  <strong className="min-w-0 text-xs font-semibold text-ink">
                    {member.displayName || `@${member.slug}`}
                  </strong>
                  <span className="shrink-0 text-meta tabular-nums text-hint">
                    {t("onboarding.relay.beat", { count: index + 1 })}
                  </span>
                  {current ? (
                    <span className="ml-auto shrink-0 rounded-full border border-[var(--status-run-line)] bg-[var(--status-run-bg)] px-2 py-0.5 text-meta font-normal text-[var(--status-run-fg)]">
                      {index === beats.length - 1
                        ? t("onboarding.relay.wrapUp")
                        : t("onboarding.relay.processing")}
                    </span>
                  ) : null}
                </header>
                <p className={cn("mt-1 text-xs leading-5", current ? "text-ink" : "text-sub")}>
                  {beat.message}
                </p>
              </>
            )}
          </article>
        );
      })}
    </>
  );
}
