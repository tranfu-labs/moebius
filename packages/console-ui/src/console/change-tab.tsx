import { FolderTree, RefreshCw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  FileDiffView,
  WorkspaceFileTree,
  workspaceLocationCopy,
  type WorkspaceFileChange,
  type WorkspaceFileContent,
} from "@/console/file-diff-view";
import { useI18n, type Translate } from "@/i18n";
import { cn } from "@/lib/utils";
import type { OperatorConsoleAppearance } from "@/console/operator-console-appearance";

export type WorkspaceDiffData =
  | {
      available: true;
      fileCount: number;
      files: WorkspaceFileChange[];
      reason: null;
      workspaceMode: "direct" | "worktree";
    }
  | {
      available: false;
      fileCount: null;
      files: [];
      reason:
        | "missing-baseline"
        | "not-git-repository"
        | "workspace-unavailable"
        | "baseline-unavailable"
        | "no-session";
      workspaceMode: "direct" | "worktree";
    };

export interface ChangeTabProps {
  appearance?: OperatorConsoleAppearance;
  sessionId: string;
  workspaceMode: "direct" | "worktree";
  conversationStarted: boolean;
  isWorking: boolean;
  loadDiff(sessionId: string): Promise<WorkspaceDiffData>;
  loadFile(sessionId: string, filePath: string): Promise<WorkspaceFileContent>;
}

interface PendingRefresh {
  diff: WorkspaceDiffData;
  content: WorkspaceFileContent | null;
}

export function ChangeTab({
  appearance = "default",
  sessionId,
  workspaceMode,
  conversationStarted,
  isWorking,
  loadDiff,
  loadFile,
}: ChangeTabProps): JSX.Element {
  const { t } = useI18n();
  const [diff, setDiff] = useState<WorkspaceDiffData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<WorkspaceFileContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentScrollTop, setContentScrollTop] = useState(0);
  const [pendingRefresh, setPendingRefresh] = useState<PendingRefresh | null>(null);
  const [treeVisible, setTreeVisible] = useState(true);
  const requestGenerationRef = useRef(0);
  const previousWorkingRef = useRef(isWorking);
  const location = workspaceLocationCopy(workspaceMode, t);

  const applyDiff = useCallback((nextDiff: WorkspaceDiffData, nextContent: WorkspaceFileContent | null = null) => {
    setDiff(nextDiff);
    setPendingRefresh(null);
    setSelectedPath((current) => {
      if (!nextDiff.available || nextDiff.files.length === 0) {
        return null;
      }
      return current !== null && nextDiff.files.some((file) => file.path === current)
        ? current
        : nextDiff.files[0]?.path ?? null;
    });
    if (nextContent !== null) {
      setContent(nextContent);
    }
  }, []);

  const refresh = useCallback(async (initial: boolean) => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    if (initial) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    try {
      const nextDiff = await loadDiff(sessionId);
      const nextContent = !initial && selectedPath !== null
        ? await loadFile(sessionId, selectedPath)
        : null;
      if (requestGenerationRef.current !== generation) {
        return;
      }
      if (!initial && diff !== null && hasRefreshChange(diff, nextDiff, content, nextContent)) {
        setPendingRefresh({ diff: nextDiff, content: nextContent });
      } else {
        applyDiff(nextDiff, nextContent);
      }
    } catch {
      if (requestGenerationRef.current === generation) {
        applyDiff({
          available: false,
          fileCount: null,
          files: [],
          reason: "workspace-unavailable",
          workspaceMode,
        });
      }
    } finally {
      if (requestGenerationRef.current === generation) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [applyDiff, content, diff, loadDiff, loadFile, selectedPath, sessionId, workspaceMode]);

  useEffect(() => {
    setDiff(null);
    setSelectedPath(null);
    setContent(null);
    setPendingRefresh(null);
    setContentScrollTop(0);
    void refresh(true);
    return () => {
      requestGenerationRef.current += 1;
    };
  }, [sessionId]);

  useEffect(() => {
    if (previousWorkingRef.current && !isWorking && diff !== null) {
      void refresh(false);
    }
    previousWorkingRef.current = isWorking;
  }, [diff, isWorking, refresh]);

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

  if (!conversationStarted) {
    return <ChangeStateMessage>{t("console.changeTab.notStarted")}</ChangeStateMessage>;
  }
  if (loading && diff === null) {
    return <ChangeStateMessage>{t("console.changeTab.loading")}</ChangeStateMessage>;
  }
  if (diff === null || !diff.available) {
    return (
      <ChangeStateMessage>
        <p>{diffUnavailableCopy(diff?.reason ?? "workspace-unavailable", t)}</p>
        <button
          type="button"
          className="mt-3 rounded-lg border border-line px-3 py-1.5 text-xs font-normal text-ink hover:bg-hover"
          onClick={() => void refresh(true)}
        >
          {t("common.retry")}
        </button>
      </ChangeStateMessage>
    );
  }
  if (diff.files.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ChangeHeader
          isWorking={isWorking}
          locationLabel={location.label}
          consequence={location.consequence}
          refreshing={refreshing}
          onRefresh={() => void refresh(false)}
        />
        <ChangeStateMessage>{t("console.changeTab.noChanges")}</ChangeStateMessage>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden",
        appearance === "focused" && "grid grid-cols-[minmax(0,1fr)_180px] grid-rows-[auto_minmax(0,1fr)]",
        appearance === "focused" && !treeVisible && "grid-cols-[minmax(0,1fr)_0px]",
      )}
      data-testid="change-tab"
    >
      <div className={appearance === "focused" ? "hidden" : undefined}>
      <ChangeHeader
        isWorking={isWorking}
        locationLabel={location.label}
        consequence={location.consequence}
        refreshing={refreshing}
        onRefresh={() => void refresh(false)}
      />
      </div>
      {pendingRefresh !== null ? (
        <button
          type="button"
          className="shrink-0 border-b border-line bg-sel px-3 py-2 text-left text-xs font-normal text-accent hover:bg-hover"
          onClick={() => applyDiff(pendingRefresh.diff, pendingRefresh.content)}
        >
          {t("console.changeTab.newChanges")}
        </button>
      ) : null}
      <WorkspaceFileTree
        files={diff.files}
        selectedPath={selectedPath}
        onSelect={(filePath) => {
          setSelectedPath(filePath);
          setContentScrollTop(0);
        }}
        className={appearance === "focused"
          ? cn(
              "col-start-2 row-start-2 min-h-0 max-h-none border-l border-line py-1",
              !treeVisible && "hidden",
            )
          : "min-h-28 max-h-[42%] shrink-0 border-b border-line py-1"}
        appearance={appearance}
      />
      <FileDiffView
        path={selectedPath}
        content={content}
        loading={contentLoading}
        scrollTop={contentScrollTop}
        onScrollTopChange={setContentScrollTop}
        appearance={appearance}
        pathAction={appearance === "focused" ? (
          <button
            type="button"
            className="absolute right-1.5 top-1/2 grid h-[26px] w-[26px] -translate-y-1/2 place-items-center rounded-md bg-card text-sub transition-colors hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:text-ink focus-visible:outline-none active:scale-[0.98]"
            aria-label={treeVisible ? "隐藏文件树" : "显示文件树"}
            aria-expanded={treeVisible}
            title={treeVisible ? "隐藏文件树" : "显示文件树"}
            onClick={() => setTreeVisible((visible) => !visible)}
          >
            <FolderTree className="h-[15px] w-[15px]" strokeWidth={1.5} aria-hidden="true" />
          </button>
        ) : null}
      />
    </div>
  );
}

