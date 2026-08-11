import type { Meta, StoryObj } from "@storybook/react";

import { SessionTeamUpdateNotice } from "./session-team-update-notice";

const meta = {
  title: "Block/Console/SessionTeamUpdateNotice",
  component: SessionTeamUpdateNotice,
  args: {
    state: {
      status: "available",
      categories: [
        { kind: "agent-definition", affectedMemberCount: 2 },
        { kind: "execution-profile", affectedMemberCount: 1 },
        { kind: "team-information", affectedMemberCount: 1 },
      ],
    },
  },
  decorators: [(Story) => <div className="w-[720px] max-w-[calc(100vw-32px)]"><Story /></div>],
} satisfies Meta<typeof SessionTeamUpdateNotice>;

export default meta;
type Story = StoryObj<typeof meta>;
export const ThreeCategories: Story = {};

/** 加上"查看"和"×"两个动作；omit `onView`/`onDismissCategory` 时保持今天只有"应用"的旧行为。 */
export const WithViewAndDismiss: Story = {
  args: {
    onView: () => undefined,
    onDismissCategory: () => undefined,
  },
};
export const Waiting: Story = { args: { state: { status: "waiting", categories: [] } } };
export const Failed: Story = { args: { state: { status: "failed", categories: [], failure: { code: "FAILED", summary: "读取磁盘版本失败。" } } } };
export const Dark: Story = { globals: { theme: "dark" } };
export const NarrowWindow: Story = {
  parameters: {
    viewport: {
      defaultViewport: "teamUpdateNarrow",
      viewports: {
        teamUpdateNarrow: {
          name: "Team update narrow · 360 × 640",
          styles: { width: "360px", height: "640px" },
        },
      },
    },
  },
};
