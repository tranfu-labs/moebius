export function planAttachmentDraftKey(input: {
  requestedDraftKey: string | undefined;
  sessionId: string;
}): string {
  return input.requestedDraftKey ?? `draft:${input.sessionId}`;
}

export function assertAttachmentCloneTarget(input: {
  targetDraftKey: string;
  sessionId: string;
}): void {
  if (input.targetDraftKey !== `draft:${input.sessionId}`) {
    throw new Error("Attachment target draft does not belong to the session");
  }
}

export function planAttachmentContentScopeValue(input: {
  draftKey?: string;
  sessionId?: string;
}): string {
  return input.draftKey ?? input.sessionId ?? "";
}
