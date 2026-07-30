import type { LocalConsoleSessionReferenceScope } from "./types.js";

export interface SessionReferenceExecutionLink {
  runId: string;
  engine: "codex" | "claude" | "kimi";
  externalSessionId: string;
}

export function buildSessionReferenceText(input: {
  scope: LocalConsoleSessionReferenceScope;
  logPath: string;
  runId: string | null;
  links: readonly SessionReferenceExecutionLink[];
}): string {
  const recordText = `Moebius 会话记录：${input.logPath}`;
  if (input.scope === "conversation") {
    return recordText;
  }
  const matchingLink = input.runId === null
    ? null
    : [...input.links].reverse().find((link) => link.runId === input.runId) ?? null;
  if (matchingLink === null) {
    return `${recordText}；外部执行：未建立`;
  }
  const engine = matchingLink.engine === "kimi"
    ? "Kimi"
    : matchingLink.engine === "claude"
      ? "Claude"
      : "Codex";
  return `${recordText}；外部执行：${engine} ${matchingLink.externalSessionId}`;
}
