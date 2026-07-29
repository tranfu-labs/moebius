import { X } from "lucide-react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/ui/tooltip";

export interface ComposerTextFragment {
  id: string;
  label: string;
  text: string;
}

export interface TextFragmentListProps {
  fragments: readonly ComposerTextFragment[];
  mode: "draft" | "message";
  onRemove?: (fragmentId: string) => void;
  className?: string;
}

export function TextFragmentList({
  fragments,
  mode,
  onRemove,
  className,
}: TextFragmentListProps): JSX.Element | null {
  const { t } = useI18n();
  if (fragments.length === 0) {
    return null;
  }

  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={100}>
      <ul
        className={cn("scroll-thin flex min-w-0 flex-nowrap gap-2 overflow-x-auto", className)}
        aria-label={t("console.textFragments.list")}
      >
        {fragments.map((fragment) => (
          <Tooltip key={fragment.id}>
            <TooltipTrigger asChild>
              <li
                className="flex h-7 max-w-52 shrink-0 items-center gap-1 rounded-full border border-line bg-card pl-2.5 pr-1 text-xs text-sub focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                tabIndex={0}
                aria-label={t("console.textFragments.detail", {
                  label: fragment.label,
                  text: fragment.text,
                })}
              >
                <span className="truncate">{fragment.label}</span>
                {mode === "draft" && onRemove ? (
                  <button
                    type="button"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    aria-label={t("console.textFragments.remove", { label: fragment.label })}
                    onClick={() => onRemove(fragment.id)}
                  >
                    <X className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            </TooltipTrigger>
            <TooltipContent side="top">
              {fragment.text}
            </TooltipContent>
          </Tooltip>
        ))}
      </ul>
    </TooltipProvider>
  );
}
