import type { Meta, StoryObj } from "@storybook/react";

import { AgentRunInfoPopover } from "./agent-run-info-popover";

const meta: Meta<typeof AgentRunInfoPopover> = {
  title: "Component/Console/AgentRunInfoPopover",
  component: AgentRunInfoPopover,
  args: {
    sessionId: "session-a", runId: "run-a", role: "implementation-lead", displayName: "实现负责人",
    loadInfo: async () => ({
      sessionId: "session-a", runId: "run-a", role: "implementation-lead",
      agent: { slug: "implementation-lead", displayName: "实现负责人", description: "生产实现" },
      team: { name: "产品交付团队", ownership: "system", sourceName: "Moebius" },
      profile: { cli: "codex", model: "gpt-5", effort: "high" },
      loadedAt: "2026-08-04T10:00:00.000Z", evidence: "executed",
    }),
    loadMarkdown: async () => ({ markdown: "# 角色\n\n负责生产实现。" }),
  },
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof meta>;
export const Executed: Story = {};
export const PlannedNotStarted: Story = {
  args: {
    loadInfo: async () => ({
      sessionId: "session-a", runId: "run-a", role: "implementation-lead",
      agent: { slug: "implementation-lead", displayName: "实现负责人", description: "生产实现" },
      team: { name: "产品交付团队", ownership: "system", sourceName: "Moebius" },
      profile: { cli: "codex", model: "gpt-5", effort: "high" },
      loadedAt: "2026-08-04T10:00:00.000Z", evidence: "planned-not-started",
    }),
  },
};
export const BoundStartUnknown: Story = {
  args: {
    loadInfo: async () => ({
      sessionId: "session-a", runId: "run-a", role: "implementation-lead",
      agent: { slug: "implementation-lead", displayName: "实现负责人", description: "生产实现" },
      team: { name: "产品交付团队", ownership: "system", sourceName: "Moebius" },
      profile: { cli: "codex", model: "gpt-5", effort: "high" },
      loadedAt: "2026-08-04T10:00:00.000Z", evidence: "bound-start-unknown",
    }),
  },
};
export const LegacyMissingFacts: Story = {
  args: {
    loadInfo: async () => ({
      sessionId: "session-a", runId: "run-a", role: "implementation-lead",
      agent: { slug: "implementation-lead", displayName: null, description: null },
      team: { name: null, ownership: null, sourceName: null },
      profile: null,
      loadedAt: null, evidence: "bound-start-unknown",
    }),
  },
};

export const Dark: Story = {
  globals: { theme: "dark" },
};

export const NarrowWindow: Story = {
  parameters: {
    viewport: {
      defaultViewport: "agentAuditNarrow",
      viewports: {
        agentAuditNarrow: {
          name: "Agent audit narrow · 360 × 640",
          styles: { width: "360px", height: "640px" },
        },
      },
    },
  },
};
