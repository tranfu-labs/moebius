import type { Meta, StoryObj } from "@storybook/react";

import { Badge } from "@/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/card";

const meta = {
  title: "Component/UI/Card",
  component: Card
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ConsolePanel: Story = {
  render: () => (
    <Card className="max-w-md">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>运行记录</CardTitle>
          <Badge variant="pass">开发</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-sub">
        <p>已完成 2 步，正在运行测试。</p>
        <p className="rounded-lg bg-sunken p-2 font-mono text-xs text-hint">pnpm test</p>
      </CardContent>
    </Card>
  )
};
