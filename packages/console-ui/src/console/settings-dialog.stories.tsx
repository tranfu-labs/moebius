import type { Meta, StoryObj } from "@storybook/react";
import { Folder, MessageSquare, Plus, Search, Settings } from "lucide-react";
import { useState } from "react";

import { I18nProvider } from "@/i18n";
import {
  SettingsDialog,
  type SettingsDialogProps,
  type SettingsSection,
} from "./settings-dialog";

const currentVersion = "0.1.4";

function SettingsStoryCanvas(args: SettingsDialogProps): JSX.Element {
  const [open, setOpen] = useState(args.open);
  const [activeSection, setActiveSection] = useState<SettingsSection>(
    args.activeSection ?? "general",
  );

  return (
    <I18nProvider locale={args.activeLocale}>
      <div className="flex min-h-screen bg-canvas text-ink">
        <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-rail p-3">
          <div className="px-2 py-3 font-display text-sm font-semibold">Moebius</div>
          <div className="mt-3 space-y-1 text-sm text-sub">
            <div className="flex h-9 items-center gap-2 rounded-sm px-2">
              <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              新建对话
            </div>
            <div className="flex h-9 items-center gap-2 rounded-sm px-2">
              <Search className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              搜索
            </div>
          </div>
          <div className="mt-5 border-t border-line pt-4 text-xs text-hint">项目</div>
          <div className="mt-2 flex h-9 items-center gap-2 rounded-sm bg-sel px-2 text-sm">
            <Folder className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            Moebius Desktop
          </div>
          <button
            type="button"
            className="mt-auto flex h-9 items-center gap-2 rounded-sm px-2 text-sm text-sub hover:bg-hover hover:text-ink"
            onClick={() => setOpen(true)}
          >
            <Settings className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            设置
          </button>
        </aside>
        <main className="min-w-0 flex-1 p-8">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-center gap-2 text-sm text-sub">
              <MessageSquare className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              产品交付
            </div>
            <h1 className="mt-4 font-display text-2xl font-semibold tracking-[-0.01em]">
              设置页视觉评审
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-sub">
              这个工作区仅用于说明设置以模态方式覆盖当前任务；固定数据不会连接 IPC、网络或本机状态。
            </p>
          </div>
        </main>
      </div>

      <SettingsDialog
        {...args}
        open={open}
        activeSection={activeSection}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          args.onOpenChange(nextOpen);
        }}
        onSectionChange={(section) => {
          setActiveSection(section);
          args.onSectionChange?.(section);
        }}
      />
    </I18nProvider>
  );
}

const meta = {
  title: "Page/Console/SettingsDialog",
  component: SettingsDialog,
  parameters: {
    layout: "fullscreen",
  },
  render: (args) => <SettingsStoryCanvas {...args} />,
  args: {
    open: true,
    activeLocale: "zh-CN",
    pendingLocale: null,
    saveStatus: "idle",
    activeSection: "general",
    about: {
      currentVersion,
      updateStatus: "idle",
      copyStatus: "idle",
    },
    onOpenChange: () => undefined,
    onSectionChange: () => undefined,
    onSelectLocale: () => undefined,
    onRetry: () => undefined,
    onCheckForUpdates: () => undefined,
    onCopyVersion: () => undefined,
    onOpenReleaseNotes: () => undefined,
    onOpenFeedback: () => undefined,
    onOpenRepository: () => undefined,
  },
} satisfies Meta<typeof SettingsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const General: Story = {};

export const About: Story = {
  args: {
    activeSection: "about",
  },
};

export const CheckingForUpdates: Story = {
  args: {
    activeSection: "about",
    about: {
      currentVersion,
      updateStatus: "checking",
    },
  },
};

export const UpToDate: Story = {
  args: {
    activeSection: "about",
    about: {
      currentVersion,
      updateStatus: "latest",
    },
  },
};

export const UpdateAvailable: Story = {
  args: {
    activeSection: "about",
    about: {
      currentVersion,
      latestVersion: "0.1.5",
      updateStatus: "available",
    },
  },
};

export const UpdateCheckFailed: Story = {
  args: {
    activeSection: "about",
    about: {
      currentVersion,
      updateStatus: "failed",
    },
  },
};

export const NarrowWindow: Story = {
  args: {
    activeSection: "about",
    about: {
      currentVersion,
      latestVersion: "0.1.5",
      updateStatus: "available",
    },
  },
  parameters: {
    viewport: {
      defaultViewport: "settingsNarrow",
      viewports: {
        settingsNarrow: {
          name: "Settings narrow · 560 × 640",
          styles: { width: "560px", height: "640px" },
        },
      },
    },
  },
};

export const ShortWindow: Story = {
  args: {
    activeSection: "about",
    about: {
      currentVersion,
      latestVersion: "0.1.5",
      updateStatus: "available",
    },
  },
  parameters: {
    viewport: {
      defaultViewport: "settingsShort",
      viewports: {
        settingsShort: {
          name: "Settings short · 900 × 480",
          styles: { width: "900px", height: "480px" },
        },
      },
    },
  },
};
