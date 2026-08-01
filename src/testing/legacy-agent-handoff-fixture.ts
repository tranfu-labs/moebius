import fs from "node:fs/promises";

import type { LocalConsoleMessage } from "../local-console/types.js";

interface LegacyAgentHandoffFactEvent {
  version: number;
  eventId: string;
  sessionId: string;
  type: string;
  recordedAt: string;
  payload?: Record<string, unknown>;
  messageUpserts: LocalConsoleMessage[];
}

export async function rewriteAsLegacyAgentHandoffFootprint(input: {
  factLogPath: string;
  sessionId: string;
  sourceMessageId: number;
  targetRunId: string;
}): Promise<void> {
  const events = (await fs.readFile(input.factLogPath, "utf8"))
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as LegacyAgentHandoffFactEvent);
  const intent = events.find((event) =>
    event.type === "codex_resume_intent"
    && event.payload?.targetRunId === input.targetRunId
    && event.payload?.sourceMessageId === input.sourceMessageId);
  if (intent?.payload === undefined) {
    throw new Error("graceful resume intent fixture not found");
  }
  delete intent.payload.sourceDisposition;
  events.push({
    version: 1,
    eventId: "legacy-agent-handoff-retry-sibling",
    sessionId: input.sessionId,
    type: "codex_resume_intent",
    recordedAt: "2026-07-30T00:00:00.000Z",
    payload: {
      ...intent.payload,
      intentId: "legacy-agent-handoff-retry",
      reason: "retry",
    },
    messageUpserts: [],
  });
  const source = events.flatMap((event) => event.messageUpserts)
    .filter((message) => message.id === input.sourceMessageId)
    .at(-1);
  if (source === undefined) {
    throw new Error("Agent handoff source fixture not found");
  }
  events.push({
    version: 1,
    eventId: "legacy-agent-handoff-pollution",
    sessionId: input.sessionId,
    type: "release_message_for_resume",
    recordedAt: "2026-07-30T00:00:00.000Z",
    payload: {
      kind: "local-release-message-for-resume",
      sessionId: input.sessionId,
      userMessageId: input.sourceMessageId,
      now: "2026-07-30T00:00:00.000Z",
    },
    messageUpserts: [{
      ...source,
      status: "pending",
      runId: null,
      runDir: null,
      error: null,
      updatedAt: "2026-07-30T00:00:00.000Z",
    }],
  });
  await fs.writeFile(
    input.factLogPath,
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );
}
