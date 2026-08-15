import type { Meta, StoryObj } from "@storybook/react";
import { useState, type ReactNode } from "react";

import { I18nProvider } from "@/i18n";
import { Button } from "@/ui/button";
import {
  NotificationPermissionDialog,
  type PendingTerminalEntry,
  type PermissionModalCloseSaveStatus,
  type PermissionModalOpenSettingsStatus,
} from "./notification-permission-dialog";

function MainArea({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      <aside className="flex w-[252px] shrink-0 flex-col border-r border-line p-3">
        <div className="px-2.5 py-2 font-sans text-base font-semibold tracking-[-0.01em]">
          Moebius
        </div>
        <div className="mt-2 space-y-1 text-sm">
          <div className="flex h-8 items-center gap-2 rounded-md px-2 text-sub">＋ 新建对话</div>
          <div className="flex h-8 items-center gap-2 rounded-md px-2 text-sub">⌕ 搜索</div>
          <div className="flex h-8 items-center gap-2 rounded-md px-2 text-sub">◇ Agent 团队</div>
        </div>
        <div className="mt-4 border-t border-line pt-3 text-xs uppercase tracking-[0.06em] text-sub">
          项目
        </div>
        <div className="mt-2 flex h-8 items-center gap-2 rounded-md bg-sel px-2 text-sm">发布前检查</div>
        <div className="mt-3 border-t border-line pt-3">
          <div className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-sub">⚙ 设置</div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-8">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-sans text-lg font-semibold tracking-[-0.01em]">发布前检查</h1>
          <p className="mt-2 text-sm text-sub">描述你的目标，团队会开始推进</p>
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}

type DialogPermissionKind = "undetermined" | "allowed" | "denied" | "unavailable";

type DialogJourneyState = {
  entries: readonly PendingTerminalEntry[];
  permission: DialogPermissionKind;
  openingSettings: PermissionModalOpenSettingsStatus;
  closingSave: PermissionModalCloseSaveStatus;
};

function DialogJourney({ initial }: { initial: DialogJourneyState }): JSX.Element {
  const [open, setOpen] = useState(true);
  const [permission, setPermission] = useState<DialogPermissionKind>(initial.permission);
  const [openingSettings, setOpeningSettings] = useState<PermissionModalOpenSettingsStatus>(initial.openingSettings);
  const [closingSave, setClosingSave] = useState<PermissionModalCloseSaveStatus>(initial.closingSave);
  const [closed, setClosed] = useState(false);

  const busy = openingSettings === "opening"
    || openingSettings === "requesting"
    || closingSave === "saving";

  const restart = (): void => {
    setOpen(true);
    setClosed(false);
    setPermission(initial.permission);
    setOpeningSettings(initial.openingSettings);
    setClosingSave(initial.closingSave);
  };

  const enablePermission = (): void => {
    if (busy) {
      return;
    }
    if (openingSettings === "failed") {
      setOpeningSettings("opening");
      window.setTimeout(() => setOpeningSettings("opened"), 800);
      return;
    }
    if (permission === "undetermined") {
      setOpeningSettings("requesting");
      window.setTimeout(() => {
        setOpeningSettings("request-done");
        setPermission("allowed");
      }, 900);
      return;
    }
    setOpeningSettings("opening");
    window.setTimeout(() => setOpeningSettings("opened"), 800);
  };

  const recheck = (): void => {
    if (busy) {
      return;
    }
    if (permission === "allowed") {
      setOpen(false);
      setClosed(true);
    }
  };

  const closeNotifications = (): void => {
    if (busy) {
      return;
    }
    setClosingSave("saving");
    window.setTimeout(() => {
      setOpen(false);
      setClosed(true);
    }, 800);
  };

  if (closed) {
    return (
      <MainArea>
        <Button type="button" variant="outline" onClick={restart}>
          重新打开弹窗
        </Button>
      </MainArea>
    );
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <NotificationPermissionDialog
        open={open}
        entries={initial.entries}
        openingSettings={openingSettings}
        closingSave={closingSave}
        onOpenChange={(next) => {
          if (!next) {
            restart();
          }
        }}
        onEnablePermission={enablePermission}
        onRecheck={recheck}
        onCloseNotifications={closeNotifications}
        onRetryOpenSettings={enablePermission}
        onRetryCloseSave={closeNotifications}
      />
    </div>
  );
}

const singleEntry = [
  {
    id: "session-release",
    conversationTitle: "发布前检查",
    outcome: "completed" as const,
  },
];

const threeEntries = [
  {
    id: "session-release",
    conversationTitle: "发布前检查",
    outcome: "completed" as const,
  },
  {
    id: "session-copy",
    conversationTitle: "落地页文案",
    outcome: "awaiting-user" as const,
  },
  {
    id: "session-refactor",
    conversationTitle: "导出功能重构",
    outcome: "awaiting-user" as const,
  },
];

const meta = {
  title: "Component/Console/NotificationPermissionDialog",
  component: NotificationPermissionDialog,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <I18nProvider locale="zh-CN">
        <Story />
      </I18nProvider>
    ),
  ],
  render: (args) => (
    <DialogJourney
      initial={{
        entries: args.entries ?? singleEntry,
        permission: "undetermined",
        openingSettings: args.openingSettings ?? "idle",
        closingSave: args.closingSave ?? "idle",
      }}
    />
  ),
  args: {
    open: true,
    entries: singleEntry,
    openingSettings: "idle",
    closingSave: "idle",
  },
} satisfies Meta<typeof NotificationPermissionDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleConversation: Story = {};

export const ThreeConversations: Story = {
  args: {
    entries: threeEntries,
  },
};

export const PermissionDenied: Story = {
  render: () => (
    <DialogJourney
      initial={{
        entries: singleEntry,
        permission: "denied",
        openingSettings: "idle",
        closingSave: "idle",
      }}
    />
  ),
};

export const UnableToDetect: Story = {
  render: () => (
    <DialogJourney
      initial={{
        entries: singleEntry,
        permission: "unavailable",
        openingSettings: "idle",
        closingSave: "idle",
      }}
    />
  ),
};

export const SystemSettingsOpened: Story = {
  args: {
    openingSettings: "opened",
  },
};

export const SystemSettingsOpenFailed: Story = {
  args: {
    openingSettings: "failed",
  },
};

export const ClosingNotificationsSaving: Story = {
  args: {
    closingSave: "saving",
  },
};

export const ClosingNotificationsSaveFailed: Story = {
  args: {
    closingSave: "failed",
  },
};
