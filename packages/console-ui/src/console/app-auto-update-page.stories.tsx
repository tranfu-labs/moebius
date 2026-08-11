import type { Meta, StoryObj } from "@storybook/react";
import { Folder, MessageSquare, RefreshCw, Search, Settings } from "lucide-react";
import { useState } from "react";

import { I18nProvider, useI18n, type Locale } from "@/i18n";
import {
  SettingsDialog,
  type SettingsAboutState,
  type SettingsSection,
} from "./settings-dialog";
import {
  UpdatePromptDialog,
  type UpdateInstallDecision,
  type UpdateInstallFailure,
  type UpdateReadyDecision,
} from "./update-prompt-dialog";

type UpdateStoryScenario =
  | "ready-reminder"
  | "running-confirmation"
  | "skipped-settings"
  | "skipped-settings-install"
  | "install-failure"
  | "stress";

type UpdateFailureFixture = "task-stop" | "install-with-tasks" | "install-no-tasks";

export type UpdateStoryArgs = {
  scenario: UpdateStoryScenario;
  activeLocale: Locale;
  currentVersion: string;
  latestVersion: string;
  taskCount: number;
  failureKind?: UpdateFailureFixture;
};

const normalProjects = [
  { name: "Moebius", sessions: ["更新流程", "产品交付"] },
  { name: "marketing-site", sessions: ["发布准备"] },
];

const stressProjects = Array.from({ length: 6 }, (_, projectIndex) => ({
  name: `workspace-${String(projectIndex + 1).padStart(2, "0")}`,
  sessions: Array.from({ length: 4 }, (_, sessionIndex) =>
    `long-running-session-${String(projectIndex * 4 + sessionIndex + 1).padStart(2, "0")}`),
}));

export function AppAutoUpdateStoryCanvas(args: UpdateStoryArgs): JSX.Element {
  return (
    <I18nProvider locale={args.activeLocale}>
      <AppAutoUpdateStoryState {...args} />
    </I18nProvider>
  );
}

