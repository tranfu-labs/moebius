import { AlertTriangle, FileText, Image as ImageIcon, LoaderCircle, RotateCcw, X } from "lucide-react";
import { forwardRef, useEffect, useRef, useState } from "react";

import { formatAttachmentMediaType } from "@/console/attachment-format";
import {
  ConversationImageDialog,
  type ConversationImageDialogItem,
} from "@/console/conversation-image-dialog";
import { ConversationImageStatusCard, type ConversationImageStatus } from "@/console/conversation-image-status-card";
import { useI18n, type Translate } from "@/i18n";
import { cn } from "@/lib/utils";

export { formatAttachmentMediaType } from "@/console/attachment-format";

export type StructuredAttachmentKind = "image" | "file";
export type ComposerAttachmentStatus = "pending" | "failed" | "ready";

/** File-class image media types that render as previews even though they commit as ordinary files. */
export const FILE_IMAGE_MEDIA_TYPES: readonly string[] = [
  "image/svg+xml",
  "image/x-icon",
  "image/bmp",
  "image/avif",
];

/** SVG attachments render as images even when committed as ordinary files, as long as they carry a derived preview. */
export function isImagePreviewableAttachment(attachment: Pick<StructuredAttachment, "kind" | "mediaType">): boolean {
  return attachment.kind === "image" || (
    attachment.kind === "file"
    && FILE_IMAGE_MEDIA_TYPES.includes(attachment.mediaType)
  );
}

export interface StructuredAttachment {
  attachmentId: string;
  kind: StructuredAttachmentKind;
  displayName: string;
  mediaType: string;
  byteSize: number;
  previewUrl?: string;
  largePreviewUrl?: string;
  previewStatus?: "ready" | ConversationImageStatus;
  degradedImagePreview?: boolean;
}

export interface ComposerAttachment extends Omit<StructuredAttachment, "attachmentId"> {
  clientId: string;
  attachmentId?: string;
  status: ComposerAttachmentStatus;
  error?: string;
}

export interface ConversationImagePreviewItem {
  id: string;
  displayName: string;
  mediaType: string;
  previewUrl: string;
  sourceLabel: string;
}

export interface ConversationImagePreviewCardProps {
  item: ConversationImagePreviewItem;
  onOpen: (item: ConversationImagePreviewItem) => void;
  className?: string;
}

export const ConversationImagePreviewCard = forwardRef<HTMLButtonElement, ConversationImagePreviewCardProps>(function ConversationImagePreviewCard({
  item,
  onOpen,
  className,
}, ref): JSX.Element {
  const { t } = useI18n();
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "group relative block h-40 min-w-0 max-w-80 overflow-hidden rounded-md bg-sunken text-left transition-colors motion-reduce:transition-none hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        className,
      )}
      aria-label={t("console.imagePreview.openLabel", { name: item.displayName })}
      data-testid="conversation-image-preview"
      onClick={() => onOpen(item)}
    >
      <img
        className="h-full w-auto max-w-full object-contain transition-transform duration-150 motion-reduce:transition-none group-hover:scale-[1.01]"
        src={item.previewUrl}
        alt={t("console.imagePreview.alt", { name: item.displayName, source: item.sourceLabel })}
      />
    </button>
  );
});

