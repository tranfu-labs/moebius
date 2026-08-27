import { useEffect, useRef, useState } from "react";

import {
  WorkspaceFileTree,
  workspaceLocationCopy,
  type WorkspaceFileChange,
  type WorkspaceFileContent,
} from "@/console/file-diff-view";
import { WorkspaceFileView } from "@/console/workspace-file-view";
import type { FileViewMode } from "@/console/file-view-state";
import { useI18n, type Translate } from "@/i18n";

export type ProjectFilesData =
  | {
      available: true;
      files: WorkspaceFileChange[];
      reason: null;
      workspaceMode: "direct" | "worktree";
    }
  | {
      available: false;
      files: [];
      reason: "workspace-unavailable";
      workspaceMode: "direct" | "worktree";
    };

export interface ProjectFilesTabProps {
  sessionId: string;
  workspaceMode: "direct" | "worktree";
  /** Changes whenever the session points at a different persisted workspace binding. */
  workspaceRevision?: number;
  loadFiles(sessionId: string): Promise<ProjectFilesData>;
  loadFile(sessionId: string, filePath: string): Promise<WorkspaceFileContent>;
  rememberedModes?: Readonly<Record<string, FileViewMode>>;
  onModeChange?(filePath: string, mode: FileViewMode): void;
}

export function ProjectFilesTab({
  sessionId,
  workspaceMode,
  workspaceRevision,
  loadFiles,
  loadFile,
  rememberedModes,
  onModeChange,
}: ProjectFilesTabProps): JSX.Element {
  const { t } = useI18n();
  const [files, setFiles] = useState<ProjectFilesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<WorkspaceFileContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentScrollTop, setContentScrollTop] = useState(0);
  const [fileModes, setFileModes] = useState<Record<string, FileViewMode>>({});
  const loadFilesRef = useRef(loadFiles);
  const loadFileRef = useRef(loadFile);
  loadFilesRef.current = loadFiles;
  loadFileRef.current = loadFile;
  const location = workspaceLocationCopy(workspaceMode, t);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFiles(null);
    setSelectedPath(null);
    setContent(null);
    setContentScrollTop(0);
    void loadFilesRef.current(sessionId).then((nextFiles) => {
      if (cancelled) {
        return;
      }
      setFiles(nextFiles);
      setSelectedPath(nextFiles.available ? nextFiles.files[0]?.path ?? null : null);
    }).catch(() => {
      if (!cancelled) {
        setFiles({
          available: false,
          files: [],
          reason: "workspace-unavailable",
          workspaceMode,
        });
      }
    }).finally(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, workspaceMode, workspaceRevision]);

  useEffect(() => {
    if (selectedPath === null) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setContentLoading(true);
    void loadFileRef.current(sessionId, selectedPath).then((nextContent) => {
      if (!cancelled) {
        setContent(nextContent);
      }
    }).catch(() => {
      if (!cancelled) {
        setContent(null);
      }
    }).finally(() => {
      if (!cancelled) {
        setContentLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedPath, sessionId, workspaceRevision]);

  if (loading && files === null) {
    return <ProjectFilesMessage>{t("console.projectFiles.loading")}</ProjectFilesMessage>;
  }
  if (files === null || !files.available) {
    return <ProjectFilesMessage>{t("console.projectFiles.unavailable")}</ProjectFilesMessage>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="project-files-tab">
      <div className="shrink-0 border-b border-line px-3 py-3 text-xs leading-5 text-sub">
        <p className="font-normal text-ink">{t("console.projectFiles.browsing", { location: location.label })}</p>
        {location.consequence !== null ? (
          <p className="mt-1">{t("console.projectFiles.isolatedCopy")}</p>
        ) : null}
      </div>
      {files.files.length === 0 ? (
        <ProjectFilesMessage>{t("console.projectFiles.empty")}</ProjectFilesMessage>
      ) : (
        <>
          <WorkspaceFileTree
            files={files.files}
            selectedPath={selectedPath}
            onSelect={(filePath) => {
              setSelectedPath(filePath);
              setContentScrollTop(0);
            }}
            className="min-h-28 max-h-[42%] shrink-0 border-b border-line py-1"
          />
          {contentLoading ? (
            <ProjectFilesMessage>{t("console.fileDiff.loading")}</ProjectFilesMessage>
          ) : content === null ? (
            <ProjectFilesMessage>{t("console.fileDiff.loadFailed")}</ProjectFilesMessage>
          ) : !content.available ? (
            <ProjectFilesMessage>{projectFileUnavailableCopy(content.reason, t)}</ProjectFilesMessage>
          ) : (
            <WorkspaceFileView
              targetKey={`${sessionId}:${workspaceMode}:${String(workspaceRevision ?? 0)}:${content.path}`}
              path={content.path}
              text={content.text ?? content.lines.map((line) => line.text).join("\n")}
              lines={content.lines.map((line, index) => ({
                lineNumber: line.newLineNumber ?? index + 1,
                text: line.text,
              }))}
              hasExplicitLine={false}
              rememberedMode={rememberedModes?.[content.path] ?? fileModes[content.path]}
              onModeChange={(mode) => {
                setFileModes((current) => ({ ...current, [content.path]: mode }));
                onModeChange?.(content.path, mode);
              }}
              scrollTop={contentScrollTop}
              onScrollTopChange={setContentScrollTop}
            />
          )}
        </>
      )}
    </div>
  );
}

function projectFileUnavailableCopy(
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

function ProjectFilesMessage({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="grid h-full min-h-0 place-items-center p-6 text-center text-sm leading-6 text-sub">
      {children}
    </div>
  );
}
