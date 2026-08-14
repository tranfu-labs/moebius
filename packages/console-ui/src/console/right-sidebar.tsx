import {
  FileDiff,
  FileText,
  Files,
  ListTree,
  MessageSquare,
  Plus,
  ScrollText,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import {
  rightSidebarKeyboardWidth,
  type RightSidebarLayout,
  type RightSidebarResizeKey,
} from "@/console/right-sidebar-layout";
import {
  RIGHT_SIDEBAR_TOGGLE_DURATION_MS,
  rightSidebarToggleProgressAt,
  startRightSidebarToggleMotion,
  type RightSidebarToggleMotion,
} from "@/console/right-sidebar-motion";
import {
  RIGHT_SIDEBAR_BUILTIN_TAB_TITLES,
  RIGHT_SIDEBAR_SELECTABLE_TAB_TYPES,
  addBlankRightSidebarTab,
  closeRightSidebarTab,
  convertBlankRightSidebarTab,
  selectRightSidebarTab,
  type RightSidebarSelectableTabType,
  type RightSidebarTab,
  type RightSidebarTabType,
  type RightSidebarTabsState,
} from "@/console/right-sidebar-tabs";
import { useI18n, type Translate } from "@/i18n";
import { cn } from "@/lib/utils";
import type { OperatorConsoleAppearance } from "@/console/operator-console-appearance";

type RightSidebarContentType = Exclude<RightSidebarTabType, "blank">;

export type RightSidebarContentSlots = Partial<Record<
  RightSidebarContentType,
  (tab: RightSidebarTab) => ReactNode
>>;

export interface RightSidebarProps {
  open: boolean;
  availableWidth: number;
  width: number;
  minWidth: number;
  maxWidth: number;
  layout: RightSidebarLayout;
  isGitRepository: boolean;
  state: RightSidebarTabsState;
  onStateChange(state: RightSidebarTabsState): void;
  onOpenChange(open: boolean): void;
  onWidthChange(width: number): void;
  onBeforeCloseTab?: (tab: RightSidebarTab) => boolean;
  focusTabId?: string | null;
  onFocusTabHandled?: (tabId: string) => void;
  createTabId(): string;
  contentSlots?: RightSidebarContentSlots;
  tabDiscriminators?: Readonly<Record<string, string>>;
  updatingTabIds?: readonly string[];
  onRetryTitles?: () => void;
  toggleButtonRef?: RefObject<HTMLButtonElement>;
  onExitComplete?: () => void;
  className?: string;
  appearance?: OperatorConsoleAppearance;
}

interface ResizeGesture {
  pointerId: number;
  startX: number;
  startWidth: number;
}

export function RightSidebar({
  open,
  availableWidth,
  width,
  minWidth,
  maxWidth,
  layout,
  isGitRepository,
  state,
  onStateChange,
  onOpenChange,
  onWidthChange,
  onBeforeCloseTab,
  focusTabId = null,
  onFocusTabHandled,
  createTabId,
  contentSlots = {},
  tabDiscriminators = {},
  updatingTabIds = [],
  onRetryTitles,
  toggleButtonRef,
  onExitComplete,
  className,
  appearance = "default",
}: RightSidebarProps): JSX.Element | null {
  const { t } = useI18n();
  const reducedMotion = usePrefersReducedMotion();
  const asideRef = useRef<HTMLElement | null>(null);
  const separatorRef = useRef<HTMLDivElement | null>(null);
  const overlayCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const layoutControlFocusedRef = useRef(false);
  const resizeGestureRef = useRef<ResizeGesture | null>(null);
  const tabButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const tabElementsRef = useRef(new Map<string, HTMLDivElement>());
  const focusedTabIdRef = useRef<string | null>(null);
  const [closingSnapshot, setClosingSnapshot] = useState<RightSidebarTabsState | null>(null);
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  const [closing, setClosing] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [transitionDuration, setTransitionDuration] = useState(0);
  const mountedRef = useRef(open);
  const expandedRef = useRef(open);
  const openRef = useRef(open);
  const motionRef = useRef<RightSidebarToggleMotion | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const openFrameRef = useRef<number | null>(null);
  const exitCompleteRef = useRef(onExitComplete);
  const toggleButtonRefRef = useRef(toggleButtonRef);
  exitCompleteRef.current = onExitComplete;
  toggleButtonRefRef.current = toggleButtonRef;
  openRef.current = open;
  const renderedState = closingSnapshot ?? state;
  const activeTab = renderedState.tabs.find((tab) => tab.id === renderedState.activeTabId)
    ?? renderedState.tabs[0]
    ?? null;
  const tabLayoutKey = renderedState.tabs
    .map((tab) => `${tab.id}:${tab.title}:${tabDiscriminators[tab.id] ?? ""}`)
    .join("\u0000");

  const completeExit = useCallback(() => {
    if (openRef.current) return;
    mountedRef.current = false;
    expandedRef.current = false;
    motionRef.current = null;
    setMounted(false);
    setExpanded(false);
    setClosing(false);
    setTransitionDuration(0);
    setClosingSnapshot(null);
    exitCompleteRef.current?.();
  }, []);

  useLayoutEffect(() => {
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    if (openFrameRef.current !== null) {
      window.cancelAnimationFrame(openFrameRef.current);
      openFrameRef.current = null;
    }
    const now = performance.now();
    const currentProgress = motionRef.current === null
      ? expandedRef.current ? 1 : 0
      : rightSidebarToggleProgressAt(motionRef.current, now);
    const target = open ? 1 : 0;
    const motion = reducedMotion
      ? null
      : startRightSidebarToggleMotion(currentProgress, target, now);
    motionRef.current = motion;
    setTransitionDuration(motion?.duration ?? 0);
    if (open) {
      mountedRef.current = true;
      setMounted(true);
      setClosing(false);
      setClosingSnapshot(null);
      if (reducedMotion) {
        expandedRef.current = true;
        setExpanded(true);
      } else if (!expandedRef.current) {
        openFrameRef.current = window.requestAnimationFrame(() => {
          openFrameRef.current = window.requestAnimationFrame(() => {
            openFrameRef.current = null;
            expandedRef.current = true;
            setExpanded(true);
          });
        });
      }
      return;
    }
    if (!mountedRef.current) return;
    setClosing(true);
    expandedRef.current = false;
    setExpanded(false);
    if (asideRef.current?.contains(document.activeElement)) {
      toggleButtonRefRef.current?.current?.focus();
    }
    if (reducedMotion) {
      completeExit();
      return;
    }
    exitTimerRef.current = window.setTimeout(completeExit, RIGHT_SIDEBAR_TOGGLE_DURATION_MS + 50);
  }, [completeExit, open, reducedMotion]);

  useEffect(() => () => {
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
    if (openFrameRef.current !== null) window.cancelAnimationFrame(openFrameRef.current);
  }, []);

  useLayoutEffect(() => {
    if (asideRef.current !== null) asideRef.current.inert = closing;
  }, [closing]);

  useEffect(() => {
    const trackLayoutControlFocus = (event: FocusEvent) => {
      layoutControlFocusedRef.current = event.target === separatorRef.current
        || event.target === overlayCloseButtonRef.current;
    };
    document.addEventListener("focusin", trackLayoutControlFocus);
    return () => document.removeEventListener("focusin", trackLayoutControlFocus);
  }, []);

  useLayoutEffect(() => {
    if (!layoutControlFocusedRef.current) return;
    toggleButtonRefRef.current?.current?.focus();
    layoutControlFocusedRef.current = false;
  }, [layout]);

  useLayoutEffect(() => {
    if (
      focusedTabIdRef.current !== null
      && !tabElementsRef.current.has(focusedTabIdRef.current)
    ) {
      focusedTabIdRef.current = null;
    }
    const targetTabId = focusedTabIdRef.current ?? activeTab?.id ?? null;
    if (targetTabId === null) return;
    tabElementsRef.current.get(targetTabId)?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeTab?.id, tabLayoutKey]);

  useLayoutEffect(() => {
    if (!open || focusTabId === null) return;
    const target = tabButtonRefs.current.get(focusTabId);
    if (target === undefined) return;
    target.focus();
    onFocusTabHandled?.(focusTabId);
  }, [focusTabId, onFocusTabHandled, open, renderedState.tabs]);

  if (!open && !mounted) {
    return null;
  }

  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = resizeGestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) {
      return;
    }
    onWidthChange(Math.min(
      maxWidth,
      Math.max(minWidth, Math.round(gesture.startWidth + gesture.startX - event.clientX)),
    ));
  };

  const finishResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = resizeGestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) {
      return;
    }
    resizeGestureRef.current = null;
    setResizing(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const focusedSplitGutter = appearance === "focused" ? 6 : 0;
  const splitTrackWidth = width + focusedSplitGutter;

  return (
    <aside
      ref={asideRef}
      className={cn(
        "flex min-w-0 shrink-0 flex-col overflow-hidden border-l border-line bg-canvas motion-reduce:transition-none",
        layout === "split"
          ? "relative z-20 transition-[width] duration-[220ms] ease-[var(--ease)]"
          : "absolute inset-0 z-40 w-full border-l-0 transition-transform duration-[220ms] ease-[var(--ease)]",
        layout === "split" && resizing && "transition-none",
        appearance === "focused" && layout === "split" && "border-0 bg-transparent shadow-none",
        appearance === "focused" && layout === "overlay" && "inset-1 rounded-xl border border-line bg-card shadow-panel",
        closing && "pointer-events-none",
        className,
      )}
      style={layout === "split"
        ? {
            width: expanded ? `${String(splitTrackWidth)}px` : "0px",
            transitionDuration: `${String(transitionDuration)}ms`,
          }
        : {
            transform: expanded ? "translateX(0)" : "translateX(100%)",
            transitionDuration: `${String(transitionDuration)}ms`,
          }}
      aria-label={t("console.rightSidebar.label")}
      aria-hidden={closing || undefined}
      data-layout={layout}
      data-motion-state={closing ? "closing" : expanded ? "open" : "opening"}
      data-testid="right-sidebar"
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        motionRef.current = null;
        setTransitionDuration(0);
        if (!openRef.current) completeExit();
      }}
    >
      {layout === "split" ? (
        <div
          ref={separatorRef}
          className={cn(
            "window-no-drag group absolute inset-y-0 left-0 z-30 w-2 -translate-x-1/2 cursor-col-resize touch-none focus-visible:outline-none",
            appearance === "focused" && "-left-0.5 w-3 border-0 bg-transparent shadow-none [&>span]:hidden",
          )}
          role="separator"
          tabIndex={0}
          aria-label={t("console.rightSidebar.resize")}
          aria-orientation="vertical"
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          aria-valuenow={width}
          aria-valuetext={t("sidebar.widthPixels", { width })}
          data-boundary={width <= minWidth ? "min" : width >= maxWidth ? "max" : "none"}
          data-testid="right-sidebar-resize-handle"
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            event.preventDefault();
            resizeGestureRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startWidth: width,
            };
            setResizing(true);
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={resize}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
            const keys: RightSidebarResizeKey[] = ["ArrowLeft", "ArrowRight", "Home", "End"];
            if (!keys.includes(event.key as RightSidebarResizeKey)) return;
            event.preventDefault();
            onWidthChange(rightSidebarKeyboardWidth(
              width,
              event.key as RightSidebarResizeKey,
              event.shiftKey,
              availableWidth,
            ));
          }}
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line transition-[width,background-color] group-hover:w-[3px] group-hover:bg-accent group-active:w-[3px] group-active:bg-accent group-focus-visible:w-[3px] group-focus-visible:bg-accent group-data-[boundary=min]:w-[3px] group-data-[boundary=min]:bg-accent group-data-[boundary=max]:w-[3px] group-data-[boundary=max]:bg-accent" />
        </div>
      ) : null}

      <div
        className={cn(
          "relative flex h-full min-w-0 flex-col border-l border-line bg-canvas",
          layout === "split" ? "absolute inset-y-0 right-0" : "w-full border-l-0",
          appearance === "focused" && layout === "split" && "inset-y-1 right-1 h-auto overflow-hidden rounded-xl border border-line bg-card shadow-panel",
          appearance === "focused" && layout === "overlay" && "w-full rounded-[inherit] border-transparent bg-card",
        )}
        style={layout === "split"
          ? {
              width: `${width}px`,
              transitionDuration: `${String(transitionDuration)}ms`,
            }
          : undefined}
        data-testid="right-sidebar-surface"
      >
      <header className={cn(
        "window-drag-region flex h-[var(--window-header-height)] shrink-0 items-center gap-1 border-b border-line px-2",
        appearance === "focused" && "border-transparent",
      )}>
        <div
          className="scroll-thin window-no-drag flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
          role="tablist"
          aria-label={t("console.rightSidebar.tabs")}
        >
          {renderedState.tabs.map((tab) => {
            const updating = updatingTabIds.includes(tab.id);
            const displayTitle = updating
              ? t("console.rightSidebar.titleUpdating")
              : rightSidebarTabDisplayTitle(tab, t);
            const discriminator = tabDiscriminators[tab.id] ?? null;
            const accessibleTitle = discriminator === null
              ? displayTitle
              : `${displayTitle}，${discriminator}`;
            return (
              <div
                key={tab.id}
                ref={(element) => {
                  if (element === null) tabElementsRef.current.delete(tab.id);
                  else tabElementsRef.current.set(tab.id, element);
                }}
                className={cn(
                  "flex h-[38px] max-w-[190px] shrink-0 items-center gap-1 rounded-lg pl-3 pr-1 text-sm transition-colors",
                  appearance === "focused" ? "h-8 rounded-md px-1 text-sm" : "font-normal",
                  activeTab?.id === tab.id
                    ? cn("bg-sel text-ink", appearance === "focused" && "font-normal")
                    : appearance === "focused"
                      ? "font-normal text-ink hover:bg-hover"
                      : "text-sub hover:bg-hover hover:text-ink",
                )}
              >
                <button
                  type="button"
                  ref={(element) => {
                    if (element === null) tabButtonRefs.current.delete(tab.id);
                    else tabButtonRefs.current.set(tab.id, element);
                  }}
                  className="flex min-w-0 items-center gap-1.5"
                  role="tab"
                  aria-selected={activeTab?.id === tab.id}
                  tabIndex={activeTab?.id === tab.id ? 0 : -1}
                  data-tab-id={tab.id}
                  aria-label={accessibleTitle}
                  title={accessibleTitle}
                  onFocus={(event) => {
                    focusedTabIdRef.current = tab.id;
                    event.currentTarget.parentElement?.scrollIntoView?.({
                      block: "nearest",
                      inline: "nearest",
                    });
                  }}
                  onBlur={(event) => {
                    if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) {
                      focusedTabIdRef.current = null;
                    }
                  }}
                  onClick={() => onStateChange(selectRightSidebarTab(renderedState, tab.id))}
                  onKeyDown={(event) => {
                    const currentIndex = renderedState.tabs.findIndex((candidate) => candidate.id === tab.id);
                    if (currentIndex < 0) return;
                    let nextIndex: number | null = null;
                    if (event.key === "ArrowRight") {
                      nextIndex = (currentIndex + 1) % renderedState.tabs.length;
                    } else if (event.key === "ArrowLeft") {
                      nextIndex = (currentIndex - 1 + renderedState.tabs.length) % renderedState.tabs.length;
                    } else if (event.key === "Home") {
                      nextIndex = 0;
                    } else if (event.key === "End") {
                      nextIndex = renderedState.tabs.length - 1;
                    }
                    if (nextIndex === null) return;
                    event.preventDefault();
                    const nextTab = renderedState.tabs[nextIndex];
                    if (nextTab === undefined) return;
                    focusedTabIdRef.current = nextTab.id;
                    onStateChange(selectRightSidebarTab(renderedState, nextTab.id));
                    window.requestAnimationFrame(() => tabButtonRefs.current.get(nextTab.id)?.focus());
                  }}
                >
                  <TabIcon type={tab.type} />
                  <span className="min-w-0">
                    <span className="block truncate">{displayTitle}</span>
                    {discriminator !== null ? (
                      <span className="block truncate text-meta font-normal text-hint">
                        {discriminator}
                      </span>
                    ) : null}
                  </span>
                </button>
                <button
                  type="button"
                  className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-sub hover:bg-sunken hover:text-ink"
                  aria-label={t("console.rightSidebar.closeTab", { title: accessibleTitle })}
                  onClick={() => {
                    if (onBeforeCloseTab?.(tab) === false) {
                      return;
                    }
                    const nextState = closeRightSidebarTab(renderedState, tab.id);
                    if (nextState.tabs.length === 0) {
                      setClosingSnapshot(renderedState);
                      toggleButtonRef?.current?.focus();
                    }
                    onStateChange(nextState);
                    if (nextState.tabs.length === 0) {
                      onOpenChange(false);
                    }
                  }}
                >
                  <X className="h-[11px] w-[11px]" strokeWidth={1.5} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="window-no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-ink"
          aria-label={t("console.rightSidebar.newTab")}
          title={t("console.rightSidebar.newTab")}
          onClick={() => onStateChange(addBlankRightSidebarTab(renderedState, createTabId()))}
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </button>

        {layout === "overlay" ? (
          <button
            ref={overlayCloseButtonRef}
            type="button"
            className="window-no-drag mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-ink"
            aria-label={t("console.rightSidebar.closeReturn")}
            title={t("console.rightSidebar.return")}
            data-testid="right-sidebar-overlay-close"
            onClick={() => {
              toggleButtonRef?.current?.focus();
              onOpenChange(false);
            }}
          >
            <X className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      {updatingTabIds.length > 0 ? (
        <div
          className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-sunken px-3 py-2 text-xs text-sub"
          role="status"
          data-testid="right-sidebar-title-retry"
        >
          <span>{t("console.rightSidebar.titleRetrying")}</span>
          <button
            type="button"
            className="shrink-0 rounded-md border border-line px-2 py-1 font-normal text-ink hover:bg-hover"
            onClick={onRetryTitles}
          >
            {t("console.rightSidebar.retryTitle")}
          </button>
        </div>
      ) : null}

      <div className="scroll-thin min-h-0 flex-1 overflow-auto" data-testid="right-sidebar-content">
        {activeTab === null ? (
          <BlankTab
            isGitRepository={isGitRepository}
            onSelect={(type) => {
              const withBlank = addBlankRightSidebarTab(renderedState, createTabId());
              onStateChange(convertBlankRightSidebarTab(withBlank, withBlank.activeTabId!, type));
            }}
          />
        ) : activeTab.type === "blank" ? (
          <BlankTab
            isGitRepository={isGitRepository}
            onSelect={(type) => onStateChange(convertBlankRightSidebarTab(renderedState, activeTab.id, type))}
          />
        ) : (
          contentSlots[activeTab.type]?.(activeTab) ?? <ContentSlotPlaceholder tab={activeTab} />
        )}
      </div>
      </div>
    </aside>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => prefersReducedMotion());
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function BlankTab({
  isGitRepository,
  onSelect,
}: {
  isGitRepository: boolean;
  onSelect: (type: RightSidebarSelectableTabType) => void;
}): JSX.Element {
  const { t } = useI18n();
  const visibleTypes = RIGHT_SIDEBAR_SELECTABLE_TAB_TYPES.filter(
    (type) => type !== "workspace-diff" || isGitRepository,
  );
  return (
    <div className="mx-auto flex min-h-full w-full max-w-sm flex-col justify-center px-6 py-10">
      <h2 className="text-center font-sans text-base font-normal tracking-[-0.01em] text-ink">
        {t("console.rightSidebar.chooseContent")}
      </h2>
      <div className="mt-5 overflow-hidden rounded-lg border border-line bg-card">
        {visibleTypes.map((type) => (
          <button
            key={type}
            type="button"
            className="flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-hover"
            onClick={() => onSelect(type)}
          >
            {type === "workspace-diff" ? (
              <FileDiff className="mt-0.5 h-4 w-4 shrink-0 text-sub" strokeWidth={1.5} aria-hidden="true" />
            ) : type === "conversation" ? (
              <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-sub" strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Files className="mt-0.5 h-4 w-4 shrink-0 text-sub" strokeWidth={1.5} aria-hidden="true" />
            )}
            <span>
              <span className="block text-sm font-normal text-ink">
                {t(type === "workspace-diff"
                  ? "console.rightSidebar.changes"
                  : type === "conversation"
                    ? "console.rightSidebar.conversation"
                    : "console.rightSidebar.projectFiles")}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-sub">
                {t(type === "workspace-diff"
                  ? "console.rightSidebar.changesDescription"
                  : type === "conversation"
                    ? "console.rightSidebar.conversationDescription"
                    : "console.rightSidebar.projectFilesDescription")}
              </span>
            </span>
          </button>
        ))}
      </div>
      {!isGitRepository ? (
        <p className="mt-3 text-xs leading-5 text-sub" role="note">
          {t("console.rightSidebar.notGit")}
        </p>
      ) : null}
      <p className="mt-5 text-center text-xs leading-5 text-sub">
        {t("console.rightSidebar.openFromTimeline")}
      </p>
    </div>
  );
}

function ContentSlotPlaceholder({ tab }: { tab: RightSidebarTab }): JSX.Element {
  const { t } = useI18n();
  const label = rightSidebarTabLabel(tab.type, t);
  return (
    <div className="grid min-h-full place-items-center p-6 text-center">
      <div>
        <TabIcon type={tab.type} className="mx-auto h-5 w-5 text-hint" />
        <h2 className="mt-3 text-sm font-normal text-ink">{label}</h2>
        <p className="mt-1 text-xs leading-5 text-sub">{t("console.rightSidebar.placeholder")}</p>
      </div>
    </div>
  );
}

function rightSidebarTabLabel(type: RightSidebarTabType, t: Translate): string {
  if (type === "workspace-diff") return t("console.rightSidebar.changes");
  if (type === "conversation") return t("console.rightSidebar.conversation");
  if (type === "project-files") return t("console.rightSidebar.projectFiles");
  if (type === "file-reference") return t("console.rightSidebar.fileReference");
  if (type === "run-output") return t("console.rightSidebar.process");
  return t("console.rightSidebar.subtask");
}

function rightSidebarTabDisplayTitle(tab: RightSidebarTab, t: Translate): string {
  if (tab.title === RIGHT_SIDEBAR_BUILTIN_TAB_TITLES.blank) {
    return t("console.rightSidebar.blank");
  }
  if (tab.title === RIGHT_SIDEBAR_BUILTIN_TAB_TITLES.workspaceDiff) {
    return t("console.rightSidebar.changes");
  }
  if (tab.title === RIGHT_SIDEBAR_BUILTIN_TAB_TITLES.conversation) {
    return t("console.rightSidebar.conversation");
  }
  if (tab.title === RIGHT_SIDEBAR_BUILTIN_TAB_TITLES.projectFiles) {
    return t("console.rightSidebar.projectFiles");
  }
  return tab.title;
}

function TabIcon({
  type,
  className,
}: {
  type: RightSidebarTabType;
  className?: string;
}): JSX.Element {
  const Icon = type === "workspace-diff"
    ? FileDiff
    : type === "conversation"
      ? MessageSquare
    : type === "project-files"
      ? Files
      : type === "file-reference"
        ? FileText
      : type === "run-output"
        ? ScrollText
        : type === "sub-session"
          ? ListTree
          : Plus;
  return <Icon className={cn("h-3.5 w-3.5 shrink-0", className)} strokeWidth={1.5} aria-hidden="true" />;
}
