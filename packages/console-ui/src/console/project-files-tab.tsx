import { useEffect, useState } from "react";

import {
  FileDiffView,
  WorkspaceFileTree,
  workspaceLocationCopy,
  type WorkspaceFileChange,
  type WorkspaceFileContent,
} from "@/console/file-diff-view";
import { useI18n } from "@/i18n";

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
  loadFiles(sessionId: string): Promise<ProjectFilesData>;
  loadFile(sessionId: string, filePath: string): Promise<WorkspaceFileContent>;
}

export function ProjectFilesTab({
  sessionId,
  workspaceMode,
  loadFiles,
  loadFile,
}: ProjectFilesTabProps): JSX.Element {
  const { t } = useI18n();
  const [files, setFiles] = useState<ProjectFilesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<WorkspaceFileContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentScrollTop, setContentScrollTop] = useState(0);
  const location = workspaceLocationCopy(workspaceMode, t);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFiles(null);
    setSelectedPath(null);
    setContent(null);
    setContentScrollTop(0);
    void loadFiles(sessionId).then((nextFiles) => {
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
  }, [loadFiles, sessionId, workspaceMode]);

  useEffect(() => {
    if (selectedPath === null) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setContentLoading(true);
    void loadFile(sessionId, selectedPath).then((nextContent) => {
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
  }, [loadFile, selectedPath, sessionId]);

  if (loading && files === null) {
    return <ProjectFilesMessage>{t("console.projectFiles.loading")}</ProjectFilesMessage>;
  }
  if (files === null || !files.available) {
    return <ProjectFilesMessage>{t("console.projectFiles.unavailable")}</ProjectFilesMessage>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="project-files-tab">
      <div className="shrink-0 border-b border-line px-3 py-3 text-xs leading-5 text-sub">
        <p className="font-medium text-ink">{t("console.projectFiles.browsing", { location: location.label })}</p>
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
          <FileDiffView
            path={selectedPath}
            content={content}
            loading={contentLoading}
            scrollTop={contentScrollTop}
            onScrollTopChange={setContentScrollTop}
          />
        </>
      )}
    </div>
  );
}

function ProjectFilesMessage({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="grid h-full min-h-0 place-items-center p-6 text-center text-sm leading-6 text-sub">
      {children}
    </div>
  );
}
