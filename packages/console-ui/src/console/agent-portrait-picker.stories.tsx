import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { AgentPortraitPicker } from "./agent-portrait-picker";
import { PORTRAIT_IDS, type PortraitId } from "./agent-portrait";

const meta = {
  title: "Component/Console/AgentPortraitPicker",
  component: AgentPortraitPicker,
  args: {
    displayName: "软件测试",
    slug: "qa",
    portraitId: null,
    engine: { cli: "codex" as const },
    onChange: () => {},
  },
  decorators: [(Story) => <div className="p-6"><Story /></div>],
} satisfies Meta<typeof AgentPortraitPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The default face, straight off the slug — no choice stored yet, so "restore" is inert. */
export const OnSlugDefault: Story = {};

export const Interactive: Story = {
  render: (args) => {
    const [portraitId, setPortraitId] = useState<string | null>(null);
    return (
      <div className="flex items-center gap-3">
        <AgentPortraitPicker {...args} portraitId={portraitId} onChange={setPortraitId} />
        <span className="text-sm text-sub">
          {portraitId === null ? "跟随默认" : `已选 ${portraitId}`}
        </span>
      </div>
    );
  },
};

/** Read-only teams still show the portrait; it just stops being a trigger. */
export const Disabled: Story = {
  args: { disabled: true },
};

/**
 * Four members of one team, so the shared background colour per member and the face variety
 * across members can be judged together rather than one avatar at a time.
 */
export const AcrossOneTeam: Story = {
  render: () => {
    const members = [
      { slug: "dev-manager", displayName: "技术负责人", portraitId: null },
      { slug: "dev", displayName: "开发", portraitId: PORTRAIT_IDS[4]! },
      { slug: "qa", displayName: "软件测试", portraitId: null },
      { slug: "product-manager", displayName: "产品", portraitId: PORTRAIT_IDS[21]! },
    ];
    return (
      <div className="grid gap-4">
        {members.map((member) => (
          <TeamRow key={member.slug} {...member} />
        ))}
      </div>
    );
  },
};

function TeamRow({
  slug,
  displayName,
  portraitId: initial,
}: {
  slug: string;
  displayName: string;
  portraitId: PortraitId | null;
}): JSX.Element {
  const [portraitId, setPortraitId] = useState<string | null>(initial);
  return (
    <div className="flex items-center gap-3">
      <AgentPortraitPicker
        displayName={displayName}
        slug={slug}
        portraitId={portraitId}
        engine={{ cli: "codex" }}
        onChange={setPortraitId}
      />
      <div className="min-w-0">
        <p className="text-sm text-ink">{displayName}</p>
        <p className="text-xs text-hint">@{slug}</p>
      </div>
    </div>
  );
}
