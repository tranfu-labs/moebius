import { AlertTriangle, ChevronDown, Diamond } from "lucide-react";

import type { OperatorAgentTeam } from "@/console/agent-teams-page";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";

export function SessionTeamMenu({
  team,
  pendingTeam,
  missingTeamId,
  health,
  teams,
  disabled,
  onSelectTeam,
}: {
  team?: OperatorAgentTeam;
  pendingTeam?: OperatorAgentTeam;
  missingTeamId?: string | null;
  health?: "usable" | "deleted" | "needs-repair" | null;
  teams: readonly OperatorAgentTeam[];
  disabled?: boolean;
  onSelectTeam?: (team: OperatorAgentTeam) => void;
}): JSX.Element | null {
  const { t } = useI18n();
  const displayedTeam = pendingTeam ?? team;
  if (displayedTeam === undefined && missingTeamId == null) {
    return null;
  }
  const teamLabel = displayedTeam?.name?.trim() || missingTeamId || t("console.common.untitledTeam");
  const needsAttention = pendingTeam === undefined && (health === "deleted" || health === "needs-repair" || team?.status === "needs-repair");
  const stateLabel = t(health === "deleted" ? "console.sessionTeam.deleted" : "console.sessionTeam.needsRepair");
  const accessibleLabel = needsAttention
    ? t("console.sessionTeam.switchWithState", { team: teamLabel, state: stateLabel })
    : t("console.sessionTeam.switch", { team: teamLabel });
  const choices = teams.filter((candidate) => candidate.canCreateConversation);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
            needsAttention
              ? "border-danger text-danger"
              : "border-line text-ink hover:bg-hover",
          )}
          aria-label={accessibleLabel}
          title={accessibleLabel}
          disabled={disabled}
        >
          {needsAttention ? (
            <AlertTriangle className="h-[13px] w-[13px] shrink-0" strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <Diamond className="h-[13px] w-[13px] shrink-0 text-sub" strokeWidth={1.5} aria-hidden="true" />
          )}
          <span className="truncate">{teamLabel}</span>
          {needsAttention ? <span className="whitespace-nowrap font-medium">{stateLabel}</span> : null}
          <ChevronDown className="h-[11px] w-[11px] shrink-0 text-hint" strokeWidth={1.5} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-72">
        {choices.map((candidate) => (
          <DropdownMenuCheckboxItem
            key={candidate.teamKey}
            checked={candidate.teamKey === displayedTeam?.teamKey}
            onSelect={() => {
              if (candidate.teamKey !== displayedTeam?.teamKey) {
                onSelectTeam?.(candidate);
              }
            }}
          >
            {candidate.name?.trim() || t("console.common.untitledTeam")}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs leading-5 text-sub">
          {t("console.sessionTeam.snapshotNotice")}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
