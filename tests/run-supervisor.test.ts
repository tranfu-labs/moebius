import { describe, expect, it } from "vitest";

import {
  createClaudeTranscriptProjectionState,
  createClaudeToolProjectionState,
  createProviderToolProjectionState,
  executionInterruptionActor,
  executionInterruptionCause,
  projectClaudeProgress,
  projectClaudeTranscriptProgress,
  projectClaudeToolLifecycle,
  projectCodexProgress,
  projectCodexToolLifecycle,
  projectKimiProgress,
  projectKimiToolLifecycle,
  selectClaudeExecutionProgress,
  selectCodexExecutionProgress,
  selectKimiExecutionProgress,
} from "../src/execution-contract.js";
import {
  createRunSupervisorState,
  observeRunProgress,
  settleRunSupervisorTools,
} from "../src/run-supervisor.js";

describe("execution progress contract", () => {
  it("normalizes interruption actor and cause at the adapter boundary", () => {
    expect(executionInterruptionCause("user-interrupted")).toBe("user");
    expect(executionInterruptionActor("user-interrupted")).toBe("user");
    expect(executionInterruptionCause("runtime-closing")).toBe("runtime-closing");
    expect(executionInterruptionCause("user-redirected-active-agent")).toBe("redirect");
    expect(executionInterruptionCause("project-directory-unavailable")).toBe("context-unavailable");
    expect(executionInterruptionActor("project-directory-unavailable")).toBe("system");
  });

  it("maps semantic progress for all three engines", () => {
    expect(projectCodexProgress({
      type: "item.completed",
      item: { type: "agent_message", text: "done" },
    }, 1)).toMatchObject({ kind: "assistant-output", delta: "done" });
    expect(projectClaudeProgress({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "checking" },
      },
    }, 2)).toMatchObject({ kind: "reasoning-output", delta: "checking" });
    expect(projectKimiToolLifecycle({
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
      },
    }, 3, {
      nextOccurrence: 2,
      activeByProviderId: new Map([["tool-1", "kimi-tool:1"]]),
      anonymousQueue: [],
    }).progress).toMatchObject({ kind: "tool-finished", toolId: "kimi-tool:1" });
  });

  it("prefers tool lifecycle progress and otherwise projects provider progress", () => {
    const toolProgress = { kind: "tool-started", toolId: "tool-1", toolKind: "read", sequence: 1 } as const;
    expect(selectCodexExecutionProgress(toolProgress, {}, 2)).toBe(toolProgress);
    expect(selectClaudeExecutionProgress(null, {
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } },
    }, 2)).toEqual({ kind: "assistant-output", delta: "hello", sequence: 2 });
    expect(selectKimiExecutionProgress(null, {
      update: { sessionUpdate: "agent_thought_chunk", content: { thought: "checking" } },
    }, 3)).toEqual({ kind: "reasoning-output", delta: "checking", sequence: 3 });
  });

  it("keeps Kimi chatter and retries separate from true progress", () => {
    expect(projectKimiProgress({
      update: { sessionUpdate: "config_option_update" },
    }, 1)).toEqual({ kind: "config", sequence: 1 });
    expect(projectKimiProgress({
      update: { sessionUpdate: "plan", message: "still planning" },
    }, 2)).toEqual({ kind: "status", sequence: 2 });
    expect(projectClaudeProgress({
      type: "stream_event",
      event: { type: "content_block_stop", index: 0, id: "tool-should-remain-active" },
    }, 3)).toEqual({ kind: "status", sequence: 3 });
    expect(projectKimiProgress({
      update: {
        sessionUpdate: "status",
        message: "engine overloaded, retry attempt 3",
      },
    }, 4)).toEqual({
      kind: "provider-retry",
      retryKind: "service",
      attempt: 3,
      sequence: 4,
    });
  });

  it("keeps a Claude tool in flight across content_block_stop until tool_result", () => {
    let projection = createClaudeToolProjectionState();
    const started = projectClaudeToolLifecycle({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 2,
        content_block: { type: "tool_use", id: "tool-2", name: "Bash" },
      },
    }, 1, projection);
    projection = started.state;
    expect(started.progress).toMatchObject({
      kind: "tool-started",
      toolId: "claude-tools-in-flight",
    });

    const blockStopped = projectClaudeToolLifecycle({
      type: "stream_event",
      event: { type: "content_block_stop", index: 2 },
    }, 2, projection);
    projection = blockStopped.state;
    expect(blockStopped.progress).toBeNull();
    expect(projection.toolIdsByBlock.get(2)).toBe("tool-2");

    const finished = projectClaudeToolLifecycle({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "tool-2", content: "done" }],
      },
    }, 3, projection);
    expect(finished.progress).toMatchObject({
      kind: "tool-finished",
      toolId: "claude-tools-in-flight",
    });
    expect(finished.state.toolIdsByBlock.size).toBe(0);
  });

  it("keeps the Claude tool group active until every parallel result arrives", () => {
    let projection = createClaudeToolProjectionState();
    projection = projectClaudeToolLifecycle({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "tool-a", name: "Bash" },
      },
    }, 1, projection).state;
    projection = projectClaudeToolLifecycle({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 2,
        content_block: { type: "tool_use", id: "tool-b", name: "Read" },
      },
    }, 2, projection).state;

    const partial = projectClaudeToolLifecycle({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "tool-a", content: "done" }],
      },
    }, 3, projection);
    projection = partial.state;
    expect(partial.progress).toEqual({ kind: "status", sequence: 3 });
    expect(projection.toolIdsByBlock.get(2)).toBe("tool-b");

    const finished = projectClaudeToolLifecycle({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "tool-b", content: "done" }],
      },
    }, 4, projection);
    expect(finished.progress).toMatchObject({
      kind: "tool-finished",
      toolId: "claude-tools-in-flight",
    });
    expect(finished.state.toolIdsByBlock.size).toBe(0);
  });

  it("projects persisted Claude thinking and two tool calls without publishing text", () => {
    let projection = createClaudeTranscriptProjectionState();
    const first = projectClaudeTranscriptProgress({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "inspect the workspace" },
          { type: "tool_use", id: "transcript-tool-1", name: "Read" },
        ],
      },
    }, 1, projection);
    projection = first.state;
    expect(first.progress).toEqual([
      { kind: "reasoning-output", delta: "inspect the workspace", sequence: 1 },
      { kind: "tool-started", toolId: "claude-transcript:transcript-tool-1", toolKind: "Read", sequence: 2 },
    ]);

    const second = projectClaudeTranscriptProgress({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "transcript-tool-2", name: "Bash" }],
      },
    }, first.nextSequence, projection);
    projection = second.state;
    expect(second.progress).toEqual([
      { kind: "tool-started", toolId: "claude-transcript:transcript-tool-2", toolKind: "Bash", sequence: 3 },
    ]);

    const finished = projectClaudeTranscriptProgress({
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "transcript-tool-1", content: "done" },
          { type: "tool_result", tool_use_id: "transcript-tool-2", content: "done" },
        ],
      },
    }, second.nextSequence, projection);
    expect(finished.progress).toEqual([
      { kind: "tool-finished", toolId: "claude-transcript:transcript-tool-1", toolKind: "Read", sequence: 4 },
      { kind: "tool-finished", toolId: "claude-transcript:transcript-tool-2", toolKind: "Bash", sequence: 5 },
    ]);
    expect(finished.state.activeTools.size).toBe(0);

    expect(projectClaudeTranscriptProgress({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "final body" }],
        usage: { output_tokens: 3 },
      },
    }, finished.nextSequence, finished.state).progress).toEqual([]);
  });

  it("pairs missing tool ids by occurrence and permits provider id reuse", () => {
    let codex = createProviderToolProjectionState();
    const anonymousStart = projectCodexToolLifecycle({
      type: "item.started",
      item: { type: "command_execution" },
    }, 1, codex);
    codex = anonymousStart.state;
    const anonymousFinish = projectCodexToolLifecycle({
      type: "item.completed",
      item: { type: "command_execution" },
    }, 2, codex);
    codex = anonymousFinish.state;
    expect(anonymousStart.progress).toMatchObject({
      kind: "tool-started",
      toolId: "codex-tool:1",
    });
    expect(anonymousFinish.progress).toMatchObject({
      kind: "tool-finished",
      toolId: "codex-tool:1",
    });
    expect(codex.anonymousQueue).toHaveLength(0);

    const firstStart = projectCodexToolLifecycle({
      type: "item.started",
      item: { id: "reused", type: "command_execution" },
    }, 3, codex);
    const firstFinish = projectCodexToolLifecycle({
      type: "item.completed",
      item: { id: "reused", type: "command_execution" },
    }, 4, firstStart.state);
    const secondStart = projectCodexToolLifecycle({
      type: "item.started",
      item: { id: "reused", type: "command_execution" },
    }, 5, firstFinish.state);
    expect(firstStart.progress).toMatchObject({ toolId: "codex-tool:2" });
    expect(firstFinish.progress).toMatchObject({ toolId: "codex-tool:2" });
    expect(secondStart.progress).toMatchObject({
      kind: "tool-started",
      toolId: "codex-tool:3",
    });
  });

  it("pairs Kimi tool updates without ids through its FIFO", () => {
    let projection = createProviderToolProjectionState();
    const started = projectKimiToolLifecycle({
      update: { sessionUpdate: "tool_call", title: "run tests" },
    }, 1, projection);
    projection = started.state;
    const finished = projectKimiToolLifecycle({
      update: { sessionUpdate: "tool_call_update", status: "completed" },
    }, 2, projection);
    expect(started.progress).toMatchObject({ toolId: "kimi-tool:1" });
    expect(finished.progress).toMatchObject({
      kind: "tool-finished",
      toolId: "kimi-tool:1",
    });
    expect(finished.state.anonymousQueue).toHaveLength(0);
  });
});

