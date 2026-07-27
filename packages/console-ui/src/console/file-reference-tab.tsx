import { useEffect, useRef, useState } from "react";

import { useI18n, type TranslationKey } from "@/i18n";
import { cn } from "@/lib/utils";

export interface FileReferenceLine {
  lineNumber: number;
  text: string;
}

export type FileReferenceContent =
  | {
      available: true;
      path: string;
      lines: FileReferenceLine[];
      reason: null;
      targetLine: number;
      targetColumn: number | null;
      truncatedBefore: boolean;
      truncatedAfter: boolean;
    }
  | {
      available: false;
      path: string;
      lines: [];
      reason:
        | "invalid-path"
        | "outside-trusted-roots"
        | "not-found"
        | "not-file"
        | "binary-file"
        | "line-too-large"
        | "response-too-large"
        | "line-not-found"
        | "scan-limit"
        | "unavailable";
      targetLine: number;
      targetColumn: number | null;
    };

export interface FileReferenceTabProps {
  sessionId: string;
  filePath: string;
  line: number;
  column: number | null;
  initialContent?: FileReferenceContent;
  loadReference(
    sessionId: string,
    filePath: string,
    line: number,
    column: number | null,
  ): Promise<FileReferenceContent>;
}

export function FileReferenceTab({
  sessionId,
  filePath,
  line,
  column,
  initialContent,
  loadReference,
}: FileReferenceTabProps): JSX.Element {
  const { t } = useI18n();
  const [content, setContent] = useState<FileReferenceContent | null>(initialContent ?? null);
  const [loading, setLoading] = useState(initialContent === undefined);
  const targetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (initialContent !== undefined) {
      setContent(initialContent);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setContent(null);
    setLoading(true);
    void loadReference(sessionId, filePath, line, column)
      .then((nextContent) => {
        if (!cancelled) {
          setContent(nextContent);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setContent({
            available: false,
            path: filePath,
            lines: [],
            reason: "unavailable",
            targetLine: line,
            targetColumn: column,
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [column, filePath, initialContent, line, loadReference, sessionId]);

  useEffect(() => {
    if (content?.available) {
      targetRef.current?.scrollIntoView?.({ block: "center" });
    }
  }, [content]);

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden"
      aria-label={t("console.fileReference.detail")}
      data-testid="file-reference-tab"
    >
      <div className="shrink-0 border-b border-line px-3 py-2.5">
        <div
          className="select-text break-all font-mono text-xs leading-5 text-sub"
          data-testid="file-reference-path"
        >
          {content?.path ?? filePath}
        </div>
        <p className="mt-1 text-xs text-hint">
          {column === null
            ? t("console.fileReference.targetLine", { line })
            : t("console.fileReference.targetLineColumn", { line, column })}
        </p>
      </div>
      {loading ? (
        <FileReferenceMessage>{t("console.fileReference.loading")}</FileReferenceMessage>
      ) : content === null || !content.available ? (
        <FileReferenceMessage>{t(fileReferenceUnavailableKey(content?.reason ?? "unavailable"))}</FileReferenceMessage>
      ) : (
        <div className="scroll-thin min-h-0 flex-1 select-text overflow-auto font-mono text-xs leading-5">
          {content.truncatedBefore ? (
            <p className="border-b border-line px-3 py-1.5 text-center text-hint">
              {t("console.fileReference.nearbyOnly")}
            </p>
          ) : null}
          <div className="min-w-max py-1">
            {content.lines.map((entry) => {
              const target = entry.lineNumber === content.targetLine;
              return (
                <div
                  key={entry.lineNumber}
                  ref={target ? targetRef : undefined}
                  className={cn(
                    "flex min-w-max border-l-2 border-transparent",
                    target && "border-accent bg-sel text-ink",
                  )}
                  data-testid={target ? "file-reference-target-line" : undefined}
                  data-target-line={target ? "true" : undefined}
                >
                  <span
                    className={cn(
                      "sticky left-0 w-16 shrink-0 border-r border-line bg-canvas px-2 text-right text-hint",
                      target && "bg-sel font-medium text-accent",
                    )}
                    aria-hidden="true"
                  >
                    {entry.lineNumber}
                  </span>
                  <span className="whitespace-pre px-3">{entry.text === "" ? "\u00a0" : entry.text}</span>
                </div>
              );
            })}
          </div>
          {content.truncatedAfter ? (
            <p className="border-t border-line px-3 py-1.5 text-center text-hint">
              {t("console.fileReference.moreAfter")}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function FileReferenceMessage({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="grid min-h-0 flex-1 place-items-center p-6 text-center text-sm leading-6 text-sub">
      {children}
    </div>
  );
}

function fileReferenceUnavailableKey(
  reason: Extract<FileReferenceContent, { available: false }>["reason"],
): TranslationKey {
  const keys: Record<typeof reason, TranslationKey> = {
    "invalid-path": "console.fileReference.error.invalid-path",
    "outside-trusted-roots": "console.fileReference.error.outside-trusted-roots",
    "not-found": "console.fileReference.error.not-found",
    "not-file": "console.fileReference.error.not-file",
    "binary-file": "console.fileReference.error.binary-file",
    "line-too-large": "console.fileReference.error.line-too-large",
    "response-too-large": "console.fileReference.error.response-too-large",
    "line-not-found": "console.fileReference.error.line-not-found",
    "scan-limit": "console.fileReference.error.scan-limit",
    unavailable: "console.fileReference.error.unavailable",
  };
  return keys[reason];
}
