export function decideSessionRunAvailability(input: {
  apiBase: string | null;
  sending: boolean;
}):
  | { kind: "available"; apiBase: string }
  | { kind: "unavailable" }
  | { kind: "busy" } {
  if (input.apiBase === null) return { kind: "unavailable" };
  return input.sending ? { kind: "busy" } : { kind: "available", apiBase: input.apiBase };
}

export function decideMemberExecutionUpdateCapability(available: boolean):
  | { kind: "update" }
  | { kind: "unavailable" } {
  return available ? { kind: "update" } : { kind: "unavailable" };
}

export function planSubSessionMessage(input: {
  body: string;
  attachmentIds: readonly string[];
}): { kind: "skip" } | { kind: "send"; body: string; attachmentIds: readonly string[] } {
  return input.body.trim() === "" && input.attachmentIds.length === 0
    ? { kind: "skip" }
    : { kind: "send", ...input };
}

export function planSubSessionComposerBody(
  values: Readonly<Record<string, string>>,
  sessionId: string,
  storedBody: string,
): string {
  return values[sessionId] ?? storedBody;
}
