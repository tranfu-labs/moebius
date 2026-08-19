import * as React from "react";
import { ChevronRight, Folder, GitBranch, LoaderCircle, MoreHorizontal, Plus, Wrench } from "lucide-react";

import { cn } from "@/lib/utils";
import type { OperatorConsoleAppearance } from "@/console/operator-console-appearance";
import { operatorFloatingSurfaceClassName } from "@/console/operator-console-appearance";
import { translate, useI18n, type Translate, type TranslationKey } from "@/i18n";
import {
  deriveProjectStatusDot,
  deriveStatusDot,
  type ConversationStatusDot,
  type StatusDotFacts,
} from "@/console/status-dot";
import { Button } from "@/ui/button";
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
  pinnedAt?: string | null;
  titleRevision?: number;
  attentionRevision?: number;
  readStateRevision?: number;
  manualUnreadAt?: string | null;
  hasUnacknowledgedAttention?: boolean;
  hasManagedProcesses?: boolean;
  branchName?: string | null;
  branchUnavailable?: boolean;
  summary?: string;
}

export interface ConversationSidebarProject {
  id: string;
  path: string;
  label?: string;
  newConversationDisabledReason?: string | null;
  directoryAvailable?: boolean;
  directoryUnavailableReason?: string | null;
  isGitRepository?: boolean;
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
  onUpdateReadState?: (
    session: ConversationSidebarSession,
    projectId: string,
    action: "mark-read-attention" | "mark-read-unread" | "mark-unread",
  ) => Promise<void>;
  onSetSessionPinned?: (
    session: ConversationSidebarSession,
    projectId: string,
    pinned: boolean,
  ) => Promise<void>;
  onRenameSession?: (
    session: ConversationSidebarSession,
    projectId: string,
    title: string,
  ) => Promise<void>;
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
  appearance?: OperatorConsoleAppearance;
}

const statusLabelKey: Record<ConversationSessionStatus, TranslationKey> = {
  red: "console.conversationSidebar.needsYou",
  blue: "console.conversationSidebar.unread",
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

export const CONVERSATION_SIDEBAR_INITIAL_SESSION_LIMIT = 5;
export const CONVERSATION_SIDEBAR_LOAD_MORE_LIMIT = 10;
export const CONVERSATION_SIDEBAR_LOAD_MORE_DELAY_MS = 120;

export interface ConversationSidebarSessionPage<T> {
  visibleSessions: T[];
  hasMore: boolean;
  nextLimit: number;
}

export function planConversationSidebarSessionPage<T>(
  sessions: readonly T[],
  visibleLimit = CONVERSATION_SIDEBAR_INITIAL_SESSION_LIMIT,
): ConversationSidebarSessionPage<T> {
  const normalizedLimit = Math.max(0, Math.trunc(visibleLimit));
  return {
    visibleSessions: sessions.slice(0, normalizedLimit),
    hasMore: sessions.length > normalizedLimit,
    nextLimit: normalizedLimit + CONVERSATION_SIDEBAR_LOAD_MORE_LIMIT,
  };
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

function capturePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    // Synthetic pointer events (Storybook/tests) do not always register an
    // active browser pointer. Dragging still works through the row handlers.
  }
}

