import type { LocalConsoleMessage } from "./types.js";

export function planLocalRouteAdmission(speaker: LocalConsoleMessage["speaker"]) {
  return speaker === "user" ? { kind: "route" as const } : { kind: "process" as const };
}

export function planLocalRouteExisting<T>(existing: T | null) {
  return existing === null
    ? { kind: "judge" as const }
    : { kind: "process" as const, existing };
}

export function planLocalRouteAction(action: "APPEND" | "NO_ACTION" | "FAIL_OPEN") {
  if (action === "APPEND") return { kind: "append" as const };
  if (action === "NO_ACTION") return { kind: "no-action" as const };
  return { kind: "fail" as const };
}

export function decideLocalRouteValidation(ok: boolean) {
  return ok ? { kind: "valid" as const } : { kind: "invalid" as const };
}

export function decideLocalRouteFailure(
  message: LocalConsoleMessage,
  availableAgentNames: readonly string[],
) {
  if (message.speaker !== "user") return { kind: "fail-open" as const };
  const normalized = message.body.toLowerCase();
  if (/(交给|交棒|移交|handoff|route|转给|继续处理|继续推进)/i.test(message.body)) {
    return { kind: "retry" as const };
  }
  const namesRole = availableAgentNames.some((agent) => {
    const escaped = agent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9_-])${escaped}([^a-z0-9_-]|$)`, "i").test(normalized);
  });
  return namesRole ? { kind: "retry" as const } : { kind: "fail-open" as const };
}

export function routeKeyForLocalMessage(message: LocalConsoleMessage): string {
  const prefix = message.speaker === "agent" ? "local-child-agent" : "local-message";
  return `${prefix}:${String(message.id)}`;
}
