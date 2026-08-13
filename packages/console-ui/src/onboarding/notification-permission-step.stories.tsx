import type { Meta, StoryObj } from "@storybook/react";
import { useState, type ReactNode } from "react";

import { I18nProvider, useI18n } from "@/i18n";
import { Button } from "@/ui/button";
import { ReadyStep } from "./onboarding-shell";
import {
  NotificationPermissionStep,
  type NotificationPermissionState,
} from "./notification-permission-step";

function MainArea({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      <aside className="flex w-[252px] shrink-0 flex-col border-r border-line p-3">
        <div className="px-2.5 py-2 font-sans text-base font-semibold tracking-[-0.01em]">
          Moebius
        </div>
        <div className="mt-2 space-y-1 text-sm">
          <div className="flex h-8 items-center gap-2 rounded-sm px-2 text-sub">＋ 新建对话</div>
          <div className="flex h-8 items-center gap-2 rounded-sm px-2 text-sub">⌕ 搜索</div>
          <div className="flex h-8 items-center gap-2 rounded-sm px-2 text-sub">◇ Agent 团队</div>
        </div>
        <div className="mt-4 border-t border-line pt-3 text-xs font-semibold uppercase tracking-[0.06em] text-sub">
          项目
        </div>
        <div className="mt-2 flex h-8 items-center gap-2 rounded-sm bg-sel px-2 text-sm">开发团队</div>
        <div className="mt-3 border-t border-line pt-3">
          <div className="flex h-8 items-center gap-2 rounded-sm px-2 text-sm text-sub">⚙ 设置</div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-8">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-sans text-lg font-semibold tracking-[-0.01em]">新对话</h1>
          <p className="mt-2 text-sm text-sub">描述你的目标，团队会开始推进</p>
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}

function JourneyCanvas({
  masterSwitchEnabled,
  permission,
  waitingForSystem,
}: {
  masterSwitchEnabled: boolean;
  permission: NotificationPermissionState;
  waitingForSystem?: boolean;
}): JSX.Element {
  const [step, setStep] = useState<4 | 5>(4);
  if (step === 4) {
    return (
      <NotificationPermissionStep
        masterSwitchEnabled={masterSwitchEnabled}
        permission={permission}
        waitingForSystem={waitingForSystem}
        onSkip={() => setStep(5)}
        onContinue={() => setStep(5)}
      />
    );
  }
  return <ReadyStepScreen onBack={() => setStep(4)} />;
}

function ReadyStepScreen({ onBack }: { onBack: () => void }): JSX.Element {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  if (done) {
    return (
      <MainArea>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setDone(false);
            onBack();
          }}
        >
          重新体验
        </Button>
      </MainArea>
    );
  }
  return (
    <main className="flex h-screen h-dvh min-h-0 flex-col overflow-hidden bg-canvas text-ink">
      <section className="flex min-h-0 flex-1 justify-center overflow-y-auto px-6 py-10 max-sm:px-4 max-sm:py-7">
        <div className="flex w-full max-w-[780px] flex-col justify-center">
          <header className="mx-auto w-full max-w-lg text-center">
            <p className="text-xs font-normal tabular-nums text-hint">
              {t("notification.step.progressReady")}
            </p>
            <h1 className="mt-2 text-lg font-semibold leading-tight tracking-[-0.02em] text-ink">
              {t("onboarding.step4ReadyTitle")}
            </h1>
            <p className="mt-2 text-sm leading-5 text-sub">
              {t("onboarding.step4ReadySubtitle")}
            </p>
          </header>
          <div className="mx-auto mt-7 w-full max-w-[640px]">
            <ReadyStep compatibility={{ affectedCount: 0, memberSlugs: [], clis: [], copy: "" }} />
          </div>
        </div>
      </section>
      <footer className="shrink-0 border-t border-line bg-canvas px-6 py-3.5 max-sm:px-4">
        <nav className="mx-auto flex w-full max-w-[780px] items-center justify-end gap-2">
          <Button type="button" size="lg" variant="outline" onClick={onBack}>
            {t("onboarding.previous")}
          </Button>
          <Button type="button" size="lg" onClick={() => setDone(true)}>
            {t("onboarding.startUsing")}
          </Button>
        </nav>
      </footer>
    </main>
  );
}

const meta = {
  title: "Page/Onboarding/NotificationPermissionStep",
  component: NotificationPermissionStep,
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
  render: (args) => <JourneyCanvas {...args} />,
  args: {
    masterSwitchEnabled: true,
    permission: "undetermined",
    waitingForSystem: false,
  },
} satisfies Meta<typeof NotificationPermissionStep>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SwitchOnPermissionUndetermined: Story = {};

export const SwitchOnPermissionAllowed: Story = {
  args: { permission: "allowed" },
};

export const SwitchOnPermissionDenied: Story = {
  args: { permission: "denied" },
};

export const SwitchOnPermissionUnavailable: Story = {
  args: { permission: "unavailable" },
};

export const SwitchOffPermissionUndetermined: Story = {
  args: { masterSwitchEnabled: false },
};

export const SwitchOffPermissionAllowed: Story = {
  args: { masterSwitchEnabled: false, permission: "allowed" },
};

export const SwitchOffPermissionDenied: Story = {
  args: { masterSwitchEnabled: false, permission: "denied" },
};

export const SwitchOffPermissionUnavailable: Story = {
  args: { masterSwitchEnabled: false, permission: "unavailable" },
};

export const WaitingForMacosConfirmation: Story = {
  args: { waitingForSystem: true },
};

export const EnglishSwitchOnUndetermined: Story = {
  decorators: [
    (Story) => (
      <I18nProvider locale="en">
        <Story />
      </I18nProvider>
    ),
  ],
  render: (args) => (
    <NotificationPermissionStep
      masterSwitchEnabled={args.masterSwitchEnabled ?? true}
      permission={args.permission ?? "undetermined"}
      waitingForSystem={args.waitingForSystem}
    />
  ),
};

export const MinimumWindow: Story = {
  args: SwitchOnPermissionUndetermined.args,
  parameters: {
    viewport: {
      defaultViewport: "onboardingMinimum",
      viewports: {
        onboardingMinimum: {
          name: "Onboarding minimum 520 × 480",
          styles: { width: "520px", height: "480px" },
        },
      },
    },
  },
};

export const PermissionStateMatrix: Story = {
  render: () => (
    <div className="grid min-h-screen grid-cols-2 gap-px bg-line">
      {([
        [true, "undetermined"],
        [true, "allowed"],
        [true, "denied"],
        [true, "unavailable"],
        [false, "undetermined"],
        [false, "allowed"],
        [false, "denied"],
        [false, "unavailable"],
      ] satisfies ReadonlyArray<readonly [boolean, NotificationPermissionState]>).map(([masterSwitchEnabled, permission]) => (
        <NotificationPermissionStep
          key={`${String(masterSwitchEnabled)}-${permission}`}
          masterSwitchEnabled={masterSwitchEnabled}
          permission={permission}
        />
      ))}
    </div>
  ),
};