describe("semantic run supervisor", () => {
  it("does not let heartbeat/config chatter count as progress and records busy separately", () => {
    let state = createRunSupervisorState(0);
    state = observeRunProgress(state, { kind: "heartbeat", sequence: 1 }, 50_000).state;
    state = observeRunProgress(state, { kind: "config", sequence: 2 }, 80_000).state;
    expect(state.lastProgressAt).toBe(0);

    state = observeRunProgress(state, {
      kind: "provider-retry",
      retryKind: "service",
      attempt: 2,
      sequence: 3,
    }, 90_000).state;

    expect(state.lastProgressAt).toBe(0);
    expect(state.busySince).toBe(90_000);
  });

  it("refreshes only unique semantic progress and clears a busy phase", () => {
    let state = createRunSupervisorState(0);
    state = observeRunProgress(state, {
      kind: "provider-retry",
      retryKind: "service",
      attempt: 1,
      sequence: 1,
    }, 10_000).state;
    state = observeRunProgress(state, {
      kind: "tool-started",
      toolId: "tool-1",
      toolKind: "shell",
      sequence: 2,
    }, 20_000).state;
    const duplicate = observeRunProgress(state, {
      kind: "tool-started",
      toolId: "tool-1",
      toolKind: "shell",
      sequence: 3,
    }, 40_000);

    expect(state.lastProgressAt).toBe(20_000);
    expect(state.busySince).toBeNull();
    expect(state.activeToolIds).toEqual(new Set(["tool-1"]));
    expect(duplicate.kind).toBe("none");
    expect(duplicate.state.lastProgressAt).toBe(20_000);
  });

  it("keeps tools active until the matching finish and ignores unrelated finishes", () => {
    let state = createRunSupervisorState(0);
    state = observeRunProgress(state, {
      kind: "tool-started",
      toolId: "slow-test",
      toolKind: "command",
      sequence: 1,
    }, 100).state;
    state = observeRunProgress(state, {
      kind: "tool-finished",
      toolId: "other",
      toolKind: "command",
      sequence: 2,
    }, 200).state;
    expect(state.activeToolIds).toEqual(new Set(["slow-test"]));
    state = observeRunProgress(state, {
      kind: "tool-finished",
      toolId: "slow-test",
      toolKind: "command",
      sequence: 3,
    }, 300).state;
    expect(state.activeToolIds.size).toBe(0);
  });

  it("accepts the same projected tool id again after its prior lifecycle ends", () => {
    let state = createRunSupervisorState(0);
    state = observeRunProgress(state, {
      kind: "tool-started",
      toolId: "provider-reused",
      toolKind: "command",
      sequence: 1,
    }, 100).state;
    state = observeRunProgress(state, {
      kind: "tool-finished",
      toolId: "provider-reused",
      toolKind: "command",
      sequence: 2,
    }, 200).state;
    const reused = observeRunProgress(state, {
      kind: "tool-started",
      toolId: "provider-reused",
      toolKind: "command",
      sequence: 3,
    }, 300);
    expect(reused.kind).toBe("progress-observed");
    expect(reused.state.activeToolIds).toEqual(new Set(["provider-reused"]));
  });

  it("settles all active tools without fabricating progress", () => {
    let state = createRunSupervisorState(0);
    state = observeRunProgress(state, {
      kind: "tool-started",
      toolId: "first-tool",
      toolKind: "command",
      sequence: 1,
    }, 100).state;
    state = observeRunProgress(state, {
      kind: "tool-started",
      toolId: "second-tool",
      toolKind: "command",
      sequence: 2,
    }, 200).state;

    const settled = settleRunSupervisorTools(state);

    expect(settled.activeToolIds).toEqual(new Set());
    expect(settled.lastProgressAt).toBe(200);
    expect(settled.lastSequence).toBe(2);
    expect(settleRunSupervisorTools(settled)).toBe(settled);
  });
});
