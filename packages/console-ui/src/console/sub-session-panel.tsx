import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

export function SubSessionPanel({
  title,
  narrow,
  onClose,
  children,
  className,
  ariaLabel,
  closeLabel,
}: {
  title: string;
  narrow: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  closeLabel?: string;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <aside
      className={cn(
        "absolute inset-y-0 right-0 z-layer-panel flex min-w-0 flex-col border-l border-line bg-canvas",
        narrow ? "left-0 w-full border-l-0" : "w-1/2 min-w-[360px]",
        className,
      )}
      aria-label={ariaLabel ?? t("console.subSessionPanel.label", { title })}
      data-layout={narrow ? "overlay" : "split"}
      data-testid="sub-session-panel"
    >
      <header className="window-drag-region flex h-16 shrink-0 items-end justify-between gap-3 border-b border-line px-5 pb-3">
        <h2 className="min-w-0 truncate text-sm font-semibold text-ink" title={title}>{title}</h2>
        <button
          type="button"
          className="window-no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          aria-label={closeLabel ?? t("console.subSessionPanel.close")}
          onClick={onClose}
        >
          <X className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </button>
      </header>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto px-5 py-3" data-testid="sub-session-panel-content">
        {children}
      </div>
    </aside>
  );
}
