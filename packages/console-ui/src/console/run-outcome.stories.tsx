import type { Meta, StoryObj } from "@storybook/react";

import { RunOutcome } from "@/console/run-outcome";

const meta = {
  title: "Component/Console/RunOutcome",
  component: RunOutcome,
  args: {
    status: "run-not-started",
    rawReason: "exit:42",
    rawOutput: "line one\n<failure reason=\"exit\"> & exit:42",
  },
} satisfies Meta<typeof RunOutcome>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Failed: Story = {};

export const Stuck: Story = {
  args: {
    status: "run-stuck",
    rawReason: "idle-timeout:10ms",
    rawOutput: "tail unchanged\nidle-timeout:10ms",
  },
};

export const Interrupted: Story = {
  args: {
    status: "user-stopped",
    rawReason: "interrupted:user",
    rawOutput: "user interruption requested",
  },
};

export const DeadLetter: Story = {
  args: {
    status: "retry-exhausted",
    rawReason: "dead-letter:max-retries",
    rawOutput: "attempt 5 failed\nexit:42",
  },
};
