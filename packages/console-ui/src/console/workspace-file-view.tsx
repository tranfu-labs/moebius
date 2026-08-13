import { useEffect, useReducer } from "react";

import { FileSourceView, type FileSourceLine } from "@/console/file-source-view";
import {
  decideInitialFileViewMode,
  isMarkdownFilePath,
  reduceFileViewState,
  type FileViewMode,
} from "@/console/file-view-state";
import { MarkdownMessage } from "@/console/markdown-message";
import type { MarkdownFileReference } from "@/console/markdown-internal-reference";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export function WorkspaceFileView({
  targetKey,
  path,
  text,
  lines,
  hasExplicitLine,
  targetLine = null,
  rememberedMode,
  onModeChange,
  onOpenFileReference,
  onOpenExternalLink,
  scrollTop = 0,
  onScrollTopChange,
  className,
}: {
  targetKey: string;
  path: string;
  text: string;
  lines: readonly FileSourceLine[];
  hasExplicitLine: boolean;
  targetLine?: number | null;
  rememberedMode?: FileViewMode;
  onModeChange?: (mode: FileViewMode) => void;
  onOpenFileReference?: (reference: MarkdownFileReference) => void;
  onOpenExternalLink?: (url: string) => void;
  scrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
  className?: string;
}): JSX.Element {
  const { t } = useI18n();
  const [state, dispatch] = useReducer(reduceFileViewState, {
    targetKey,
    mode: decideInitialFileViewMode({
      path,
      scope: "workspace-file",
      hasExplicitLine,
      rememberedMode,
    }),
    userSelected: rememberedMode !== undefined,
  });
  useEffect(() => {
    dispatch({
      type: "target-changed",
      targetKey,
      path,
      scope: "workspace-file",
      hasExplicitLine,
      rememberedMode,
    });
  }, [hasExplicitLine, path, rememberedMode, targetKey]);
  const markdown = isMarkdownFilePath(path);
  const mode = markdown ? state.mode : "source";

  const selectMode = (nextMode: FileViewMode) => {
    dispatch({ type: "mode-selected", mode: nextMode });
    onModeChange?.(nextMode);
  };

  return (
    <section className={cn("flex min-h-0 flex-1 flex-col", className)} aria-label={t("console.fileSource.contentLabel")}>
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1 select-text truncate font-mono text-xs text-sub" data-testid="selected-file-path">
          {path}
        </div>
        {markdown ? (
          <div className="flex shrink-0 rounded-md border border-line p-0.5" role="group" aria-label={t("console.fileSource.modeLabel")}>
            {(["preview", "source"] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={cn(
                  "rounded px-2 py-1 text-xs text-sub hover:text-ink",
                  mode === candidate && "bg-sel font-normal text-accent",
                )}
                aria-pressed={mode === candidate}
                onClick={() => selectMode(candidate)}
              >
                {t(candidate === "preview" ? "console.fileSource.preview" : "console.fileSource.source")}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {mode === "preview" ? (
        <div className="scroll-thin min-h-0 flex-1 overflow-auto px-4 py-3" data-testid="markdown-file-preview">
          <MarkdownMessage
            content={text}
            mode="static"
            onOpenFileReference={onOpenFileReference}
            onOpenExternalLink={onOpenExternalLink}
          />
        </div>
      ) : (
        <FileSourceView
          lines={lines}
          targetLine={targetLine}
          scrollTop={scrollTop}
          onScrollTopChange={onScrollTopChange}
        />
      )}
    </section>
  );
}
