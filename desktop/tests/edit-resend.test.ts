import { describe, expect, it, vi } from "vitest";
import type { OperatorMessage } from "@moebius/console-ui";

import {
  findStoppedRunStartMessage,
  refillStoppedRunDraft,
} from "../src/console-page/edit-resend.js";

describe("edit and resend draft preparation", () => {
  it("finds the latest user message before a stopped member handoff", () => {
    const messages = [
      message(1, "user", "最初目标"),
      message(2, "agent", "交给测试", { role: "dev" }),
      message(3, "agent", "测试处理中", { role: "qa" }),
      message(4, "system", "你让这一步停下了", { systemEventKind: "user-stopped" }),
    ];

    expect(findStoppedRunStartMessage(messages, 4)?.id).toBe(1);
  });

  it("clones attachment refs before persistently replacing the body", async () => {
    const messages = [
      message(11, "user", "原消息"),
      message(12, "system", "你让这一步停下了", { systemEventKind: "user-stopped" }),
    ];
    const order: string[] = [];
    const replaceAttachments = vi.fn(async () => { order.push("attachments"); });
    const persistBody = vi.fn(() => { order.push("body"); });

    await expect(refillStoppedRunDraft({
      messages,
      stoppedMessageId: 12,
      stoppedRunId: null,
      sessionId: "session-a",
      missingSourceMessage: "missing-source-sentinel",
      replaceAttachments,
      persistBody,
    })).resolves.toMatchObject({ id: 11, body: "原消息" });

    expect(replaceAttachments).toHaveBeenCalledWith({ sessionId: "session-a", sourceMessageId: 11 });
    expect(persistBody).toHaveBeenCalledWith("原消息");
    expect(order).toEqual(["attachments", "body"]);
  });

  it("rejects non-stopped records without changing the draft", async () => {
    const persistBody = vi.fn();

    await expect(refillStoppedRunDraft({
      messages: [message(1, "user", "原消息"), message(2, "system", "卡住", { systemEventKind: "run-stuck" })],
      stoppedMessageId: 2,
      stoppedRunId: null,
      sessionId: "session-a",
      missingSourceMessage: "missing-source-sentinel",
      replaceAttachments: vi.fn(async () => undefined),
      persistBody,
    })).rejects.toThrow("missing-source-sentinel");
    expect(persistBody).not.toHaveBeenCalled();
  });

  it("rejects a stale stopped-run context without changing the draft", async () => {
    const persistBody = vi.fn();

    await expect(refillStoppedRunDraft({
      messages: [
        message(1, "user", "原消息"),
        message(2, "system", "你让这一步停下了", { systemEventKind: "user-stopped", runId: "run-current" }),
      ],
      stoppedMessageId: 2,
      stoppedRunId: "run-stale",
      sessionId: "session-a",
      missingSourceMessage: "stale-source-sentinel",
      replaceAttachments: vi.fn(async () => undefined),
      persistBody,
    })).rejects.toThrow("stale-source-sentinel");
    expect(persistBody).not.toHaveBeenCalled();
  });
});

function message(
  id: number,
  speaker: OperatorMessage["speaker"],
  body: string,
  overrides: Partial<OperatorMessage> = {},
): OperatorMessage {
  return {
    id,
    sessionId: "session-a",
    speaker,
    role: null,
    body,
    status: "displayed",
    runId: null,
    runDir: null,
    error: null,
    systemEventKind: "other",
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    ...overrides,
  };
}
