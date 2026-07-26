import { ChevronDown, CircleAlert, Diamond, FolderOpen, GitBranch, Laptop, Plus } from "lucide-react";
import { useState } from "react";

import {
  MAIN_CONVERSATION_COLUMN_GUTTER_CLASS,
  MAIN_CONVERSATION_COLUMN_WIDTH_CLASS,
} from "@/console/conversation-layout";
import { RoleComposer } from "@/console/role-composer";
import {
  hasBlockingComposerAttachment,
  readyComposerAttachmentIds,
  type ComposerAttachment,
} from "@/console/structured-attachments";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";

export interface NewConversationProjectOption {
  projectId: string;
  title: string;
  available: boolean;
  independentWorkspaceAvailable: boolean;
  branchLabel: string;
}

export interface NewConversationTeamOption {
  teamKey: string;
  label: string;
  members: Array<{
    slug: string;
    displayName: string;
    description: string;
    available?: boolean;
    executionProfile?: {
      effectiveProfile: {
        cli: "codex" | "kimi";
      };
    };
  }>;
}

export interface NewConversationPageProps {
  projects: NewConversationProjectOption[];
  teams: NewConversationTeamOption[];
  selectedProjectId: string | null;
  selectedWorkspaceMode: "direct" | "worktree";
  selectedTeamKey: string | null;
  cliReadiness?: { codex: boolean; kimi: boolean };
  draft: string;
  attachments?: readonly ComposerAttachment[];
  isSubmitting?: boolean;
  isProjectMutationPending?: boolean;
  error?: string | null;
  onSelectProject(projectId: string): void;
  onSelectWorkspace(workspaceMode: "direct" | "worktree"): void;
  onAddProject(): void;
  onSelectTeam(teamKey: string): void;
  onDraftChange(value: string): void;
  onFilesAdded?: (files: File[]) => void;
  onAttachmentRemove?: (clientId: string) => void;
  onAttachmentRetry?: (clientId: string) => void;
  onSubmit(): void;
  className?: string;
}

