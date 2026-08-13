import { useEffect, useReducer, useRef, useState } from "react";

import { FileSourceView } from "@/console/file-source-view";
import {
  reduceFileReadState,
  type FileReadEvent,
  type FileReadState,
  type FileViewMode,
} from "@/console/file-view-state";
import type { MarkdownFileReference } from "@/console/markdown-internal-reference";
import { WorkspaceFileView } from "@/console/workspace-file-view";
import { useI18n, type TranslationKey } from "@/i18n";

export interface FileReferenceLine {
  lineNumber: number;
  text: string;
}

export type FileReferenceContent =
  | {
      available: true;
      scope: "workspace-file" | "external-preview";
      isComplete: boolean;
      path: string;
      lines: FileReferenceLine[];
      reason: null;
      targetLine: number;
      targetColumn: number | null;
      truncatedBefore: boolean;
      truncatedAfter: boolean;
      relativePath: string | null;
      text: string | null;
    }
  | {
      available: false;
      scope: "workspace-file" | "external-preview" | null;
      isComplete: null;
      path: string;
      lines: [];
      reason:
        | "invalid-path"
        | "not-found"
        | "not-file"
        | "binary-file"
        | "line-too-large"
        | "response-too-large"
        | "line-not-found"
        | "scan-limit"
        | "file-too-large"
        | "workspace-unavailable"
        | "unavailable";
      targetLine: number;
      targetColumn: number | null;
      relativePath: string | null;
      text: null;
    };

export interface FileReferenceTabProps {
  sessionId: string;
  filePath: string;
  line: number;
  column: number | null;
  hasExplicitLine: boolean;
  rememberedMode?: FileViewMode;
  initialContent?: FileReferenceContent;
  loadReference(
    sessionId: string,
    filePath: string,
    line: number,
    column: number | null,
    hasExplicitLine: boolean,
  ): Promise<FileReferenceContent>;
  onModeChange?: (mode: FileViewMode) => void;
  onOpenFileReference?: (reference: MarkdownFileReference) => void;
  onOpenExternalLink?: (url: string) => void;
}

