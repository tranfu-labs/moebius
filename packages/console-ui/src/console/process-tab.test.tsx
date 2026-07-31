import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { translate } from "@/i18n";

import { ProcessEvent, escapeTerminalControls } from "./process-event";
import { resolveOperatorMemberName } from "./member-name";
import {
  ProcessTab,
  nextProcessTabTitle,
  processEventWithLatestAttempt,
} from "./process-tab";

describe("ProcessTab", () => {
  it("shows the explicit Codex unavailable state without fallback output", () => {
    render(
      <div data-testid="scroll-parent">
        <ProcessTab
          title="开发"
          state={{
            status: "ready",
            output: {
              sessionId: "session-a",
              requestedRunId: "run-a",
              role: "dev",
              status: "unavailable",
              unavailableReason: "link-missing",
              attempts: [],
              events: [],
              previousCursor: null,
              appendCursor: null,
              atLatest: true,
            },
          }}
        />
      </div>,
    );

    expect(screen.getByText("过程记录已不可用")).toBeInTheDocument();
    expect(screen.getByText("这一步的最终回复仍保留在主对话区。")).toBeInTheDocument();
    expect(screen.queryByText("标准输出")).not.toBeInTheDocument();
    expect(screen.queryByText("保留记录")).not.toBeInTheDocument();
  });

  it("retains the provider label when an attempt has no execution link", () => {
    render(
      <div data-testid="scroll-parent">
        <ProcessTab
          title="Kimi 验收"
          state={{
            status: "ready",
            output: {
              sessionId: "session-a",
              requestedRunId: "run-kimi-empty",
              role: "kimi-dev",
              status: "unavailable",
              unavailableReason: "link-missing",
              unavailableEngine: "kimi",
              attempts: [],
              events: [],
              previousCursor: null,
              appendCursor: null,
              atLatest: true,
            },
          }}
        />
      </div>,
    );

    expect(screen.getByText("Kimi 过程记录已不可用")).toBeInTheDocument();
  });

  it("renders raw tool fields, exact protocol metadata, and unknown payload", () => {
    const { rerender } = render(
      <ProcessEvent
        sessionId="session-a"
        event={{
          key: "tool-1",
          kind: "tool",
          timestamp: "2026-07-23T01:00:00.000Z",
          protocolType: "response_item · function_call",
          rawPayload: "{\"path\":\"/Users/person/project\"}",
          phase: "completed",
          name: "exec",
          callId: "call-01",
          input: "pnpm test",
          output: "PASS",
          status: "completed",
        }}
      />,
    );
    expect(screen.getByText(/2026-07-23T01:00:00.000Z · response_item · function_call/u)).toBeInTheDocument();
    expect(screen.getByText(/call_id: call-01 · completed/u)).toBeInTheDocument();
    expect(screen.getByText("pnpm test")).toBeInTheDocument();
    expect(screen.getByText("PASS")).toBeInTheDocument();

    rerender(
      <ProcessEvent
        sessionId="session-a"
        event={{
          key: "unsupported-1",
          kind: "unsupported-debug",
          timestamp: null,
          protocolType: "event_msg · future_event",
          rawPayload: "{\"secret\":\"debug-value\"}",
        }}
      />,
    );
    expect(screen.getByText("未识别事件")).toBeInTheDocument();
    expect(screen.getByText(/event_msg · future_event/u)).toBeInTheDocument();
    expect(screen.getByText(/debug-value/u)).toBeInTheDocument();
  });

  it("keeps long tool output complete, collapsed, and unredacted", () => {
    const output = Array.from(
      { length: 24 },
      (_, index) => `第 ${String(index + 1)} 行 /Users/person/private/file.ts runId=secret-run`,
    ).join("\n");
    const { container } = render(
      <ProcessEvent
        sessionId="session-a"
        event={{
          key: "tool-long",
          kind: "tool",
          timestamp: null,
          protocolType: "response_item · function_call_output",
          rawPayload: "{}",
          phase: "completed",
          name: "inspect",
          callId: "call-long",
          input: null,
          output,
          status: "completed",
        }}
      />,
    );

    expect(screen.getByText("展开完整result")).toBeInTheDocument();
    expect(container.textContent).toContain("第 24 行");
    expect(container.textContent).toContain("/Users/person/private/file.ts");
    expect(container.textContent).toContain("runId=secret-run");
    expect(escapeTerminalControls("\u001b[31mred\u0000")).toBe("\\x1b[31mred\\x00");
  });

  it("keeps stable member labels and monotonic duplicate titles", () => {
    expect(resolveOperatorMemberName(
      "dev",
      [],
      (key, values) => translate("zh-CN", key, values),
    )).toBe("开发");
    expect(nextProcessTabTitle({
      tabs: [
        { type: "run-output", title: "开发" },
        { type: "run-output", title: "开发 2" },
        { type: "workspace-diff", title: "改动" },
      ],
    }, "dev")).toBe("开发 3");
  });

  it("uses custom snapshot names and lazily loads three exact prompt layers", () => {
    const memberIdentities = [
      { slug: "plan-supervisor", displayName: "方案监督者" },
      { slug: "plan-executor", displayName: "方案执行者" },
    ];
    expect(nextProcessTabTitle({ tabs: [] }, "plan-supervisor", memberIdentities)).toBe("方案监督者");
    expect(nextProcessTabTitle({
      tabs: [{ type: "run-output", title: "方案监督者" }],
    }, "plan-supervisor", memberIdentities)).toBe("方案监督者 2");
    expect(nextProcessTabTitle({
      tabs: [{ type: "run-output", title: "方案监督者" }],
    }, "plan-executor", memberIdentities)).toBe("方案执行者");

    const load = vi.fn();
    render(
      <ProcessEvent
        sessionId="session-a"
        onLoadInvocation={load}
        invocationState={{
          status: "ready",
          invocation: {
            status: "available",
            sessionId: "session-a",
            runId: "run-a",
            prompts: {
              system: { status: "recorded", contents: ["SYSTEM-EXACT"] },
              developer: { status: "recorded", contents: ["DEVELOPER-EXACT"] },
              user: { status: "recorded", contents: ["USER-EXACT"] },
            },
            metadata: {
              model: "gpt-5",
              effort: "high",
              provider: "openai",
              cliVersion: "1.2.3",
              cwd: "/Users/person/project",
              threadId: "thread-a",
              metadataSource: "rollout",
            },
          },
        }}
        event={{
          key: "attempt-a",
          kind: "attempt-header",
          runId: "run-a",
          attempt: 1,
          role: "plan-supervisor",
          engine: "codex",
          model: null,
          effort: null,
          provider: null,
          cliVersion: null,
          metadataSource: "not-recorded",
          threadId: "thread-a",
          startedAt: "2026-07-25T00:00:00.000Z",
          status: "completed",
          elapsedMs: 1000,
          completedAt: "2026-07-25T00:00:01.000Z",
        }}
      />,
    );
    const systemDetails = screen.getByText("SYSTEM_PROMPT").closest("details");
    expect(systemDetails).not.toBeNull();
    systemDetails!.open = true;
    fireEvent(systemDetails!, new Event("toggle"));
    fireEvent.click(screen.getByText("DEVELOPER_PROMPT"));
    fireEvent.click(screen.getByText("USER_INPUT"));
    expect(screen.getByText("SYSTEM-EXACT")).toBeVisible();
    expect(screen.getByText("DEVELOPER-EXACT")).toBeVisible();
    expect(screen.getByText("USER-EXACT")).toBeVisible();
    expect(screen.getByText("gpt-5")).toBeVisible();
    expect(load).not.toHaveBeenCalled();
  });

  it("renders provider-native Claude sections, session identity, and thinking", () => {
    const { rerender } = render(
      <ProcessEvent
        sessionId="session-a"
        invocationState={{
          status: "ready",
          invocation: {
            status: "available",
            sessionId: "session-a",
            runId: "run-claude",
            engine: "claude",
            sections: [
              {
                key: "user",
                label: "USER",
                source: "claude-transcript",
                status: "recorded",
                contents: ["CLAUDE_USER_MARKER"],
              },
              {
                key: "assistant",
                label: "ASSISTANT",
                source: "claude-transcript",
                status: "not-recorded",
                contents: [],
              },
            ],
            prompts: {
              system: { status: "not-recorded", contents: [] },
              developer: { status: "not-recorded", contents: [] },
              user: { status: "recorded", contents: ["CLAUDE_USER_MARKER"] },
            },
            metadata: {
              model: "claude-sonnet",
              effort: "high",
              provider: "Anthropic",
              cliVersion: "2.1.220",
              cwd: "/tmp/project",
              externalSessionId: "claude-session",
              identityLabel: "session",
              threadId: "claude-session",
              metadataSource: "provider-native",
            },
          },
        }}
        event={{
          key: "attempt-claude",
          kind: "attempt-header",
          runId: "run-claude",
          attempt: 1,
          role: "dev",
          engine: "claude",
          model: null,
          effort: null,
          provider: null,
          cliVersion: null,
          metadataSource: "provider-native",
          externalSessionId: "claude-session",
          identityLabel: "session",
          threadId: "claude-session",
          startedAt: "2026-07-30T00:00:00.000Z",
          status: "completed",
          elapsedMs: 1_000,
          completedAt: "2026-07-30T00:00:01.000Z",
        }}
      />,
    );

    expect(screen.getByText("claude")).toBeVisible();
    expect(screen.getByText("claude-session")).toBeVisible();
    fireEvent.click(screen.getByText("USER"));
    expect(screen.getByText("CLAUDE_USER_MARKER")).toBeVisible();
    fireEvent.click(screen.getByText("ASSISTANT"));
    expect(screen.getByText("该引擎未记录此层。")).toBeVisible();

    rerender(
      <ProcessEvent
        sessionId="session-a"
        event={{
          key: "thinking-claude",
          engine: "claude",
          kind: "thinking",
          timestamp: "2026-07-30T00:00:00.000Z",
          protocolType: "assistant · thinking",
          rawPayload: "{\"thinking\":\"CLAUDE_THINKING_MARKER\"}",
          thinking: "CLAUDE_THINKING_MARKER",
        }}
      />,
    );
    expect(screen.getByText("CLAUDE_THINKING_MARKER")).toBeVisible();
    expect(screen.getByText(/assistant · thinking/u)).toBeVisible();

    rerender(
      <ProcessEvent
        sessionId="session-a"
        event={{
          key: "thinking-claude-redacted",
          engine: "claude",
          kind: "thinking",
          timestamp: "2026-07-30T00:00:01.000Z",
          protocolType: "assistant · thinking",
          rawPayload: "{\"type\":\"thinking\"}",
          thinking: "",
        }}
      />,
    );
    expect(screen.getByText("该引擎未记录可展示的思考文本")).toBeVisible();
  });

  it("keeps prompt state across parent rerenders and retries with the latest callback", () => {
    const firstLoad = vi.fn();
    const retryLoad = vi.fn();
    const event = {
      key: "attempt-async",
      kind: "attempt-header" as const,
      runId: "run-async",
      attempt: 1,
      role: "dev",
      engine: "codex" as const,
      model: null,
      effort: null,
      provider: null,
      cliVersion: null,
      metadataSource: "not-recorded" as const,
      threadId: "thread-async",
      startedAt: "2026-07-25T00:00:00.000Z",
      status: "running" as const,
      elapsedMs: 500,
      completedAt: null,
    };
    const { rerender } = render(
      <ProcessEvent
        event={event}
        sessionId="session-a"
        invocationState={{ status: "idle" }}
        onLoadInvocation={firstLoad}
      />,
    );
    const asyncSystemDetails = screen.getByText("SYSTEM_PROMPT").closest("details");
    expect(asyncSystemDetails).not.toBeNull();
    asyncSystemDetails!.open = true;
    fireEvent(asyncSystemDetails!, new Event("toggle"));
    expect(firstLoad).toHaveBeenCalledWith("session-a", "run-async");

    rerender(
      <ProcessEvent
        event={event}
        sessionId="session-a"
        invocationState={{ status: "loading" }}
        onLoadInvocation={retryLoad}
      />,
    );
    expect(screen.getAllByText("正在读取这次执行的提示词…")[0]).toBeVisible();
    expect(retryLoad).not.toHaveBeenCalled();

    rerender(
      <ProcessEvent
        event={event}
        sessionId="session-a"
        invocationState={{ status: "error", message: "slow request failed" }}
        onLoadInvocation={retryLoad}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "重试" })[0]!);
    expect(retryLoad).toHaveBeenCalledWith("session-a", "run-async");

    rerender(
      <ProcessEvent
        event={event}
        sessionId="session-a"
        invocationState={{
          status: "ready",
          invocation: {
            status: "available",
            sessionId: "session-a",
            runId: "run-async",
            prompts: {
              system: { status: "recorded", contents: ["LATE-SYSTEM"] },
              developer: { status: "not-recorded", contents: [] },
              user: { status: "recorded", contents: ["LATE-USER"] },
            },
            metadata: {
              model: "gpt-5",
              effort: "high",
              provider: "openai",
              cliVersion: "1.2.3",
              cwd: "/tmp/project",
              threadId: "thread-async",
              metadataSource: "rollout",
            },
          },
        }}
        onLoadInvocation={vi.fn()}
      />,
    );
    expect(screen.getByText("LATE-SYSTEM")).toBeVisible();
  });

  it.each(["completed", "failed", "interrupted"] as const)(
    "renders authoritative %s attempt metadata over a stale running header",
    (status) => {
      const staleHeader = {
        key: "attempt-terminal",
        kind: "attempt-header" as const,
        runId: "run-terminal",
        attempt: 1,
        role: "dev",
        engine: "codex" as const,
        model: "gpt-5",
        effort: "high",
        provider: "openai",
        cliVersion: "1.2.3",
        metadataSource: "rollout" as const,
        threadId: "thread-terminal",
        startedAt: "2026-07-25T00:00:00.000Z",
        status: "running" as const,
        elapsedMs: 500,
        completedAt: null,
      };
      const renderedEvent = processEventWithLatestAttempt(staleHeader, {
        ...staleHeader,
        status,
        elapsedMs: 2_000,
        completedAt: "2026-07-25T00:00:02.000Z",
      });
      render(
        <ProcessEvent sessionId="session-a" event={renderedEvent} />,
      );

      expect(screen.getByText(`第 1 次执行 · ${status}`)).toBeInTheDocument();
      expect(screen.queryByText("第 1 次执行 · running")).not.toBeInTheDocument();
      expect(screen.getByText("2026-07-25T00:00:02.000Z")).toBeInTheDocument();
    },
  );

  it("keeps a large process history to a bounded viewport plus overscan DOM", () => {
    const events = Array.from({ length: 1_000 }, (_, index) => ({
      key: `agent-${String(index)}`,
      kind: "agent-output" as const,
      timestamp: `2026-07-23T01:${String(index % 60).padStart(2, "0")}:00.000Z`,
      protocolType: "response_item · message",
      rawPayload: "{}",
      output: `第 ${String(index + 1)} 条过程`,
    }));
    const { container } = render(
      <div style={{ height: 640, overflow: "auto" }}>
        <ProcessTab
          title="开发"
          state={{
            status: "ready",
            output: {
              sessionId: "session-a",
              requestedRunId: "run-a",
              role: "dev",
              status: "settled",
              unavailableReason: null,
              attempts: [],
              events,
              previousCursor: null,
              appendCursor: null,
              atLatest: true,
            },
          }}
        />
      </div>,
    );

    expect(container.querySelectorAll("[data-index]").length).toBeLessThan(30);
    expect(container.querySelectorAll("article").length).toBeLessThan(30);
  });
});
