export function decideSidebarMessageAvailability(input: {
  apiBase: string | null;
  sending: boolean;
}):
  | { kind: "available"; apiBase: string }
  | { kind: "skip" } {
  return input.apiBase === null || input.sending
    ? { kind: "skip" }
    : { kind: "available", apiBase: input.apiBase };
}

export function planSidebarMessageSubmission(input: {
  body: string;
  attachmentIds: readonly string[];
}): { kind: "skip" } | { kind: "send"; body: string; attachmentIds: readonly string[] } {
  return input.body.trim() === "" && input.attachmentIds.length === 0
    ? { kind: "skip" }
    : { kind: "send", ...input };
}

export function planSidebarComposerBody(
  values: Readonly<Record<string, string>>,
  sessionId: string,
  storedBody: string,
): string {
  return values[sessionId] ?? storedBody;
}

export function decideSidebarViewRefresh(input: {
  apiBase: string | null;
  hasView: boolean;
}): { kind: "refresh"; apiBase: string } | { kind: "skip" } {
  return input.apiBase !== null && input.hasView
    ? { kind: "refresh", apiBase: input.apiBase }
    : { kind: "skip" };
}
