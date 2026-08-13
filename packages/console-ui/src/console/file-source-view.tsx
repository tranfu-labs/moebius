import { useEffect, useRef, type UIEvent } from "react";

import { cn } from "@/lib/utils";

export interface FileSourceLine {
  lineNumber: number;
  text: string;
}

export function FileSourceView({
  lines,
  targetLine = null,
  scrollTop = 0,
  onScrollTopChange,
  className,
}: {
  lines: readonly FileSourceLine[];
  targetLine?: number | null;
  scrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
  className?: string;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (targetLine !== null) {
      targetRef.current?.scrollIntoView?.({ block: "center" });
      return;
    }
    if (scrollRef.current !== null && scrollRef.current.scrollTop !== scrollTop) {
      scrollRef.current.scrollTop = scrollTop;
    }
  }, [lines, scrollTop, targetLine]);

  return (
    <div
      ref={scrollRef}
      className={cn("scroll-thin min-h-0 flex-1 select-text overflow-auto font-mono text-xs leading-5", className)}
      data-testid="file-source-scroll"
      onScroll={(event: UIEvent<HTMLDivElement>) => onScrollTopChange?.(event.currentTarget.scrollTop)}
    >
      <div className="min-w-max py-1">
        {lines.length === 0 ? (
          <div className="px-3 py-6 text-sub" data-testid="file-source-empty">∅</div>
        ) : lines.map((line) => {
          const target = line.lineNumber === targetLine;
          return (
            <div
              key={line.lineNumber}
              ref={target ? targetRef : undefined}
              className={cn(
                "flex min-w-max border-l-2 border-transparent",
                target && "border-accent bg-sel text-ink",
              )}
              data-testid={target ? "file-source-target-line" : undefined}
              aria-current={target ? "location" : undefined}
            >
              <span
                className={cn(
                  "sticky left-0 w-16 shrink-0 border-r border-line bg-canvas px-2 text-right text-hint",
                  target && "bg-sel font-normal text-accent",
                )}
                aria-hidden="true"
              >
                {line.lineNumber}
              </span>
              <span className="whitespace-pre px-3">{line.text === "" ? "\u00a0" : line.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
