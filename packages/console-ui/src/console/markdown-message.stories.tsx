import type { Meta, StoryObj } from "@storybook/react";

import { MarkdownMessage } from "@/console/markdown-message";

const capabilityMarkdown = `# Markdown 能力矩阵

中文 **强调**、~~删除线~~、[安全外链](https://streamdown.ai) 与行内代码 \`const ready = true\`。

> 用户消息和 Agent 消息共用同一套渲染器。

- [x] GFM 任务
- [x] CJK 标点边界

| 能力 | 状态 |
| --- | --- |
| Streamdown | 已接入 |
| 原地流式 | 单一活动节点 |

\`\`\`ts
export const messageCount = 1;
\`\`\`

$$
E = mc^2
$$

\`\`\`mermaid
flowchart LR
  Event[JSONL events] --> Active[one active bubble]
  Active --> Final[one final message]
\`\`\`
`;

const meta = {
  title: "Component/Console/MarkdownMessage",
  component: MarkdownMessage,
  parameters: { layout: "padded" },
  args: {
    content: capabilityMarkdown,
    mode: "static",
    onOpenExternalLink: () => undefined,
  },
  decorators: [
    (Story) => <div className="mx-auto max-w-[760px] bg-canvas p-6"><Story /></div>,
  ],
} satisfies Meta<typeof MarkdownMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CapabilityMatrix: Story = {};

export const LiveReplacement: Story = {
  args: {
    content: "## 正在验证\n\n- 已解析用户 Markdown\n- 正在生成最终答复",
    density: "live",
    mode: "streaming",
  },
};
