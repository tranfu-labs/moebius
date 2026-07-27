import type { Meta, StoryObj } from "@storybook/react";

import { AcceptCard, type AcceptanceItem } from "@/console/accept-card";

const sampleItems: AcceptanceItem[] = [
  {
    id: "export-all",
    statement: "跑 export-all -> 产出 12 个文件",
    decision: "pass",
    artifactLabel: "导出结果(12 文件)",
    evidence: "自测通过"
  },
  {
    id: "empty-series",
    statement: "空系列 -> 友好提示且退出码 0",
    decision: "pass",
    evidence: "自测记录第 8 项通过"
  },
  {
    id: "partial-failure",
    statement: "部分失败 -> 跳过并汇总",
    decision: "fail",
    evidence: "失败汇总缺少文件名"
  }
];

const meta = {
  title: "Component/Console/AcceptCard",
  component: AcceptCard,
  args: {
    reviewerLabel: "用户代表",
    summary: "导出时新增实时进度提示；失败文件跳过并计入汇总",
    selfTestSummary: "测试走查 12 项用例全部通过",
    selfTestHref: "#",
    items: sampleItems
  }
} satisfies Meta<typeof AcceptCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MixedDecisions: Story = {};

export const NeutralWaiting: Story = {
  args: {
    items: sampleItems.map((item) => ({ ...item, decision: "pending" }))
  }
};