function ChangeHeader({
  isWorking,
  locationLabel,
  consequence,
  refreshing,
  onRefresh,
}: {
  isWorking: boolean;
  locationLabel: string;
  consequence: string | null;
  refreshing: boolean;
  onRefresh(): void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="shrink-0 border-b border-line px-3 py-3 text-xs leading-5 text-sub">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-normal text-ink">
            {t("console.changeTab.summary", { location: locationLabel })}
          </p>
          {consequence !== null ? <p className="mt-1">{consequence}</p> : null}
          {isWorking ? <p className="mt-1">{t("console.changeTab.workingStale")}</p> : null}
        </div>
        {isWorking ? (
          <button
            type="button"
            className="flex shrink-0 items-center gap-1 rounded-lg border border-line px-2 py-1 font-normal text-ink hover:bg-hover disabled:opacity-50"
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            {t(refreshing ? "console.changeTab.refreshing" : "console.changeTab.refresh")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function hasRefreshChange(
  currentDiff: WorkspaceDiffData,
  nextDiff: WorkspaceDiffData,
  currentContent: WorkspaceFileContent | null,
  nextContent: WorkspaceFileContent | null,
): boolean {
  return JSON.stringify(currentDiff) !== JSON.stringify(nextDiff)
    || JSON.stringify(currentContent) !== JSON.stringify(nextContent);
}

function diffUnavailableCopy(
  reason: NonNullable<Extract<WorkspaceDiffData, { available: false }>["reason"]>,
  t: Translate,
): string {
  const copy: Record<typeof reason, string> = {
    "missing-baseline": t("console.changeTab.missingBaseline"),
    "not-git-repository": t("console.changeTab.notGit"),
    "workspace-unavailable": t("console.changeTab.workspaceUnavailable"),
    "baseline-unavailable": t("console.changeTab.baselineUnavailable"),
    "no-session": t("console.changeTab.noSession"),
  };
  return copy[reason];
}

function ChangeStateMessage({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="grid h-full min-h-0 place-items-center p-6 text-center text-sm leading-6 text-sub">
      <div>{children}</div>
    </div>
  );
}
