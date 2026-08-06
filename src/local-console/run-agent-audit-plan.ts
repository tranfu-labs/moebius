import type {
  LocalProviderProcessStartedFact,
  LocalRunExecutionContextFact,
} from "./execution-context.js";
import type { LocalConsoleExecutionEngine, LocalConsoleRunAgentInfo } from "./types.js";
import type { LocalConsoleMessage } from "./types.js";

export function projectRunAgentInfo(input: {
  context: LocalRunExecutionContextFact;
  processStarted: boolean;
  preStartTerminal: boolean;
}): LocalConsoleRunAgentInfo {
  const snapshotMember = input.context.teamSnapshot?.members.find((member) => member.name === input.context.role);
  const legacyMember = input.context.team.find((member) => member.name === input.context.role);
  if (snapshotMember === undefined && legacyMember === undefined) {
    throw new Error("RUN_AGENT_NOT_FOUND");
  }
  const historicalTeam = input.context.teamSnapshot?.team;
  return {
    sessionId: input.context.sessionId,
    runId: input.context.runId,
    role: input.context.role,
    agent: {
      slug: snapshotMember?.name ?? legacyMember!.name,
      displayName: snapshotMember?.displayName ?? null,
      description: snapshotMember?.description ?? null,
    },
    team: {
      name: historicalTeam?.name ?? null,
      ownership: historicalTeam?.ownership ?? null,
      sourceName: historicalTeam?.officialSourceName ?? null,
    },
    profile: input.context.profile,
    loadedAt: input.context.teamSnapshot?.loadedAt ?? null,
    evidence: input.preStartTerminal
      ? "planned-not-started"
      : input.processStarted
        ? "executed"
        : "bound-start-unknown",
  };
}

export function readRunAgentMarkdown(
  context: LocalRunExecutionContextFact,
): string {
  const member = context.teamSnapshot?.members.find((candidate) => candidate.name === context.role)
    ?? context.team.find((candidate) => candidate.name === context.role);
  if (member === undefined) throw new Error("RUN_AGENT_NOT_FOUND");
  return member.agentMarkdown;
}

export function planProviderProcessStartedFact(input: {
  active?: { sessionId: string; role: string | null; engine: LocalConsoleExecutionEngine };
  runId: string;
  startedAt: string;
}): { kind: "skip" | "record"; fact: LocalProviderProcessStartedFact | null } {
  return input.active === undefined || input.active.role === null
    ? { kind: "skip", fact: null }
    : {
        kind: "record",
        fact: {
          sessionId: input.active.sessionId,
          runId: input.runId,
          role: input.active.role,
          engine: input.active.engine,
          startedAt: input.startedAt,
        },
      };
}

export function requireRunAgentAuditValue<T>(value: T | null | undefined, code: string): T {
  if (value == null) throw new Error(code);
  return value;
}

export function hasRunNotStartedTerminal(messages: readonly LocalConsoleMessage[], runId: string): boolean {
  return messages.some((message) =>
    message.runId === runId
    && message.speaker === "system"
    && message.systemEventKind === "run-not-started");
}
