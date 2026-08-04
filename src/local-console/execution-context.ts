import crypto from "node:crypto";
import path from "node:path";

import type { LocalCodexResumeIntentFact } from "./codex-resume.js";
import type { LocalCodexThreadLinkFact } from "./codex-thread-link.js";
import type { LocalConsoleAgentTeamSnapshot, LocalConsoleExecutionProfile } from "./types.js";
import type { ResolvedLocalWorkspace } from "./workspace-source.js";

export interface LocalRunExecutionContextFact {
  sessionId: string;
  runId: string;
  sourceMessageId: number;
  role: string;
  engine: "codex" | "claude" | "kimi";
  profile: LocalConsoleExecutionProfile | null;
  profileFingerprint: string;
  agentIdentityFingerprint: string;
  identitySalt?: string;
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
  teamSnapshot?: LocalConsoleAgentTeamSnapshot;
  /** Legacy facts may contain this field; normalization strips it before runtime reuse. */
  referenceContext?: string | null;
  recordedAt: string;
}

export interface LocalExecutionSessionLinkFact {
  sessionId: string;
  runId: string;
  sourceMessageId: number;
  role: string;
  engine: "codex" | "claude" | "kimi";
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
  engine: "codex" | "claude" | "kimi";
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
  engine: "codex" | "claude" | "kimi";
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

export interface LocalProviderProcessStartedFact {
  sessionId: string;
  runId: string;
  role: string;
  engine: "codex" | "claude" | "kimi";
  startedAt: string;
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

export interface LocalExecutionContextSeed {
  profile: LocalConsoleExecutionProfile | null;
  workspace: ResolvedLocalWorkspace;
  identitySalt?: string;
  preferredIntentId?: string;
}

export type LocalRecoveryAvailabilityCheck =
  | {
      kind: "required";
      externalSessionId: string;
      recoveryPlan: Extract<LocalExecutionRecoveryPlan, { kind: "resume" }>;
    }
  | { kind: "skip" };

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

export function singleRunOverrideIdentitySalt(input: {
  overrideId: string;
  profile: LocalConsoleExecutionProfile;
}): string {
  return `${input.overrideId}:${executionProfileFingerprint(input.profile)}`;
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
  teamSnapshot?: LocalConsoleAgentTeamSnapshot | null;
  recordedAt: string;
  identitySalt?: string;
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
    identitySalt: input.identitySalt,
  });
  const contextFingerprint = executionContextFingerprint({
    role: input.role,
    engine,
    profileFingerprint,
    workspace,
    team: input.team,
    identitySalt: input.identitySalt,
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
    ...(input.identitySalt === undefined ? {} : { identitySalt: input.identitySalt }),
    contextFingerprint,
    workspace,
    team: input.team.map((member) => ({
      name: member.name,
      agentMarkdown: member.agentMarkdown,
      executionProfile: member.executionProfile,
    })),
    ...(input.teamSnapshot == null ? {} : { teamSnapshot: input.teamSnapshot }),
    recordedAt: input.recordedAt,
  };
}

export function planLocalRunExecutionContext(input: {
  sessionId: string;
  runId: string;
  sourceMessageId: number;
  role: string;
  seed: LocalExecutionContextSeed;
  team: Array<{
    name: string;
    agentMarkdown: string;
    executionProfile: LocalConsoleExecutionProfile | null;
  }>;
  teamSnapshot?: LocalConsoleAgentTeamSnapshot | null;
  recordedAt: string;
}): LocalRunExecutionContextFact {
  return createRunExecutionContext({
    sessionId: input.sessionId,
    runId: input.runId,
    sourceMessageId: input.sourceMessageId,
    role: input.role,
    profile: input.seed.profile,
    workspace: input.seed.workspace,
    team: input.team,
    teamSnapshot: input.teamSnapshot,
    recordedAt: input.recordedAt,
    ...(input.seed.identitySalt === undefined ? {} : { identitySalt: input.seed.identitySalt }),
  });
}

export function planLocalExecutionRecoveryFromSeed(input: {
  sourceMessageId: number;
  role: string;
  currentContext: LocalRunExecutionContextFact;
  seed: LocalExecutionContextSeed;
  intents: LocalCodexResumeIntentFact[];
  consumedIntentIds: ReadonlySet<string>;
  canonicalLinks?: LocalAgentSessionLinkFact[];
  observations?: LocalProviderSessionObservedFact[];
  executionLinks: LocalExecutionSessionLinkFact[];
  legacyCodexLinks: LocalCodexThreadLinkFact[];
  contexts: LocalRunExecutionContextFact[];
}): LocalExecutionRecoveryPlan {
  return planLocalExecutionRecovery({
    sourceMessageId: input.sourceMessageId,
    role: input.role,
    currentContext: input.currentContext,
    ...(input.seed.preferredIntentId === undefined
      ? {}
      : { preferredIntentId: input.seed.preferredIntentId }),
    intents: input.intents,
    consumedIntentIds: input.consumedIntentIds,
    canonicalLinks: input.canonicalLinks,
    observations: input.observations,
    executionLinks: input.executionLinks,
    legacyCodexLinks: input.legacyCodexLinks,
    contexts: input.contexts,
  });
}

export function planLocalExecutionContextSeed(input: {
  lane: "primary" | "worker";
  sessionId: string;
  runId: string;
  sourceMessageId: number;
  role: string;
  defaultProfile: LocalConsoleExecutionProfile | null;
  defaultWorkspace: ResolvedLocalWorkspace;
  concurrentWorkspace: ResolvedLocalWorkspace | null;
  intents: readonly LocalCodexResumeIntentFact[];
  consumedIntentIds: ReadonlySet<string>;
  contexts: readonly LocalRunExecutionContextFact[];
}): LocalExecutionContextSeed {
  const exactRecovery = exactGracefulRecoveryContext(input);
  if (exactRecovery !== null) {
    return input.lane === "primary"
      ? {
          profile: exactRecovery.context.profile,
          workspace: workspaceFromExecutionContext(exactRecovery.context),
          ...(exactRecovery.context.identitySalt === undefined
            ? {}
            : { identitySalt: exactRecovery.context.identitySalt }),
          preferredIntentId: exactRecovery.intent.intentId,
        }
      : {
          profile: input.defaultProfile,
          workspace: workspaceFromExecutionContext(exactRecovery.context),
          preferredIntentId: exactRecovery.intent.intentId,
        };
  }

  const overrideIntent = input.lane === "primary"
    ? [...input.intents].reverse().find((intent) =>
        intent.sourceMessageId === input.sourceMessageId
        && intent.reason === "retry"
        && intent.executionOverride !== undefined
        && !input.consumedIntentIds.has(intent.intentId))
    : undefined;
  const baseWorkspace = input.concurrentWorkspace ?? input.defaultWorkspace;
  if (overrideIntent?.executionOverride !== undefined) {
    return {
      profile: overrideIntent.executionOverride.profile,
      workspace: baseWorkspace,
      identitySalt: singleRunOverrideIdentitySalt(overrideIntent.executionOverride),
    };
  }
  return {
    profile: input.defaultProfile,
    workspace: baseWorkspace,
  };
}

export function planLocalRecoveryAvailabilityCheck(
  recoveryPlan: LocalExecutionRecoveryPlan,
): LocalRecoveryAvailabilityCheck {
  return recoveryPlan.kind === "resume" && recoveryPlan.context.engine === "codex"
    ? { kind: "required", externalSessionId: recoveryPlan.externalSessionId, recoveryPlan }
    : { kind: "skip" };
}

export function decideLocalRecoveryAvailability(
  recoveryPlan: Extract<LocalExecutionRecoveryPlan, { kind: "resume" }>,
  available: boolean,
): LocalExecutionRecoveryPlan {
  return available
    ? recoveryPlan
    : {
        kind: "unavailable",
        intent: recoveryPlan.intent,
        context: recoveryPlan.context,
        reason: "rollout-unavailable",
      };
}

export function workspaceFromExecutionContext(
  context: LocalRunExecutionContextFact,
): ResolvedLocalWorkspace {
  return {
    cwd: path.resolve(context.workspace.cwd),
    mode: context.workspace.mode === "worktree" ? "worktree" : "direct",
    worktreePath: context.workspace.worktreePath,
    worktreeUnavailableReason: context.workspace.worktreeUnavailableReason,
    branchName: context.workspace.branchName,
    baseRef: context.workspace.baseRef,
    originalRepoRoot: context.workspace.originalRepoRoot,
  };
}

export function exactGracefulRecoveryContext(input: {
  sessionId: string;
  runId: string;
  sourceMessageId: number;
  role: string;
  intents: readonly LocalCodexResumeIntentFact[];
  consumedIntentIds: ReadonlySet<string>;
  contexts: readonly LocalRunExecutionContextFact[];
}): {
  context: LocalRunExecutionContextFact;
  intent: LocalCodexResumeIntentFact;
} | null {
  const intents = input.intents.filter((intent) =>
    intent.reason === "graceful-shutdown"
    && intent.targetRunId === input.runId
    && intent.sourceMessageId === input.sourceMessageId
    && intent.role === input.role
    && !input.consumedIntentIds.has(intent.intentId));
  if (intents.length !== 1) return null;
  const relatedContexts = input.contexts.filter((context) =>
    context.runId === input.runId
    || context.sourceMessageId === input.sourceMessageId);
  if (
    relatedContexts.length !== 1
    || relatedContexts[0]?.sessionId !== input.sessionId
    || relatedContexts[0]?.runId !== input.runId
    || relatedContexts[0]?.sourceMessageId !== input.sourceMessageId
    || relatedContexts[0]?.role !== input.role
  ) {
    return null;
  }
  return { context: relatedContexts[0], intent: intents[0] };
}

export function localAgentIdentityFingerprint(input: {
  role: string;
  team: Array<{
    name: string;
    agentMarkdown: string;
    executionProfile: LocalConsoleExecutionProfile | null;
  }>;
  identitySalt?: string;
}): string {
  return sha256({
    role: input.role,
    team: input.team.map((member) => ({
      name: member.name,
      agentMarkdown: member.agentMarkdown,
      executionProfile: member.executionProfile,
    })),
    ...(input.identitySalt === undefined ? {} : { identitySalt: input.identitySalt }),
  });
}

export function executionContextFingerprint(input: {
  role: string;
  engine: "codex" | "claude" | "kimi";
  profileFingerprint: string;
  workspace: { cwd: string; mode: string };
  team: Array<{
    name: string;
    agentMarkdown: string;
    executionProfile: LocalConsoleExecutionProfile | null;
  }>;
  identitySalt?: string;
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
    ...(input.identitySalt === undefined ? {} : { identitySalt: input.identitySalt }),
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
    if (intent.executionOverride !== undefined) {
      const expectedIdentitySalt = singleRunOverrideIdentitySalt(intent.executionOverride);
      if (
        input.currentContext.profile?.cli !== intent.executionOverride.profile.cli
        || input.currentContext.profile.model !== intent.executionOverride.profile.model
        || input.currentContext.profile.effort !== intent.executionOverride.profile.effort
        || input.currentContext.identitySalt !== expectedIdentitySalt
      ) {
        return unavailable(input.currentContext, intent, "profile-mismatch");
      }
      return {
        kind: "first",
        intent,
        context: input.currentContext,
        reason: "no-provider-session",
      };
    }
    const target = input.contexts.find((candidate) =>
      candidate.runId === intent.targetRunId
      && candidate.sessionId === input.currentContext.sessionId);
    if (target === undefined) {
      return unavailable(input.currentContext, intent, "run-context-missing");
    }
    context = normalizeRunExecutionContext(target);
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
    normalizeRunExecutionContext(candidate),
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
    return {
      kind: "first",
      intent,
      context,
      reason: "no-provider-session",
    };
  }
  return {
    kind: "first",
    intent: null,
    context,
    reason: "no-provider-session",
  };
}

export function projectExecutionFactPayloads(
  values: readonly unknown[],
  sessionId: string,
  type: string,
): unknown[] {
  const payloads: unknown[] = [];
  for (const [index, event] of values.entries()) {
    if (!isRecord(event) || event.sessionId !== sessionId) {
      throw new Error(`invalid session fact event ${sessionId} line ${String(index + 1)}`);
    }
    if (event.type === type) payloads.push(event.payload);
  }
  return payloads;
}

export function latestAgentTimelineCursor(
  cursors: readonly LocalAgentTimelineCursorFact[],
  agentIdentityFingerprint: string,
): LocalAgentTimelineCursorFact | null {
  return [...cursors]
    .reverse()
    .find((cursor) => cursor.agentIdentityFingerprint === agentIdentityFingerprint) ?? null;
}

export function planLatestAgentTimelineIndex(
  cursors: readonly LocalAgentTimelineCursorFact[],
  agentIdentityFingerprint: string,
): number {
  return latestAgentTimelineCursor(cursors, agentIdentityFingerprint)?.lastSeenIndex ?? -1;
}

export function normalizeRunExecutionContext(
  context: LocalRunExecutionContextFact,
): LocalRunExecutionContextFact {
  const normalized = {
    ...context,
    agentIdentityFingerprint: contextIdentity(context),
  };
  delete normalized.referenceContext;
  return normalized;
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

function sha256(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