export function FileReferenceTab({
  sessionId,
  filePath,
  line,
  column,
  hasExplicitLine,
  rememberedMode,
  initialContent,
  loadReference,
  onModeChange,
  onOpenFileReference,
  onOpenExternalLink,
}: FileReferenceTabProps): JSX.Element {
  const { t } = useI18n();
  const targetKey = `${sessionId}:${filePath}:${String(line)}:${String(column)}:${hasExplicitLine ? "1" : "0"}`;
  const [readState, dispatchRead] = useReducer(
    (
      state: FileReadState<FileReferenceContent>,
      event: FileReadEvent<FileReferenceContent>,
    ) => reduceFileReadState(state, event),
    {
      targetKey,
      generation: 0,
      loading: initialContent === undefined,
      content: initialContent ?? null,
    },
  );
  const { content, loading } = readState;
  const [reloadVersion, setReloadVersion] = useState(0);
  const [sourceScrollTop, setSourceScrollTop] = useState(0);
  const loadReferenceRef = useRef(loadReference);
  const requestGenerationRef = useRef(0);
  loadReferenceRef.current = loadReference;

  useEffect(() => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    dispatchRead({ type: "request-started", targetKey, generation });
    if (initialContent !== undefined && reloadVersion === 0) {
      dispatchRead({ type: "request-succeeded", targetKey, generation, content: initialContent });
      return () => {
        dispatchRead({ type: "request-invalidated", targetKey, generation });
      };
    }
    void loadReferenceRef.current(sessionId, filePath, line, column, hasExplicitLine)
      .then((nextContent) => {
        dispatchRead({ type: "request-succeeded", targetKey, generation, content: nextContent });
      })
      .catch(() => {
        dispatchRead({
          type: "request-failed",
          targetKey,
          generation,
          content: unavailableFileReference(filePath, line, column),
        });
      });
    return () => {
      dispatchRead({ type: "request-invalidated", targetKey, generation });
    };
  }, [column, filePath, hasExplicitLine, initialContent, line, reloadVersion, sessionId, targetKey]);

  useEffect(() => {
    setSourceScrollTop(0);
  }, [column, filePath, hasExplicitLine, line, sessionId]);

  const displayPath = content?.path ?? filePath;
  if (content?.available && content.scope === "workspace-file") {
    return (
      <section
        className="flex h-full min-h-0 flex-col overflow-hidden"
        aria-label={t("console.fileReference.detail")}
        data-testid="file-reference-tab"
        data-file-scope="workspace-file"
      >
        <WorkspaceFileView
          targetKey={`${sessionId}:${displayPath}:${String(line)}:${hasExplicitLine ? "1" : "0"}`}
          path={displayPath}
          text={content.text ?? content.lines.map((entry) => entry.text).join("\n")}
          lines={content.lines}
          hasExplicitLine={hasExplicitLine}
          targetLine={hasExplicitLine ? content.targetLine : null}
          rememberedMode={rememberedMode}
          onModeChange={onModeChange}
          onOpenFileReference={onOpenFileReference}
          onOpenExternalLink={onOpenExternalLink}
          scrollTop={sourceScrollTop}
          onScrollTopChange={setSourceScrollTop}
        />
      </section>
    );
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden"
      aria-label={t("console.fileReference.detail")}
      data-testid="file-reference-tab"
      data-file-scope={content?.scope ?? "unknown"}
    >
      <div className="shrink-0 border-b border-line px-3 py-2.5">
        {content?.scope === "external-preview" ? (
          <p className="mb-1 text-xs font-normal text-ink" data-testid="external-file-preview-label">
            {t("console.fileReference.externalPreview")}
          </p>
        ) : null}
        <div className="select-text break-all font-mono text-xs leading-5 text-sub" data-testid="file-reference-path">
          {displayPath}
        </div>
        <p className="mt-1 text-xs text-hint">
          {column === null
            ? t("console.fileReference.targetLine", { line })
            : t("console.fileReference.targetLineColumn", { line, column })}
        </p>
        {content?.scope === "external-preview" ? (
          <p className="mt-1 text-xs text-hint">{t("console.fileReference.nearbyOnly")}</p>
        ) : null}
      </div>
      {loading ? (
        <FileReferenceMessage>{t("console.fileReference.loading")}</FileReferenceMessage>
      ) : content === null || !content.available ? (
        <FileReferenceMessage>
          <p>{t(fileReferenceUnavailableKey(content?.reason ?? "unavailable"))}</p>
          <button
            type="button"
            className="mt-3 rounded-md border border-line px-3 py-1.5 text-xs font-normal text-ink hover:bg-hover"
            onClick={() => setReloadVersion((current) => current + 1)}
          >
            {t("common.retry")}
          </button>
        </FileReferenceMessage>
      ) : (
        <>
          {content.truncatedBefore ? (
            <p className="shrink-0 border-b border-line px-3 py-1.5 text-center text-xs text-hint">
              {t("console.fileReference.nearbyOnly")}
            </p>
          ) : null}
          <FileSourceView lines={content.lines} targetLine={content.targetLine} />
          {content.truncatedAfter ? (
            <p className="shrink-0 border-t border-line px-3 py-1.5 text-center text-xs text-hint">
              {t("console.fileReference.moreAfter")}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function FileReferenceMessage({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="grid min-h-0 flex-1 place-items-center p-6 text-center text-sm leading-6 text-sub">
      <div>{children}</div>
    </div>
  );
}

function unavailableFileReference(
  filePath: string,
  line: number,
  column: number | null,
): Extract<FileReferenceContent, { available: false }> {
  return {
    available: false,
    scope: null,
    isComplete: null,
    path: filePath,
    lines: [],
    reason: "unavailable",
    targetLine: line,
    targetColumn: column,
    relativePath: null,
    text: null,
  };
}

function fileReferenceUnavailableKey(
  reason: Extract<FileReferenceContent, { available: false }>["reason"],
): TranslationKey {
  const keys: Record<typeof reason, TranslationKey> = {
    "invalid-path": "console.fileReference.error.invalid-path",
    "not-found": "console.fileReference.error.not-found",
    "not-file": "console.fileReference.error.not-file",
    "binary-file": "console.fileReference.error.binary-file",
    "line-too-large": "console.fileReference.error.line-too-large",
    "response-too-large": "console.fileReference.error.response-too-large",
    "line-not-found": "console.fileReference.error.line-not-found",
    "scan-limit": "console.fileReference.error.scan-limit",
    "file-too-large": "console.fileDiff.tooLarge",
    "workspace-unavailable": "console.fileDiff.workspaceUnavailable",
    unavailable: "console.fileReference.error.unavailable",
  };
  return keys[reason];
}
