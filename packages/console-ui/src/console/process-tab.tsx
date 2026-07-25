import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  ProcessEvent,
  type OperatorProcessTimelineEvent,
} from "@/console/process-event";
import {
  INITIAL_PROCESS_SCROLL_MODEL,
  processDistanceFromBottom,
  reduceProcessScroll,
  type ProcessScrollModel,
} from "@/console/process-scroll-model";
import type { RightSidebarProcessScrollSnapshot } from "@/console/right-sidebar-tabs";
import { cn } from "@/lib/utils";
import {
  resolveOperatorMemberName,
  type OperatorMemberIdentity,
} from "@/console/member-name";

export interface OperatorProcessAttemptMeta {
  runId: string;
  attempt: number;
  role: string;
  startedAt: string;
  status: "running" | "settled";
}

export interface OperatorProcessOutput {
  sessionId: string;
  requestedRunId: string;
  role: string | null;
  status: "running" | "settled" | "unavailable";
  unavailableReason: string | null;
  attempts: OperatorProcessAttemptMeta[];
  events: OperatorProcessTimelineEvent[];
  previousCursor: string | null;
  appendCursor: string | null;
  atLatest: boolean;
}

export interface OperatorProcessAppendOutput {
  events: OperatorProcessTimelineEvent[];
  appendCursor: string;
  atLatest: boolean;
  status: "running" | "settled";
}

export type OperatorProcessOutputState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      output: OperatorProcessOutput;
      loadingPrevious?: boolean;
    };

export interface ProcessTabProps {
  title: string;
  state: OperatorProcessOutputState;
  memberIdentities?: readonly OperatorMemberIdentity[];
  scrollSnapshot?: RightSidebarProcessScrollSnapshot;
  onScrollSnapshotChange?: (snapshot: RightSidebarProcessScrollSnapshot) => void;
  onLoadPrevious?: (cursor: string) => void;
  onOpenExternalLink?: (url: string) => void;
  className?: string;
}

