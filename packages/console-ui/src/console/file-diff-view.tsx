import { File, Folder } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  type UIEvent,
} from "react";

import { translate, useI18n, type Translate } from "@/i18n";
import { cn } from "@/lib/utils";

export interface WorkspaceFileChange {
  path: string;
  additions: number | null;
  deletions: number | null;
  changed?: boolean;
}

export interface WorkspaceFileLine {
  kind: "addition" | "deletion" | "unchanged";
  oldLineNumber: number | null;
  newLineNumber: number | null;
  text: string;
}

export type WorkspaceFileContent =
  | {
      available: true;
      path: string;
      lines: WorkspaceFileLine[];
      reason: null;
    }
  | {
      available: false;
      path: string;
      lines: [];
      reason:
        | "binary-file"
        | "file-too-large"
        | "not-found"
        | "not-file"
        | "outside-workspace"
        | "workspace-unavailable";
    };

export function workspaceLocationCopy(
  mode: "direct" | "worktree",
  t: Translate = (key, values) => translate("zh-CN", key, values),
): {
  label: string;
  consequence: string | null;
} {
  return mode === "worktree"
    ? {
        label: t("console.fileDiff.worktree"),
        consequence: t("console.fileDiff.worktreeConsequence"),
      }
    : { label: t("console.fileDiff.projectFolder"), consequence: null };
}