function AppAutoUpdateStoryState({
  scenario,
  activeLocale,
  currentVersion,
  latestVersion,
  taskCount,
  failureKind = "install-no-tasks",
}: UpdateStoryArgs): JSX.Element {
  const { t } = useI18n();
  const stress = scenario === "stress";
  const settingsScenario = scenario === "skipped-settings" || scenario === "skipped-settings-install";
  const failureScenario = scenario === "install-failure";
  const [dialog, setDialog] = useState<"ready" | "install-confirmation" | "install-failure" | null>(
    scenario === "ready-reminder" ? "ready" : failureScenario ? "install-failure" : settingsScenario ? null : "install-confirmation",
  );
  const [settingsOpen, setSettingsOpen] = useState(settingsScenario);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("about");
  const [skippedVersion, setSkippedVersion] = useState(settingsScenario);
  const [lastDecision, setLastDecision] = useState<string | null>(null);
  const projects = stress ? stressProjects : normalProjects;

  const failure: UpdateInstallFailure = failureKind === "task-stop"
    ? {
        kind: "task-stop",
        version: latestVersion,
        runningTaskCount: taskCount,
        hadRunningTasks: true,
        tasksStopped: false,
        installStarted: false,
      }
    : {
        kind: "install",
        version: latestVersion,
        runningTaskCount: 0,
        hadRunningTasks: failureKind === "install-with-tasks",
        tasksStopped: true,
        installStarted: failureKind === "install-with-tasks",
      };
  const about: SettingsAboutState = {
    currentVersion,
    latestVersion,
    updateStatus: failureScenario ? "failed" : "ready",
    updateFailureReason: failureScenario ? "install" : undefined,
    skippedVersion,
  };

  const openInstallConfirmation = (): void => {
    setSettingsOpen(false);
    setDialog("install-confirmation");
    setLastDecision("install-intent");
  };

  const recordReadyDecision = (decision: UpdateReadyDecision): void => {
    if (decision === "install") {
      openInstallConfirmation();
      return;
    }
    if (decision === "skip-version") {
      setSkippedVersion(true);
      setSettingsSection("about");
      setSettingsOpen(true);
      setLastDecision("skip-version");
      setDialog(null);
      return;
    }
    setLastDecision("remind-later");
    setDialog(null);
  };

  const recordInstallDecision = (decision: UpdateInstallDecision): void => {
    setLastDecision(decision);
    setDialog(null);
  };

  const recordFailureDecision = (decision: "dismiss" | "retry"): void => {
    setLastDecision(decision);
    setDialog(decision === "retry" ? "install-confirmation" : null);
  };

  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      <aside className="flex w-[252px] shrink-0 flex-col border-r border-line bg-rail p-3">
        <div className="px-2 py-3 font-display text-sm font-semibold">Moebius</div>
        <nav className="mt-3 grid gap-1 text-sm text-sub" aria-label="Application navigation fixture">
          <div className="flex h-9 items-center gap-2 rounded-sm bg-sel px-2 text-ink">
            <MessageSquare className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            Conversations
          </div>
          <div className="flex h-9 items-center gap-2 rounded-sm px-2">
            <Search className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            Search
          </div>
        </nav>

        <div className="mt-5 border-t border-line pt-4 text-xs text-hint">Projects</div>
        <div className="mt-2 min-h-0 flex-1 space-y-4 overflow-auto pr-1">
          {projects.map((project) => (
            <section key={project.name} aria-label={project.name}>
              <div className="flex h-8 items-center gap-2 px-2 text-sm font-medium">
                <Folder className="h-4 w-4 text-sub" strokeWidth={1.5} aria-hidden="true" />
                <span className="truncate">{project.name}</span>
              </div>
              <div className="grid gap-1 pl-6 text-xs text-sub">
                {project.sessions.map((session) => (
                  <div key={session} className="flex min-h-7 items-center gap-2 rounded-sm px-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                    <span className="truncate">{session}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <footer className="mt-3 grid gap-1 border-t border-line pt-3">
          <button
            type="button"
            className="flex h-9 items-center gap-2 rounded-sm px-2 text-sm text-sub hover:bg-hover hover:text-ink"
            onClick={() => {
              setSettingsSection("about");
              setSettingsOpen(true);
            }}
          >
            <Settings className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            Settings
          </button>
          <button
            type="button"
            className="flex h-9 items-center gap-2 rounded-sm px-2 text-sm text-sub hover:bg-hover hover:text-ink"
            onClick={() => setDialog("install-confirmation")}
          >
            <RefreshCw className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            Install update
          </button>
        </footer>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto p-8">
        <div className="mx-auto grid max-w-[840px] gap-6">
          <header>
            <p className="text-sm text-sub">Active workspace</p>
            <h1 className="mt-2 font-display text-2xl font-semibold tracking-[-0.01em]">
              Update delivery review
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-sub">
              The workspace remains visible behind the application-owned update decision. This fixture has no IPC, network, or user state.
            </p>
          </header>

          <section className="grid gap-3 rounded-[14px] border border-line bg-card p-4" aria-label="Running task fixture">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Long-running work</p>
                <p className="mt-1 text-sm text-sub">Agent and managed-process activity stays visible while the reminder waits.</p>
              </div>
              <span
                className="tnum rounded-full border border-line px-2 py-1 text-xs text-sub"
                data-testid="running-task-count"
              >
                {taskCount} running
              </span>
            </div>
            <div className="grid gap-2">
              {Array.from({ length: stress ? 8 : Math.min(taskCount, 3) }, (_, index) => (
                <div key={index} className="flex items-center justify-between gap-3 border-t border-line pt-2 text-sm">
                  <span className="truncate">{stress ? `worker-${String(index + 1).padStart(2, "0")} · provider trace and verification` : `Agent task ${index + 1}`}</span>
                  <span className="tnum shrink-0 text-xs text-sub">{String(index + 3).padStart(2, "0")}:14</span>
                </div>
              ))}
            </div>
          </section>

          {lastDecision !== null ? (
            <p className="text-xs text-hint" data-testid="update-decision-fixture">
              Fixture decision: {lastDecision}
            </p>
          ) : null}
        </div>
      </main>

      <SettingsDialog
        open={settingsOpen}
        activeLocale={activeLocale}
        pendingLocale={null}
        saveStatus="idle"
        activeSection={settingsSection}
        about={about}
        onOpenChange={setSettingsOpen}
        onSectionChange={setSettingsSection}
        onSelectLocale={() => undefined}
        onRetry={() => undefined}
        onCheckForUpdates={() => undefined}
        onInstallUpdate={openInstallConfirmation}
        onCopyVersion={() => undefined}
        onOpenReleaseNotes={() => setLastDecision("release-notes")}
        onOpenFeedback={() => setLastDecision("feedback")}
        onOpenRepository={() => setLastDecision("repository")}
      />

      <UpdatePromptDialog
        {...(dialog === "ready"
          ? {
              mode: "ready" as const,
              open: true,
              currentVersion,
              latestVersion,
              onDecision: recordReadyDecision,
              onOpenReleaseNotes: () => setLastDecision("release-notes"),
            }
          : dialog === "install-confirmation" ? {
              mode: "install-confirmation" as const,
              open: dialog === "install-confirmation",
              version: latestVersion,
              runningTaskCount: taskCount,
              onDecision: recordInstallDecision,
            } : {
              mode: "install-failure" as const,
              open: dialog === "install-failure",
              failure,
              onDecision: recordFailureDecision,
            })}
      />
    </div>
  );
}

const meta = {
  title: "Page/Console/AppAutoUpdate",
  parameters: { layout: "fullscreen" },
  args: {
    scenario: "ready-reminder" as const,
    activeLocale: "zh-CN" as const,
    currentVersion: "0.4.3",
    latestVersion: "0.5.0",
    taskCount: 3,
  },
  render: (args: UpdateStoryArgs) => <AppAutoUpdateStoryCanvas {...args} />,
} satisfies Meta<UpdateStoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadyReminder: Story = {
  name: "更新就绪提醒",
};

export const ReadyReminderNoTasks: Story = {
  name: "更新就绪提醒（无任务）",
  args: {
    taskCount: 0,
  },
};

export const RunningTasksInstallConfirmation: Story = {
  name: "运行任务下的安装确认",
  args: {
    scenario: "running-confirmation",
    taskCount: 3,
  },
};

export const SkippedVersionSettings: Story = {
  name: "跳过版本后的关于状态",
  args: {
    scenario: "skipped-settings",
  },
};

export const SkippedVersionSettingsInstall: Story = {
  name: "跳过后从关于重新安装",
  args: {
    scenario: "skipped-settings-install",
  },
};

export const InstallFailureTaskStop: Story = {
  name: "安装失败：任务仍在运行",
  args: {
    scenario: "install-failure",
    failureKind: "task-stop",
    taskCount: 3,
  },
};

export const InstallFailureAfterTaskStop: Story = {
  name: "安装失败：任务已停止",
  args: {
    scenario: "install-failure",
    failureKind: "install-with-tasks",
    taskCount: 0,
  },
};

export const InstallFailureNoTasks: Story = {
  name: "安装失败：无任务",
  args: {
    scenario: "install-failure",
    failureKind: "install-no-tasks",
    taskCount: 0,
  },
};

export const StressData: Story = {
  name: "压力数据",
  args: {
    scenario: "stress",
    activeLocale: "en",
    taskCount: 42,
  },
  parameters: {
    viewport: {
      defaultViewport: "updateStress",
      viewports: {
        updateStress: {
          name: "Update stress · 720 × 640",
          styles: { width: "720px", height: "640px" },
        },
      },
    },
  },
};
