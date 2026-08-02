export function selectClaudeAiTeamBuilderSession(input: {
  threadId: string | null | undefined;
  observedExternalSessionId: string | null;
  requestedExternalSessionId: string | null;
}): string | null {
  return input.threadId
    ?? input.observedExternalSessionId
    ?? input.requestedExternalSessionId;
}

export function selectCodexAiTeamBuilderFailedSession(input: {
  observedExternalSessionId: string | null;
  threadId: string | null | undefined;
}): string | null {
  return input.observedExternalSessionId ?? input.threadId ?? null;
}

export function selectCodexAiTeamBuilderFailureResponseSession(input: {
  requestedExternalSessionId: string | null;
  failedObservedExternalSessionId: string | null;
}): string | null {
  return input.requestedExternalSessionId ?? input.failedObservedExternalSessionId;
}

export function selectCodexAiTeamBuilderSession(input: {
  threadId: string | null | undefined;
  observedExternalSessionId: string | null;
  requestedExternalSessionId: string | null;
}): string | null {
  return input.threadId
    ?? input.observedExternalSessionId
    ?? input.requestedExternalSessionId;
}

export function selectKimiAiTeamBuilderFailedSession(input: {
  observedExternalSessionId: string | null;
  requestedExternalSessionId: string | null;
}): string | null {
  return input.observedExternalSessionId ?? input.requestedExternalSessionId;
}

export function selectKimiAiTeamBuilderSession(input: {
  threadId: string | null | undefined;
  observedExternalSessionId: string | null;
  requestedExternalSessionId: string | null;
}): string | null {
  return input.threadId
    ?? input.observedExternalSessionId
    ?? input.requestedExternalSessionId;
}
