import { AlertTriangle, FileQuestion, LoaderCircle, RefreshCw, ShieldAlert } from "lucide-react";

import { formatAttachmentMediaType } from "@/console/attachment-format";
import type { ConversationImagePreviewItem } from "@/console/structured-attachments";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export type ConversationImageStatus = "loading" | "failed" | "missing" | "changed" | "unsafe";

export interface ConversationImageStatusCardProps {
  item: Omit<ConversationImagePreviewItem, "previewUrl">;
  status: ConversationImageStatus;
  onReload?: () => void;
  onOpenFile?: () => void;
  className?: string;
}

export function ConversationImageStatusCard({
  item,
  status,
  onReload,
  onOpenFile,
  className,
}: ConversationImageStatusCardProps): JSX.Element {
  const { t } = useI18n();
  const loading = status === "loading";
  const Icon = loading ? LoaderCircle : status === "unsafe" ? ShieldAlert : status === "missing" ? FileQuestion : status === "changed" ? RefreshCw : AlertTriangle;
  const description = status === "loading"
    ? t("console.imagePreview.loading", { name: item.displayName })
    : status === "failed"
      ? t("console.imagePreview.failedHelp")
      : status === "missing"
        ? t("console.imagePreview.missing", { name: item.displayName })
        : status === "changed"
          ? t("console.imagePreview.changed", { name: item.displayName })
          : t("console.imagePreview.unsafeSvg");

  return (
    <article
      className={cn("w-32 min-w-0 overflow-hidden rounded-md border border-line bg-sunken", className)}
      aria-label={description}
      title={item.displayName}
    >
      <div className="flex min-h-24 flex-col justify-center gap-1.5 px-2 py-2 text-center">
        <Icon
          className={cn("mx-auto h-5 w-5 text-sub", loading && "animate-spin")}
          strokeWidth={1.5}
          aria-hidden="true"
        />
        {status === "failed" ? <strong className="text-meta font-medium text-ink">{t("console.imagePreview.failedTitle")}</strong> : null}
        <p className="text-meta leading-4 text-sub">{description}</p>
      </div>
      <div className="min-w-0 border-t border-line px-2 py-1.5">
        <span className="block truncate text-xs font-normal text-ink">{item.displayName}</span>
        <span className="block truncate text-meta text-hint">
          {formatAttachmentMediaType(item.mediaType)} · {item.sourceLabel}
        </span>
      </div>
      {!loading && (onReload || onOpenFile) ? (
        <div className="grid border-t border-line">
          {status !== "unsafe" && onReload ? (
            <button type="button" className="min-h-7 px-2 text-meta text-accent hover:bg-hover" onClick={onReload}>
              {t("console.imagePreview.reload")}
            </button>
          ) : null}
          {onOpenFile ? (
            <button type="button" className="min-h-7 border-t border-line px-2 text-meta text-sub hover:bg-hover hover:text-ink" onClick={onOpenFile}>
              {t("console.imagePreview.openFile")}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
