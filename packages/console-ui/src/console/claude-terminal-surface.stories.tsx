import type { Meta, StoryObj } from "@storybook/react";

import { I18nProvider } from "@/i18n";
import {
  ClaudeTerminalSurface,
  type OperatorClaudeTerminalTraceState,
} from "./claude-terminal-surface";

function SurfaceStory({ trace = liveTrace }: { trace?: OperatorClaudeTerminalTraceState }): JSX.Element {
  return (
    <I18nProvider locale="zh-CN">
      <div className="max-w-[720px] p-4">
        <ClaudeTerminalSurface trace={trace} />
      </div>
    </I18nProvider>
  );
}

const meta = {
  title: "Component/Console/ClaudeTerminalSurface",
  component: SurfaceStory,
} satisfies Meta<typeof SurfaceStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Live: Story = {};
export const Connecting: Story = {
  args: { trace: { status: "connecting", chunks: [], nextCursor: 0 } },
};
export const Dark: Story = { globals: { theme: "dark" } };
export const Narrow: Story = {
  parameters: {
    viewport: {
      defaultViewport: "claudeTerminalNarrow",
      viewports: {
        claudeTerminalNarrow: {
          name: "Claude terminal narrow · 360 × 640",
          styles: { width: "360px", height: "640px" },
        },
      },
    },
  },
};

const liveTrace: OperatorClaudeTerminalTraceState = {
  status: "ready",
  chunks: [
    { cursor: 0, dataBase64: "G1sySg==" },
    { cursor: 1, dataBase64: "V2VsY29tZSB0byBDbGF1ZGUgQ29kZQ0KDQrilo4g" },
  ],
  nextCursor: 2,
};
