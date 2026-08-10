import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";

import { AgentMarkdownMentionEditor } from "./agent-markdown-mention-editor";

const teamMembers = [
  { slug: "dev-manager", displayName: "开发经理" },
  { slug: "dev", displayName: "开发" },
  { slug: "qa", displayName: "测试" },
];

function ControlledEditor(
  props: Omit<Parameters<typeof AgentMarkdownMentionEditor>[0], "onValueChange">,
): JSX.Element {
  const [value, setValue] = useState(props.value);
  return <AgentMarkdownMentionEditor {...props} value={value} onValueChange={setValue} />;
}

const meta = {
  title: "Component/Console/AgentMarkdownMentionEditor",
  component: ControlledEditor,
  args: {
    id: "story-agent-markdown-editor",
    members: teamMembers,
    label: "开发经理 AGENT.md",
    value: "# 开发经理\n\n你负责判断推进方向、验证方案可行性……\n\n方案不成立时直接说不，不进入实现。\n\n交付汇总以真机行为证据开头，列出改动文件与验证方式。",
    changeMarkers: [
      {
        blockIndex: 2,
        authorKind: "user",
        authorLabel: "你",
        timeLabel: "3 天前",
        previousText: "方案不成立时先记录原因，再评估是否强行推进。",
      },
      {
        blockIndex: 3,
        authorKind: "official",
        authorLabel: "官方 v1.3",
        timeLabel: "2026-08-06",
        previousText: "交付汇总列出改动文件。",
      },
    ],
  },
  decorators: [(Story) => <div className="w-[640px] max-w-[calc(100vw-32px)]"><Story /></div>],
} satisfies Meta<typeof ControlledEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PlainNoMarkers: Story = {
  args: {
    value: "# 开发经理\n\n你负责判断推进方向、验证方案可行性……",
  },
};

export const WithChangeMarkers: Story = {};

/** `seeds/general-assistant` 的真实 `AGENT.md` 没有任何 Markdown 标题，切块规则须退化为整份视为一块。 */
export const HeadlessAgentMarkdown: Story = {
  args: {
    value: "处理一般对话与任务，不附加专业职责、固定流程或团队交棒。",
    changeMarkers: [
      {
        blockIndex: 0,
        authorKind: "official",
        authorLabel: "官方 v1.2",
        timeLabel: "这支团队的官方初始版本",
        previousText: null,
      },
    ],
  },
};

export const ReadOnly: Story = {
  args: {
    value: "# 只读团队\n\n这段内容不可编辑。",
    readOnly: true,
  },
};

export const Dark: Story = { globals: { theme: "dark" } };

export const NarrowWindow: Story = {
  parameters: {
    viewport: {
      defaultViewport: "editorNarrow",
      viewports: {
        editorNarrow: {
          name: "Editor narrow · 360 × 640",
          styles: { width: "360px", height: "640px" },
        },
      },
    },
  },
};

export const ReducedMotion: Story = {
  decorators: [(Story) => (
    <div data-reduced-motion-fixture>
      <style>{"[data-reduced-motion-fixture] *, [data-reduced-motion-fixture] *::before, [data-reduced-motion-fixture] *::after { animation: none !important; transition: none !important; }"}</style>
      <Story />
    </div>
  )],
};