export function ProcessTab({
  title,
  state,
  memberIdentities = [],
  scrollSnapshot,
  onScrollSnapshotChange,
  onLoadPrevious,
  onOpenExternalLink,
  className,
}: ProcessTabProps): JSX.Element {
  const sectionRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);
  const previousKeysRef = useRef<string[]>([]);
  const snapshotRef = useRef(scrollSnapshot);
  const snapshotFrameRef = useRef<number | null>(null);
  const [scrollModel, setScrollModel] = useState<ProcessScrollModel>(() =>
    scrollSnapshot === undefined
      ? INITIAL_PROCESS_SCROLL_MODEL
      : reduceProcessScroll(INITIAL_PROCESS_SCROLL_MODEL, {
          type: "restore",
          followLatest: scrollSnapshot.followLatest,
        }),
  );
  const output = state.status === "ready" ? state.output : null;
  const events = output?.events ?? [];
  const eventKeys = useMemo(() => events.map((event) => event.key), [events]);
  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => sectionRef.current?.parentElement ?? null,
    getItemKey: (index) => events[index]?.key ?? index,
    estimateSize: () => 96,
    measureElement: (element) => element.getBoundingClientRect().height,
    overscan: 6,
    initialRect: { width: 420, height: 640 },
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const memberName = resolveOperatorMemberName(
    output?.role ?? null,
    memberIdentities,
    title.replace(/\s+\d+$/u, ""),
  );

  useEffect(() => {
    snapshotRef.current = scrollSnapshot;
  }, [scrollSnapshot]);

  useLayoutEffect(() => {
    if (state.status !== "ready" || events.length === 0) {
      return;
    }
    const previousKeys = previousKeysRef.current;
    const firstReady = !initializedRef.current;
    const prepended = previousKeys.length > 0
      && eventKeys.length > previousKeys.length
      && eventKeys.at(-1) === previousKeys.at(-1)
      && eventKeys[0] !== previousKeys[0];
    const appended = previousKeys.length > 0
      && eventKeys.length > previousKeys.length
      && eventKeys[0] === previousKeys[0];

    if (firstReady) {
      initializedRef.current = true;
      const anchorKey = snapshotRef.current?.anchorEventKey ?? null;
      const anchorIndex = anchorKey === null ? -1 : eventKeys.indexOf(anchorKey);
      if (anchorIndex >= 0 && snapshotRef.current?.followLatest === false) {
        virtualizer.scrollToIndex(anchorIndex, { align: "start" });
        const offset = snapshotRef.current.offsetPx;
        if (offset > 0) {
          requestAnimationFrame(() => {
            const parent = sectionRef.current?.parentElement;
            if (parent !== null && parent !== undefined) {
              parent.scrollTop += offset;
            }
          });
        }
        setScrollModel(reduceProcessScroll(INITIAL_PROCESS_SCROLL_MODEL, {
          type: "restore",
          followLatest: false,
        }));
      } else {
        virtualizer.scrollToIndex(events.length - 1, { align: "end" });
        setScrollModel(reduceProcessScroll(INITIAL_PROCESS_SCROLL_MODEL, { type: "ready" }));
      }
    } else if (prepended) {
      const anchorKey = snapshotRef.current?.anchorEventKey ?? previousKeys[0] ?? null;
      const anchorIndex = anchorKey === null ? -1 : eventKeys.indexOf(anchorKey);
      if (anchorIndex >= 0) {
        virtualizer.scrollToIndex(anchorIndex, { align: "start" });
        const offset = snapshotRef.current?.offsetPx ?? 0;
        if (offset > 0) {
          requestAnimationFrame(() => {
            const parent = sectionRef.current?.parentElement;
            if (parent !== null && parent !== undefined) {
              parent.scrollTop += offset;
            }
          });
        }
      }
    } else if (appended) {
      const count = eventKeys.length - previousKeys.length;
      setScrollModel((current) => {
        const next = reduceProcessScroll(current, { type: "append", count });
        if (current.mode === "following") {
          requestAnimationFrame(() => virtualizer.scrollToIndex(events.length - 1, { align: "end" }));
        }
        return next;
      });
    }
    previousKeysRef.current = eventKeys;
  }, [eventKeys, events.length, state.status, virtualizer]);

  useEffect(() => {
    const parent = sectionRef.current?.parentElement;
    if (parent === null || parent === undefined) {
      return;
    }
    const persistSnapshot = () => {
      if (onScrollSnapshotChange === undefined || events.length === 0) {
        return;
      }
      const firstVisible = virtualizer.getVirtualItems()[0];
      const anchorEventKey = firstVisible === undefined
        ? events.at(-1)?.key ?? null
        : events[firstVisible.index]?.key ?? null;
      const offsetPx = firstVisible === undefined
        ? 0
        : Math.max(0, parent.scrollTop - firstVisible.start);
      onScrollSnapshotChange({
        anchorEventKey,
        offsetPx,
        followLatest: processDistanceFromBottom(parent) <= 48,
      });
    };
    const onScroll = () => {
      const distanceFromBottom = processDistanceFromBottom(parent);
      setScrollModel((current) => reduceProcessScroll(current, {
        type: "scroll",
        distanceFromBottom,
      }));
      if (snapshotFrameRef.current !== null) {
        cancelAnimationFrame(snapshotFrameRef.current);
      }
      snapshotFrameRef.current = requestAnimationFrame(persistSnapshot);
    };
    parent.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      parent.removeEventListener("scroll", onScroll);
      if (snapshotFrameRef.current !== null) {
        cancelAnimationFrame(snapshotFrameRef.current);
        snapshotFrameRef.current = null;
      }
    };
  }, [events, onScrollSnapshotChange, virtualizer]);

  useEffect(() => {
    if (
      state.status !== "ready"
      || state.loadingPrevious === true
      || state.output.previousCursor === null
      || onLoadPrevious === undefined
      || virtualItems[0]?.index !== 0
    ) {
      return;
    }
    onLoadPrevious(state.output.previousCursor);
  }, [onLoadPrevious, state, virtualItems]);

  const returnLatest = () => {
    if (events.length === 0) {
      return;
    }
    virtualizer.scrollToIndex(events.length - 1, { align: "end" });
    setScrollModel((current) => reduceProcessScroll(current, { type: "return-latest" }));
  };

  return (
    <section
      ref={sectionRef}
      className={cn("relative min-h-full select-text px-5 pb-5 text-sm text-ink", className)}
      aria-label={`${title}的过程输出`}
      data-testid="process-tab"
    >
      <header className="sticky top-0 z-10 -mx-5 flex items-start justify-between gap-3 border-b border-line bg-canvas px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-ink" title={title}>
            {title} · 这一步的完整输出
          </h2>
          <p className="mt-1 text-xs text-sub">
            {scrollModel.mode === "reading"
              ? "已暂停跟随"
              : output?.status === "running"
                ? "跟随最新"
                : "只读完整过程"}
          </p>
        </div>
      </header>

      {state.status === "idle" || state.status === "loading" ? (
        <ProcessNotice>正在读取 Codex 过程记录…</ProcessNotice>
      ) : state.status === "error" ? (
        <ProcessNotice>Codex 过程记录暂时无法读取：{state.message}</ProcessNotice>
      ) : state.output.status === "unavailable" ? (
        <ProcessNotice>
          <span className="block font-medium text-ink">Codex 过程记录文件已不可用</span>
          <span className="mt-1 block">这一步的最终回复仍保留在主对话区。</span>
        </ProcessNotice>
      ) : events.length === 0 ? (
        <ProcessNotice>这一步没有产生可显示的过程事件。</ProcessNotice>
      ) : (
        <>
          {state.loadingPrevious === true ? (
            <p className="py-2 text-center text-xs text-sub">正在加载更早过程…</p>
          ) : state.output.previousCursor !== null ? (
            <p className="py-2 text-center text-xs text-sub">↑ 向上滚动加载更早过程</p>
          ) : null}
          <div
            ref={listRef}
            className="relative"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualItem) => {
              const event = events[virtualItem.index];
              if (event === undefined) {
                return null;
              }
              return (
                <div
                  key={event.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  className="absolute left-0 top-0 w-full"
                  style={{
                    transform: `translateY(${String(virtualItem.start - virtualizer.options.scrollMargin)}px)`,
                  }}
                >
                  <ProcessEvent
                    event={event}
                    memberName={memberName}
                    memberIdentities={memberIdentities}
                    onOpenExternalLink={onOpenExternalLink}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}

      {scrollModel.mode === "reading" && scrollModel.unreadCount > 0 ? (
        <button
          type="button"
          className="sticky bottom-4 ml-auto mt-3 block rounded-full border border-line bg-card px-3 py-1.5 text-xs font-medium text-ink hover:bg-hover"
          onClick={returnLatest}
        >
          ↓ {scrollModel.unreadCount} 条新内容 / 到最新
        </button>
      ) : null}
    </section>
  );
}

export function nextProcessTabTitle(
  state: { tabs: Array<{ type: string; title: string }> },
  role: string | null,
  memberIdentities: readonly OperatorMemberIdentity[] = [],
): string {
  const memberName = resolveOperatorMemberName(role, memberIdentities, "成员未知");
  const usedOrdinals = new Set(state.tabs.flatMap((tab): number[] => {
    if (tab.type !== "run-output") {
      return [];
    }
    if (tab.title === memberName) {
      return [1];
    }
    const suffix = tab.title.startsWith(`${memberName} `)
      ? tab.title.slice(memberName.length + 1)
      : "";
    return /^[2-9]\d*$/u.test(suffix) ? [Number(suffix)] : [];
  }));
  let nextOrdinal = 1;
  while (usedOrdinals.has(nextOrdinal)) {
    nextOrdinal += 1;
  }
  return nextOrdinal === 1 ? memberName : `${memberName} ${String(nextOrdinal)}`;
}

export { resolveOperatorMemberName };

function ProcessNotice({ children }: { children: ReactNode }): JSX.Element {
  return <p className="py-10 text-center text-sm leading-6 text-sub">{children}</p>;
}
