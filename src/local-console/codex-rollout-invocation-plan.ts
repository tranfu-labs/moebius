export interface CodexRolloutPromptProjection {
  developer: string | null;
  user: string | null;
}

export function planCodexRolloutPromptProjection(
  role: unknown,
  content: string | null,
): CodexRolloutPromptProjection {
  return {
    developer: role === "developer" ? content : null,
    user: role === "user" ? content : null,
  };
}
