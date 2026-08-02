import type { OperatorMessage } from "@moebius/console-ui";

export function findStoppedRunStartMessage(
  messages: readonly OperatorMessage[],
  stoppedMessageId: number,
): OperatorMessage | null {
  const stoppedIndex = messages.findIndex((message) => message.id === stoppedMessageId);
  const stopped = messages[stoppedIndex];
  if (
    stoppedIndex < 0
    || stopped === undefined
    || stopped.speaker !== "system"
    || stopped.systemEventKind !== "user-stopped"
  ) {
    return null;
  }
  for (let index = stoppedIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate?.sessionId === stopped.sessionId && candidate.speaker === "user") {
      return candidate;
    }
  }
  return null;
}

export async function refillStoppedRunDraft(input: {
  messages: readonly OperatorMessage[];
  stoppedMessageId: number;
  stoppedRunId: string | null;
  sessionId: string;
  missingSourceMessage: string;
  replaceAttachments(source: { sessionId: string; sourceMessageId: number }): Promise<void>;
  persistBody(body: string): void;
}): Promise<OperatorMessage> {
  const source = findStoppedRunStartMessage(input.messages, input.stoppedMessageId);
  const stopped = input.messages.find((message) => message.id === input.stoppedMessageId);
  if (
    source === null
    || source.sessionId !== input.sessionId
    || stopped?.sessionId !== input.sessionId
    || stopped.runId !== input.stoppedRunId
  ) {
    throw new Error(input.missingSourceMessage);
  }
  await input.replaceAttachments({
    sessionId: source.sessionId,
    sourceMessageId: source.id,
  });
  input.persistBody(source.body);
  return source;
}
