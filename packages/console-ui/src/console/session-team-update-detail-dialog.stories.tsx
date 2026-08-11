import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";

import { SessionTeamUpdateDetailDialog, type SessionTeamUpdateDetailView } from "./session-team-update-detail-dialog";

const view: SessionTeamUpdateDetailView = {
  teamName: "开发团队",
  members: [
    {
      memberSlug: "dev-manager",
      displayName: "开发经理",
      changes: [{
        summary: "交付汇总以真机行为证据开头……",
        authorLabel: "官方 v1.3",
        previousText: "交付汇总列出改动文件",
      }],
    },
    {
      memberSlug: "qa",
      displayName: "测试",
      changes: [{
        summary: "把自动返工上限从三轮改成两轮",
        authorLabel: "你 · 3 天前",
        previousText: null,
      }],
    },
  ],
};

function Controlled(): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <>
      {!open ? <button type="button" onClick={() => setOpen(true)}>重新打开</button> : null}
      <SessionTeamUpdateDetailDialog
        open={open}
        view={view}
        onOpenChange={setOpen}
        onCancel={() => setOpen(false)}
        onApply={() => setOpen(false)}
      />
    </>
  );
}

const meta = {
  title: "Component/Console/SessionTeamUpdateDetailDialog",
  component: Controlled,
} satisfies Meta<typeof Controlled>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwoMembers: Story = {};
export const Dark: Story = { globals: { theme: "dark" } };
export const NarrowWindow: Story = {
  parameters: {
    viewport: {
      defaultViewport: "detailDialogNarrow",
      viewports: {
        detailDialogNarrow: {
          name: "Detail dialog narrow · 360 × 640",
          styles: { width: "360px", height: "640px" },
        },
      },
    },
  },
};