export function NewConversationPage({
  projects,
  teams,
  selectedProjectId,
  selectedWorkspaceMode,
  selectedTeamKey,
  cliReadiness,
  draft,
  attachments = [],
  isSubmitting = false,
  isProjectMutationPending = false,
  error,
  onSelectProject,
  onSelectWorkspace,
  onAddProject,
  onSelectTeam,
  onDraftChange,
  onFilesAdded,
  onAttachmentRemove,
  onAttachmentRetry,
  onSubmit,
  className,
}: NewConversationPageProps): JSX.Element {
  const [confirmIndependentWorkspace, setConfirmIndependentWorkspace] = useState(false);
  const selectedProject = projects.find((project) => project.projectId === selectedProjectId && project.available);
  const selectedTeam = teams.find((team) => team.teamKey === selectedTeamKey);
  const compatibility = getNewConversationTeamCompatibility(selectedTeam, cliReadiness);
  const hasAvailableProjects = projects.some((project) => project.available);
  const canSubmit = selectedProject !== undefined
    && selectedTeamKey !== null
    && (draft.trim() !== "" || readyComposerAttachmentIds(attachments).length > 0)
    && !hasBlockingComposerAttachment(attachments)
    && !isSubmitting
    && !isProjectMutationPending;
  const disabledReason = selectedProject === undefined
    ? hasAvailableProjects
      ? "选择一个项目后才能发送"
      : "还没有项目，从上面的项目按钮添加一个"
    : selectedTeamKey === null
      ? "选择一支可用的 Agent 团队后才能发送"
      : undefined;

  return (
    <section className={cn("flex min-h-0 flex-1 flex-col", className)} aria-label="新建对话">
      <header
        className={cn(
          "window-drag-region shrink-0 pb-3 pt-12",
          MAIN_CONVERSATION_COLUMN_GUTTER_CLASS,
        )}
      >
        <h1
          className={cn(
            "mx-auto w-full truncate text-base font-semibold text-ink",
            MAIN_CONVERSATION_COLUMN_WIDTH_CLASS,
          )}
          title="新对话"
        >
          新对话
        </h1>
      </header>
      <div
        className={cn(
          "scroll-thin flex min-h-0 flex-1 flex-col overflow-auto pb-6",
          MAIN_CONVERSATION_COLUMN_GUTTER_CLASS,
        )}
      >
        <div
          className={cn(
            "mx-auto flex w-full flex-1 flex-col justify-center py-8",
            MAIN_CONVERSATION_COLUMN_WIDTH_CLASS,
          )}
          data-testid="new-conversation-column"
        >
          <p className="mb-8 text-center text-lg font-medium text-ink">描述你的目标，团队会开始推进</p>
          <RoleComposer
            value={draft}
            attachments={attachments}
            onValueChange={onDraftChange}
            onFilesAdded={onFilesAdded}
            onAttachmentRemove={onAttachmentRemove}
            onAttachmentRetry={onAttachmentRetry}
            onSubmit={onSubmit}
            roles={selectedTeam?.members
              .filter((member) => member.available !== false)
              .map((member) => ({
                handle: member.slug,
                label: member.displayName || `@${member.slug}`,
                description: member.description,
              })) ?? []}
            disabled={isSubmitting}
            submitDisabled={!canSubmit}
            placeholder="描述你的目标…"
            statusText={disabledReason}
            context={(
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-sub">
                <ProjectMenu
                  projects={projects}
                  selectedProject={selectedProject}
                  disabled={isSubmitting || isProjectMutationPending}
                  onSelectProject={onSelectProject}
                  onAddProject={onAddProject}
                />
                {selectedProject ? (
                  <>
                    <WorkspaceMenu
                      mode={selectedWorkspaceMode}
                      independentAvailable={selectedProject.independentWorkspaceAvailable}
                      disabled={isSubmitting || isProjectMutationPending}
                      onSelectDirect={() => onSelectWorkspace("direct")}
                      onSelectIndependent={() => setConfirmIndependentWorkspace(true)}
                    />
                    <span className="inline-flex items-center gap-1.5 px-1.5 py-1">
                      <GitBranch className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                      {selectedProject.branchLabel}
                    </span>
                  </>
                ) : null}
                <label className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-hover hover:text-ink">
                  <Diamond className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                  <span className="sr-only">Agent 团队</span>
                  <select
                    className="min-w-0 max-w-48 bg-transparent text-xs text-inherit outline-none"
                    aria-label="Agent 团队"
                    value={selectedTeamKey ?? ""}
                    disabled={isSubmitting || teams.length === 0}
                    onChange={(event) => onSelectTeam(event.currentTarget.value)}
                  >
                    {teams.length === 0 ? <option value="">没有可用团队</option> : null}
                    {teams.map((team) => <option key={team.teamKey} value={team.teamKey}>{team.label}</option>)}
                  </select>
                </label>
              </div>
            )}
          />
          {compatibility.affectedCount > 0 ? (
            <div
              className="mt-3 flex items-start gap-2 rounded-lg border border-line bg-sunken px-3 py-2 text-xs leading-5 text-sub"
              data-testid="new-conversation-team-compatibility"
            >
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <p>{compatibility.copy}；可在 Agent 团队页调整。</p>
            </div>
          ) : null}
          {error ? <p className="mt-3 text-sm text-danger" role="alert">{error}</p> : null}
        </div>
      </div>
      {confirmIndependentWorkspace ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/20 p-6">
          <section
            className="w-full max-w-md rounded-[14px] border border-line bg-sunken p-5 text-ink"
            role="dialog"
            aria-modal="true"
            aria-label="换成独立工作空间"
          >
            <h2 className="text-base font-semibold">换成独立工作空间</h2>
            <p className="mt-2 text-sm leading-6 text-sub">
              副本基于项目当前所在的提交，不包含你还没提交的改动。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmIndependentWorkspace(false)}>
                取消
              </Button>
              <Button
                type="button"
                onClick={() => {
                  onSelectWorkspace("worktree");
                  setConfirmIndependentWorkspace(false);
                }}
              >
                换过去
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function getNewConversationTeamCompatibility(
  team: NewConversationTeamOption | undefined,
  readiness: NewConversationPageProps["cliReadiness"],
): { affectedCount: number; copy: string } {
  if (team === undefined || readiness === undefined) {
    return { affectedCount: 0, copy: "" };
  }
  const missing = team.members.flatMap((member): Array<"codex" | "kimi"> => {
    const cli = member.executionProfile?.effectiveProfile.cli;
    return (cli === "codex" || cli === "kimi") && !readiness[cli] ? [cli] : [];
  });
  const labels = [...new Set(missing)].map((cli) => cli === "codex" ? "Codex" : "Kimi");
  return {
    affectedCount: missing.length,
    copy: missing.length === 0
      ? ""
      : `其中 ${String(missing.length)} 名成员仍需完成 ${labels.join(" / ")} 准备`,
  };
}

function WorkspaceMenu({
  mode,
  independentAvailable,
  disabled,
  onSelectDirect,
  onSelectIndependent,
}: {
  mode: "direct" | "worktree";
  independentAvailable: boolean;
  disabled: boolean;
  onSelectDirect(): void;
  onSelectIndependent(): void;
}): JSX.Element {
  const label = mode === "worktree" ? "独立工作空间" : "默认工作空间";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-hover hover:text-ink disabled:opacity-50"
          aria-label={`工作空间：${label}，点击切换`}
          disabled={disabled}
        >
          <Laptop className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          {label}
          <ChevronDown className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-72">
        <DropdownMenuCheckboxItem checked={mode === "direct"} onSelect={() => mode !== "direct" && onSelectDirect()}>
          <span className="grid gap-0.5">
            <span>默认工作空间</span>
            <span className="text-xs font-normal text-sub">直接改项目文件夹里的文件</span>
          </span>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={mode === "worktree"}
          disabled={!independentAvailable}
          onSelect={() => mode !== "worktree" && onSelectIndependent()}
        >
          <span className="grid gap-0.5">
            <span>独立工作空间</span>
            <span className="text-xs font-normal text-sub">
              {independentAvailable
                ? "把改动隔离在一份副本里"
                : "这个项目文件夹不是 git 仓库，无法隔离改动"}
            </span>
          </span>
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectMenu({
  projects,
  selectedProject,
  disabled,
  onSelectProject,
  onAddProject,
}: {
  projects: NewConversationProjectOption[];
  selectedProject?: NewConversationProjectOption;
  disabled: boolean;
  onSelectProject(projectId: string): void;
  onAddProject(): void;
}): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-hover hover:text-ink disabled:opacity-50"
          aria-label={selectedProject ? `项目：${selectedProject.title}，点击切换` : "项目：未选择，点击选择"}
          disabled={disabled}
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          <span className="max-w-48 truncate">{selectedProject?.title ?? "选择项目"}</span>
          <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={1.5} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="min-w-52">
        {projects.filter((project) => project.available).map((project) => (
          <DropdownMenuCheckboxItem
            key={project.projectId}
            checked={project.projectId === selectedProject?.projectId}
            onSelect={() => onSelectProject(project.projectId)}
          >
            {project.title}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onAddProject}>
          <Plus className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          添加项目…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
