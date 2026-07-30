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
  agentIdentityFingerprint: string;
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
  agentIdentityFingerprint?: string;
  contextFingerprint: string;
  startedAt: string;
}

export interface LocalAgentSessionLinkFact {
  sessionId: string;
  agentIdentityFingerprint: string;
  role: string;
  engine: "codex" | "kimi";
  externalSessionId: string;
  profileFingerprint: string;
  contextFingerprint: string;
  linkedAt: string;
}

export interface LocalProviderSessionObservedFact {
  sessionId: string;
  runId: string;
  sourceMessageId: number;
  role: string;
  engine: "codex" | "kimi";
  agentIdentityFingerprint: string;
  contextFingerprint: string;
  externalSessionId: string | null;
  observedAt: string;
}

export interface LocalAgentTimelineCursorFact {
  sessionId: string;
  runId: string;
  role: string;
  agentIdentityFingerprint: string;
  lastSeenIndex: number;
  recordedAt: string;
}

export interface LocalProviderInvocationFact {
  sessionId: string;
  runId: string;
  invocationId: string;
  role: string;
  agentIdentityFingerprint: string;
  phase: "started" | "terminal";
  mode: "full" | "resume";
  requestedExternalSessionId: string | null;
  observedExternalSessionId: string | null;
  outcome: "started" | "succeeded" | "failed";
  recordedAt: string;
}

export type LocalExecutionRecoveryPlan =
  | {
      kind: "first";
      intent: LocalCodexResumeIntentFact | null;
      context: LocalRunExecutionContextFact;
      reason: "no-provider-session";
    }
  | {
      kind: "resume";
      intent: LocalCodexResumeIntentFact | null;
      context: LocalRunExecutionContextFact;
      externalSessionId: string;
      canonicalLinkMissing: boolean;
      reason: "compatible";
    }
  | {
      kind: "unavailable";
      intent: LocalCodexResumeIntentFact | null;
      context: LocalRunExecutionContextFact;
      reason:
        | "run-context-missing"
        | "identity-invalid"
        | "context-mismatch"
        | "engine-mismatch"
        | "profile-mismatch"
        | "session-link-missing"
        | "session-link-conflict"
        | "provider-id-missing"
        | "rollout-unavailable"
        | "external-session-unavailable";
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
  const agentIdentityFingerprint = localAgentIdentityFingerprint({
    role: input.role,
    team: input.team,
  });
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
    agentIdentityFingerprint,
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

export function localAgentIdentityFingerprint(input: {
  role: string;
  team: Array<{
    name: string;
    agentMarkdown: string;
    executionProfile: LocalConsoleExecutionProfile | null;
  }>;
}): string {
  return sha256({
    role: input.role,
    team: input.team.map((member) => ({
      name: member.name,
      agentMarkdown: member.agentMarkdown,
      executionProfile: member.executionProfile,
    })),
  });
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
  preferredIntentId?: string;
  intents: LocalCodexResumeIntentFact[];
  consumedIntentIds: ReadonlySet<string>;
  canonicalLinks?: LocalAgentSessionLinkFact[];
  observations?: LocalProviderSessionObservedFact[];
  executionLinks: LocalExecutionSessionLinkFact[];
  legacyCodexLinks: LocalCodexThreadLinkFact[];
  contexts: LocalRunExecutionContextFact[];
}): LocalExecutionRecoveryPlan {
  const intent = input.preferredIntentId === undefined
    ? [...input.intents]
        .reverse()
        .find((candidate) =>
          candidate.sourceMessageId === input.sourceMessageId
          && !input.consumedIntentIds.has(candidate.intentId)) ?? null
    : input.intents.find((candidate) =>
        candidate.intentId === input.preferredIntentId
        && candidate.sourceMessageId === input.sourceMessageId
        && !input.consumedIntentIds.has(candidate.intentId)) ?? null;
  const currentIdentity = contextIdentity(input.currentContext);
  const computedIdentity = localAgentIdentityFingerprint(input.currentContext);
  const computedContext = executionContextFingerprint(input.currentContext);
  if (
    input.currentContext.role !== input.role
    || currentIdentity !== computedIdentity
    || input.currentContext.contextFingerprint !== computedContext
  ) {
    return unavailable(input.currentContext, intent, "identity-invalid");
  }

  let context = input.currentContext;
  if (intent !== null) {
    const target = input.contexts.find((candidate) =>
      candidate.runId === intent.targetRunId
      && candidate.sessionId === input.currentContext.sessionId);
    if (target === undefined) {
      return unavailable(input.currentContext, intent, "run-context-missing");
    }
    context = normalizeContext(target);
    if (
      context.agentIdentityFingerprint !== localAgentIdentityFingerprint(context)
      || context.contextFingerprint !== executionContextFingerprint(context)
    ) {
      return unavailable(context, intent, "identity-invalid");
    }
  }
  const targetIdentity = contextIdentity(context);

  const canonical = (input.canonicalLinks ?? []).filter((link) =>
    link.sessionId === context.sessionId
    && link.agentIdentityFingerprint === targetIdentity);
  const incompatibleCanonical = canonical.find((link) =>
    link.role !== context.role
    || link.engine !== context.engine
    || link.profileFingerprint !== context.profileFingerprint
    || link.contextFingerprint !== context.contextFingerprint);
  if (incompatibleCanonical !== undefined) {
    if (incompatibleCanonical.engine !== context.engine) {
      return unavailable(context, intent, "engine-mismatch");
    }
    if (incompatibleCanonical.profileFingerprint !== context.profileFingerprint) {
      return unavailable(context, intent, "profile-mismatch");
    }
    return unavailable(context, intent, "context-mismatch");
  }

  const contextByRun = new Map(input.contexts.map((candidate) => [
    candidate.runId,
    normalizeContext(candidate),
  ]));
  const candidateIds = new Set(canonical.map((link) => link.externalSessionId));

  for (const link of input.executionLinks) {
    if (link.sessionId !== context.sessionId || link.role !== context.role) continue;
    const linkedContext = contextByRun.get(link.runId);
    const identity = link.agentIdentityFingerprint
      ?? (linkedContext === undefined ? null : contextIdentity(linkedContext));
    if (identity !== targetIdentity) continue;
    if (
      link.engine !== context.engine
      || link.profileFingerprint !== context.profileFingerprint
      || link.contextFingerprint !== context.contextFingerprint
    ) {
      return unavailable(context, intent, "context-mismatch");
    }
    candidateIds.add(link.externalSessionId);
  }

  if (context.engine === "codex") {
    for (const link of input.legacyCodexLinks) {
      if (link.sessionId !== context.sessionId || link.role !== context.role) continue;
      const linkedContext = contextByRun.get(link.runId);
      if (linkedContext === undefined || contextIdentity(linkedContext) !== targetIdentity) continue;
      const compatibleFingerprint = link.contextFingerprint == null
        || link.contextFingerprint === context.contextFingerprint
        || link.contextFingerprint === legacyCodexContextFingerprint(linkedContext);
      if (!compatibleFingerprint) {
        return unavailable(context, intent, "context-mismatch");
      }
      candidateIds.add(link.threadId);
    }
  }

  if (candidateIds.size > 1) {
    return unavailable(context, intent, "session-link-conflict");
  }
  const externalSessionId = [...candidateIds][0];
  if (externalSessionId !== undefined) {
    return {
      kind: "resume",
      intent,
      context,
      externalSessionId,
      canonicalLinkMissing: canonical.length === 0,
      reason: "compatible",
    };
  }

  const matchingObservations = (input.observations ?? []).filter((observation) =>
    observation.sessionId === context.sessionId
    && observation.agentIdentityFingerprint === targetIdentity);
  if (matchingObservations.some((observation) => observation.externalSessionId === null)) {
    return unavailable(context, intent, "provider-id-missing");
  }
  const observedIds = new Set(
    matchingObservations
      .map((observation) => observation.externalSessionId)
      .filter((value): value is string => value !== null),
  );
  if (observedIds.size > 1) {
    return unavailable(context, intent, "session-link-conflict");
  }
  const observedId = [...observedIds][0];
  if (observedId !== undefined) {
    return {
      kind: "resume",
      intent,
      context,
      externalSessionId: observedId,
      canonicalLinkMissing: true,
      reason: "compatible",
    };
  }

  if (intent !== null) {
    return unavailable(context, intent, "session-link-missing");
  }
  return {
    kind: "first",
    intent: null,
    context,
    reason: "no-provider-session",
  };
}

