import type { Meta, StoryObj } from "@storybook/react";

import {
  RunBlock,
  type OperatorNativePromptDecision,
  type RunBlockStep,
} from "@/console/run-block";

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

export const EmbeddedProcessTrail: Story = {
  name: "右侧栏 · 过程步骤",
  args: {
    variant: "embedded",
    steps: [],
    elapsedTime: "47秒",
    activity: { action: "正在生成发布说明", object: "v0.4.3" },
    processSteps: [
      {
        id: "embedded-done",
        kind: "command",
        title: "核对版本号",
        detail: "package.json",
        status: "done",
        input: "node -p \"require('./package.json').version\"",
        output: "0.4.3",
      },
      {
        id: "embedded-running",
        kind: "tool",
        title: "生成 changelog",
        status: "running",
        input: "v0.4.2..HEAD",
        output: null,
      },
      {
        id: "embedded-failed",
        kind: "file",
        title: "读取发布目录",
        detail: "release/",
        status: "failed",
        input: "/workspace/release",
        output: "Permission denied",
        error: "没有权限读取该目录",
      },
    ],
  },
};

const nativePromptDecision: OperatorNativePromptDecision = {
  sessionId: "story-session",
  decisionId: "story-decision",
  options: [
    { number: 1, label: "Resume from summary (recommended)", raw: "1. Resume from summary (recommended)" },
    { number: 2, label: "Resume full session as-is", raw: "2. Resume full session as-is" },
    { number: 3, label: "Don't ask me again", raw: "3. Don't ask me again" },
  ],
};

export const WaitingForNativeConfirmation: Story = {
  name: "Claude · 等待原生确认",
  args: {
    elapsedTime: undefined,
    elapsedMs: 84_000,
    processSteps: [
      {
        id: "before-native-prompt",
        kind: "tool",
        title: "读取 transcript",
        detail: "claude",
        status: "done",
      },
    ],
    nativePromptDecision,
    onSelectNativePrompt: () => undefined,
    onOpenClaudeTerminalDiagnostics: () => undefined,
  },
};
