import { useState, type ReactNode } from "react";

import { AgentInitialAvatar } from "@/console/agent-initial-avatar";
import { useI18n } from "@/i18n";
import {
  DropdownMenuContent,
  DropdownMenuSeparator,
} from "@/ui/dropdown-menu";

export interface AgentTeamOptionView {
  label: string;
  ownership?: "system" | "user";
  description?: string | null;
  primaryAgentSlug?: string | null;
  members: ReadonlyArray<{ slug: string; displayName: string }>;
}

export function AgentTeamOption({ team }: {
  team: AgentTeamOptionView;
}): JSX.Element {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const primary = team.members.find((member) => member.slug === team.primaryAgentSlug);
  const stopMenuSelection = (event: { preventDefault: () => void; stopPropagation: () => void }): void => {
    event.preventDefault();
    event.stopPropagation();
  };
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
      {team.description ? <span className="truncate text-xs font-normal leading-4 text-sub">{team.description}</span> : null}
      <span className="flex flex-wrap items-center gap-1 text-[11px] font-normal text-sub">
        {primary ? <span>{t("console.agentTeamOption.primary", { name: primary.displayName || `@${primary.slug}` })}</span> : null}
        <span>{t("console.agentTeamOption.memberCount", { count: team.members.length })}</span>
        {team.members.length > 0 ? (
          <button
            type="button"
            className="ml-auto rounded px-1 py-0.5 text-[10px] font-medium text-sub hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-expanded={expanded}
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              stopMenuSelection(event);
              setExpanded((value) => !value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                stopMenuSelection(event);
                setExpanded((value) => !value);
              }
            }}
          >
            {t(expanded ? "console.agentTeamOption.collapse" : "console.agentTeamOption.showMembers")}
          </button>
        ) : null}
      </span>
      {expanded ? (
        <span
          className="scroll-thin flex max-h-24 flex-wrap items-start gap-1.5 overflow-y-auto overscroll-contain rounded-md bg-sunken px-1.5 py-1"
          data-testid="agent-team-members"
        >
          {team.members.map((member) => (
            <span key={member.slug} className="inline-flex items-center gap-1 text-[11px] font-normal text-sub">
              <AgentInitialAvatar displayName={member.displayName} slug={member.slug} className="h-5 w-5 text-[10px]" />
              <span>{member.displayName || `@${member.slug}`}</span>
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

export function AgentTeamMenuContent({
  align,
  header,
  catalogLabel,
  children,
  footer,
}: {
  align: "start" | "center" | "end";
  header?: ReactNode;
  catalogLabel?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}): JSX.Element {
  return (
    <DropdownMenuContent
      align={align}
      side="top"
      collisionPadding={12}
      className="flex w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden p-0"
      style={{ maxHeight: "min(430px, var(--radix-dropdown-menu-content-available-height), calc(100dvh - 24px))" }}
    >
      {header ? (
        <>
          <div className="shrink-0 p-1">{header}</div>
          <DropdownMenuSeparator className="m-0" />
        </>
      ) : null}
      <div className="scroll-thin min-h-0 overflow-y-auto overscroll-contain p-1" data-testid="agent-team-catalog">
        {catalogLabel ? <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-hint">{catalogLabel}</div> : null}
        {children}
      </div>
      {footer ? (
        <>
          <DropdownMenuSeparator className="m-0" />
          <div className="shrink-0 px-3 py-2 text-xs leading-5 text-sub">{footer}</div>
        </>
      ) : null}
    </DropdownMenuContent>
  );
}
