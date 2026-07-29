import * as React from "react";
import { ChevronRight, MoreHorizontal, Plus, Wrench } from "lucide-react";

import { cn } from "@/lib/utils";
import { translate, useI18n, type Translate, type TranslationKey } from "@/i18n";
import {
  deriveProjectStatusDot,
  deriveStatusDot,
  type ConversationStatusDot,
  type StatusDotFacts,
} from "@/console/status-dot";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/ui/tooltip";

export type ConversationSessionStatus = ConversationStatusDot;
export type ConversationSidebarDataState = "ready" | "loading" | "error";

export interface ConversationSidebarSession extends StatusDotFacts {
  id: string;
  title: string;
  awaitsHumanReason?: string | null;
  analysisDisabledReason?: string | null;
  createdAt: string;
  summary?: string;
}

export interface ConversationSidebarProject {
  id: string;
  path: string;
  label?: string;
  newConversationDisabledReason?: string | null;
  directoryAvailable?: boolean;
  directoryUnavailableReason?: string | null;
  sessions: ConversationSidebarSession[];
}

export type CopySessionLogPathFailureReason =
  | "invalid-session"
  | "service-unavailable"
  | "record-unavailable"
  | "clipboard-unavailable"
  | "unknown";

export type CopySessionLogPathResult =
  | { ok: true }
  | { ok: false; reason: Exclude<CopySessionLogPathFailureReason, "unknown"> };

export interface ConversationSidebarProps {
  projects: ConversationSidebarProject[];
  dataState?: ConversationSidebarDataState;
  selectedSessionId?: string;
  onSelectSession?: (sessionId: string, projectId: string) => void;
  onNewConversation?: (projectId: string) => void;
  onShowProjectInFolder?: (project: ConversationSidebarProject) => void;
  onRenameProject?: (project: ConversationSidebarProject) => void;
  onRemoveProject?: (project: ConversationSidebarProject) => void;
  onAnalyzeConversation?: (sessionId: string, projectId: string) => void;
  onArchiveSession?: (sessionId: string, projectId: string) => void;
  onCopySessionLogPath?: (sessionId: string, projectId: string) => Promise<CopySessionLogPathResult>;
  onReorderProjects?: (projectIds: string[]) => boolean | void | Promise<boolean | void>;
  onRepairProject?: (project: ConversationSidebarProject) => void;
  onRetry?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  projectActionsDisabled?: boolean;
  projectActionsDisabledReason?: string;
  showProjectPath?: boolean;
  className?: string;
}

const statusLabelKey: Record<ConversationSessionStatus, TranslationKey> = {
  red: "console.conversationSidebar.needsYou",
  blue: "console.conversationSidebar.newResult",
  blink: "console.conversationSidebar.running",
  none: "console.conversationSidebar.idle",
};

export { deriveProjectStatusDot, deriveStatusDot } from "@/console/status-dot";

export function projectDirectoryName(
  project: Pick<ConversationSidebarProject, "path" | "label">,
  fallback = translate("zh-CN", "console.conversationSidebar.untitledProject"),
): string {
  const displayName = project.label?.trim();
  if (displayName) {
    return displayName;
  }
  const trimmed = project.path.trim().replace(/[\\/]+$/u, "");
  const directory = trimmed.split(/[\\/]/u).filter(Boolean).at(-1);
  return directory || fallback;
}

export function orderSessionsByCreatedAt<T extends { createdAt: string }>(sessions: readonly T[]): T[] {
  return sessions
    .map((session, index) => ({ session, index }))
    .sort((left, right) => {
      const byCreatedAt = right.session.createdAt.localeCompare(left.session.createdAt);
      return byCreatedAt === 0 ? left.index - right.index : byCreatedAt;
    })
    .map(({ session }) => session);
}

export interface ProjectRowBounds {
  id: string;
  top: number;
  bottom: number;
}

export function orderProjectIdsForPointer(
  projectIds: readonly string[],
  draggedProjectId: string,
  clientY: number,
  rowBounds: readonly ProjectRowBounds[],
): string[] {
  const remaining = projectIds.filter((projectId) => projectId !== draggedProjectId);
  if (remaining.length === projectIds.length) {
    return [...projectIds];
  }
  let insertAt = remaining.length;
  for (let index = 0; index < remaining.length; index += 1) {
    const bounds = rowBounds.find((entry) => entry.id === remaining[index]);
    if (bounds !== undefined && clientY < (bounds.top + bounds.bottom) / 2) {
      insertAt = index;
      break;
    }
  }
  const next = [...remaining];
  next.splice(insertAt, 0, draggedProjectId);
  return next;
}

