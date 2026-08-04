import type { Meta, StoryObj } from "@storybook/react";

import { translate } from "../i18n";
import { ManagedProcessPanel, type ManagedProcessPanelController } from "./managed-process-panel";

const controller: ManagedProcessPanelController = {
  state: {
    status: "ready",
    items: [
      { id: "storybook", label: "Storybook", kind: "service", state: "ready", endpoint: { url: "http://127.0.0.1:6006" }, exitCode: null, signal: null },
      { id: "worker", label: "Python worker", kind: "task", state: "running", endpoint: null, exitCode: null, signal: null },
    ],
  },
  logs: { storybook: { status: "ready", stdout: "Local: http://127.0.0.1:6006\n", stderr: "", truncated: false } },
  pendingIds: new Set(),
  onRefresh: () => undefined,
  onReadLogs: () => undefined,
  onStop: () => undefined,
  onAcknowledge: () => undefined,
  onOpenEndpoint: () => undefined,
};

const meta = {
  title: "Block/Console/ManagedProcessPanel",
  component: ManagedProcessPanel,
  args: { controller, t: (key, values) => translate("zh-CN", key, values) },
  parameters: { layout: "centered" },
} satisfies Meta<typeof ManagedProcessPanel>;

export default meta;
type Story = StoryObj<typeof meta>;
export const ServiceAndTask: Story = {};
