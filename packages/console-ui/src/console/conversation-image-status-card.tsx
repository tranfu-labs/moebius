import { AlertTriangle, FileQuestion, LoaderCircle, RefreshCw, ShieldAlert } from "lucide-react";

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
    ? t("console.imagePreview.loading")
    : status === "failed"
      ? t("console.imagePreview.failedTitle")
      : status === "missing"
        ? t("console.imagePreview.missing")
        : status === "changed"
          ? t("console.imagePreview.changed")
          : t("console.imagePreview.unsafeSvg");

  return (
    <article
      className={cn("flex h-40 w-32 min-w-0 flex-col overflow-hidden rounded-md border border-line bg-sunken", className)}
      aria-label={description}
      title={item.displayName}
    >
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5 px-2 text-center">
        <Icon
          className={cn("mx-auto h-5 w-5 text-sub", loading && "animate-spin")}
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <p className="text-meta leading-4 text-sub">{description}</p>
      </div>
      <div className="min-w-0 shrink-0 border-t border-line px-2 py-1">
        <span className="block truncate text-xs font-normal text-ink">{item.displayName}</span>
      </div>
      {!loading && (onReload || onOpenFile) ? (
        <div className="flex shrink-0 border-t border-line">
          {status !== "unsafe" && onReload ? (
            <button type="button" className="min-h-7 flex-1 px-1 text-meta text-accent hover:bg-hover" onClick={onReload}>
              {t("console.imagePreview.reload")}
            </button>
          ) : null}
          {onOpenFile ? (
            <button
              type="button"
              className={cn(
                "min-h-7 flex-1 px-1 text-meta text-sub hover:bg-hover hover:text-ink",
                status !== "unsafe" && onReload && "border-l border-line",
              )}
              onClick={onOpenFile}
            >
              {t("console.imagePreview.openFile")}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
