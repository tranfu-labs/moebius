import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Info, KeyRound, Languages } from "lucide-react";

import { I18nProvider } from "@/i18n";
import {
  TerminalNotificationSettings,
  type NotificationPermissionState,
  type NotificationSaveStatus,
} from "./terminal-notification-settings";

type RecheckOutcome = "recover" | "persist";
type RetrySaveOutcome = "success" | "persist";

type SettingsJourneyState = {
  enabled: boolean;
  permission: NotificationPermissionState;
  saveStatus: NotificationSaveStatus;
  channelAnomaly: boolean;
  recheckOutcome: RecheckOutcome;
  retrySaveOutcome: RetrySaveOutcome;
};

function SettingsGroupJourney({ initial }: { initial: SettingsJourneyState }): JSX.Element {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [permission] = useState(initial.permission);
  const [saveStatus, setSaveStatus] = useState(initial.saveStatus);
  const [saveResult, setSaveResult] = useState<"closed" | null>(null);
  const [channelAnomaly, setChannelAnomaly] = useState(initial.channelAnomaly);
  const [channelCheckResult, setChannelCheckResult] = useState<"recovered" | "still-anomaly" | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  const recheck = (): void => {
    if (checking) {
      return;
    }
    setChecking(true);
    setChannelCheckResult(null);
    window.setTimeout(() => {
      setChecking(false);
      if (initial.recheckOutcome === "persist") {
        setChannelAnomaly(true);
        setChannelCheckResult("still-anomaly");
      } else {
        setChannelAnomaly(false);
        setChannelCheckResult("recovered");
      }
    }, 900);
  };

  const retrySave = (): void => {
    if (saving) {
      return;
    }
    setSaving(true);
    setSaveResult(null);
    window.setTimeout(() => {
      setSaving(false);
      if (initial.retrySaveOutcome === "persist") {
        setSaveStatus("failed");
      } else {
        setEnabled(false);
        setSaveStatus("idle");
        setSaveResult("closed");
      }
    }, 900);
  };

  return (
    <TerminalNotificationSettings
      enabled={enabled}
      saveStatus={saving ? "saving" : saveStatus}
      saveResult={saveResult}
      permission={permission}
      channelAnomaly={channelAnomaly}
      channelCheckResult={channelCheckResult}
      checking={checking}
      onToggle={(next) => {
        setSaveResult(null);
        setSaveStatus("idle");
        setEnabled(next);
      }}
      onRequestPermission={() => undefined}
      onOpenSystemSettings={() => undefined}
      onRecheckChannel={recheck}
      onReportProblem={() => undefined}
      onRetrySave={retrySave}
    />
  );
}

function SettingsGroupCanvas({ initial }: { initial: SettingsJourneyState }): JSX.Element {
  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      <aside className="flex w-[168px] shrink-0 flex-col border-r border-line bg-card p-3">
        <div className="px-2.5 py-2 font-sans text-base font-semibold tracking-[-0.01em]">
          设置
        </div>
        <div className="mt-1 space-y-1 text-sm">
          <span className="flex h-9 items-center gap-2 rounded-sm bg-sel px-2.5 text-ink">
            <Languages className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            常规
          </span>
          <span className="flex h-9 items-center gap-2 rounded-sm px-2.5 text-sub">
            <KeyRound className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            AI 服务商
          </span>
          <span className="flex h-9 items-center gap-2 rounded-sm px-2.5 text-sub">
            <Info className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            关于
          </span>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        <SettingsGroupJourney initial={initial} />
      </main>
    </div>
  );
}

const defaultInitial: SettingsJourneyState = {
  enabled: true,
  permission: "allowed",
  saveStatus: "idle",
  channelAnomaly: false,
  recheckOutcome: "recover",
  retrySaveOutcome: "success",
};

const meta = {
  title: "Page/Console/TerminalNotificationSettings",
  component: TerminalNotificationSettings,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <I18nProvider locale="zh-CN">
        <Story />
      </I18nProvider>
    ),
  ],
  render: (args) => (
    <SettingsGroupCanvas
      initial={{
        ...defaultInitial,
        enabled: args.enabled ?? defaultInitial.enabled,
        permission: args.permission ?? defaultInitial.permission,
        saveStatus: args.saveStatus ?? defaultInitial.saveStatus,
        channelAnomaly: args.channelAnomaly ?? defaultInitial.channelAnomaly,
      }}
    />
  ),
  args: {
    enabled: true,
    saveStatus: "idle",
    permission: "allowed",
    channelAnomaly: false,
    checking: false,
  },
} satisfies Meta<typeof TerminalNotificationSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultAllowed: Story = {};

export const PermissionUndetermined: Story = {
  args: { permission: "undetermined" },
};

export const PermissionDenied: Story = {
  args: { permission: "denied" },
};

export const SavingSwitchOn: Story = {
  args: {
    enabled: false,
    saveStatus: "saving",
    permission: "allowed",
  },
};

export const SavingSwitchOff: Story = {
  args: {
    enabled: true,
    saveStatus: "saving",
    permission: "allowed",
  },
};

export const SaveFailed: Story = {
  render: () => (
    <SettingsGroupCanvas
      initial={{
        ...defaultInitial,
        saveStatus: "failed",
        retrySaveOutcome: "success",
      }}
    />
  ),
};

export const SaveFailedStillFails: Story = {
  render: () => (
    <SettingsGroupCanvas
      initial={{
        ...defaultInitial,
        saveStatus: "failed",
        retrySaveOutcome: "persist",
      }}
    />
  ),
};

export const ChannelAnomalyAllowed: Story = {
  render: () => (
    <SettingsGroupCanvas
      initial={{
        ...defaultInitial,
        channelAnomaly: true,
        recheckOutcome: "recover",
      }}
    />
  ),
};

export const ChannelAnomalyDenied: Story = {
  render: () => (
    <SettingsGroupCanvas
      initial={{
        ...defaultInitial,
        permission: "denied",
        channelAnomaly: true,
        recheckOutcome: "persist",
      }}
    />
  ),
};

export const EnglishDefaultAllowed: Story = {
  decorators: [
    (Story) => (
      <I18nProvider locale="en">
        <Story />
      </I18nProvider>
    ),
  ],
};

export const NarrowWindow: Story = {
  render: () => (
    <SettingsGroupCanvas
      initial={{
        ...defaultInitial,
        permission: "denied",
        saveStatus: "failed",
        channelAnomaly: true,
        recheckOutcome: "persist",
      }}
    />
  ),
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