interface ProjectPointerGesture {
  pointerId: number;
  projectId: string;
  startX: number;
  startY: number;
  lastY: number;
  maxDistance: number;
  startedAt: number;
  activated: boolean;
  initialOrder: string[];
  activationTimer: number;
}

const PROJECT_DRAG_DISTANCE_PX = 5;
const PROJECT_DRAG_DELAY_MS = 150;

export function ConversationSidebar({
  projects,
  dataState = "ready",
  selectedSessionId,
  onSelectSession,
  onNewConversation,
  onShowProjectInFolder,
  onRenameProject,
  onRemoveProject,
  onAnalyzeConversation,
  onArchiveSession,
  onCopySessionLogPath,
  onReorderProjects,
  onRepairProject,
  onRetry,
  disabled = false,
  disabledReason,
  projectActionsDisabled = false,
  projectActionsDisabledReason,
  showProjectPath = true,
  className
}: ConversationSidebarProps): JSX.Element {
  const { t } = useI18n();
  const [collapsedProjectIds, setCollapsedProjectIds] = React.useState<Set<string>>(() => new Set());
  const [draftProjectOrder, setDraftProjectOrder] = React.useState<string[] | null>(null);
  const [draggingProjectId, setDraggingProjectId] = React.useState<string | null>(null);
  const rowElements = React.useRef(new Map<string, HTMLDivElement>());
  const gestureRef = React.useRef<ProjectPointerGesture | null>(null);
  const projectIds = projects.map((project) => project.id);
  const projectOrderKey = projectIds.join("\u0000");

  React.useEffect(() => {
    setDraftProjectOrder((current) => {
      if (current === null) {
        return null;
      }
      const currentSet = new Set(current);
      return current.length === projectIds.length && projectIds.every((projectId) => currentSet.has(projectId))
        ? current
        : null;
    });
  }, [projectOrderKey]);

  React.useEffect(() => () => {
    const gesture = gestureRef.current;
    if (gesture !== null) {
      window.clearTimeout(gesture.activationTimer);
    }
  }, []);

  const visibleProjectIds = draftProjectOrder ?? projectIds;
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const visibleProjects = visibleProjectIds.flatMap((projectId) => {
    const project = projectsById.get(projectId);
    return project === undefined ? [] : [project];
  });

  const rowBounds = (): ProjectRowBounds[] => visibleProjectIds.flatMap((projectId) => {
    const element = rowElements.current.get(projectId);
    if (element === undefined) {
      return [];
    }
    const bounds = element.getBoundingClientRect();
    return [{ id: projectId, top: bounds.top, bottom: bounds.bottom }];
  });

  const updateDragOrder = (gesture: ProjectPointerGesture): void => {
    setDraftProjectOrder((current) => orderProjectIdsForPointer(
      current ?? gesture.initialOrder,
      gesture.projectId,
      gesture.lastY,
      rowBounds(),
    ));
  };

  const activateGesture = (gesture: ProjectPointerGesture): void => {
    if (
      disabled
      || projectActionsDisabled
      || onReorderProjects === undefined
      || gestureRef.current !== gesture
      || gesture.activated
      || gesture.maxDistance < PROJECT_DRAG_DISTANCE_PX
    ) {
      return;
    }
    gesture.activated = true;
    setDraggingProjectId(gesture.projectId);
    updateDragOrder(gesture);
  };

  const finishGesture = (event: React.PointerEvent<HTMLDivElement>, cancelled: boolean): void => {
    const gesture = gestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) {
      return;
    }
    window.clearTimeout(gesture.activationTimer);
    gestureRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (gesture.activated) {
      const nextOrder = orderProjectIdsForPointer(
        draftProjectOrder ?? gesture.initialOrder,
        gesture.projectId,
        gesture.lastY,
        rowBounds(),
      );
      setDraggingProjectId(null);
      if (cancelled) {
        setDraftProjectOrder(null);
      } else if (nextOrder.some((projectId, index) => projectId !== gesture.initialOrder[index])) {
        setDraftProjectOrder(nextOrder);
        void Promise.resolve(onReorderProjects?.(nextOrder)).then((accepted) => {
          if (accepted === false) {
            setDraftProjectOrder(null);
          }
        }, () => setDraftProjectOrder(null));
      } else {
        setDraftProjectOrder(null);
      }
      return;
    }
    if (!cancelled && gesture.maxDistance < PROJECT_DRAG_DISTANCE_PX) {
      setCollapsedProjectIds((current) => {
        const next = new Set(current);
        if (next.has(gesture.projectId)) {
          next.delete(gesture.projectId);
        } else {
          next.add(gesture.projectId);
        }
        return next;
      });
    }
  };

  return (
    <aside
      className={cn("flex w-[248px] flex-col bg-rail text-ink", className)}
      aria-label={t("console.conversationSidebar.label")}
    >
      <nav className="scroll-thin min-h-0 flex-1 overflow-auto px-2 pb-2" aria-label={t("console.conversationSidebar.projectList")}>
        {dataState === "loading" ? (
          <ProjectListSkeleton />
        ) : dataState === "error" ? (
          <ProjectListError onRetry={onRetry} />
        ) : visibleProjects.length === 0 ? (
          <p className="px-2 py-3 text-xs leading-5 text-hint" data-testid="conversation-sidebar-no-projects">
            {t("console.conversationSidebar.addFirstProject")}
          </p>
        ) : visibleProjects.map((project) => {
          const projectName = projectDirectoryName(project, t("console.conversationSidebar.untitledProject"));
          const orderedSessions = orderSessionsByCreatedAt(project.sessions);
          const expanded = !collapsedProjectIds.has(project.id);
          const aggregatedStatus = expanded ? "none" : deriveProjectStatusDot(project.sessions);
          const conversationListId = `project-${project.id}-conversations`;
          const projectAccessibleName = t("console.conversationSidebar.projectState", {
            project: projectName,
            expanded: t(expanded ? "console.conversationSidebar.expanded" : "console.conversationSidebar.collapsed"),
            status: aggregatedStatus === "none"
              ? ""
              : t("console.conversationSidebar.projectStatus", {
                  status: t(statusLabelKey[aggregatedStatus]),
                }),
          });
          const newConversationDisabledReason = project.newConversationDisabledReason
            ?? (projectActionsDisabled ? projectActionsDisabledReason ?? t("sidebar.projectChanging") : null)
            ?? (disabled ? disabledReason ?? t("sidebar.projectChanging") : null);

          return (
            <section key={project.id} className="mb-2" aria-label={t("console.conversationSidebar.project", { project: projectName })}>
              <div
                ref={(element) => {
                  if (element === null) {
                    rowElements.current.delete(project.id);
                  } else {
                    rowElements.current.set(project.id, element);
                  }
                }}
                data-testid="conversation-sidebar-project"
                data-project-id={project.id}
                className={cn(
                  "mb-0.5 flex min-w-0 cursor-grab touch-none select-none items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover",
                  draggingProjectId === project.id && "cursor-grabbing bg-sel opacity-80",
                )}
                onPointerDown={(event) => {
                  if (
                    event.button !== 0
                    || gestureRef.current !== null
                    || (event.target as Element).closest("[data-project-row-action]") !== null
                  ) {
                    return;
                  }
                  const gesture: ProjectPointerGesture = {
                    pointerId: event.pointerId,
                    projectId: project.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    lastY: event.clientY,
                    maxDistance: 0,
                    startedAt: Date.now(),
                    activated: false,
                    initialOrder: [...visibleProjectIds],
                    activationTimer: 0,
                  };
                  gesture.activationTimer = window.setTimeout(() => activateGesture(gesture), PROJECT_DRAG_DELAY_MS);
                  gestureRef.current = gesture;
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const gesture = gestureRef.current;
                  if (gesture === null || gesture.pointerId !== event.pointerId) {
                    return;
                  }
                  gesture.lastY = event.clientY;
                  gesture.maxDistance = Math.max(
                    gesture.maxDistance,
                    Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY),
                  );
                  if (!gesture.activated && Date.now() - gesture.startedAt >= PROJECT_DRAG_DELAY_MS) {
                    activateGesture(gesture);
                  } else if (gesture.activated) {
                    updateDragOrder(gesture);
                  }
                }}
                onPointerUp={(event) => finishGesture(event, false)}
                onPointerCancel={(event) => finishGesture(event, true)}
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded}
                  aria-controls={conversationListId}
                  aria-label={projectAccessibleName}
                  title={projectAccessibleName}
                  data-testid="conversation-sidebar-project-toggle"
                  data-project-id={project.id}
                  data-status-dot={aggregatedStatus}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setCollapsedProjectIds((current) => {
                        const next = new Set(current);
                        if (next.has(project.id)) {
                          next.delete(project.id);
                        } else {
                          next.add(project.id);
                        }
                        return next;
                      });
                    }
                  }}
                >
                  <ChevronRight
                    className={cn("h-4 w-4 shrink-0 text-sub transition-transform", expanded && "rotate-90")}
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold leading-5" title={projectName}>{projectName}</h2>
                    {showProjectPath ? <p className="truncate text-xs text-hint" title={project.path}>{project.path}</p> : null}
                  </div>
                  {!expanded ? <StatusIcon status={aggregatedStatus} /> : null}
                </div>
                {project.directoryAvailable === false && onRepairProject ? (
                  <button
                    type="button"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-danger hover:bg-danger/10 disabled:pointer-events-none disabled:opacity-40"
                    aria-label={t("console.conversationSidebar.repairProject", { project: projectName })}
                    aria-description={project.directoryUnavailableReason ?? undefined}
                    data-project-row-action="repair-project"
                    title={project.directoryUnavailableReason ?? t("console.conversationSidebar.folderMissing")}
                    disabled={disabled || projectActionsDisabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRepairProject(project);
                    }}
                  >
                    <Wrench className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                  </button>
                ) : null}
                {onNewConversation ? (
                  <button
                    type="button"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sub hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={t("console.conversationSidebar.newInProject", { project: projectName })}
                    aria-description={newConversationDisabledReason ?? undefined}
                    data-project-row-action="new-conversation"
                    title={newConversationDisabledReason ?? t("console.conversationSidebar.newInProject", { project: projectName })}
                    disabled={newConversationDisabledReason !== null}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (newConversationDisabledReason === null) {
                        onNewConversation(project.id);
                      }
                    }}
                  >
                    <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                  </button>
                ) : null}
                {onShowProjectInFolder || onRenameProject || onRemoveProject ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sub hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                        aria-label={t("console.conversationSidebar.projectMenu", { project: projectName })}
                        title={t("console.conversationSidebar.projectMenu", { project: projectName })}
                        data-project-row-action="project-menu"
                        disabled={disabled || projectActionsDisabled}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" aria-label={t("console.conversationSidebar.projectActions", { project: projectName })} className="min-w-48">
                      {onShowProjectInFolder ? (
                        <DropdownMenuItem onSelect={() => onShowProjectInFolder(project)}>
                          {t("console.conversationSidebar.showInManager")}
                        </DropdownMenuItem>
                      ) : null}
                      {onRenameProject ? (
                        <DropdownMenuItem onSelect={() => onRenameProject(project)}>
                          {t("console.conversationSidebar.rename")}
                        </DropdownMenuItem>
                      ) : null}
                      {onRemoveProject ? <DropdownMenuSeparator /> : null}
                      {onRemoveProject ? (
                        <DropdownMenuItem className="text-danger focus:text-danger" onSelect={() => onRemoveProject(project)}>
                          {t("console.conversationSidebar.removeProject")}
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>

              {expanded ? orderedSessions.length === 0 ? (
                <p
                  id={conversationListId}
                  className="px-8 py-1.5 text-xs text-hint"
                  data-testid="conversation-sidebar-empty-project"
                >
                  {t("console.conversationSidebar.noConversations")}
                </p>
              ) : (
                <div id={conversationListId} className="space-y-0.5" role="list" aria-label={t("console.conversationSidebar.projectConversations", { project: projectName })}>
                  {orderedSessions.map((session) => (
                    <SessionRow
                      key={session.id}
                      projectId={project.id}
                      session={session}
                      selected={session.id === selectedSessionId}
                      onSelectSession={onSelectSession}
                      onAnalyzeConversation={onAnalyzeConversation}
                      onArchiveSession={onArchiveSession}
                      onCopySessionLogPath={onCopySessionLogPath}
                      disabled={disabled}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </nav>
    </aside>
  );
}

function ProjectListSkeleton(): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="space-y-3 px-2 py-2" aria-label={t("console.conversationSidebar.projectsLoading")} aria-busy="true" data-testid="conversation-sidebar-loading">
      {["first", "second", "third"].map((key, index) => (
        <div key={key} className="animate-pulse space-y-2" aria-hidden="true">
          <div className="flex h-8 items-center gap-2">
            <span className="h-3 w-3 rounded-sm bg-line" />
            <span className={cn("h-3 rounded bg-line", index === 1 ? "w-24" : "w-32")} />
          </div>
          <div className="ml-5 h-7 rounded-md bg-line/60" />
          {index === 0 ? <div className="ml-5 h-7 rounded-md bg-line/40" /> : null}
        </div>
      ))}
    </div>
  );
}

function ProjectListError({ onRetry }: { onRetry?: () => void }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="mx-2 mt-2 rounded-lg border border-line bg-card px-3 py-3" role="alert" data-testid="conversation-sidebar-error">
      <p className="text-sm font-medium text-ink">{t("console.conversationSidebar.loadFailed")}</p>
      <p className="mt-1 text-xs leading-5 text-sub">{t("console.conversationSidebar.loadFailedDescription")}</p>
      {onRetry ? (
        <button
          type="button"
          className="mt-2 h-7 rounded-md border border-line bg-input px-2.5 text-xs font-medium text-ink hover:bg-hover"
          onClick={onRetry}
        >
          {t("common.retry")}
        </button>
      ) : null}
    </div>
  );
}

function SessionRow({
  projectId,
  session,
  selected,
  onSelectSession,
  onAnalyzeConversation,
  onArchiveSession,
  onCopySessionLogPath,
  disabled
}: {
  projectId: string;
  session: ConversationSidebarSession;
  selected: boolean;
  onSelectSession?: (sessionId: string, projectId: string) => void;
  onAnalyzeConversation?: (sessionId: string, projectId: string) => void;
  onArchiveSession?: (sessionId: string, projectId: string) => void;
  onCopySessionLogPath?: (sessionId: string, projectId: string) => Promise<CopySessionLogPathResult>;
  disabled: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuReturnFocusRef = React.useRef<HTMLElement | null>(null);
  const [copyFeedback, setCopyFeedback] = React.useState<"success" | CopySessionLogPathFailureReason | null>(null);
  const [copyPending, setCopyPending] = React.useState(false);
  React.useEffect(() => {
    if (copyFeedback === null) {
      return;
    }
    const timer = window.setTimeout(() => setCopyFeedback(null), 3_000);
    return () => window.clearTimeout(timer);
  }, [copyFeedback]);
  const status = deriveStatusDot(session);
  const accessibleName = [session.title, status === "none" ? null : t(statusLabelKey[status])]
    .filter((part): part is string => part !== null)
    .join("，");
  const archiveDisabledReason = session.isRunning ? t("console.conversationSidebar.archiveRunning") : null;
  const hasMenu = onAnalyzeConversation !== undefined
    || onArchiveSession !== undefined
    || onCopySessionLogPath !== undefined;
  const openMenuFromContext = (event: React.SyntheticEvent): void => {
    if (!disabled && hasMenu) {
      event.preventDefault();
      menuReturnFocusRef.current = event.currentTarget as HTMLElement;
      setMenuOpen(true);
    }
  };
  return (
    <div className="group relative flex h-8 min-w-0 items-center" data-testid="conversation-sidebar-session-row">
      <button
        type="button"
        data-testid="conversation-sidebar-session"
        data-session-id={session.id}
        data-status-dot={status}
        className={cn(
          "grid h-8 w-full grid-cols-[minmax(0,1fr)_18px] items-center gap-1.5 rounded-md px-2 text-left text-sm hover:bg-hover",
          selected ? "bg-sel" : "bg-transparent"
        )}
        aria-current={selected ? "page" : undefined}
        aria-label={accessibleName}
        title={session.title}
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            onSelectSession?.(session.id, projectId);
          }
        }}
        onContextMenu={openMenuFromContext}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            openMenuFromContext(event);
          }
        }}
      >
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-normal leading-4">{session.title}</span>
        </span>
        <StatusIcon status={status} />
      </button>
      {hasMenu ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "absolute right-1 flex h-6 w-6 items-center justify-center rounded-md bg-rail text-sub opacity-0 hover:bg-hover hover:text-ink focus:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent group-hover:opacity-100 group-focus-within:opacity-100",
                menuOpen && "opacity-100",
              )}
              aria-label={t("console.conversationSidebar.conversationMenu", { title: session.title })}
              title={t("console.conversationSidebar.conversationMenu", { title: session.title })}
              disabled={disabled}
            >
              <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            aria-label={t("console.conversationSidebar.conversationActions", { title: session.title })}
            className="min-w-32"
            onCloseAutoFocus={(event) => {
              if (menuReturnFocusRef.current !== null) {
                event.preventDefault();
                menuReturnFocusRef.current.focus();
                menuReturnFocusRef.current = null;
              }
            }}
          >
            {onAnalyzeConversation !== undefined ? (
              <SessionAnalysisMenuItem
                disabledReason={session.analysisDisabledReason ?? null}
                label={t("console.sessionAnalysis.analyzeConversation")}
                onSelect={() => onAnalyzeConversation(session.id, projectId)}
              />
            ) : null}
            {onCopySessionLogPath !== undefined ? (
              <DropdownMenuItem
                disabled={copyPending}
                title={t("console.conversationSidebar.copyPath")}
                onSelect={() => {
                  setCopyPending(true);
                  setCopyFeedback(null);
                  void onCopySessionLogPath(session.id, projectId)
                    .then((result) => setCopyFeedback(result.ok ? "success" : result.reason))
                    .catch(() => setCopyFeedback("unknown"))
                    .finally(() => setCopyPending(false));
                }}
              >
                {t("console.conversationSidebar.copyPath")}
              </DropdownMenuItem>
            ) : null}
            {onArchiveSession !== undefined ? (
              <DropdownMenuItem
                disabled={archiveDisabledReason !== null}
                aria-description={archiveDisabledReason ?? undefined}
                title={archiveDisabledReason ?? t("console.conversationSidebar.archive")}
                onSelect={() => onArchiveSession(session.id, projectId)}
              >
                {t("console.conversationSidebar.archive")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {copyFeedback !== null ? (
        <span
          className={cn(
            "pointer-events-none absolute right-8 z-20 whitespace-nowrap rounded-md border bg-card px-2 py-1 text-xs",
            copyFeedback === "success" ? "border-line text-ink" : "border-danger/40 text-danger",
          )}
          role={copyFeedback === "success" ? "status" : "alert"}
        >
          {copyFeedback === "success" ? t("console.conversationSidebar.pathCopied") : copySessionLogFailureMessage(copyFeedback, t)}
        </span>
      ) : null}
    </div>
  );
}

function SessionAnalysisMenuItem({
  disabledReason,
  label,
  onSelect,
}: {
  disabledReason: string | null;
  label: string;
  onSelect: () => void;
}): JSX.Element {
  const item = (
    <DropdownMenuItem
      disabled={disabledReason !== null}
      aria-description={disabledReason ?? undefined}
      title={disabledReason ?? label}
      onSelect={onSelect}
    >
      {label}
    </DropdownMenuItem>
  );
  if (disabledReason === null) {
    return item;
  }
  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="block cursor-not-allowed">
            {item}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">
          {disabledReason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function copySessionLogFailureMessage(reason: CopySessionLogPathFailureReason, t: Translate): string {
  switch (reason) {
    case "invalid-session":
      return t("console.conversationSidebar.copyInvalid");
    case "service-unavailable":
      return t("console.conversationSidebar.copyServiceUnavailable");
    case "record-unavailable":
      return t("console.conversationSidebar.copyRecordUnavailable");
    case "clipboard-unavailable":
      return t("console.conversationSidebar.copyClipboardUnavailable");
    case "unknown":
      return t("console.conversationSidebar.copyUnknown");
  }
}

function StatusIcon({ status }: { status: ConversationSessionStatus }): JSX.Element {
  const { t } = useI18n();
  return (
    <span
      className="flex h-4 w-4 items-center justify-center"
      role="img"
      aria-label={t(statusLabelKey[status])}
      title={t(statusLabelKey[status])}
      data-status-indicator={status}
    >
      {status === "red" ? <span className="h-[7px] w-[7px] rounded-full bg-danger" aria-hidden="true" /> : null}
      {status === "blue" ? <span className="h-[7px] w-[7px] rounded-full bg-[var(--status-info-fg)]" aria-hidden="true" /> : null}
      {status === "blink" ? <span className="h-[7px] w-[7px] rounded-full bg-[var(--status-run-fg)] animate-breathe" aria-hidden="true" /> : null}
    </span>
  );
}