function releasePointer(element: HTMLElement, pointerId: number): void {
  try {
    if (element.hasPointerCapture?.(pointerId)) {
      element.releasePointerCapture?.(pointerId);
    }
  } catch {
    // The browser may have released capture before pointerup/pointercancel.
  }
}

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
  onUpdateReadState,
  onSetSessionPinned,
  onRenameSession,
  onCopySessionLogPath,
  onReorderProjects,
  onRepairProject,
  onRetry,
  disabled = false,
  disabledReason,
  projectActionsDisabled = false,
  projectActionsDisabledReason,
  showProjectPath = true,
  className,
  appearance = "default",
}: ConversationSidebarProps): JSX.Element {
  const { t } = useI18n();
  const asideRef = React.useRef<HTMLElement | null>(null);
  const [preview, setPreview] = React.useState<{
    session: ConversationSidebarSession;
    project: ConversationSidebarProject;
    top: number;
  } | null>(null);
  const [collapsedProjectIds, setCollapsedProjectIds] = React.useState<Set<string>>(() => new Set());
  const [draftProjectOrder, setDraftProjectOrder] = React.useState<string[] | null>(null);
  const [draggingProjectId, setDraggingProjectId] = React.useState<string | null>(null);
  const [sessionLimits, setSessionLimits] = React.useState<Record<string, number>>({});
  const [loadingProjectIds, setLoadingProjectIds] = React.useState<Set<string>>(() => new Set());
  const rowElements = React.useRef(new Map<string, HTMLDivElement>());
  const gestureRef = React.useRef<ProjectPointerGesture | null>(null);
  const pendingSessionLoadsRef = React.useRef(new Map<string, number>());
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

  const cancelPendingSessionLoad = (projectId: string): void => {
    const timerId = pendingSessionLoadsRef.current.get(projectId);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      pendingSessionLoadsRef.current.delete(projectId);
    }
    setLoadingProjectIds((current) => {
      if (!current.has(projectId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
  };

  const resetProjectSessionPage = (projectId: string): void => {
    cancelPendingSessionLoad(projectId);
    setSessionLimits((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, projectId)) {
        return current;
      }
      const next = { ...current };
      delete next[projectId];
      return next;
    });
  };

  React.useEffect(() => {
    const currentProjectIds = new Set(projectIds);
    setSessionLimits((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([projectId]) => currentProjectIds.has(projectId)),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
    for (const projectId of pendingSessionLoadsRef.current.keys()) {
      if (!currentProjectIds.has(projectId)) {
        cancelPendingSessionLoad(projectId);
      }
    }
  }, [projectOrderKey]);

  React.useEffect(() => () => {
    for (const timerId of pendingSessionLoadsRef.current.values()) {
      window.clearTimeout(timerId);
    }
    pendingSessionLoadsRef.current.clear();
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
  const pinnedSessions = projects
    .flatMap((project) => project.sessions
      .filter((session) => (session.pinnedAt ?? null) !== null)
      .map((session) => ({ project, session })))
    .sort((left, right) =>
      (right.session.pinnedAt ?? "").localeCompare(left.session.pinnedAt ?? ""));
  const showPreview = (
    session: ConversationSidebarSession,
    project: ConversationSidebarProject,
    element: HTMLElement,
  ): void => {
    const aside = asideRef.current?.getBoundingClientRect();
    const row = element.getBoundingClientRect();
    if (aside !== undefined) {
      setPreview({ session, project, top: row.top - aside.top });
    }
  };

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

  const toggleProject = (projectId: string): void => {
    const isCollapsed = collapsedProjectIds.has(projectId);
    if (!isCollapsed) {
      resetProjectSessionPage(projectId);
    }
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const loadMoreSessions = (projectId: string, nextLimit: number): void => {
    if (loadingProjectIds.has(projectId)) {
      return;
    }
    setLoadingProjectIds((current) => {
      const next = new Set(current);
      next.add(projectId);
      return next;
    });
    const timerId = window.setTimeout(() => {
      pendingSessionLoadsRef.current.delete(projectId);
      setSessionLimits((current) => ({ ...current, [projectId]: nextLimit }));
      setLoadingProjectIds((current) => {
        if (!current.has(projectId)) {
          return current;
        }
        const next = new Set(current);
        next.delete(projectId);
        return next;
      });
    }, CONVERSATION_SIDEBAR_LOAD_MORE_DELAY_MS);
    pendingSessionLoadsRef.current.set(projectId, timerId);
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
    releasePointer(event.currentTarget, event.pointerId);
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
      toggleProject(gesture.projectId);
    }
  };

  return (
    <aside
      ref={asideRef}
      className={cn("relative flex w-[252px] flex-col overflow-visible bg-canvas text-ink", className)}
      aria-label={t("console.conversationSidebar.label")}
    >
      <nav
        className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2.5 pb-2"
        aria-label={t("console.conversationSidebar.projectList")}
        onMouseLeave={() => setPreview(null)}
      >
        {dataState === "loading" ? (
          <ProjectListSkeleton />
        ) : dataState === "error" ? (
          <ProjectListError onRetry={onRetry} />
        ) : visibleProjects.length === 0 ? (
          <p className="px-2 py-3 text-xs leading-5 text-hint" data-testid="conversation-sidebar-no-projects">
            {t("console.conversationSidebar.addFirstProject")}
          </p>
        ) : (
          <>
            {pinnedSessions.length > 0 ? (
              <section aria-label={t("console.conversationSidebar.pinned")} className="mb-3">
                <div className="px-2 pb-1 pt-2 text-xs uppercase tracking-[0.06em] text-sub">
                  {t("console.conversationSidebar.pinned")}
                </div>
                <div className="space-y-0.5" role="list">
                  {pinnedSessions.map(({ project, session }) => (
                    <SessionRow
                      key={session.id}
                      project={project}
                      projectId={project.id}
                      session={session}
                      selected={session.id === selectedSessionId}
                      onSelectSession={onSelectSession}
                      onAnalyzeConversation={onAnalyzeConversation}
                      onArchiveSession={onArchiveSession}
                      onCopySessionLogPath={onCopySessionLogPath}
                      onUpdateReadState={onUpdateReadState}
                      onSetSessionPinned={onSetSessionPinned}
                      onRenameSession={onRenameSession}
                      onPreview={showPreview}
                      onPreviewEnd={() => setPreview(null)}
                      appearance={appearance}
                      disabled={disabled}
                    />
                  ))}
                </div>
              </section>
            ) : null}
            <div className="flex items-center justify-between px-2 pb-1 pt-2 text-xs uppercase tracking-[0.06em] text-sub">
              <span>{t("console.conversationSidebar.projects")}</span>
              {projectActionsDisabled ? <span role="status">{t("sidebar.updating")}</span> : null}
            </div>
            {visibleProjects.map((project) => {
          const projectName = projectDirectoryName(project, t("console.conversationSidebar.untitledProject"));
          const orderedSessions = orderSessionsByCreatedAt(
            project.sessions.filter((session) => (session.pinnedAt ?? null) === null),
          );
          const visibleLimit = sessionLimits[project.id] ?? CONVERSATION_SIDEBAR_INITIAL_SESSION_LIMIT;
          const sessionPage = planConversationSidebarSessionPage(orderedSessions, visibleLimit);
          const loadingMore = loadingProjectIds.has(project.id);
          const expanded = !collapsedProjectIds.has(project.id);
          const aggregatedStatus = expanded ? "none" : deriveProjectStatusDot(orderedSessions);
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
            <section key={project.id} className="pb-2 last:pb-0" aria-label={t("console.conversationSidebar.project", { project: projectName })}>
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
                  "mb-0.5 flex h-7 min-w-0 cursor-grab touch-none select-none items-center gap-1.5 rounded-md px-2 hover:bg-hover",
                  draggingProjectId === project.id && "cursor-grabbing bg-sel opacity-80",
                )}
                onPointerDown={(event) => {
                  // Radix menus render their content through a React portal. The
                  // portal event still bubbles through this row in React even
                  // though the menu item is not a DOM descendant of the row.
                  // Only a pointer that started inside the row may begin its
                  // drag/collapse gesture.
                  const target = event.target;
                  if (!(target instanceof Element) || !event.currentTarget.contains(target)) {
                    return;
                  }
                  if (
                    event.button !== 0
                    || gestureRef.current !== null
                    || target.closest("[data-project-row-action]") !== null
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
                  capturePointer(event.currentTarget, event.pointerId);
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
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleProject(project.id);
                    }
                  }}
                >
                  <ChevronRight
                    className={cn("h-3.5 w-3.5 shrink-0 text-sub transition-transform", expanded && "rotate-90")}
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm leading-5" title={projectName}>{projectName}</h2>
                    {showProjectPath ? <p className="truncate text-xs text-hint" title={project.path}>{project.path}</p> : null}
                  </div>
                  {!expanded ? <ConversationStatusIndicator status={aggregatedStatus} /> : null}
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
                    <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
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
                        data-project-menu-project-id={project.id}
                        disabled={disabled || projectActionsDisabled}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      aria-label={t("console.conversationSidebar.projectActions", { project: projectName })}
                      className={operatorFloatingSurfaceClassName(appearance, "min-w-48")}
                    >
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
                        <DropdownMenuItem
                          className="text-danger focus:text-danger"
                          onSelect={() => onRemoveProject(project)}
                        >
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
                  {project.sessions.length > 0
                    ? t("console.conversationSidebar.allPinned")
                    : t("console.conversationSidebar.noConversations")}
                </p>
              ) : (
                <div id={conversationListId} className="space-y-0.5" role="list" aria-label={t("console.conversationSidebar.projectConversations", { project: projectName })}>
                  {sessionPage.visibleSessions.map((session) => (
                    <SessionRow
                      key={session.id}
                      project={project}
                      projectId={project.id}
                      session={session}
                      selected={session.id === selectedSessionId}
                      onSelectSession={onSelectSession}
                      onAnalyzeConversation={onAnalyzeConversation}
                      onArchiveSession={onArchiveSession}
                      onCopySessionLogPath={onCopySessionLogPath}
                      onUpdateReadState={onUpdateReadState}
                      onSetSessionPinned={onSetSessionPinned}
                      onRenameSession={onRenameSession}
                      onPreview={showPreview}
                      onPreviewEnd={() => setPreview(null)}
                      appearance={appearance}
                      disabled={disabled}
                    />
                  ))}
                  {sessionPage.hasMore ? (
                    <div className="px-2 pt-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start text-xs"
                        data-testid="conversation-sidebar-show-more"
                        data-project-id={project.id}
                        disabled={disabled || loadingMore}
                        aria-busy={loadingMore}
                        aria-description={loadingMore ? t("console.conversationSidebar.loadingMore") : undefined}
                        onClick={() => loadMoreSessions(project.id, sessionPage.nextLimit)}
                      >
                        {loadingMore ? (
                          <LoaderCircle
                            className="h-3.5 w-3.5 motion-safe:animate-spin motion-reduce:animate-none"
                            strokeWidth={1.5}
                            aria-hidden="true"
                          />
                        ) : null}
                        {t("console.conversationSidebar.showMore")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
            })}
          </>
        )}
      </nav>
      <ConversationPreview preview={preview} appearance={appearance} />
    </aside>
  );
}

function ProjectListSkeleton(): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="space-y-3 px-2 py-2" aria-label={t("console.conversationSidebar.projectsLoading")} aria-busy="true" data-testid="conversation-sidebar-loading">
      {["first", "second", "third"].map((key, index) => (
        <div key={key} className="animate-pulse space-y-2 motion-reduce:animate-none" aria-hidden="true">
          <div className="flex h-7 items-center gap-2">
            <span className="h-3 w-3 rounded-md bg-line" />
            <span className={cn("h-3 rounded bg-line", index === 1 ? "w-24" : "w-32")} />
          </div>
          <div className="ml-5 h-7 rounded-lg bg-line/60" />
          {index === 0 ? <div className="ml-5 h-7 rounded-lg bg-line/40" /> : null}
        </div>
      ))}
    </div>
  );
}

function ProjectListError({ onRetry }: { onRetry?: () => void }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="mx-2 mt-2 rounded-xl border border-line bg-card px-3 py-3" role="alert" data-testid="conversation-sidebar-error">
      <p className="text-sm font-normal text-ink">{t("console.conversationSidebar.loadFailed")}</p>
      <p className="mt-1 text-xs leading-5 text-sub">{t("console.conversationSidebar.loadFailedDescription")}</p>
      {onRetry ? (
        <button
          type="button"
          className="mt-2 h-7 rounded-lg border border-line bg-input px-2.5 text-xs font-normal text-ink hover:bg-hover"
          onClick={onRetry}
        >
          {t("common.retry")}
        </button>
      ) : null}
    </div>
  );
}

function ConversationPreview({
  preview,
  appearance,
}: {
  preview: {
    session: ConversationSidebarSession;
    project: ConversationSidebarProject;
    top: number;
  } | null;
  appearance: OperatorConsoleAppearance;
}): JSX.Element {
  const { t } = useI18n();
  const folderName = preview === null
    ? ""
    : preview.project.path.trim().replace(/[\\/]+$/u, "").split(/[\\/]/u).filter(Boolean).at(-1)
      ?? t("console.conversationSidebar.untitledProject");
  const branchName = preview === null
    ? null
    : preview.project.directoryAvailable === false
      ? t("console.conversationSidebar.branchUnavailable")
      : preview.project.isGitRepository === false
        ? null
        : preview.session.branchUnavailable === true
      || !preview.session.branchName
        ? t("console.conversationSidebar.branchUnavailable")
        : preview.session.branchName;

  return (
    <div
      className={cn(
        operatorFloatingSurfaceClassName(
          appearance,
          "pointer-events-none absolute left-[calc(100%+8px)] top-0 z-50 w-64 rounded-xl px-3 py-2.5",
        ),
        appearance === "default" && "border border-line bg-sunken shadow-lg",
        "transition-[transform,opacity] duration-150 ease-out motion-reduce:transition-none",
        preview === null ? "invisible opacity-0" : "visible opacity-100",
      )}
      style={{ transform: `translate3d(0, ${preview?.top ?? 0}px, 0)` }}
      data-testid="conversation-sidebar-shared-preview"
      data-visible={preview === null ? "false" : "true"}
      aria-hidden={preview === null}
    >
      <p className="truncate text-sm text-ink">
        {preview?.session.title ?? ""}
      </p>
      <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-sub">
        <Folder className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
        <span className="truncate">{folderName}</span>
      </p>
      {branchName !== null ? (
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-sub">
          <GitBranch className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          <span className="truncate">{branchName}</span>
        </p>
      ) : null}
    </div>
  );
}

function SessionRow({
  project,
  projectId,
  session,
  selected,
  onSelectSession,
  onAnalyzeConversation,
  onArchiveSession,
  onCopySessionLogPath,
  onUpdateReadState,
  onSetSessionPinned,
  onRenameSession,
  onPreview,
  onPreviewEnd,
  appearance,
  disabled
}: {
  project: ConversationSidebarProject;
  projectId: string;
  session: ConversationSidebarSession;
  selected: boolean;
  onSelectSession?: (sessionId: string, projectId: string) => void;
  onAnalyzeConversation?: (sessionId: string, projectId: string) => void;
  onArchiveSession?: (sessionId: string, projectId: string) => void;
  onCopySessionLogPath?: (sessionId: string, projectId: string) => Promise<CopySessionLogPathResult>;
  onUpdateReadState?: ConversationSidebarProps["onUpdateReadState"];
  onSetSessionPinned?: ConversationSidebarProps["onSetSessionPinned"];
  onRenameSession?: ConversationSidebarProps["onRenameSession"];
  onPreview: (
    session: ConversationSidebarSession,
    project: ConversationSidebarProject,
    element: HTMLElement,
  ) => void;
  onPreviewEnd: () => void;
  appearance: OperatorConsoleAppearance;
  disabled: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuReturnFocusRef = React.useRef<HTMLElement | null>(null);
  const [copyFeedback, setCopyFeedback] = React.useState<"success" | CopySessionLogPathFailureReason | null>(null);
  const [copyPending, setCopyPending] = React.useState(false);
  const [mutationPending, setMutationPending] = React.useState(false);
  const [mutationError, setMutationError] = React.useState<string | null>(null);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameValue, setRenameValue] = React.useState(session.title);
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
  const archiveDisabledReason = session.isRunning || session.hasManagedProcesses === true
    ? t("console.conversationSidebar.archiveRunning")
    : null;
  const hasMenu = onAnalyzeConversation !== undefined
    || onArchiveSession !== undefined
    || onCopySessionLogPath !== undefined
    || onUpdateReadState !== undefined
    || onSetSessionPinned !== undefined
    || onRenameSession !== undefined;
  const openMenuFromContext = (event: React.SyntheticEvent): void => {
    if (!disabled && hasMenu) {
      event.preventDefault();
      onPreviewEnd();
      menuReturnFocusRef.current = event.currentTarget as HTMLElement;
      setMenuOpen(true);
    }
  };
  return (
    <div className="group relative flex h-7 min-w-0 items-center" data-testid="conversation-sidebar-session-row">
      <button
        type="button"
        data-testid="conversation-sidebar-session"
        data-session-id={session.id}
        data-status-dot={status}
        className={cn(
          "grid h-7 w-full grid-cols-[minmax(0,1fr)_18px] items-center gap-1.5 rounded-md pl-7 pr-2 text-left hover:bg-hover",
          appearance === "focused" ? "text-ink" : "text-sub hover:text-ink",
          selected ? "bg-sel" : "bg-transparent"
        )}
        aria-current={selected ? "page" : undefined}
        aria-label={accessibleName}
        title={session.title}
        disabled={disabled}
        onMouseEnter={(event) => onPreview(session, project, event.currentTarget)}
        onMouseLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onPreviewEnd();
        }}
        onFocus={(event) => onPreview(session, project, event.currentTarget)}
        onBlur={(event) => {
          if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) onPreviewEnd();
        }}
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
          <span
            className="block truncate text-sm font-normal leading-4"
            data-testid="conversation-sidebar-session-title"
          >
            {session.title}
          </span>
        </span>
        <ConversationStatusIndicator status={status} />
      </button>
      {hasMenu ? (
        <DropdownMenu
          open={menuOpen}
          onOpenChange={(open) => {
            setMenuOpen(open);
            if (open) onPreviewEnd();
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "absolute right-1 flex h-6 w-6 items-center justify-center rounded-lg bg-canvas text-sub opacity-0 hover:bg-hover hover:text-ink focus:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent group-hover:opacity-100 group-focus-within:opacity-100",
                menuOpen && "opacity-100",
              )}
              aria-label={t("console.conversationSidebar.conversationMenu", { title: session.title })}
              title={t("console.conversationSidebar.conversationMenu", { title: session.title })}
              disabled={disabled}
            >
              <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            aria-label={t("console.conversationSidebar.conversationActions", { title: session.title })}
            className={operatorFloatingSurfaceClassName(appearance, "min-w-32")}
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
            {onUpdateReadState !== undefined && status !== "blink" ? (
              <DropdownMenuItem
                disabled={mutationPending}
                onSelect={() => {
                  const action = status === "red"
                    ? "mark-read-attention"
                    : status === "blue"
                      ? "mark-read-unread"
                      : "mark-unread";
                  setMutationPending(true);
                  setMutationError(null);
                  void onUpdateReadState(session, projectId, action)
                    .catch((error: unknown) =>
                      setMutationError(error instanceof Error ? error.message : String(error)))
                    .finally(() => setMutationPending(false));
                }}
              >
                {t(status === "none"
                  ? "console.conversationSidebar.markUnread"
                  : "console.conversationSidebar.markRead")}
              </DropdownMenuItem>
            ) : null}
            {onSetSessionPinned !== undefined ? (
              <DropdownMenuItem
                disabled={mutationPending}
                onSelect={() => {
                  const pinned = (session.pinnedAt ?? null) === null;
                  setMutationPending(true);
                  setMutationError(null);
                  void onSetSessionPinned(session, projectId, pinned)
                    .then(() => {
                      window.requestAnimationFrame(() => {
                        const destination = document.querySelector<HTMLElement>(
                          `[data-session-id="${CSS.escape(session.id)}"]`,
                        ) ?? document.querySelector<HTMLElement>(
                          `[data-project-id="${CSS.escape(projectId)}"][data-testid="conversation-sidebar-project-toggle"]`,
                        );
                        destination?.focus();
                      });
                    })
                    .catch((error: unknown) =>
                      setMutationError(error instanceof Error ? error.message : String(error)))
                    .finally(() => setMutationPending(false));
                }}
              >
                {t((session.pinnedAt ?? null) === null
                  ? "console.conversationSidebar.pin"
                  : "console.conversationSidebar.unpin")}
              </DropdownMenuItem>
            ) : null}
            {onRenameSession !== undefined ? (
              <DropdownMenuItem
                disabled={mutationPending}
                onSelect={() => {
                  onPreviewEnd();
                  setRenameValue(session.title);
                  setMutationError(null);
                  setRenameOpen(true);
                }}
              >
                {t("console.conversationSidebar.renameConversation")}
              </DropdownMenuItem>
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
            "pointer-events-none absolute right-8 z-20 whitespace-nowrap rounded-lg border bg-card px-2 py-1 text-xs",
            copyFeedback === "success" ? "border-line text-ink" : "border-danger/40 text-danger",
            appearance === "focused" && copyFeedback === "success" && operatorFloatingSurfaceClassName(appearance),
          )}
          role={copyFeedback === "success" ? "status" : "alert"}
        >
          {copyFeedback === "success" ? t("console.conversationSidebar.pathCopied") : copySessionLogFailureMessage(copyFeedback, t)}
        </span>
      ) : null}
      {mutationError !== null ? (
        <span
          className="absolute right-0 top-8 z-40 max-w-64 rounded-lg border border-danger/40 bg-sunken px-2 py-1 text-xs text-danger"
          role="alert"
        >
          {mutationError}
        </span>
      ) : null}
      {renameOpen ? (
        <div
          className={operatorFloatingSurfaceClassName(
            appearance,
            "absolute left-2 top-8 z-50 w-60 rounded-lg border border-line bg-sunken p-3",
          )}
          role="dialog"
          aria-label={t("console.conversationSidebar.renameConversation")}
        >
          <label className="block text-xs font-normal text-sub">
            {t("console.conversationSidebar.conversationName")}
            <input
              autoFocus
              className="mt-1 h-8 w-full rounded-md border border-line bg-input px-2 text-sm text-ink outline-none focus:border-accent"
              disabled={mutationPending}
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setRenameOpen(false);
              }}
            />
          </label>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              className="h-7 rounded-md px-2 text-xs text-sub hover:bg-hover"
              disabled={mutationPending}
              onClick={() => setRenameOpen(false)}
            >
              {t("console.common.cancel")}
            </button>
            <button
              type="button"
              className="h-7 rounded-md bg-accent px-2 text-xs font-normal text-white disabled:opacity-40"
              disabled={mutationPending || renameValue.trim() === ""}
              onClick={() => {
                setMutationPending(true);
                setMutationError(null);
                void onRenameSession?.(session, projectId, renameValue)
                  .then(() => setRenameOpen(false))
                  .catch((error: unknown) =>
                    setMutationError(error instanceof Error ? error.message : String(error)))
                  .finally(() => setMutationPending(false));
              }}
            >
              {mutationPending
                ? t("console.conversationSidebar.saving")
                : t("console.conversationSidebar.save")}
            </button>
          </div>
        </div>
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

export function ConversationStatusIndicator({
  status,
}: {
  status: ConversationSessionStatus;
}): JSX.Element {
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
