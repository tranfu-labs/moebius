import type { Meta, StoryObj } from "@storybook/react";

import { AgentMessage } from "@/console/agent-message";

const rawMarkdown = [
  "## 结论",
  "消息、运行块和错误结局已按 Linear 扁平语言拆成独立组件。",
  "",
  "## 依据",
  "- packages/console-ui/src/console/agent-message.tsx",
  "- packages/console-ui/src/console/run-block.tsx",
  "",
  "## 下一步",
  "交棒：@qa 请按验收语句走查",
  "",
  "<!-- moebius:stage=plan-written -->",
].join("\n");

const meta = {
  title: "Component/Console/AgentMessage",
  component: AgentMessage,
  args: {
    role: "dev",
    rawMarkdown,
    timestamp: "09:36",
  },
} satisfies Meta<typeof AgentMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {};

export const Expanded: Story = {
  args: {
    defaultOpen: true,
  },
};

export const ExplicitOverrides: Story = {
  args: {
    stage: "code-verified",
    conclusion: "显式字段优先显示，原始 Markdown 仍完整保留。",
    handoff: "交给「产品」确认验收",
  },
};

export const InboxStream: Story = {
  render: () => (
    <div className="max-w-[720px]">
      <AgentMessage role="dev" rawMarkdown={rawMarkdown} timestamp="09:41" />
      <AgentMessage
        role="qa"
        rawMarkdown={[
          "## 结论",
          "方案可测性良好，建议补充空状态验收语句。",
          "",
          "## 下一步",
          "交棒：@dev 补充验收语句",
          "",
          "<!-- moebius:stage=in-progress -->",
        ].join("\n")}
        timestamp="09:44"
      />
      <AgentMessage
        role="product-manager"
        rawMarkdown={[
          "## 结论",
          "三条验收语句全部通过，可进入发布流程。",
          "",
          "## 下一步",
          "等待真人：确认发布",
          "",
          "<!-- moebius:stage=code-verified -->",
        ].join("\n")}
        timestamp="10:02"
      />
    </div>
  ),
};