export function StructuredAttachmentList({
  attachments,
  mode,
  onRemove,
  onRetry,
  onImageReload,
  onImageOpenFile,
  sourceLabel,
  imageGallery,
  className,
}: {
  attachments: readonly (StructuredAttachment | ComposerAttachment)[];
  mode: "draft" | "message";
  onRemove?: (id: string) => void;
  onRetry?: (id: string) => void;
  onImageReload?: (id: string) => void;
  onImageOpenFile?: (id: string) => void;
  sourceLabel?: string;
  imageGallery?: readonly ConversationImageDialogItem[];
  className?: string;
}): JSX.Element | null {
  const { t } = useI18n();
  const [selectedImage, setSelectedImage] = useState<ConversationImageDialogItem | null>(null);
  const [selectedGallery, setSelectedGallery] = useState<readonly ConversationImageDialogItem[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [returnFocusTarget, setReturnFocusTarget] = useState<HTMLElement | null>(null);
  const imageTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const returnFocusRef = { current: returnFocusTarget };
  /** Message images keep a fixed 160px height and their aspect ratio; more than six fold behind a view-all entry. */
  const MAX_DIRECT_IMAGE_PREVIEWS = 6;
  const messageImages = (() => {
    if (mode !== "message") return [] as ConversationImageDialogItem[];
    const items: ConversationImageDialogItem[] = [];
    for (const attachment of attachments) {
      const svgFallbackFile = attachment.kind === "file"
        && FILE_IMAGE_MEDIA_TYPES.includes(attachment.mediaType)
        && attachment.previewUrl === undefined
        && attachment.previewStatus === undefined;
      if (!svgFallbackFile && isImagePreviewableAttachment(attachment) && attachment.previewUrl && sourceLabel) {
        items.push({
          id: attachment.attachmentId ?? attachment.displayName,
          displayName: attachment.displayName,
          mediaType: attachment.mediaType,
          previewUrl: attachment.previewUrl,
          largePreviewUrl: attachment.largePreviewUrl ?? attachment.previewUrl,
          sourceLabel,
        });
      }
    }
    return items;
  })();
  useEffect(() => {
    if (!imageDialogOpen || selectedImage === null || imageGallery === undefined) return;
    if (imageGallery.some((candidate) => candidate.id === selectedImage.id)) return;
    setImageDialogOpen(false);
    setSelectedGallery([]);
    setSelectedImage(null);
  }, [imageDialogOpen, imageGallery, selectedImage]);
  if (attachments.length === 0) {
    return null;
  }
  let renderedMessageImages = 0;
  let foldButtonRendered = false;
  return (
    <>
      <div className={cn("flex min-w-0 flex-wrap gap-2", className)} aria-label={t(mode === "draft" ? "console.attachments.draft" : "console.attachments.message")}>
      {attachments.map((attachment, index) => {
        const draft = "clientId" in attachment ? attachment : null;
        const itemId = draft?.clientId ?? attachment.attachmentId ?? `${attachment.displayName}:${String(index)}`;
        const status = draft?.status ?? "ready";
        const error = draft?.error;
        const actions = mode === "draft" ? (
          <span className="flex shrink-0 items-center gap-1">
            {status === "failed" && onRetry ? (
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-ink"
                aria-label={t("console.attachments.retryLabel", { name: attachment.displayName })}
                title={t("console.attachments.retry", { name: attachment.displayName })}
                onClick={() => onRetry(itemId)}
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              </button>
            ) : null}
            {onRemove ? (
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-ink"
                aria-label={t("console.attachments.removeLabel", { name: attachment.displayName })}
                title={t("console.attachments.remove", { name: attachment.displayName })}
                onClick={() => onRemove(itemId)}
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              </button>
            ) : null}
          </span>
        ) : null;

        const svgFallbackFile = attachment.kind === "file"
          && FILE_IMAGE_MEDIA_TYPES.includes(attachment.mediaType)
          && attachment.previewUrl === undefined
          && attachment.previewStatus === undefined;
        if (!svgFallbackFile && isImagePreviewableAttachment(attachment)) {
          if (mode === "message" && sourceLabel && attachment.previewStatus && attachment.previewStatus !== "ready") {
            return (
              <ConversationImageStatusCard
                key={itemId}
                item={{
                  id: itemId,
                  displayName: attachment.displayName,
                  mediaType: attachment.mediaType,
                  sourceLabel,
                }}
                status={attachment.previewStatus}
                onReload={onImageReload ? () => onImageReload(itemId) : undefined}
                onOpenFile={onImageOpenFile ? () => onImageOpenFile(itemId) : undefined}
              />
            );
          }
          if (mode === "message" && sourceLabel && attachment.previewUrl) {
            const previewItem: ConversationImageDialogItem = {
              id: itemId,
              displayName: attachment.displayName,
              mediaType: attachment.mediaType,
              previewUrl: attachment.previewUrl,
              largePreviewUrl: attachment.largePreviewUrl ?? attachment.previewUrl,
              sourceLabel,
            };
            const gallery = imageGallery === undefined
              ? messageImages
              : imageGallery.some((candidate) => candidate.id === previewItem.id)
                ? imageGallery
                : [...imageGallery, previewItem];
            if (renderedMessageImages >= MAX_DIRECT_IMAGE_PREVIEWS) {
              if (foldButtonRendered) return null;
              foldButtonRendered = true;
              return (
                <button
                  key={itemId}
                  ref={(node) => {
                    if (node) imageTriggerRefs.current.set(itemId, node);
                    else imageTriggerRefs.current.delete(itemId);
                  }}
                  type="button"
                  className="inline-flex h-40 w-28 shrink-0 items-center justify-center rounded-md border border-line bg-sunken px-2 text-center text-xs leading-5 text-sub transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                  aria-label={t("console.imagePreview.viewAll", { count: messageImages.length })}
                  onClick={() => {
                    const first = messageImages[0];
                    if (first === undefined) return;
                    setReturnFocusTarget(imageTriggerRefs.current.get(itemId) ?? null);
                    setSelectedImage(first);
                    setSelectedGallery(imageGallery ?? messageImages);
                    setSelectedImageIndex(imageGallery
                      ? Math.max(0, imageGallery.findIndex((candidate) => candidate.id === first.id))
                      : 0);
                    setImageDialogOpen(true);
                  }}
                >
                  {t("console.imagePreview.viewAll", { count: messageImages.length })}
                </button>
              );
            }
            renderedMessageImages += 1;
            return (
              <ConversationImagePreviewCard
                key={itemId}
                ref={(node) => {
                  if (node) imageTriggerRefs.current.set(itemId, node);
                  else imageTriggerRefs.current.delete(itemId);
                }}
                item={previewItem}
                onOpen={(item) => {
                  setReturnFocusTarget(imageTriggerRefs.current.get(item.id) ?? null);
                  setSelectedImage({ ...previewItem, ...item });
                  setSelectedGallery(gallery);
                  setSelectedImageIndex(Math.max(0, gallery.findIndex((candidate) => candidate.id === item.id)));
                  setImageDialogOpen(true);
                }}
              />
            );
          }
          return (
            <article
              key={itemId}
              className="relative min-w-0 max-w-80 overflow-hidden rounded-md border border-line bg-sunken"
              aria-label={t("console.attachments.itemLabel", {
                name: attachment.displayName,
                status: attachmentStatusLabel(status, t),
              })}
              title={attachment.displayName}
            >
              <span className="relative block h-40 w-full overflow-hidden bg-sunken">
                {attachment.previewUrl ? (
                  <img className="h-full w-auto max-w-full object-contain" src={attachment.previewUrl} alt="" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-hint">
                    <ImageIcon className="h-6 w-6" strokeWidth={1.5} aria-hidden="true" />
                  </span>
                )}
                {actions ? (
                  <span className="absolute right-1.5 top-1.5 rounded-md border border-line bg-card p-0.5">
                    {actions}
                  </span>
                ) : null}
              </span>
              <span className="block min-w-0 border-t border-line px-2 py-1.5">
                <span className="block truncate text-xs font-normal text-ink">{attachment.displayName}</span>
                <span className={cn("flex min-w-0 items-center gap-1 text-meta", status === "failed" ? "text-danger" : "text-hint")}>
                  {status === "pending" ? <LoaderCircle className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" /> : null}
                  {status === "failed" ? <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
                  <span className="truncate">
                    {attachmentStatusLabel(status, t)} · {formatAttachmentMediaType(attachment.mediaType)} · {t("console.imagePreview.sourceYou")}
                  </span>
                </span>
                {status !== "ready" ? (
                  <span className={cn("mt-1 block text-meta leading-4", status === "failed" ? "text-danger" : "text-sub")}>
                    {status === "pending"
                      ? t("console.imagePreview.draftPreparing", { name: attachment.displayName })
                      : error ?? t("console.imagePreview.draftFailed", { name: attachment.displayName })}
                  </span>
                ) : null}
              </span>
              {error ? <span className="sr-only">{error}</span> : null}
            </article>
          );
        }

        return (
          <article
            key={itemId}
            className={cn(
              "flex min-h-14 min-w-0 max-w-full items-center gap-2 rounded-md border bg-sunken px-3 py-2",
              status === "failed" ? "border-danger/40" : "border-line",
            )}
            aria-label={t("console.attachments.itemLabel", {
              name: attachment.displayName,
              status: attachmentStatusLabel(status, t),
            })}
            title={attachment.displayName}
          >
            {status === "pending" ? (
              <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-sub" strokeWidth={1.5} aria-hidden="true" />
            ) : status === "failed" ? (
              <AlertTriangle className="h-5 w-5 shrink-0 text-danger" strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <FileText className="h-5 w-5 shrink-0 text-sub" strokeWidth={1.5} aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block max-w-56 truncate text-xs font-normal text-ink">{attachment.displayName}</span>
              <span className={cn("block truncate text-meta", status === "failed" ? "text-danger" : "text-hint")}>
                {attachment.degradedImagePreview
                  ? t("console.imagePreview.svgFallback")
                  : status === "pending"
                  ? t("console.attachments.preparing")
                  : status === "failed"
                    ? error ?? t("console.attachments.notReady")
                    : `${formatAttachmentMediaType(attachment.mediaType)} · ${formatByteSize(attachment.byteSize)}`}
              </span>
            </span>
            {actions}
          </article>
        );
      })}
      </div>
      {selectedImage ? (
        <ConversationImageDialog
          open={imageDialogOpen}
          items={selectedGallery.length > 0 && selectedImage !== null ? selectedGallery : selectedImage === null ? [] : [selectedImage]}
          initialIndex={selectedImageIndex}
          onOpenChange={setImageDialogOpen}
          returnFocusRef={returnFocusRef}
        />
      ) : null}
    </>
  );
}

export function hasBlockingComposerAttachment(attachments: readonly ComposerAttachment[]): boolean {
  return attachments.some((attachment) => attachment.status !== "ready");
}

export function readyComposerAttachmentIds(attachments: readonly ComposerAttachment[]): string[] {
  return attachments.flatMap((attachment) => attachment.status === "ready" && attachment.attachmentId
    ? [attachment.attachmentId]
    : []);
}

function attachmentStatusLabel(status: ComposerAttachmentStatus, t: Translate): string {
  if (status === "pending") return t("console.attachments.statusPreparing");
  if (status === "failed") return t("console.attachments.statusFailed");
  return t("console.attachments.statusReady");
}

export function formatByteSize(byteSize: number): string {
  if (byteSize < 1024) return `${String(byteSize)} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
  if (byteSize < 1024 * 1024 * 1024) return `${(byteSize / 1024 / 1024).toFixed(1)} MB`;
  return `${(byteSize / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