export function WorkspaceFileTree({
  files,
  selectedPath,
  onSelect,
  className,
}: {
  files: readonly WorkspaceFileChange[];
  selectedPath: string | null;
  onSelect(path: string): void;
  className?: string;
}): JSX.Element {
  const { t } = useI18n();
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  const tree = useMemo(() => buildWorkspaceFileTree(files), [files]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [selectedPath]);

  return (
    <div
      className={cn("scroll-thin overflow-auto", className)}
      role="tree"
      aria-label={t("console.fileDiff.treeLabel")}
      data-testid="workspace-file-tree"
    >
      {tree.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          selectedPath={selectedPath}
          selectedRef={selectedRef}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export function FileDiffView({
  path,
  content,
  loading = false,
  scrollTop = 0,
  onScrollTopChange,
  className,
}: {
  path: string | null;
  content: WorkspaceFileContent | null;
  loading?: boolean;
  scrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
  className?: string;
}): JSX.Element {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current !== null && scrollRef.current.scrollTop !== scrollTop) {
      scrollRef.current.scrollTop = scrollTop;
    }
  }, [content, path, scrollTop]);

  if (path === null) {
    return <FileContentMessage className={className}>{t("console.fileDiff.selectFile")}</FileContentMessage>;
  }

  return (
    <section className={cn("flex min-h-0 flex-1 flex-col", className)} aria-label={t("console.fileDiff.contentLabel")}>
      <div
        className="shrink-0 border-b border-line px-3 py-2 font-mono text-xs text-sub selection:bg-sel selection:text-ink"
        data-testid="selected-file-path"
      >
        {path}
      </div>
      {loading ? (
        <FileContentMessage>{t("console.fileDiff.loading")}</FileContentMessage>
      ) : content === null ? (
        <FileContentMessage>{t("console.fileDiff.loadFailed")}</FileContentMessage>
      ) : !content.available ? (
        <FileContentMessage>{fileUnavailableCopy(content.reason, t)}</FileContentMessage>
      ) : (
        <div
          ref={scrollRef}
          className="scroll-thin min-h-0 flex-1 select-text overflow-auto font-mono text-xs leading-5"
          data-testid="file-diff-scroll"
          onScroll={(event: UIEvent<HTMLDivElement>) => onScrollTopChange?.(event.currentTarget.scrollTop)}
        >
          <div className="min-w-max py-1">
            {content.lines.length === 0 ? (
              <div className="px-3 py-6 text-sub">{t("console.fileDiff.empty")}</div>
            ) : content.lines.map((line, index) => (
              <div
                key={`${String(line.oldLineNumber)}:${String(line.newLineNumber)}:${String(index)}`}
                className={cn(
                  "flex min-w-max",
                  line.kind === "addition" && "bg-[var(--status-pass-bg)] text-ink",
                  line.kind === "deletion" && "bg-[var(--status-danger-bg)] text-sub",
                )}
                data-line-kind={line.kind}
              >
                <span
                  className={cn(
                    "sticky left-0 z-10 flex w-24 shrink-0 justify-end gap-2 border-r border-line bg-canvas px-2 text-hint",
                    line.kind === "addition" && "bg-[var(--status-pass-bg)] text-pass",
                    line.kind === "deletion" && "bg-[var(--status-danger-bg)] text-danger",
                  )}
                  aria-hidden="true"
                >
                  <span className="w-7 text-right">{line.oldLineNumber ?? ""}</span>
                  <span className="w-7 text-right">{line.newLineNumber ?? ""}</span>
                  <span className="w-2 text-center">
                    {line.kind === "addition" ? "+" : line.kind === "deletion" ? "−" : ""}
                  </span>
                </span>
                <span className="whitespace-pre px-3">{line.text === "" ? "\u00a0" : line.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

interface FileTreeNodeModel {
  name: string;
  path: string;
  kind: "directory" | "file";
  change: WorkspaceFileChange | null;
  children: FileTreeNodeModel[];
}

function buildWorkspaceFileTree(files: readonly WorkspaceFileChange[]): FileTreeNodeModel[] {
  const roots: FileTreeNodeModel[] = [];
  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    let level = roots;
    let currentPath = "";
    segments.forEach((segment, index) => {
      currentPath = currentPath === "" ? segment : `${currentPath}/${segment}`;
      const isFile = index === segments.length - 1;
      let node = level.find((candidate) => candidate.name === segment);
      if (node === undefined) {
        node = {
          name: segment,
          path: currentPath,
          kind: isFile ? "file" : "directory",
          change: isFile ? file : null,
          children: [],
        };
        level.push(node);
        level.sort(compareFileTreeNodes);
      }
      level = node.children;
    });
  }
  return roots;
}

function FileTreeNode({
  node,
  selectedPath,
  selectedRef,
  onSelect,
  depth = 0,
}: {
  node: FileTreeNodeModel;
  selectedPath: string | null;
  selectedRef: React.MutableRefObject<HTMLButtonElement | null>;
  onSelect(path: string): void;
  depth?: number;
}): JSX.Element {
  const { t } = useI18n();
  if (node.kind === "directory") {
    return (
      <div role="treeitem" aria-expanded="true" aria-label={node.name}>
        <div
          className="flex h-7 items-center gap-1.5 px-2 text-xs font-medium text-sub"
          style={{ paddingLeft: `${String(8 + depth * 14)}px` }}
        >
          <Folder className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          <span className="truncate">{node.name}</span>
        </div>
        <div role="group">
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              selectedRef={selectedRef}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      </div>
    );
  }

  const selected = node.path === selectedPath;
  const change = node.change;
  return (
    <button
      ref={selected ? selectedRef : undefined}
      type="button"
      role="treeitem"
      aria-selected={selected}
      className={cn(
        "flex h-7 w-full min-w-0 items-center gap-1.5 px-2 text-left text-xs text-sub hover:bg-hover hover:text-ink",
        selected && "bg-sel text-ink",
      )}
      style={{ paddingLeft: `${String(8 + depth * 14)}px` }}
      title={node.path}
      onClick={() => onSelect(node.path)}
    >
      <File className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      {change !== null && change.changed !== false && (change.additions !== null || change.deletions !== null) ? (
        <span className="tnum flex shrink-0 gap-1 text-[11px]" aria-label={changeSummary(change, t)}>
          {change.additions !== null ? <span className="text-pass">+{change.additions}</span> : null}
          {change.deletions !== null ? <span className="text-danger">−{change.deletions}</span> : null}
        </span>
      ) : null}
    </button>
  );
}

function compareFileTreeNodes(left: FileTreeNodeModel, right: FileTreeNodeModel): number {
  if (left.kind !== right.kind) {
    return left.kind === "directory" ? -1 : 1;
  }
  return left.name.localeCompare(right.name);
}

function changeSummary(change: WorkspaceFileChange, t: Translate): string {
  const additions = change.additions === null
    ? t("console.fileDiff.additionsUnavailable")
    : t("console.fileDiff.additions", { count: change.additions });
  const deletions = change.deletions === null
    ? t("console.fileDiff.deletionsUnavailable")
    : t("console.fileDiff.deletions", { count: change.deletions });
  return t("console.fileDiff.changeSummary", { additions, deletions });
}

function fileUnavailableCopy(
  reason: Extract<WorkspaceFileContent, { available: false }>["reason"],
  t: Translate,
): string {
  const copy: Record<typeof reason, string> = {
    "binary-file": t("console.fileDiff.binary"),
    "file-too-large": t("console.fileDiff.tooLarge"),
    "not-found": t("console.fileDiff.notFound"),
    "not-file": t("console.fileDiff.notFile"),
    "outside-workspace": t("console.fileDiff.outside"),
    "workspace-unavailable": t("console.fileDiff.workspaceUnavailable"),
  };
  return copy[reason];
}

function FileContentMessage({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn("grid min-h-0 flex-1 place-items-center p-5 text-center text-xs leading-5 text-sub", className)}>
      {children}
    </div>
  );
}
