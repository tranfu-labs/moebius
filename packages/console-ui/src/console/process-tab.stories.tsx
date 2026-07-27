import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import {
  ProcessTab,
  type OperatorProcessOutput,
  type OperatorProcessOutputState,
} from "@/console/process-tab";

const meta = {
  title: "Block/Console/ProcessTab",
  component: ProcessTabStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ProcessTabStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LongHistoryAtLatest: Story = {};

export const LiveFollowing: Story = {
  args: { live: true },
};

export const Unavailable: Story = {
  args: { unavailable: true },
};

function ProcessTabStory({
  unavailable = false,
  live = false,
}: {
  unavailable?: boolean;
  live?: boolean;
}): JSX.Element {
  const [extraEvents, setExtraEvents] = useState(0);
  const state: OperatorProcessOutputState = unavailable
    ? unavailableState
    : live
      ? {
          status: "ready",
          output: {
            ...longHistoryOutput,
            status: "running",
            events: [
              ...longHistoryOutput.events,
              ...Array.from({ length: extraEvents }, (_, index) => ({
                key: `live-${String(index)}`,
                kind: "agent-output" as const,
                timestamp: "2026-07-23T09:00:00.000Z",
                protocolType: "response_item · message",
                rawPayload: "{}",
                output: `实时追加第 ${String(index + 1)} 条事件。`,
              })),
            ],
          },
        }
      : longHistoryState;
  return (
    <main className="relative flex h-screen justify-end bg-canvas">
      {live ? (
        <button
          id="append-process-event"
          type="button"
          className="absolute left-6 top-6 rounded-md border border-line bg-card px-3 py-2 text-sm text-ink"
          onClick={() => setExtraEvents((current) => current + 1)}
        >
          追加过程事件
        </button>
      ) : null}
      <div
        id="process-story-scroll"
        className="scroll-thin h-screen w-[460px] overflow-auto border-l border-line bg-canvas"
      >
        <ProcessTab
          title="开发"
          state={state}
        />
      </div>
    </main>
  );
}

const longHistoryOutput: OperatorProcessOutput = {
  sessionId: "story-session",
  requestedRunId: "story-run",
  role: "dev",
  status: "settled",
  unavailableReason: null,
  attempts: [{
    runId: "story-run",
    attempt: 1,
    role: "dev",
    engine: "codex",
    model: "gpt-5",
    effort: "high",
    provider: "openai",
    cliVersion: "1.2.3",
    metadataSource: "immutable-context",
    threadId: "story-thread",
    startedAt: "2026-07-23T08:00:00.000Z",
    status: "completed",
  }],
  events: [
    {
      key: "attempt-1",
      kind: "attempt-header",
      runId: "story-run",
      attempt: 1,
      role: "dev",
      engine: "codex",
      model: "gpt-5",
      effort: "high",
      provider: "openai",
      cliVersion: "1.2.3",
      metadataSource: "immutable-context",
      threadId: "story-thread",
      startedAt: "2026-07-23T08:00:00.000Z",
      status: "completed",
    },
    {
      key: "execution-1",
      kind: "execution-header",
      runId: "story-run",
      attempt: 1,
    },
    ...Array.from({ length: 220 }, (_, index) => processStoryEvent(index)),
  ],
  previousCursor: null,
  appendCursor: null,
  atLatest: true,
};

const longHistoryState: OperatorProcessOutputState = {
  status: "ready",
  output: longHistoryOutput,
};

const unavailableState: OperatorProcessOutputState = {
  status: "ready",
  output: {
    sessionId: "story-session",
    requestedRunId: "missing-run",
    role: "dev",
    status: "unavailable",
    unavailableReason: "not-found",
    attempts: [],
    events: [],
    previousCursor: null,
    appendCursor: null,
    atLatest: true,
  },
};

function processStoryEvent(index: number) {
  const ordinal = index + 1;
  const timestamp = `2026-07-23T08:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`;
  if (index % 11 === 0) {
    return {
      key: `command-${String(index)}`,
      kind: "command" as const,
      timestamp,
      protocolType: "response_item · command_execution",
      rawPayload: "{}",
      phase: "completed" as const,
      name: "command_execution",
      callId: `call-${String(index)}`,
      status: "completed",
      input: "pnpm exec vitest run src/login-page.test.tsx",
      output: `第 ${String(ordinal)} 轮检查通过`,
      exitCode: 0,
    };
  }
  if (index % 7 === 0) {
    return {
      key: `tool-${String(index)}`,
      kind: "tool" as const,
      timestamp,
      protocolType: "response_item · function_call_output",
      rawPayload: "{}",
      phase: "completed" as const,
      name: "读取文件",
      callId: `call-${String(index)}`,
      input: "src/login-page.tsx",
      output: "已读取并核对组件状态。",
      status: "completed",
    };
  }
  if (index % 5 === 0) {
    return {
      key: `file-${String(index)}`,
      kind: "file" as const,
      timestamp,
      protocolType: "event_msg · patch_apply_end",
      rawPayload: "{}",
      action: "修改文件",
      path: "src/login-page.tsx",
      detail: "调整空状态文案与按钮禁用条件。",
    };
  }
  return {
    key: `agent-${String(index)}`,
    kind: "agent-output" as const,
    timestamp,
    protocolType: "response_item · message",
    rawPayload: "{}",
    output: `正在核对第 ${String(ordinal)} 个交互状态，当前结果保持一致。`,
  };
}
