import {
  FileDiff,
  FileText,
  Files,
  ListTree,
  Plus,
  ScrollText,
  X,
} from "lucide-react";
import {
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

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

export const DEFAULT_RIGHT_SIDEBAR_WIDTH_PX = 420;
export const MIN_RIGHT_SIDEBAR_WIDTH_PX = 320;
export const MAX_RIGHT_SIDEBAR_WIDTH_PX = 640;
export const RIGHT_SIDEBAR_OVERLAY_WIDTH_PX = 1_080;

type RightSidebarContentType = Exclude<RightSidebarTabType, "blank">;

export type RightSidebarContentSlots = Partial<Record<
  RightSidebarContentType,
  (tab: RightSidebarTab) => ReactNode
>>;

export interface RightSidebarProps {
  open: boolean;
  width: number;
  narrow: boolean;
  isGitRepository: boolean;
  state: RightSidebarTabsState;
  onStateChange(state: RightSidebarTabsState): void;
  onOpenChange(open: boolean): void;
  onWidthChange(width: number): void;
  createTabId(): string;
  contentSlots?: RightSidebarContentSlots;
  className?: string;
}

interface ResizeGesture {
  pointerId: number;
  startX: number;
  startWidth: number;
}

export function RightSidebar({
  open,
  width,
  narrow,
  isGitRepository,
  state,
  onStateChange,
  onOpenChange,
  onWidthChange,
  createTabId,
  contentSlots = {},
  className,
}: RightSidebarProps): JSX.Element | null {
  const { t } = useI18n();
  const resizeGestureRef = useRef<ResizeGesture | null>(null);
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0] ?? null;

  if (!open) {
    return null;
  }

  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = resizeGestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) {
      return;
    }
    onWidthChange(clampRightSidebarWidth(gesture.startWidth + gesture.startX - event.clientX));
  };

  const finishResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = resizeGestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) {
      return;
    }
    resizeGestureRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  return (
    <aside
      className={cn(
        "relative flex min-w-0 shrink-0 flex-col border-l border-line bg-canvas",
        narrow && "absolute inset-0 z-40 w-full border-l-0",
        className,
      )}
      style={narrow ? undefined : { width: `${width}px` }}
      aria-label={t("console.rightSidebar.label")}
      data-layout={narrow ? "overlay" : "split"}
      data-testid="right-sidebar"
    >
      {!narrow ? (
        <div
          className="window-no-drag group absolute inset-y-0 left-0 z-30 w-1 -translate-x-1/2 cursor-col-resize touch-none"
          role="separator"
          aria-label={t("console.rightSidebar.resize")}
          aria-orientation="vertical"
          aria-valuemin={MIN_RIGHT_SIDEBAR_WIDTH_PX}
          aria-valuemax={MAX_RIGHT_SIDEBAR_WIDTH_PX}
          aria-valuenow={width}
          aria-valuetext={t("sidebar.widthPixels", { width })}
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
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={resize}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line transition-colors group-hover:bg-accent group-active:bg-accent" />
        </div>
      ) : null}

      <header className="window-drag-region flex h-[var(--window-header-height)] shrink-0 items-center gap-1 border-b border-line px-2">
        <div
          className="scroll-thin window-no-drag flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
          role="tablist"
          aria-label={t("console.rightSidebar.tabs")}
        >
          {state.tabs.map((tab) => {
            const displayTitle = rightSidebarTabDisplayTitle(tab, t);
            return (
              <div
                key={tab.id}
                className={cn(
                  "flex h-[30px] max-w-[150px] shrink-0 items-center gap-1 rounded-md pl-3 pr-1 text-[12.5px] font-medium transition-colors",
                  activeTab?.id === tab.id ? "bg-sel text-ink" : "text-sub hover:bg-hover hover:text-ink",
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-1.5"
                  role="tab"
                  aria-selected={activeTab?.id === tab.id}
                  title={displayTitle}
                  onClick={() => onStateChange(selectRightSidebarTab(state, tab.id))}
                >
                  <TabIcon type={tab.type} />
                  <span className="truncate">{displayTitle}</span>
                </button>
                <button
                  type="button"
                  className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-sub hover:bg-sunken hover:text-ink"
                  aria-label={t("console.rightSidebar.closeTab", { title: displayTitle })}
                  onClick={() => onStateChange(closeRightSidebarTab(state, tab.id, createTabId()))}
                >
                  <X className="h-[11px] w-[11px]" strokeWidth={1.5} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="window-no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sub hover:bg-hover hover:text-ink"
          aria-label={t("console.rightSidebar.newTab")}
          title={t("console.rightSidebar.newTab")}
          onClick={() => onStateChange(addBlankRightSidebarTab(state, createTabId()))}
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </button>

        {narrow ? (
          <button
            type="button"
            className="window-no-drag mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sub hover:bg-hover hover:text-ink"
            aria-label={t("console.rightSidebar.closeReturn")}
            title={t("console.rightSidebar.return")}
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-auto" data-testid="right-sidebar-content">
        {activeTab === null ? (
          <div className="grid min-h-full place-items-center p-6 text-sm text-sub">{t("console.rightSidebar.preparing")}</div>
        ) : activeTab.type === "blank" ? (
          <BlankTab
            isGitRepository={isGitRepository}
            onSelect={(type) => onStateChange(convertBlankRightSidebarTab(state, activeTab.id, type))}
          />
        ) : (
          contentSlots[activeTab.type]?.(activeTab) ?? <ContentSlotPlaceholder tab={activeTab} />
        )}
      </div>
    </aside>
  );
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
      <h2 className="text-center font-display text-base font-semibold tracking-[-0.01em] text-ink">
        {t("console.rightSidebar.chooseContent")}
      </h2>
      <div className="mt-5 overflow-hidden rounded-md border border-line bg-card">
        {visibleTypes.map((type) => (
          <button
            key={type}
            type="button"
            className="flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-hover"
            onClick={() => onSelect(type)}
          >
            {type === "workspace-diff" ? (
              <FileDiff className="mt-0.5 h-4 w-4 shrink-0 text-sub" strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Files className="mt-0.5 h-4 w-4 shrink-0 text-sub" strokeWidth={1.5} aria-hidden="true" />
            )}
            <span>
              <span className="block text-sm font-medium text-ink">
                {t(type === "workspace-diff" ? "console.rightSidebar.changes" : "console.rightSidebar.projectFiles")}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-sub">
                {t(type === "workspace-diff" ? "console.rightSidebar.changesDescription" : "console.rightSidebar.projectFilesDescription")}
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
        <h2 className="mt-3 text-sm font-medium text-ink">{label}</h2>
        <p className="mt-1 text-xs leading-5 text-sub">{t("console.rightSidebar.placeholder")}</p>
      </div>
    </div>
  );
}

function rightSidebarTabLabel(type: RightSidebarTabType, t: Translate): string {
  if (type === "workspace-diff") return t("console.rightSidebar.changes");
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

export function clampRightSidebarWidth(width: number): number {
  return Math.min(MAX_RIGHT_SIDEBAR_WIDTH_PX, Math.max(MIN_RIGHT_SIDEBAR_WIDTH_PX, Math.round(width)));
}
