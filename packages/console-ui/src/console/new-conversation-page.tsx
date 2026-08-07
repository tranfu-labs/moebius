import { ChevronDown, Diamond, FolderOpen, GitBranch, Laptop, Plus } from "lucide-react";
import { useState } from "react";

import {
  MAIN_CONVERSATION_COLUMN_GUTTER_CLASS,
  MAIN_CONVERSATION_COLUMN_WIDTH_CLASS,
} from "@/console/conversation-layout";
import { RoleComposer } from "@/console/role-composer";
import { AgentTeamOption } from "@/console/agent-team-option";
import {
  hasBlockingComposerAttachment,
  readyComposerAttachmentIds,
  type ComposerAttachment,
} from "@/console/structured-attachments";
import type { ComposerTextFragment } from "@/console/text-fragment-list";
import { useI18n } from "@/i18n";
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
  available?: boolean;
  ownership?: "system" | "user";
  description?: string | null;
  primaryAgentSlug?: string | null;
  members: Array<{
    slug: string;
    displayName: string;
    description: string;
    available?: boolean;
    executionProfile?: {
      effectiveProfile: {
        cli: "codex" | "claude" | "kimi" | "pi";
      };
    };
  }>;
}

export interface NewConversationPromptSuggestion {
  id: string;
  label: string;
  prompt: string;
}

export interface NewConversationPageProps {
  projects: NewConversationProjectOption[];
  teams: NewConversationTeamOption[];
  selectedProjectId: string | null;
  selectedWorkspaceMode: "direct" | "worktree";
  selectedTeamKey: string | null;
  draft: string;
  attachments?: readonly ComposerAttachment[];
  textFragments?: readonly ComposerTextFragment[];
  promptSuggestions?: readonly NewConversationPromptSuggestion[];
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
  onTextFragmentRemove?: (fragmentId: string) => void;
  onPromptSuggestionSelect?: (suggestion: NewConversationPromptSuggestion) => void;
  onSubmit(): void;
  className?: string;
}

