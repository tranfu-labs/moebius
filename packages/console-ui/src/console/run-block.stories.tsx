import type { Meta, StoryObj } from "@storybook/react";

import { RunBlock, type RunBlockStep } from "@/console/run-block";

const steps: RunBlockStep[] = [
  {
    id: "agent",
    title: "写 agent 折叠消息",
    status: "completed",
    summary: "已完成默认提取和显式覆盖。",
    rawOutput: "created agent-message.tsx\nPASS agent-message.test.tsx",
  },
  {
    id: "run",
    title: "运行组件测试",
    status: "running",
    summary: "正在验证键盘展开和中断回调。",
    rawOutput: "RUNS run-block.test.tsx\nraw output includes exit:42",
  },
  {
    id: "story",
    title: "Storybook 走查",
    status: "pending",
    summary: "等待静态构建完成。",
  },
];

const meta = {
  title: "Block/Console/RunBlock",
  component: RunBlock,
  args: {
    appearance: "focused",
    variant: "main",
    role: "dev",
    elapsedTime: "3分12秒",
    steps,
  },
} satisfies Meta<typeof RunBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithSteps: Story = { name: "页面同款 · 分步运行" };

export const WithoutSteps: Story = {
  name: "页面同款 · 无步骤运行",
  args: {
    steps: [],
    summary: "正在运行测试 · 已进行 3 分 12 秒",
    rawOutput: "pnpm --filter @moebius/console-ui test\nstdout tail is hidden until expanded",
  },
};

export const MissingPresentationData: Story = {
  name: "降级 · 缺少展示数据",
  args: {
    elapsedTime: "   ",
    steps: undefined,
    summary: "  ",
    rawOutput: undefined,
  },
};
