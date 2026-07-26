import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { LocalCodexResumeIntentFact } from "./codex-resume.js";
import type { LocalCodexThreadLinkFact } from "./codex-thread-link.js";
import type { LocalConsoleExecutionProfile } from "./types.js";
import type { ResolvedLocalWorkspace } from "./workspace-source.js";

export interface LocalRunExecutionContextFact {
  sessionId: string;
  runId: string;
  sourceMessageId: number;
  role: string;
  engine: "codex" | "kimi";
  profile: LocalConsoleExecutionProfile | null;
  profileFingerprint: string;
  contextFingerprint: string;
  workspace: {
    cwd: string;
    mode: string;
    worktreePath: string | null;
    worktreeUnavailableReason: string | null;
    branchName: string | null;
    baseRef: string | null;
    originalRepoRoot: string | null;
  };
  team: Array<{
    name: string;
    agentMarkdown: string;
    executionProfile: LocalConsoleExecutionProfile | null;
  }>;
  recordedAt: string;
}

export interface LocalExecutionSessionLinkFact {
  sessionId: string;
  runId: string;
  sourceMessageId: number;
  role: string;
  engine: "codex" | "kimi";
  externalSessionId: string;
  profileFingerprint: string;
  contextFingerprint: string;
  startedAt: string;
}

export type LocalExecutionRecoveryPlan =
  | {
      kind: "full";
      intent: null;
      context: LocalRunExecutionContextFact;
      reason: "no-resume-intent";
    }
  | {
      kind: "resume";
      intent: LocalCodexResumeIntentFact;
      context: LocalRunExecutionContextFact;
      externalSessionId: string;
      reason: "compatible";
    }
  | {
      kind: "full-fallback";
      intent: LocalCodexResumeIntentFact;
      context: LocalRunExecutionContextFact;
      reason:
        | "session-link-missing"
        | "run-context-missing"
        | "source-mismatch"
        | "role-mismatch"
        | "context-mismatch"
        | "engine-mismatch"
        | "profile-mismatch"
        | "legacy-context-mismatch"
        | "rollout-unavailable"
        | "external-session-unavailable"
        | "explicit-retry";
    }
  | {
      kind: "unsafe";
      intent: LocalCodexResumeIntentFact;
      reason: "run-context-missing";
    };

export function executionProfileFingerprint(
  profile: LocalConsoleExecutionProfile | null,
): string {
  return sha256(profile === null
    ? { kind: "legacy-codex" }
    : {
        kind: "profile",
        cli: profile.cli,
        model: profile.model,
        effort: profile.effort,
      });
}

export function createRunExecutionContext(input: {
  sessionId: string;
  runId: string;
  sourceMessageId: number;
  role: string;
  profile: LocalConsoleExecutionProfile | null;
  workspace: ResolvedLocalWorkspace;
  team: Array<{
    name: string;
    agentMarkdown: string;
    executionProfile: LocalConsoleExecutionProfile | null;
  }>;
  recordedAt: string;
}): LocalRunExecutionContextFact {
  const engine = input.profile?.cli ?? "codex";
  const profileFingerprint = executionProfileFingerprint(input.profile);
  const workspace = {
    cwd: path.resolve(input.workspace.cwd),
    mode: input.workspace.mode,
    worktreePath: input.workspace.worktreePath,
    worktreeUnavailableReason: input.workspace.worktreeUnavailableReason,
    branchName: input.workspace.branchName,
    baseRef: input.workspace.baseRef,
    originalRepoRoot: input.workspace.originalRepoRoot,
  };
  const contextFingerprint = executionContextFingerprint({
    role: input.role,
    engine,
    profileFingerprint,
    workspace,
    team: input.team,
  });
  return {
    sessionId: input.sessionId,
    runId: input.runId,
    sourceMessageId: input.sourceMessageId,
    role: input.role,
    engine,
    profile: input.profile,
    profileFingerprint,
    contextFingerprint,
    workspace,
    team: input.team.map((member) => ({
      name: member.name,
      agentMarkdown: member.agentMarkdown,
      executionProfile: member.executionProfile,
    })),
    recordedAt: input.recordedAt,
  };
}

export function executionContextFingerprint(input: {
  role: string;
  engine: "codex" | "kimi";
  profileFingerprint: string;
  workspace: { cwd: string; mode: string };
  team: Array<{
    name: string;
    agentMarkdown: string;
    executionProfile: LocalConsoleExecutionProfile | null;
  }>;
}): string {
  return sha256({
    role: input.role,
    engine: input.engine,
    profileFingerprint: input.profileFingerprint,
    team: input.team.map((member) => ({
      name: member.name,
      agentMarkdown: member.agentMarkdown,
      executionProfile: member.executionProfile,
    })),
    cwd: path.resolve(input.workspace.cwd),
    workspaceMode: input.workspace.mode,
  });
}

export function legacyCodexContextFingerprint(input: {
  role: string;
  workspace: { cwd: string; mode: string };
  team: Array<{ name: string; agentMarkdown: string }>;
}): string {
  return sha256({
    role: input.role,
    agentMarkdown: input.team.find((member) => member.name === input.role)?.agentMarkdown ?? "",
    team: [...input.team]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((member) => ({
        name: member.name,
        agentMarkdown: member.agentMarkdown,
      })),
    cwd: path.resolve(input.workspace.cwd),
    workspaceMode: input.workspace.mode,
  });
}