export function NewConversationPage({
  projects,
  teams,
  selectedProjectId,
  selectedWorkspaceMode,
  selectedTeamKey,
  draft,
  attachments = [],
  textFragments = [],
  promptSuggestions = [],
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
  onTextFragmentRemove,
  onPromptSuggestionSelect,
  onSubmit,
  className,
}: NewConversationPageProps): JSX.Element {
  const { t } = useI18n();
  const [confirmIndependentWorkspace, setConfirmIndependentWorkspace] = useState(false);
  const selectedProject = projects.find((project) => project.projectId === selectedProjectId);
  const selectedTeam = teams.find((team) => team.teamKey === selectedTeamKey);
  const hasAvailableProjects = projects.some((project) => project.available);
  const canSubmit = selectedProject !== undefined
    && selectedProject.available
    && selectedTeam !== undefined
    && selectedTeam.available !== false
    && (draft.trim() !== "" || readyComposerAttachmentIds(attachments).length > 0)
    && !hasBlockingComposerAttachment(attachments)
    && !isSubmitting
    && !isProjectMutationPending;
  const disabledReason = selectedProject === undefined
    ? hasAvailableProjects
      ? t("console.newConversation.selectProject")
      : t("console.newConversation.addProjectFirst")
    : !selectedProject.available
      ? t("console.newConversation.projectUnavailable")
      : selectedTeamKey === null || selectedTeam === undefined
        ? t("console.newConversation.selectTeam")
        : selectedTeam.available === false
          ? t("console.newConversation.teamUnavailable")
        : undefined;

  return (
    <section className={cn("flex min-h-0 flex-1 flex-col", className)} aria-label={t("console.newConversation.label")}>
      <header
        className={cn(
          "window-drag-region shrink-0 pb-3 pt-12",
          MAIN_CONVERSATION_COLUMN_GUTTER_CLASS,
        )}
      >
        <h1
          className={cn(
            "mx-auto w-full truncate font-display text-[15px] font-semibold tracking-[-0.01em] text-ink",
            MAIN_CONVERSATION_COLUMN_WIDTH_CLASS,
          )}
          title={t("console.newConversation.title")}
        >
          {t("console.newConversation.title")}
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
          <p className="mb-8 text-center text-lg font-medium text-ink">{t("console.newConversation.invitation")}</p>
          {promptSuggestions.length > 0 ? (
            <div
              className="mb-4 flex flex-wrap justify-center gap-2"
              aria-label={t("console.newConversation.promptSuggestions")}
            >
              {promptSuggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  className="rounded-full border border-line bg-card px-3 py-1.5 text-xs text-sub transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  onClick={() => onPromptSuggestionSelect?.(suggestion)}
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
          ) : null}
          <RoleComposer
            variant="main"
            value={draft}
            attachments={attachments}
            textFragments={textFragments}
            onValueChange={onDraftChange}
            onFilesAdded={onFilesAdded}
            onAttachmentRemove={onAttachmentRemove}
            onAttachmentRetry={onAttachmentRetry}
            onTextFragmentRemove={onTextFragmentRemove}
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
            placeholder={t("console.newConversation.placeholder")}
            statusText={disabledReason}
            context={(
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-sub">
                <ProjectMenu
                  projects={projects}
                  selectedProject={selectedProject}
                  unavailableReason={selectedProject?.available === false ? disabledReason : undefined}
                  disabled={isSubmitting || isProjectMutationPending}
                  onSelectProject={onSelectProject}
                  onAddProject={onAddProject}
                />
                {selectedProject ? (
                  <>
                    <WorkspaceMenu
                      mode={selectedWorkspaceMode}
                      independentAvailable={selectedProject.independentWorkspaceAvailable}
                      disabled={!selectedProject.available || isSubmitting || isProjectMutationPending}
                      onSelectDirect={() => onSelectWorkspace("direct")}
                      onSelectIndependent={() => setConfirmIndependentWorkspace(true)}
                    />
                    <span className="inline-flex items-center gap-1.5 px-1.5 py-1">
                      <GitBranch className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                      {selectedProject.branchLabel}
                    </span>
                  </>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-hover hover:text-ink disabled:opacity-50"
                      aria-label={t("console.common.agentTeam")}
                      disabled={isSubmitting || teams.length === 0}
                      data-testid="new-conversation-team-picker"
                    >
                      <Diamond className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                      <span className="max-w-48 truncate">{selectedTeam?.label ?? t("console.newConversation.noTeams")}</span>
                      <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    side="top"
                    collisionPadding={12}
                    className="scroll-thin w-[min(360px,calc(100vw-24px))] overflow-y-auto overscroll-contain"
                    style={{ maxHeight: "var(--radix-dropdown-menu-content-available-height)" }}
                  >
                    {teams.map((team) => (
                      <DropdownMenuCheckboxItem
                        key={team.teamKey}
                        checked={team.teamKey === selectedTeamKey}
                        disabled={team.available === false}
                        className="items-start"
                        data-testid="new-conversation-team-option"
                        data-team-key={team.teamKey}
                        onSelect={() => team.teamKey !== selectedTeamKey && onSelectTeam(team.teamKey)}
                      >
                        <AgentTeamOption team={team} />
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          />
          {error ? <p className="mt-3 text-sm text-danger" role="alert">{error}</p> : null}
        </div>
      </div>
      {confirmIndependentWorkspace ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/20 p-6">
          <section
            className="w-full max-w-md rounded-[14px] border border-line bg-sunken p-5 text-ink"
            role="dialog"
            aria-modal="true"
            aria-label={t("console.newConversation.switchWorktree")}
          >
            <h2 className="text-base font-semibold">{t("console.newConversation.switchWorktree")}</h2>
            <p className="mt-2 text-sm leading-6 text-sub">
              {t("console.newConversation.worktreeWarning")}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmIndependentWorkspace(false)}>
                {t("console.common.cancel")}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  onSelectWorkspace("worktree");
                  setConfirmIndependentWorkspace(false);
                }}
              >
                {t("console.newConversation.switch")}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
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
  const { t } = useI18n();
  const label = t(mode === "worktree" ? "console.workspace.worktree" : "console.workspace.direct");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-hover hover:text-ink disabled:opacity-50"
          aria-label={t("console.composerContext.workspaceSwitch", { workspace: label })}
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
            <span>{t("console.workspace.direct")}</span>
            <span className="text-xs font-normal text-sub">{t("console.workspace.directDescription")}</span>
          </span>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={mode === "worktree"}
          disabled={!independentAvailable}
          onSelect={() => mode !== "worktree" && onSelectIndependent()}
        >
          <span className="grid gap-0.5">
            <span>{t("console.workspace.worktree")}</span>
            <span className="text-xs font-normal text-sub">
              {independentAvailable
                ? t("console.workspace.worktreeDescription")
                : t("console.workspace.notGit")}
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
  unavailableReason,
  disabled,
  onSelectProject,
  onAddProject,
}: {
  projects: NewConversationProjectOption[];
  selectedProject?: NewConversationProjectOption;
  unavailableReason?: string;
  disabled: boolean;
  onSelectProject(projectId: string): void;
  onAddProject(): void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-hover hover:text-ink disabled:opacity-50",
            selectedProject?.available === false && "bg-danger/10 text-danger hover:bg-danger/15 hover:text-danger",
          )}
          aria-label={selectedProject
            ? t("console.composerContext.projectSwitch", { project: selectedProject.title })
            : t("console.newConversation.projectUnselected")}
          aria-invalid={selectedProject?.available === false ? "true" : undefined}
          aria-description={unavailableReason}
          title={unavailableReason}
          disabled={disabled}
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          <span className="max-w-48 truncate">{selectedProject?.title ?? t("console.newConversation.chooseProject")}</span>
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
          {t("console.newConversation.addProject")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
