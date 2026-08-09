import type { Meta, StoryObj } from "@storybook/react";

import { RunOutcome } from "@/console/run-outcome";

const meta = {
  title: "Component/Console/RunOutcome",
  component: RunOutcome,
  args: {
    status: "run-not-started",
    rawReason: "exit:42",
  },
} satisfies Meta<typeof RunOutcome>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Failed: Story = {};

export const Stuck: Story = {
  args: {
    status: "run-stuck",
    rawReason: "idle-timeout:10ms",
  },
};

export const Interrupted: Story = {
  args: {
    status: "user-stopped",
    rawReason: "interrupted:user",
  },
};

export const DeadLetter: Story = {
  args: {
    status: "retry-exhausted",
    rawReason: "dead-letter:max-retries",
  },
};
