import type { Meta, StoryObj } from "@storybook/react";

import { AgentMarkdownRevisionTimeline } from "./agent-markdown-revision-timeline";

const meta = {
  title: "Component/Console/AgentMarkdownRevisionTimeline",
  component: AgentMarkdownRevisionTimeline,
  args: {
    memberDisplayName: "开发经理",
    entries: [
      {
        id: "rev-3",
        authorLabel: "官方 v1.3",
        timeLabel: "2026-08-06",
        summary: "收紧了交付汇总的证据要求，保留了你写的返工轮次上限",
        summaryStatus: "ready",
        isLatest: true,
      },
      {
        id: "rev-2",
        authorLabel: "你",
        timeLabel: "2026-08-03",
        summary: "把自动返工上限从三轮改成两轮",
        summaryStatus: "ready",
      },
      {
        id: "rev-1",
        authorLabel: "官方 v1.2",
        timeLabel: "2026-07-28",
        summary: "这支团队的官方初始版本",
        summaryStatus: "ready",
      },
    ],
  },
  decorators: [(Story) => <div className="w-[640px] max-w-[calc(100vw-32px)]"><Story /></div>],
} satisfies Meta<typeof AgentMarkdownRevisionTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThreeRevisions: Story = {};

export const SummaryPendingAndUnavailable: Story = {
  args: {
    entries: [
      {
        id: "rev-2",
        authorLabel: "你",
        timeLabel: "刚刚",
        summary: null,
        summaryStatus: "pending",
        isLatest: true,
      },
      {
        id: "rev-1",
        authorLabel: "你",
        timeLabel: "5 分钟前",
        summary: null,
        summaryStatus: "unavailable",
      },
    ],
  },
};

export const LongTimeline: Story = {
  args: {
    entries: Array.from({ length: 14 }, (_, index) => ({
      id: `rev-${14 - index}`,
      authorLabel: index % 3 === 0 ? "官方 v1." + (4 - Math.floor(index / 5)) : "你",
      timeLabel: `${index + 1} 天前`,
      summary: index % 3 === 0
        ? "官方更新了交付汇总的证据要求"
        : "调整了返工轮次和验收清单的措辞",
      summaryStatus: "ready" as const,
      isLatest: index === 0,
    })),
  },
};

export const Empty: Story = { args: { entries: [] } };

export const Dark: Story = { globals: { theme: "dark" } };

export const ReducedMotion: Story = {
  decorators: [(Story) => (
    <div data-reduced-motion-fixture>
      <style>{"[data-reduced-motion-fixture] *, [data-reduced-motion-fixture] *::before, [data-reduced-motion-fixture] *::after { animation: none !important; transition: none !important; }"}</style>
      <Story />
    </div>
  )],
};

export const NarrowWindow: Story = {
  parameters: {
    viewport: {
      defaultViewport: "timelineNarrow",
      viewports: {
        timelineNarrow: {
          name: "Timeline narrow · 360 × 640",
          styles: { width: "360px", height: "640px" },
        },
      },
    },
  },
};
