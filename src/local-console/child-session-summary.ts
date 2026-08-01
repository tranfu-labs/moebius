import type {
  LocalConsoleChildSessionStatus,
  LocalConsoleChildSessionSummary,
  LocalConsoleSessionStatus,
  LocalConsoleSystemEventKind,
  LocalConsoleAgentTeamSnapshot,
} from "./types.js";
import {
  projectLocalConsoleMemberIdentities,
  resolveLocalConsoleMemberName,
} from "./member-identity.js";

export const LOCAL_CHILD_SESSION_CARD_SOURCE_KIND = "local-child-session-card";

export interface ChildSessionSummarySource {
  sessionId: string;
  title: string | null;
  parentSessionId: string | null;
  status: LocalConsoleSessionStatus | null;
  unresolvedSystemEventKind: LocalConsoleSystemEventKind | null;
  latestAgentRole: string | null;
  initialBody: string | null;
  agentTeamSnapshot: LocalConsoleAgentTeamSnapshot | null;
  chainValid: boolean;
}

export function summarizeChildSessions(
  parentSessionId: string,
  sources: readonly ChildSessionSummarySource[],
): LocalConsoleChildSessionSummary[] {
  return sources.map((source) => {
    const chainValid = source.chainValid && source.parentSessionId === parentSessionId;
    const status = chainValid ? childSessionStatus(source.status, source.unresolvedSystemEventKind) : "unavailable";
    return {
      sessionId: source.sessionId,
      title: cleanText(source.title) ?? "子任务不可用",
      memberName: resolveChildSessionMember(
        source.latestAgentRole,
        source.initialBody,
        source.agentTeamSnapshot,
      ),
      status,
      statusLabel: childSessionStatusLabel(status),
    };
  });
}

export function resolveChildSessionMember(
  latestAgentRole: string | null,
  initialBody: string | null,
  agentTeamSnapshot: LocalConsoleAgentTeamSnapshot | null = null,
): string {
  const role = cleanText(latestAgentRole) ?? extractInitialHandoffRole(initialBody);
  return resolveLocalConsoleMemberName(
    role,
    projectLocalConsoleMemberIdentities(agentTeamSnapshot),
  );
}

export function childSessionStatus(
  status: LocalConsoleSessionStatus | null,
  eventKind: LocalConsoleSystemEventKind | null,
): LocalConsoleChildSessionStatus {
  if (eventKind === "retry-exhausted") return "retry-exhausted";
  if (eventKind === "run-stuck") return "stuck";
  if (eventKind === "run-not-started") return "not-started";
  if (eventKind === "user-stopped") return "stopped";
  if (status === "running") return "running";
  if (status === "waiting") return "waiting";
  if (status === "stuck") return "stuck";
  if (status === "failed") return "not-started";
  if (status === "interrupted") return "stopped";
  if (status === "idle") return "finished";
  return "unavailable";
}

export function childSessionStatusLabel(status: LocalConsoleChildSessionStatus): string {
  switch (status) {
    case "running": return "进行中";
    case "waiting": return "等待中";
    case "finished": return "已结束";
    case "not-started": return "没跑起来";
    case "stuck": return "卡住了";
    case "stopped": return "已停下";
    case "retry-exhausted": return "反复重试未成功";
    case "unavailable": return "不可用";
  }
}

function extractInitialHandoffRole(body: string | null): string | null {
  if (body === null) return null;
  const handoff = /Initial handoff:\s*\n\s*@([a-z0-9][a-z0-9-]*)/iu.exec(body);
  return handoff?.[1] ?? null;
}

function cleanText(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}