export function planLocalExecutionRecovery(input: {
  sourceMessageId: number;
  role: string;
  currentContext: LocalRunExecutionContextFact;
  intents: LocalCodexResumeIntentFact[];
  consumedIntentIds: ReadonlySet<string>;
  executionLinks: LocalExecutionSessionLinkFact[];
  legacyCodexLinks: LocalCodexThreadLinkFact[];
  contexts: LocalRunExecutionContextFact[];
}): LocalExecutionRecoveryPlan {
  const intent = [...input.intents]
    .reverse()
    .find((candidate) =>
      candidate.sourceMessageId === input.sourceMessageId
      && !input.consumedIntentIds.has(candidate.intentId));
  if (intent === undefined) {
    return {
      kind: "full",
      intent: null,
      context: input.currentContext,
      reason: "no-resume-intent",
    };
  }

  const targetContext = input.contexts.find((candidate) =>
    candidate.runId === intent.targetRunId
    && candidate.sessionId === input.currentContext.sessionId);
  if (targetContext === undefined) {
    return {
      kind: "unsafe",
      intent,
      reason: "run-context-missing",
    };
  }
  if (intent.reason === "retry") {
    return fallback(intent, targetContext, "explicit-retry");
  }
  const executionLink = input.executionLinks.find((candidate) =>
    candidate.runId === intent.targetRunId
    && candidate.sessionId === input.currentContext.sessionId);
  if (executionLink !== undefined) {
    if (
      executionLink.sourceMessageId !== intent.sourceMessageId
      && intent.reason !== "edit-resend"
    ) {
      return fallback(intent, targetContext, "source-mismatch");
    }
    if (
      executionLink.role !== intent.role
      || intent.role !== input.role
      || targetContext.role !== intent.role
    ) {
      return fallback(intent, targetContext, "role-mismatch");
    }
    if (
      executionLink.contextFingerprint !== targetContext.contextFingerprint
      || targetContext.contextFingerprint !== executionContextFingerprint(targetContext)
    ) {
      return fallback(intent, targetContext, "context-mismatch");
    }
    if (
      executionLink.engine !== targetContext.engine
      || targetContext.engine !== (targetContext.profile?.cli ?? "codex")
    ) {
      return fallback(intent, targetContext, "engine-mismatch");
    }
    if (
      executionLink.profileFingerprint !== targetContext.profileFingerprint
      || targetContext.profileFingerprint !== executionProfileFingerprint(targetContext.profile)
    ) {
      return fallback(intent, targetContext, "profile-mismatch");
    }
    return {
      kind: "resume",
      intent,
      context: targetContext,
      externalSessionId: executionLink.externalSessionId,
      reason: "compatible",
    };
  }

  const legacyLink = input.legacyCodexLinks.find((candidate) =>
    candidate.runId === intent.targetRunId
    && candidate.sessionId === input.currentContext.sessionId);
  if (legacyLink === undefined) {
    return fallback(intent, targetContext, "session-link-missing");
  }
  const legacyContext = asLegacyCodexContext(targetContext);
  if (
    legacyLink.sourceMessageId !== intent.sourceMessageId
    && intent.reason !== "edit-resend"
  ) {
    return fallback(intent, legacyContext, "source-mismatch");
  }
  if (legacyLink.role !== intent.role || intent.role !== input.role) {
    return fallback(intent, legacyContext, "role-mismatch");
  }
  if (
    legacyLink.contextFingerprint == null
    || legacyLink.contextFingerprint !== legacyCodexContextFingerprint(legacyContext)
  ) {
    return fallback(intent, legacyContext, "legacy-context-mismatch");
  }
  return {
    kind: "resume",
    intent,
    context: legacyContext,
    externalSessionId: legacyLink.threadId,
    reason: "compatible",
  };
}

export async function readRunExecutionContexts(
  logPath: string,
  sessionId: string,
): Promise<LocalRunExecutionContextFact[]> {
  return readTypedFacts(logPath, sessionId, "run_execution_context") as Promise<LocalRunExecutionContextFact[]>;
}

export async function readExecutionSessionLinks(
  logPath: string,
  sessionId: string,
): Promise<LocalExecutionSessionLinkFact[]> {
  return readTypedFacts(logPath, sessionId, "execution_session_link") as Promise<LocalExecutionSessionLinkFact[]>;
}

async function readTypedFacts(
  logPath: string,
  sessionId: string,
  type: string,
): Promise<unknown[]> {
  let content: string;
  try {
    content = await fs.readFile(logPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
  const complete = content.endsWith("\n")
    ? content
    : content.slice(0, Math.max(0, content.lastIndexOf("\n") + 1));
  if (complete.trim() === "") return [];
  const values: unknown[] = [];
  for (const [index, line] of complete.trimEnd().split("\n").entries()) {
    const event = JSON.parse(line) as unknown;
    if (!isRecord(event) || event.sessionId !== sessionId) {
      throw new Error(`invalid session fact event ${sessionId} line ${String(index + 1)}`);
    }
    if (event.type === type) values.push(event.payload);
  }
  return values;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function asLegacyCodexContext(
  context: LocalRunExecutionContextFact,
): LocalRunExecutionContextFact {
  const profileFingerprint = executionProfileFingerprint(null);
  return {
    ...context,
    engine: "codex",
    profile: null,
    profileFingerprint,
    contextFingerprint: executionContextFingerprint({
      ...context,
      engine: "codex",
      profileFingerprint,
      team: context.team.map((member) => ({
        ...member,
        executionProfile: null,
      })),
    }),
    team: context.team.map((member) => ({
      ...member,
      executionProfile: null,
    })),
  };
}

function fallback(
  intent: LocalCodexResumeIntentFact,
  context: LocalRunExecutionContextFact,
  reason: Extract<LocalExecutionRecoveryPlan, { kind: "full-fallback" }>["reason"],
): LocalExecutionRecoveryPlan {
  return { kind: "full-fallback", intent, context, reason };
}

function sha256(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
