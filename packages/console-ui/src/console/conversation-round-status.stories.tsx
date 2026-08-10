import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { I18nProvider } from "@/i18n";
import {
  ConversationRoundStatusList,
  type ConversationRoundStatusListProps,
  type ConversationRoundStatusRow,
} from "./conversation-round-status";

const occlusionMatrix: readonly ConversationRoundStatusRow[] = [
  { id: "awaiting-you", title: "发布前检查", dot: "red" },
  { id: "awaiting-you-2", title: "落地页文案", dot: "red" },
  { id: "new-result-unread", title: "集成收尾", dot: "blue" },
  { id: "new-result-unread-2", title: "分享卡片", dot: "blue" },
  { id: "in-progress", title: "导出功能重构", dot: "blink" },
  { id: "in-progress-2", title: "官网空状态", dot: "blink" },
  { id: "viewed", title: "需求梳理", dot: "none" },
  { id: "no-new-content", title: "文案打磨", dot: "none" },
];

function CollapsedProjectJourney({ initial }: { initial: ConversationRoundStatusListProps }): JSX.Element {
  const [collapsed, setCollapsed] = useState(initial.projectCollapsed ?? true);
  return (
    <ConversationRoundStatusList
      {...initial}
      projectCollapsed={collapsed}
      onToggleProject={() => setCollapsed((current) => !current)}
    />
  );
}

const meta = {
  title: "Block/Console/ConversationRoundStatus",
  component: ConversationRoundStatusList,
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
  args: {
    rows: occlusionMatrix,
    dockCount: 4,
    projectStatus: null,
  },
} satisfies Meta<typeof ConversationRoundStatusList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OcclusionMatrix: Story = {};

export const CollapsedProjectAggregation: Story = {
  render: () => (
    <CollapsedProjectJourney
      initial={{
        rows: [
          occlusionMatrix[0]!,
          occlusionMatrix[2]!,
        ],
        dockCount: 2,
        projectStatus: "red",
        projectCollapsed: true,
      }}
    />
  ),
};

export const EnglishOcclusionMatrix: Story = {
  decorators: [
    (Story) => (
      <I18nProvider locale="en">
        <Story />
      </I18nProvider>
    ),
  ],
};
