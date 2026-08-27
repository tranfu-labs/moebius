import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, X } from "lucide-react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useEffect, useRef, useState } from "react";

import type { ConversationImageStatus } from "@/console/conversation-image-status-card";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/ui/dialog";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

export interface ConversationImageDialogItem {
  id: string;
  displayName: string;
  mediaType: string;
  previewUrl: string;
  sourceLabel: string;
  largePreviewUrl?: string;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

export function ConversationImageDialog({
  open,
  items,
  initialIndex = 0,
  onOpenChange,
  returnFocusRef,
  status = "ready",
  onReload,
  onOpenFile,
}: {
  open: boolean;
  items: readonly ConversationImageDialogItem[];
  initialIndex?: number;
  onOpenChange(open: boolean): void;
  returnFocusRef?: RefObject<HTMLElement>;
  status?: "ready" | ConversationImageStatus;
  onReload?: () => void;
  onOpenFile?: () => void;
}): JSX.Element | null {
  const { t } = useI18n();
  const itemIds = items.map((item) => item.id).join("\u0001");
  const [activeIndex, setActiveIndex] = useState(() => clampIndex(initialIndex, items.length));
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(clampIndex(initialIndex, items.length));
    setZoom(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
    setDragging(false);
  }, [initialIndex, itemIds, items.length, open]);

  const item = items[activeIndex] ?? items[0];
  if (item === undefined) return null;

  const setZoomLevel = (nextZoom: number) => {
    const next = clampZoom(nextZoom);
    setZoom(next);
    if (next === MIN_ZOOM) setOffset({ x: 0, y: 0 });
  };

  const resetView = () => {
    setZoom(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
  };

  const moveTo = (nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= items.length) return;
    setActiveIndex(nextIndex);
    resetView();
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom <= MIN_ZOOM || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    setDragging(true);
    event.preventDefault();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    setOffset({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    });
    event.preventDefault();
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[calc(100vh-24px)] w-[calc(100vw-24px)] max-w-none flex-col overflow-hidden rounded-none border-0 bg-transparent p-0 outline-none sm:h-[calc(100vh-32px)] sm:w-[calc(100vw-32px)]"
        overlayClassName="bg-black/90"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            moveTo(activeIndex - 1);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            moveTo(activeIndex + 1);
          } else if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            setZoomLevel(zoom + ZOOM_STEP);
          } else if (event.key === "-" || event.key === "_") {
            event.preventDefault();
            setZoomLevel(zoom - ZOOM_STEP);
          } else if (event.key === "0") {
            event.preventDefault();
            resetView();
          }
        }}
        onCloseAutoFocus={(event) => {
          if (returnFocusRef?.current !== null && returnFocusRef?.current !== undefined) {
            event.preventDefault();
            returnFocusRef.current.focus();
          }
        }}
      >
        <DialogTitle className="sr-only">
          {t("console.imagePreview.dialogTitle")}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t("console.imagePreview.dialogDescription", {
            position: activeIndex + 1,
            total: items.length,
          })}
        </DialogDescription>

        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          <DialogClose asChild>
            <button
              type="button"
              className="absolute right-1 top-1 z-layer-local-high inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/35 text-white/80 transition-colors motion-reduce:transition-none hover:bg-black/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={t("console.imagePreview.closeLabel")}
            >
              <X className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
            </button>
          </DialogClose>

          {items.length > 1 ? (
            <button
              type="button"
              className="absolute left-1 top-1/2 z-layer-local-high inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white/80 transition-colors motion-reduce:transition-none hover:bg-black/60 hover:text-white disabled:pointer-events-none disabled:opacity-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={t("console.imagePreview.previous")}
              disabled={activeIndex === 0}
              onClick={() => moveTo(activeIndex - 1)}
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
            </button>
          ) : null}

          <div
            className={cn(
              "flex h-full w-full items-center justify-center overflow-hidden touch-none",
              zoom > MIN_ZOOM ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default",
            )}
            data-testid="image-lightbox-viewport"
            onPointerCancel={finishPointer}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishPointer}
            onWheel={(event) => {
              event.preventDefault();
              setZoomLevel(zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
            }}
          >
            {status === "ready" ? (
              <img
                className="block max-h-full max-w-full select-none object-contain"
                src={item.largePreviewUrl ?? item.previewUrl}
                alt={t("console.imagePreview.dialogAlt", { name: item.displayName })}
                draggable={false}
                style={{
                  transform: `translate3d(${String(offset.x)}px, ${String(offset.y)}px, 0) scale(${String(zoom)})`,
                  transformOrigin: "center center",
                }}
              />
            ) : (
              <div className="flex max-w-md flex-col items-center justify-center gap-3 px-8 text-center text-white">
                <p className="text-sm font-medium">
                  {status === "loading"
                    ? t("console.imagePreview.dialogLoading", { name: item.displayName })
                    : status === "missing"
                      ? t("console.imagePreview.missing", { name: item.displayName })
                      : status === "changed"
                        ? t("console.imagePreview.changed", { name: item.displayName })
                        : status === "unsafe"
                          ? t("console.imagePreview.unsafeSvg")
                          : t("console.imagePreview.failedTitle")}
                </p>
                {status === "failed" ? <p className="text-xs text-white/65">{t("console.imagePreview.failedHelp")}</p> : null}
                {status !== "loading" && (onReload || onOpenFile) ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    {status !== "unsafe" && onReload ? (
                      <button type="button" className="inline-flex min-h-8 items-center rounded-md bg-accent px-3 text-xs font-medium text-white hover:opacity-90" onClick={onReload}>
                        {t("console.imagePreview.reload")}
                      </button>
                    ) : null}
                    {onOpenFile ? (
                      <button type="button" className="inline-flex min-h-8 items-center rounded-md border border-white/20 bg-black/25 px-3 text-xs font-medium text-white/80 hover:bg-black/45 hover:text-white" onClick={onOpenFile}>
                        {t("console.imagePreview.openFile")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {items.length > 1 ? (
            <button
              type="button"
              className="absolute right-1 top-1/2 z-layer-local-high inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white/80 transition-colors motion-reduce:transition-none hover:bg-black/60 hover:text-white disabled:pointer-events-none disabled:opacity-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={t("console.imagePreview.next")}
              disabled={activeIndex === items.length - 1}
              onClick={() => moveTo(activeIndex + 1)}
            >
              <ChevronRight className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
            </button>
          ) : null}

          <div className="absolute bottom-1 left-1/2 z-layer-local-high flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/40 px-1.5 py-1 text-white/80 backdrop-blur-sm">
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/15 hover:text-white disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              aria-label={t("console.imagePreview.zoomOut")}
              disabled={zoom <= MIN_ZOOM}
              onClick={() => setZoomLevel(zoom - ZOOM_STEP)}
            >
              <Minus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            </button>
            <span className="min-w-12 text-center text-meta tabular-nums" data-testid="image-lightbox-zoom">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/15 hover:text-white disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              aria-label={t("console.imagePreview.zoomIn")}
              disabled={zoom >= MAX_ZOOM}
              onClick={() => setZoomLevel(zoom + ZOOM_STEP)}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              aria-label={t("console.imagePreview.resetZoom")}
              onClick={resetView}
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            </button>
            <span className="sr-only" aria-live="polite">
              {t("console.imagePreview.position", {
                position: activeIndex + 1,
                total: items.length,
              })}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function clampIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(zoom / ZOOM_STEP) * ZOOM_STEP));
}
