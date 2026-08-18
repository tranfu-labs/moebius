import type { Meta, StoryObj } from "@storybook/react";

import { ProcessTrail, type ProcessStep } from "@/console/process-trail";

const steps: ProcessStep[] = [
  {
    id: "thinking",
    kind: "thinking",
    title: "确认过程步骤的展开边界",
    status: "done",
    input: "先保持时间线可扫读，再让用户按需查看单步输入与结果。",
    output: null,
  },
  {
    id: "command",
    kind: "command",
    title: "构建 console-ui Storybook",
    detail: "pnpm --filter @moebius/console-ui check:storybook",
    status: "done",
    input: "pnpm --filter @moebius/console-ui check:storybook",
    output: "Story catalog check passed\nStorybook static build completed",
  },
  {
    id: "tool",
    kind: "tool",
    title: "检查 Storybook 画布",
    detail: "browser screenshot",
    status: "running",
    input: "block-console-conversationview--relay-running",
    output: null,
  },
  {
    id: "failed",
    kind: "command",
    title: "运行组件测试",
    detail: "process-trail.test.tsx",
    status: "failed",
    input: "pnpm test packages/console-ui/src/console/process-trail.test.tsx",
    output: "FAIL keyboard interaction\nExpected aria-expanded=\"true\"",
    outputRemainingLines: 18,
    error: "exit code 1\n键盘展开状态没有更新",
  },
];

const meta = {
  title: "Component/Console/ProcessTrail",
  component: ProcessTrail,
  args: { steps },
  decorators: [
    (Story) => (
      <div className="w-[720px] rounded-xl border border-line bg-card p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProcessTrail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StepDetails: Story = {
  name: "步骤行与详情",
};

export const CommandReceipt: Story = {
  name: "命令记录 · 完成",
  args: {
    steps: [{
      id: "tag-release",
      kind: "command",
      title: "创建版本标签",
      detail: "git tag v0.4.3",
      status: "done",
      input: "git tag v0.4.3",
      output: "tag v0.4.3 created",
    }],
  },
  play: openOnlyStep,
};

export const LegacyMissingDetails: Story = {
  name: "旧记录 · 详情未记录",
  args: {
    steps: [{ id: "legacy", kind: "tool", title: "调用工具", detail: "read_file", status: "done" }],
  },
  play: openOnlyStep,
};

export const LoadingOutput: Story = {
  name: "加载中 · 等待步骤输出",
  args: {
    steps: [{
      id: "loading",
      kind: "tool",
      title: "生成 changelog",
      detail: "release notes",
      status: "running",
      input: "release notes from v0.4.2..HEAD",
      output: null,
    }],
  },
  play: openOnlyStep,
};

export const FailedStep: Story = {
  name: "报错 · 单步失败",
  args: {
    steps: [{
      id: "failed-test",
      kind: "command",
      title: "运行组件测试",
      detail: "process-trail.test.tsx",
      status: "failed",
      input: "pnpm test process-trail.test.tsx",
      output: "FAIL process-trail.test.tsx\nExpected aria-expanded=\"true\"",
      outputRemainingLines: 18,
      error: "exit code 1\n键盘展开状态没有更新",
    }],
  },
  play: openOnlyStep,
};

export const PermissionDenied: Story = {
  name: "无权限 · 文件步骤失败",
  args: {
    steps: [{
      id: "permission-denied",
      kind: "file",
      title: "读取文件",
      detail: ".env",
      status: "failed",
      input: "/workspace/.env",
      output: "Permission denied",
      error: "没有权限读取该文件",
    }],
  },
  play: openOnlyStep,
};

export const LongContent: Story = {
  name: "超长文本 · 换行与裁剪",
  args: {
    steps: [{
      id: "long-search",
      kind: "search",
      title: "搜索所有仍引用旧过程协议且需要逐项核对迁移边界的实现位置",
      detail: "https://example.test/search?q=process-step-detail-and-historical-output-boundary",
      status: "done",
      input: "process-step-detail OR historical-output-boundary OR provider-native-trace",
      output: Array.from({ length: 12 }, (_, index) => `result-${String(index + 1).padStart(2, "0")} · packages/console-ui/src/console/process-trail.tsx`).join("\n"),
      outputRemainingLines: 37,
    }],
  },
  play: openOnlyStep,
};

async function openOnlyStep({ canvasElement }: { canvasElement: HTMLElement }): Promise<void> {
  const button = canvasElement.querySelector<HTMLButtonElement>("button[aria-expanded='false']");
  if (button === null) throw new Error("ProcessTrail state story requires one collapsed step");
  button.click();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
