import { useEffect, useRef, useState } from "react";

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
      aria-label="文件引用详情"
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
          目标位置：第 {line} 行{column === null ? "" : `，第 ${String(column)} 列`}
        </p>
      </div>
      {loading ? (
        <FileReferenceMessage>正在读取目标行…</FileReferenceMessage>
      ) : content === null || !content.available ? (
        <FileReferenceMessage>{fileReferenceUnavailableCopy(content?.reason ?? "unavailable")}</FileReferenceMessage>
      ) : (
        <div className="scroll-thin min-h-0 flex-1 select-text overflow-auto font-mono text-xs leading-5">
          {content.truncatedBefore ? (
            <p className="border-b border-line px-3 py-1.5 text-center text-hint">仅显示目标行附近内容</p>
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
            <p className="border-t border-line px-3 py-1.5 text-center text-hint">目标行之后仍有内容</p>
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

function fileReferenceUnavailableCopy(
  reason: Extract<FileReferenceContent, { available: false }>["reason"],
): string {
  const copy: Record<typeof reason, string> = {
    "invalid-path": "这个文件引用无效，无法读取。",
    "outside-trusted-roots": "这个文件不在当前会话允许读取的位置。",
    "not-found": "这个文件已经不存在。",
    "not-file": "这个引用没有指向普通文件。",
    "binary-file": "这个文件不是可显示的 UTF-8 文本。",
    "line-too-large": "目标附近存在过长单行，无法安全显示。",
    "response-too-large": "目标附近内容超过本次安全显示范围。",
    "line-not-found": "这个文件没有链接中指定的目标行。",
    "scan-limit": "目标行超出本次安全读取范围。",
    unavailable: "暂时无法读取这个文件引用。",
  };
  return copy[reason];
}