export async function readRunExecutionContexts(
  logPath: string,
  sessionId: string,
): Promise<LocalRunExecutionContextFact[]> {
  return (await readTypedFacts(logPath, sessionId, "run_execution_context"))
    .map((value) => normalizeContext(value as LocalRunExecutionContextFact));
}

export async function readExecutionSessionLinks(
  logPath: string,
  sessionId: string,
): Promise<LocalExecutionSessionLinkFact[]> {
  return readTypedFacts(logPath, sessionId, "execution_session_link") as Promise<LocalExecutionSessionLinkFact[]>;
}

export async function readAgentSessionLinks(
  logPath: string,
  sessionId: string,
): Promise<LocalAgentSessionLinkFact[]> {
  return readTypedFacts(logPath, sessionId, "agent_session_link") as Promise<LocalAgentSessionLinkFact[]>;
}

export async function readProviderSessionObservations(
  logPath: string,
  sessionId: string,
): Promise<LocalProviderSessionObservedFact[]> {
  return readTypedFacts(logPath, sessionId, "provider_session_observed") as Promise<LocalProviderSessionObservedFact[]>;
}

export async function readAgentTimelineCursors(
  logPath: string,
  sessionId: string,
): Promise<LocalAgentTimelineCursorFact[]> {
  return readTypedFacts(logPath, sessionId, "agent_timeline_cursor") as Promise<LocalAgentTimelineCursorFact[]>;
}

export function latestAgentTimelineCursor(
  cursors: readonly LocalAgentTimelineCursorFact[],
  agentIdentityFingerprint: string,
): LocalAgentTimelineCursorFact | null {
  return [...cursors]
    .reverse()
    .find((cursor) => cursor.agentIdentityFingerprint === agentIdentityFingerprint) ?? null;
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

function normalizeContext(
  context: LocalRunExecutionContextFact,
): LocalRunExecutionContextFact {
  return {
    ...context,
    agentIdentityFingerprint: contextIdentity(context),
  };
}

function contextIdentity(context: LocalRunExecutionContextFact): string {
  return typeof context.agentIdentityFingerprint === "string"
    && context.agentIdentityFingerprint !== ""
    ? context.agentIdentityFingerprint
    : localAgentIdentityFingerprint(context);
}

function unavailable(
  context: LocalRunExecutionContextFact,
  intent: LocalCodexResumeIntentFact | null,
  reason: Extract<LocalExecutionRecoveryPlan, { kind: "unavailable" }>["reason"],
): LocalExecutionRecoveryPlan {
  return { kind: "unavailable", intent, context, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function sha256(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
