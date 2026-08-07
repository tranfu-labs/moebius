import { useState } from "react";

import { AgentPortrait } from "@/console/agent-portrait";
import { type ExecutionEngine } from "@/console/provider-mark";
import { useI18n } from "@/i18n";

export interface AgentTeamOptionView {
  label: string;
  ownership?: "system" | "user";
  description?: string | null;
  primaryAgentSlug?: string | null;
  members: ReadonlyArray<{
    slug: string;
    displayName: string;
    engine?: { cli: ExecutionEngine; providerId?: string };
  }>;
}

export function AgentTeamOption({ team, memberLimit = 3 }: {
  team: AgentTeamOptionView;
  memberLimit?: number;
}): JSX.Element {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const visibleMembers = expanded ? team.members : team.members.slice(0, memberLimit);
  const hiddenCount = team.members.length - visibleMembers.length;
  const primary = team.members.find((member) => member.slug === team.primaryAgentSlug);
  return (
    <span className="grid min-w-0 flex-1 gap-1 py-0.5 text-left">
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium text-ink">{team.label}</span>
        {team.ownership ? (
          <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] font-normal text-sub">
            {t(team.ownership === "system" ? "console.agentTeamOption.official" : "console.agentTeamOption.user")}
          </span>
        ) : null}
      </span>
      {team.description ? <span className="line-clamp-2 text-xs font-normal leading-4 text-sub">{team.description}</span> : null}
      <span className="flex flex-wrap items-center gap-1 text-[11px] font-normal text-sub">
        {primary ? <span>{t("console.agentTeamOption.primary", { name: primary.displayName || `@${primary.slug}` })}</span> : null}
        <span>{t("console.agentTeamOption.memberCount", { count: team.members.length })}</span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        {visibleMembers.map((member) => (
          <span key={member.slug} className="inline-flex items-center gap-1 text-[11px] font-normal text-sub">
            <AgentPortrait displayName={member.displayName} slug={member.slug} engine={member.engine} className="h-5 w-5" />
            <span>{member.displayName || `@${member.slug}`}</span>
          </span>
        ))}
        {hiddenCount > 0 ? (
          <button
            type="button"
            className="rounded-full border border-line px-1.5 py-0.5 text-[10px] font-medium text-sub hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-expanded={expanded}
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setExpanded(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                setExpanded(true);
              }
            }}
          >
            +{hiddenCount}
          </button>
        ) : expanded && team.members.length > memberLimit ? (
          <button
            type="button"
            className="text-[10px] font-medium text-sub hover:text-ink"
            onClick={(event) => { event.preventDefault(); event.stopPropagation(); setExpanded(false); }}
          >
            {t("console.agentTeamOption.collapse")}
          </button>
        ) : null}
      </span>
    </span>
  );
}
