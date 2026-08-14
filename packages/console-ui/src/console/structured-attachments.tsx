import { AlertTriangle, FileText, Image as ImageIcon, LoaderCircle, RotateCcw, X } from "lucide-react";

import { useI18n, type Translate } from "@/i18n";
import { cn } from "@/lib/utils";

export type StructuredAttachmentKind = "image" | "file";
export type ComposerAttachmentStatus = "pending" | "failed" | "ready";

export interface StructuredAttachment {
  attachmentId: string;
  kind: StructuredAttachmentKind;
  displayName: string;
  mediaType: string;
  byteSize: number;
  previewUrl?: string;
}

export interface ComposerAttachment extends Omit<StructuredAttachment, "attachmentId"> {
  clientId: string;
  attachmentId?: string;
  status: ComposerAttachmentStatus;
  error?: string;
}

export function StructuredAttachmentList({
  attachments,
  mode,
  onRemove,
  onRetry,
  className,
}: {
  attachments: readonly (StructuredAttachment | ComposerAttachment)[];
  mode: "draft" | "message";
  onRemove?: (id: string) => void;
  onRetry?: (id: string) => void;
  className?: string;
}): JSX.Element | null {
  const { t } = useI18n();
  if (attachments.length === 0) {
    return null;
  }
  return (
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

        if (attachment.kind === "image") {
          return (
            <article
              key={itemId}
              className="relative flex h-24 w-32 min-w-0 overflow-hidden rounded-md border border-line bg-sunken"
              aria-label={t("console.attachments.itemLabel", {
                name: attachment.displayName,
                status: attachmentStatusLabel(status, t),
              })}
              title={attachment.displayName}
            >
              {attachment.previewUrl ? (
                <img className="h-full w-full object-cover" src={attachment.previewUrl} alt="" />
              ) : (
                <span className="flex flex-1 items-center justify-center text-hint">
                  <ImageIcon className="h-6 w-6" strokeWidth={1.5} aria-hidden="true" />
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 flex min-w-0 items-center gap-1 bg-ink/70 px-2 py-1 text-meta text-white">
                {status === "pending" ? <LoaderCircle className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" /> : null}
                {status === "failed" ? <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
                <span className="min-w-0 flex-1 truncate">{status === "pending" ? t("console.attachments.preparing") : attachment.displayName}</span>
                {actions}
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
                {status === "pending"
                  ? t("console.attachments.preparing")
                  : status === "failed"
                    ? error ?? t("console.attachments.notReady")
                    : `${attachmentTypeLabel(attachment.mediaType)} · ${formatByteSize(attachment.byteSize)}`}
              </span>
            </span>
            {actions}
          </article>
        );
      })}
    </div>
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

function attachmentTypeLabel(mediaType: string): string {
  const subtype = mediaType.split("/")[1]?.split(/[;+]/u)[0]?.trim();
  return (subtype || "FILE").toUpperCase();
}

export function formatByteSize(byteSize: number): string {
  if (byteSize < 1024) return `${String(byteSize)} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
  if (byteSize < 1024 * 1024 * 1024) return `${(byteSize / 1024 / 1024).toFixed(1)} MB`;
  return `${(byteSize / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
