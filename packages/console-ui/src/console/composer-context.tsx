import { ChevronDown, FolderOpen, GitBranch, Laptop } from "lucide-react";
import { useEffect, useState } from "react";

import type { OperatorAgentTeam } from "@/console/agent-teams-page";
import type { OperatorConsoleAppearance } from "@/console/operator-console-appearance";
import type { OperatorProject, OperatorSession } from "@/console/operator-console";
import { operatorFloatingSurfaceClassName } from "@/console/operator-console-appearance";
import { SessionTeamMenu } from "@/console/session-team-menu";
import { useI18n, type Translate } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";

type WorkspaceMode = "direct" | "worktree";

export function ComposerContext({
  project,
  projects,
  selectedSession,
  agentTeam,
  pendingAgentTeam,
  missingAgentTeamId,
  agentTeamHealth,
  teams,
  canChangeProject,
  disabled,
  onChangeSessionProject,
  onChangeSessionWorkspace,
  onChangeSessionTeam,
  teamMenuOpen,
  onTeamMenuOpenChange,
  appearance = "default",
}: {
  project: OperatorProject;
  projects: OperatorProject[];
  selectedSession: OperatorSession | null;
  agentTeam?: OperatorAgentTeam;
  pendingAgentTeam?: OperatorAgentTeam;
  missingAgentTeamId?: string | null;
  agentTeamHealth?: "usable" | "deleted" | "needs-repair" | null;
  teams: readonly OperatorAgentTeam[];
  canChangeProject: boolean;
  disabled: boolean;
  onChangeSessionProject?: (sessionId: string, projectId: string) => void;
  onChangeSessionWorkspace?: (sessionId: string, workspaceMode: WorkspaceMode) => void;
  onChangeSessionTeam?: (sessionId: string, team: OperatorAgentTeam) => void;
  teamMenuOpen?: boolean;
  onTeamMenuOpenChange?: (open: boolean) => void;
  appearance?: OperatorConsoleAppearance;
}): JSX.Element {
  const { t } = useI18n();
  const [viewportWidth, setViewportWidth] = useState(() => typeof window === "undefined" ? 1440 : window.innerWidth);
  const visible = visibleComposerContextEntries(viewportWidth);
  const effectiveMode = selectedSession?.workspaceMode ?? "direct";
  const workspaceLabel = workspaceModeLabel(effectiveMode, t);
  const branchName = selectedSession?.branchName ?? project.branchName ?? "—";
  const independentUnavailable = selectedSession?.workspaceUnavailableReason === "not-git-repository";
  const pendingDescription = pendingAgentTeam === undefined
    ? null
    : t("console.composerContext.pendingTeam", {
        team: pendingAgentTeam.name?.trim() || t("console.common.untitledTeam"),
      });

  useEffect(() => {
    const updateWidth = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  return (
    <div className="min-w-0 text-xs text-sub">
      <div className={cn("flex min-w-0 items-center gap-1.5", appearance === "focused" && "flex-nowrap")}>
        {visible.project ? <span className="contents" data-context-entry="project">{canChangeProject && selectedSession && onChangeSessionProject ? (
          disabled ? (
            <button
              type="button"
              className={cn(COMPOSER_CHIP_CLASS, "opacity-40")}
              aria-label={t("console.composerContext.projectSwitch", { project: project.title })}
              disabled
            >
              <FolderOpen className="h-[13px] w-[13px] shrink-0 text-sub" strokeWidth={1.5} aria-hidden="true" />
              <span className="truncate">{project.title}</span>
              <ChevronDown className="h-[11px] w-[11px] shrink-0 text-hint" strokeWidth={1.5} aria-hidden="true" />
            </button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={COMPOSER_CHIP_CLASS}
                  aria-label={t("console.composerContext.projectSwitch", { project: project.title })}
                >
                  <FolderOpen className="h-[13px] w-[13px] shrink-0 text-sub" strokeWidth={1.5} aria-hidden="true" />
                  <span className="truncate">{project.title}</span>
                  <ChevronDown className="h-[11px] w-[11px] shrink-0 text-hint" strokeWidth={1.5} aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side="top"
                className={operatorFloatingSurfaceClassName(appearance, "min-w-48")}
              >
                {projects.map((candidate) => (
                  <DropdownMenuCheckboxItem
                    key={candidate.projectId}
                    checked={candidate.projectId === project.projectId}
                    onSelect={() => {
                      if (candidate.projectId !== project.projectId) {
                        onChangeSessionProject(selectedSession.sessionId, candidate.projectId);
                      }
                    }}
                  >
                    {candidate.title}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        ) : (
          <span className={COMPOSER_LOCKED_CLASS} aria-label={t("console.composerContext.projectLocked", { project: project.title })}>
            <FolderOpen className="h-[13px] w-[13px] shrink-0" strokeWidth={1.5} aria-hidden="true" />
            <span className="truncate">{project.title}</span>
          </span>
        )}</span> : null}

        {visible.workspace ? <span className="contents" data-context-entry="workspace">{selectedSession && onChangeSessionWorkspace ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={COMPOSER_CHIP_CLASS}
                aria-label={t("console.composerContext.workspaceSwitch", { workspace: workspaceLabel })}
                disabled={disabled}
              >
                <Laptop className="h-[13px] w-[13px] shrink-0 text-sub" strokeWidth={1.5} aria-hidden="true" />
                <span className="truncate">{workspaceLabel}</span>
                <ChevronDown className="h-[11px] w-[11px] shrink-0 text-hint" strokeWidth={1.5} aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="top"
              className={operatorFloatingSurfaceClassName(appearance, "w-72")}
            >
              <DropdownMenuCheckboxItem
                checked={effectiveMode === "direct"}
                onSelect={() => effectiveMode !== "direct" && onChangeSessionWorkspace(selectedSession.sessionId, "direct")}
              >
                <span className="grid gap-0.5">
                  <span>{t("console.workspace.direct")}</span>
                  <span className="text-xs font-normal text-sub">{t("console.workspace.directDescription")}</span>
                </span>
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={effectiveMode === "worktree"}
                disabled={independentUnavailable}
                onSelect={() => effectiveMode !== "worktree" && onChangeSessionWorkspace(selectedSession.sessionId, "worktree")}
              >
                <span className="grid gap-0.5">
                  <span>{t("console.workspace.worktree")}</span>
                  <span className="text-xs font-normal text-sub">
                    {independentUnavailable
                      ? t("console.workspace.notGit")
                      : t("console.workspace.worktreeDescription")}
                  </span>
                </span>
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className={COMPOSER_LOCKED_CLASS} aria-label={t("console.composerContext.workspaceLocked", { workspace: workspaceLabel })}>
            <Laptop className="h-[13px] w-[13px] shrink-0" strokeWidth={1.5} aria-hidden="true" />
            <span className="truncate">{workspaceLabel}</span>
          </span>
        )}</span> : null}

        {visible.branch ? <span className={COMPOSER_LOCKED_CLASS} aria-label={t("console.composerContext.branch", { branch: branchName })} data-context-entry="branch">
          <GitBranch className="h-[13px] w-[13px] shrink-0" strokeWidth={1.5} aria-hidden="true" />
          <span className="truncate font-mono text-xs">{branchName}</span>
        </span> : null}

        {visible.team ? <span className="contents" data-context-entry="team"><SessionTeamMenu
          team={agentTeam}
          pendingTeam={pendingAgentTeam}
          missingTeamId={missingAgentTeamId}
          health={agentTeamHealth}
          teams={teams}
          disabled={disabled}
          open={teamMenuOpen}
          onOpenChange={onTeamMenuOpenChange}
          appearance={appearance}
          onSelectTeam={selectedSession && onChangeSessionTeam
            ? (team) => onChangeSessionTeam(selectedSession.sessionId, team)
            : undefined}
        /></span> : null}
      </div>

      {pendingDescription !== null ? (
        <p className="mt-1 pl-1 text-meta leading-4 text-sub" role="status">
          {pendingDescription}
        </p>
      ) : null}
    </div>
  );
}

/* i18n-exempt: developer-only component note; interactive chip uses h28/r12 and locked entries use plain text */
const COMPOSER_CHIP_CLASS =
  "inline-flex h-7 min-w-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line px-2.5 text-xs font-normal text-ink transition-colors hover:bg-hover";
const COMPOSER_LOCKED_CLASS =
  "inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap px-1 py-1 text-sub";

function workspaceModeLabel(mode: WorkspaceMode, t: Translate): string {
  return t(mode === "worktree" ? "console.workspace.worktree" : "console.workspace.direct");
}

export function visibleComposerContextEntries(width: number): {
  branch: boolean;
  workspace: boolean;
  team: boolean;
  project: boolean;
} {
  return {
    branch: width >= 1_000,
    workspace: width >= 760,
    team: true,
    project: width >= 420,
  };
}
