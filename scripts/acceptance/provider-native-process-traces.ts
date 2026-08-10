import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, type ElectronApplication, type Locator, type Page } from "playwright";

import { runClaude } from "../../src/claude.js";
import { executionProfileFingerprint, type LocalRunExecutionContextFact } from "../../src/local-console/execution-context.js";
import {
  readProviderTraceContext,
  readProviderTracePage,
  resolveProviderTrace,
  type ProviderTraceLink,
  type ProviderTraceResolution,
} from "../../src/local-console/provider-process-trace.js";
import { createSqliteLocalConsoleStore } from "../../src/local-console/store.js";
import type { LocalConsoleExecutionProfile } from "../../src/local-console/types.js";
import { runKimiAcp } from "../../src/kimi.js";
import { resolveKimiRuntimeHomePaths } from "../../src/kimi-runtime-home.js";
import { createAcceptanceOutputDirectory } from "./temp-output.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const claudeOnly = process.argv.includes("--claude-only");
const evidenceDir = await createAcceptanceOutputDirectory("provider-native-process-traces");
const evidencePath = path.join(evidenceDir, "evidence.json");
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-provider-traces-"));
const workspace = path.join(runtimeRoot, "workspace");
const sessionLogRoot = path.join(runtimeRoot, "sessions");
const sqlitePath = path.join(runtimeRoot, ".state", "local-console.sqlite");
const marker = `MOEBIUS_NATIVE_TRACE_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const markerPath = path.join(workspace, "trace-marker.txt");
const claudeProfile = {
  cli: "claude",
  model: "sonnet",
  effort: "high",
} satisfies LocalConsoleExecutionProfile;
const kimiProfile = {
  cli: "kimi",
  model: "kimi-code/kimi-for-coding",
  effort: "on",
} satisfies LocalConsoleExecutionProfile;

await fs.mkdir(workspace, { recursive: true });
await fs.writeFile(markerPath, `${marker}\n`, "utf8");
await fs.writeFile(path.join(runtimeRoot, ".onboarding-completed"), `${new Date().toISOString()}\n`, "utf8");

const claudeFull = await runClaude({
  prompt: [
    "You must use the Read tool to read trace-marker.txt from the current working directory.",
    "Think through whether the file contents are trustworthy before answering.",
    `Reply with exactly: CLAUDE_FULL ${marker}`,
  ].join("\n"),
  runDir: path.join(runtimeRoot, "runs", "claude-full"),
  cwd: workspace,
  profile: claudeProfile,
  mode: { kind: "full" },
  idleTimeoutMs: 180_000,
  maxDurationMs: 300_000,
});
assertProviderRun("Claude full", claudeFull, `CLAUDE_FULL ${marker}`);
if (claudeFull.threadId === undefined) {
  throw new Error("Claude full run did not expose its exact session id");
}

const claudeResume = await runClaude({
  prompt: [
    "Use the Read tool again on trace-marker.txt.",
    "Think about whether this is the same file and session as before.",
    `Reply with exactly: CLAUDE_RESUME ${marker}`,
  ].join("\n"),
  runDir: path.join(runtimeRoot, "runs", "claude-resume"),
  cwd: workspace,
  profile: claudeProfile,
  mode: { kind: "resume", externalSessionId: claudeFull.threadId },
  idleTimeoutMs: 180_000,
  maxDurationMs: 300_000,
});
assertProviderRun("Claude resume", claudeResume, `CLAUDE_RESUME ${marker}`);
if (claudeResume.threadId !== claudeFull.threadId) {
  throw new Error("Claude resume changed the external session id");
}

const kimiHomes = resolveKimiRuntimeHomePaths({
  dataRoot: runtimeRoot,
  env: process.env,
});
let kimiRun: Extract<Awaited<ReturnType<typeof runKimiAcp>>, { ok: true }> | null = null;
let kimiOutputBlockedByQuota = false;
if (!claudeOnly) {
  const result = await runKimiAcp({
    prompt: [
      "You must use the file-reading tool to read trace-marker.txt from the current working directory.",
      "Think through whether the file contents are trustworthy before answering.",
      `Reply with exactly: KIMI_FULL ${marker}`,
    ].join("\n"),
    runDir: path.join(runtimeRoot, "runs", "kimi-full"),
    cwd: workspace,
    profile: kimiProfile,
    mode: { kind: "full" },
    runtimeHomePaths: kimiHomes,
    idleTimeoutMs: 180_000,
    maxDurationMs: 300_000,
  });
  assertSuccessfulProviderRun("Kimi full", result);
  kimiOutputBlockedByQuota = result.finalText.trim().length === 0;
  if (!kimiOutputBlockedByQuota && !result.finalText.includes(`KIMI_FULL ${marker}`)) {
    throw new Error("Kimi full returned an unexpected final reply");
  }
  if (result.threadId === undefined) {
    throw new Error("Kimi full run did not expose its exact session id");
  }
  kimiRun = result;
}

const store = await createSqliteLocalConsoleStore({
  sqlitePath,
  sessionLogRoot,
  timeoutMs: 10_000,
});
await store.init();
const project = await store.createProject({
  folderPath: workspace,
  worktreeMode: false,
  now: timestamp(0),
});
const claudeFixture = await seedProviderSession({
  store,
  projectId: project.projectId,
  title: "Claude 原生过程记录验收",
  role: "claude-dev",
  profile: claudeProfile,
  externalSessionId: claudeFull.threadId,
  replies: [
    { runId: "acceptance-claude-full", body: claudeFull.finalText, attempt: 1 },
    { runId: "acceptance-claude-resume", body: claudeResume.finalText, attempt: 2 },
  ],
});
const claudeDeletionFixture = await seedProviderSession({
  store,
  projectId: project.projectId,
  title: "Claude 原生过程记录删除验收",
  role: "claude-dev",
  profile: claudeProfile,
  externalSessionId: claudeFull.threadId,
  replies: [
    { runId: "acceptance-claude-deletion", body: claudeFull.finalText, attempt: 1 },
  ],
});
const kimiFixture = kimiRun === null
  ? null
  : await seedProviderSession({
      store,
      projectId: project.projectId,
      title: "Kimi 原生过程记录验收",
      role: "kimi-dev",
      profile: kimiProfile,
      externalSessionId: kimiRun.threadId!,
      replies: [
        { runId: "acceptance-kimi-full", body: kimiRun.finalText, attempt: 1 },
      ],
    });
await store.close();

const kimiIndexEvidence = kimiRun === null
  ? null
  : await prepareStaleKimiIndexEvidence({
      sourceHome: kimiHomes.sourceHome,
      managedHome: kimiHomes.managedHome,
      sessionId: kimiRun.threadId!,
      expectedWorkDir: workspace,
    });
const claudeResolution = await resolveProviderTrace({
  link: claudeFixture.links[0]!,
  context: claudeFixture.contexts[0],
  options: { dataRoot: runtimeRoot },
});
if (claudeResolution.status !== "available" || claudeResolution.engine !== "claude") {
  throw new Error(`Claude native transcript was not resolvable: ${claudeResolution.reason}`);
}
const kimiResolution = kimiFixture === null
  ? null
  : await resolveProviderTrace({
      link: kimiFixture.links[0]!,
      context: kimiFixture.contexts[0],
      options: { dataRoot: runtimeRoot },
    });
if (
  kimiResolution !== null
  && (kimiResolution.status !== "available" || kimiResolution.engine !== "kimi")
) {
  throw new Error(`Kimi native wire was not resolvable: ${kimiResolution.reason}`);
}
if (
  kimiResolution !== null
  && kimiIndexEvidence !== null
  && path.resolve(kimiResolution.file.filePath) !== kimiIndexEvidence.expectedSourceWirePath
) {
  throw new Error("Kimi native wire did not re-anchor from the stale managed path to source home");
}
const kimiProjectionEvidence = kimiResolution?.status === "available" && kimiResolution.engine === "kimi"
  ? await inspectKimiProjection(kimiResolution, marker)
  : null;

const assertions: Record<string, boolean | number | string> = {};
let application: ElectronApplication | null = null;
const claudeTranscriptPath = claudeResolution.file.filePath;
const transcriptBackupPath = path.join(runtimeRoot, "deleted-transcript-backup.jsonl");
let transcriptMoved = false;
const kimiWirePath = kimiResolution?.status === "available" && kimiResolution.engine === "kimi"
  ? kimiResolution.file.filePath
  : null;
const kimiWireBackupPath = path.join(runtimeRoot, "deleted-kimi-wire-backup.jsonl");
let kimiWireMoved = false;

try {
  application = await launchDesktop();
  const firstPage = await application.firstWindow();
  await assertProviderPage(firstPage, claudeFixture.sessionId, {
    engine: "Claude",
    marker,
    attemptFacts: [
      { attempt: 1, model: "sonnet", status: "completed", elapsed: "00:02" },
      { attempt: 2, model: "sonnet", status: "completed", elapsed: "00:03" },
    ],
  });
  assertions.claudeThinkingToolAndResultVisible = true;
  assertions.claudeResumeAttempts = 2;
  assertions.claudeThinkingLabel = "Thinking";
  assertions.claudeToolName = "Read";
  assertions.claudeToolResultMarker = marker;
  assertions.claudeAttemptFacts = "1:claude/sonnet/completed/00:02; 2:claude/sonnet/completed/00:03";
  process.stdout.write("PROVIDER_NATIVE_PROCESS_TRACE_PHASE=initial-page-passed\n");
  if (kimiFixture !== null) {
    if (kimiOutputBlockedByQuota) {
      await assertQuotaBlockedKimiPage(firstPage, kimiFixture.sessionId, marker);
      assertions.kimiQuotaBlockedNativePageVisible = true;
      assertions.kimiProviderMetadata = "kimi/kimi-for-coding/on/completed/00:02";
      assertions.kimiNativeSections = "SYSTEM_PROMPT; TURN_PROMPT; CONTEXT; LLM_REQUEST";
      assertions.kimiNativeEvents = "llm.tools_snapshot; llm.request";
      assertions.kimiMissingCliField = "该引擎未记录";
      assertions.kimiNoCodexContextShape = true;
    } else {
      await assertProviderPage(firstPage, kimiFixture.sessionId, {
        engine: "Kimi",
        marker,
        attemptFacts: [
          { attempt: 1, model: "kimi-code/kimi-for-coding", status: "completed", elapsed: "00:02" },
        ],
      });
      assertions.kimiThinkingToolAndResultVisible = true;
    }
    process.stdout.write("PROVIDER_NATIVE_PROCESS_TRACE_PHASE=kimi-page-passed\n");
  }
  await closeDesktop(application);
  application = null;

  application = await launchDesktop();
  const restartPage = await application.firstWindow();
  await assertProviderPage(restartPage, claudeFixture.sessionId, {
    engine: "Claude",
    marker,
    attemptFacts: [
      { attempt: 1, model: "sonnet", status: "completed", elapsed: "00:02" },
      { attempt: 2, model: "sonnet", status: "completed", elapsed: "00:03" },
    ],
  });
  assertions.restartRetainsNativeTrace = true;
  process.stdout.write("PROVIDER_NATIVE_PROCESS_TRACE_PHASE=restart-page-passed\n");
  await closeDesktop(application);
  application = null;

  if (kimiFixture !== null && kimiWirePath !== null) {
    await fs.rename(kimiWirePath, kimiWireBackupPath);
    kimiWireMoved = true;
    application = await launchDesktop();
    const deletedKimiPage = await application.firstWindow();
    await assertUnavailableProviderPage(
      deletedKimiPage,
      kimiFixture.sessionId,
      "Kimi 过程记录已不可用",
      marker,
    );
    assertions.deletedKimiWireUnavailableWithoutReplySubstitution = true;
    assertions.deletedKimiWireText = "Kimi 过程记录已不可用";
    await closeDesktop(application);
    application = null;
    await fs.mkdir(path.dirname(kimiWirePath), { recursive: true });
    await fs.rename(kimiWireBackupPath, kimiWirePath);
    kimiWireMoved = false;
    process.stdout.write("PROVIDER_NATIVE_PROCESS_TRACE_PHASE=deleted-kimi-source-page-passed\n");
  }

  await fs.rename(claudeTranscriptPath, transcriptBackupPath);
  transcriptMoved = true;
  application = await launchDesktop();
  const deletedPage = await application.firstWindow();
  await assertUnavailableProviderPage(
    deletedPage,
    claudeDeletionFixture.sessionId,
    "Claude 过程记录已不可用",
    marker,
  );
  assertions.deletedTranscriptUnavailableWithoutReplySubstitution = true;
  assertions.deletedTranscriptText = "Claude 过程记录已不可用";
  process.stdout.write("PROVIDER_NATIVE_PROCESS_TRACE_PHASE=deleted-source-page-passed\n");
} finally {
  if (application !== null) {
    await closeDesktop(application);
  }
  if (transcriptMoved) {
    await fs.mkdir(path.dirname(claudeTranscriptPath), { recursive: true });
    await fs.rename(transcriptBackupPath, claudeTranscriptPath);
  }
  if (kimiWireMoved && kimiWirePath !== null) {
    await fs.mkdir(path.dirname(kimiWirePath), { recursive: true });
    await fs.rename(kimiWireBackupPath, kimiWirePath);
  }
}

const pendingAssertions = kimiOutputBlockedByQuota
  ? [
      {
        id: "kimi-real-thinking-rendering",
        reason: "Kimi account usage limit returns HTTP 403 before any model response.",
      },
      {
        id: "kimi-real-tool-call-rendering",
        reason: "Kimi account usage limit returns HTTP 403 before any tool call.",
      },
      {
        id: "kimi-real-tool-result-rendering",
        reason: "Kimi account usage limit returns HTTP 403 before any tool result.",
      },
    ]
  : [];
const evidence = {
  ok: pendingAssertions.length === 0,
  status: pendingAssertions.length === 0 ? "complete" : "partial-account-quota-blocked",
  generatedAt: new Date().toISOString(),
  source: claudeOnly
    ? "real Claude CLI + provider-native JSONL + real Electron renderer/server (Kimi skipped)"
    : kimiOutputBlockedByQuota
      ? "real Claude CLI + quota-blocked real Kimi ACP CLI + provider-native JSONL + real Electron renderer/server"
      : "real Claude CLI + real Kimi ACP CLI + provider-native JSONL + real Electron renderer/server",
  cli: {
    claude: await commandVersion("claude"),
    kimi: await commandVersion("kimi"),
  },
  sessions: {
    claude: sessionDigest(claudeFull.threadId),
    kimi: kimiRun === null ? null : sessionDigest(kimiRun.threadId!),
    sameClaudeSessionAfterResume: claudeResume.threadId === claudeFull.threadId,
  },
  pendingAssertions,
  assertions,
  kimiResolver: kimiIndexEvidence === null || kimiProjectionEvidence === null
    ? null
    : {
        indexParsed: true,
        workDirKey: kimiIndexEvidence.workDirKey,
        workDirHashSuffix: kimiIndexEvidence.workDirHashSuffix,
        workDirHashValidated: true,
        staleManagedSessionDirUnavailable: true,
        sourceHomeReanchored: true,
        fileIdentityValidated: true,
        contextSections: kimiProjectionEvidence.contextSections,
        projectedProtocolTypes: kimiProjectionEvidence.projectedProtocolTypes,
      },
  nativeFiles: {
    claudeRestoredAfterDeletionCheck: await fileExists(claudeTranscriptPath),
    kimiWireResolved: kimiResolution !== null
      && kimiResolution.status === "available"
      && kimiResolution.engine === "kimi"
      ? {
          existsAfterDeletionRestore: await fileExists(kimiResolution.file.filePath),
          device: kimiResolution.identity.device,
          inode: kimiResolution.identity.inode,
          size: kimiResolution.identity.size,
        }
      : null,
  },
};
await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.stdout.write(`PROVIDER_NATIVE_PROCESS_TRACE_EVIDENCE=${evidencePath}\n`);
process.exit(0);

async function seedProviderSession(input: {
  store: Awaited<ReturnType<typeof createSqliteLocalConsoleStore>>;
  projectId: string;
  title: string;
  role: string;
  profile: LocalConsoleExecutionProfile;
  externalSessionId: string;
  replies: Array<{ runId: string; body: string; attempt: number }>;
}): Promise<{
  sessionId: string;
  contexts: LocalRunExecutionContextFact[];
  links: ProviderTraceLink[];
}> {
  const sessionId = `local:${randomUUID()}`;
  await input.store.createSession({
    sessionId,
    projectId: input.projectId,
    title: input.title,
    now: timestamp(10),
  });
  const user = await input.store.appendUserMessage({
    sessionId,
    body: `${input.role} 读取 trace-marker.txt 并确认 ${marker}`,
    now: timestamp(11),
  });
  const first = input.replies[0]!;
  await input.store.claimNextPendingMessage({
    sessionId,
    runId: first.runId,
    now: timestamp(12),
  });
  const contexts: LocalRunExecutionContextFact[] = [];
  const links: ProviderTraceLink[] = [];
  for (const [index, reply] of input.replies.entries()) {
    const context = executionContext({
      sessionId,
      runId: reply.runId,
      sourceMessageId: user.id,
      role: input.role,
      profile: input.profile,
    });
    const link: ProviderTraceLink = {
      sessionId,
      runId: reply.runId,
      sourceMessageId: user.id,
      role: input.role,
      engine: input.profile.cli,
      externalSessionId: input.externalSessionId,
      contextFingerprint: context.contextFingerprint,
      startedAt: timestamp(13 + index * 10),
    };
    contexts.push(context);
    links.push(link);
    await input.store.recordRunLifecycleEvent({
      sessionId,
      runId: reply.runId,
      stepId: `message:${String(user.id)}`,
      attempt: reply.attempt,
      phase: "created",
      role: input.role,
      engine: input.profile.cli,
      processOutputAvailable: true,
      createdAt: timestamp(12 + index * 10),
      startedAt: null,
      elapsedMs: null,
      completedAt: null,
      status: "queued",
      recordedAt: timestamp(12 + index * 10),
    });
    await input.store.recordRunLifecycleEvent({
      sessionId,
      runId: reply.runId,
      stepId: `message:${String(user.id)}`,
      attempt: reply.attempt,
      phase: "started",
      role: input.role,
      engine: input.profile.cli,
      processOutputAvailable: true,
      createdAt: timestamp(12 + index * 10),
      startedAt: timestamp(13 + index * 10),
      elapsedMs: 0,
      completedAt: null,
      status: "running",
      recordedAt: timestamp(13 + index * 10),
    });
    await input.store.recordRunExecutionContext(context);
    await input.store.recordExecutionSessionLink(link);
    if (index === 0) {
      await input.store.recordAgentResponse({
        userMessageId: user.id,
        sessionId,
        role: input.role,
        body: reply.body,
        runId: reply.runId,
        runDir: path.join(runtimeRoot, "runs", reply.runId),
        processSteps: [],
        now: timestamp(15 + index * 10),
      });
    } else {
      await input.store.recordDetachedAgentResponse({
        sessionId,
        role: input.role,
        body: reply.body,
        runId: reply.runId,
        runDir: path.join(runtimeRoot, "runs", reply.runId),
        processSteps: [],
        now: timestamp(15 + index * 10),
      });
    }
    await input.store.recordRunLifecycleEvent({
      sessionId,
      runId: reply.runId,
      stepId: `message:${String(user.id)}`,
      attempt: reply.attempt,
      phase: "terminal",
      role: input.role,
      engine: input.profile.cli,
      processOutputAvailable: true,
      createdAt: timestamp(12 + index * 10),
      startedAt: timestamp(13 + index * 10),
      elapsedMs: 2_000 + index * 1_000,
      completedAt: timestamp(15 + index * 10),
      status: "completed",
      recordedAt: timestamp(15 + index * 10),
    });
  }
  return { sessionId, contexts, links };
}

function executionContext(input: {
  sessionId: string;
  runId: string;
  sourceMessageId: number;
  role: string;
  profile: LocalConsoleExecutionProfile;
}): LocalRunExecutionContextFact {
  const profileFingerprint = executionProfileFingerprint(input.profile);
  const identity = `acceptance:${input.profile.cli}:${input.role}`;
  return {
    sessionId: input.sessionId,
    runId: input.runId,
    sourceMessageId: input.sourceMessageId,
    role: input.role,
    engine: input.profile.cli,
    profile: input.profile,
    profileFingerprint,
    agentIdentityFingerprint: identity,
    contextFingerprint: createHash("sha256")
      .update(`${identity}:${workspace}:${profileFingerprint}`)
      .digest("hex"),
    workspace: {
      cwd: workspace,
      mode: "direct",
      worktreePath: null,
      worktreeUnavailableReason: null,
      branchName: null,
      baseRef: null,
      originalRepoRoot: null,
    },
    team: [],
    recordedAt: timestamp(12),
  };
}

async function prepareStaleKimiIndexEvidence(input: {
  sourceHome: string;
  managedHome: string;
  sessionId: string;
  expectedWorkDir: string;
}): Promise<{
  workDirKey: string;
  workDirHashSuffix: string;
  expectedSourceWirePath: string;
}> {
  const indexPath = path.join(input.sourceHome, "session_index.jsonl");
  const indexText = await fs.readFile(indexPath, "utf8");
  const completeText = indexText.endsWith("\n")
    ? indexText
    : indexText.slice(0, Math.max(0, indexText.lastIndexOf("\n") + 1));
  const matches = completeText
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as unknown)
    .filter((value): value is { sessionId: string; sessionDir: string; workDir: string } =>
      typeof value === "object"
      && value !== null
      && "sessionId" in value
      && value.sessionId === input.sessionId
      && "sessionDir" in value
      && typeof value.sessionDir === "string"
      && "workDir" in value
      && typeof value.workDir === "string");
  if (matches.length !== 1) {
    throw new Error(`Kimi index expected one exact session entry, received ${String(matches.length)}`);
  }
  const mapping = matches[0]!;
  if (path.resolve(mapping.workDir) !== path.resolve(input.expectedWorkDir)) {
    throw new Error("Kimi index workDir does not match the execution workspace");
  }
  if (!path.resolve(mapping.sessionDir).startsWith(`${path.resolve(input.managedHome)}${path.sep}`)) {
    throw new Error("Kimi index did not preserve the managed-home absolute sessionDir");
  }
  const workDirKey = path.basename(path.dirname(path.resolve(mapping.sessionDir)));
  const workDirHashSuffix = createHash("sha256")
    .update(path.resolve(mapping.workDir))
    .digest("hex")
    .slice(0, 12);
  if (!workDirKey.endsWith(`_${workDirHashSuffix}`)) {
    throw new Error("Kimi workDirKey SHA-256 suffix does not match index workDir");
  }
  const managedSessionsLink = path.join(input.managedHome, "sessions");
  const [managedSessionsStat, sourceSessionsRoot, managedSessionsRoot] = await Promise.all([
    fs.lstat(managedSessionsLink),
    fs.realpath(path.join(input.sourceHome, "sessions")),
    fs.realpath(managedSessionsLink),
  ]);
  if (!managedSessionsStat.isSymbolicLink() || managedSessionsRoot !== sourceSessionsRoot) {
    throw new Error("Kimi managed sessions entry is not the expected source-home link");
  }
  const expectedSourceWirePath = await fs.realpath(path.join(
    sourceSessionsRoot,
    workDirKey,
    input.sessionId,
    "agents",
    "main",
    "wire.jsonl",
  ));
  await fs.unlink(managedSessionsLink);
  if (await fileExists(mapping.sessionDir)) {
    throw new Error("Kimi managed index sessionDir remained reachable after its temporary link was removed");
  }
  return {
    workDirKey,
    workDirHashSuffix,
    expectedSourceWirePath,
  };
}

async function inspectKimiProjection(
  resolution: Extract<ProviderTraceResolution, { status: "available"; engine: "kimi" }>,
  expectedMarker: string,
): Promise<{
  contextSections: string[];
  projectedProtocolTypes: string[];
}> {
  const context = await readProviderTraceContext(resolution);
  if ("status" in context) {
    throw new Error(`Kimi native context could not be read: ${context.reason}`);
  }
  const sections = new Map(context.sections.map((section) => [section.key, section]));
  const requiredSections = ["system", "turn", "context", "request"] as const;
  for (const key of requiredSections) {
    if (sections.get(key)?.status !== "recorded") {
      throw new Error(`Kimi native context section ${key} was not recorded`);
    }
  }
  if (!sections.get("system")!.contents.some((content) => content.includes("You are Kimi Code CLI"))) {
    throw new Error("Kimi systemPrompt was not projected from wire");
  }
  if (!sections.get("turn")!.contents.some((content) => content.includes(expectedMarker))) {
    throw new Error("Kimi turn.prompt marker was not projected from wire");
  }
  if (
    !sections.get("request")!.contents.some((content) =>
      content.includes("\"provider\": \"kimi\"")
      && content.includes("\"modelAlias\": \"kimi-code/kimi-for-coding\""))
  ) {
    throw new Error("Kimi llm.request metadata was not projected from wire");
  }
  const page = await readProviderTracePage({
    resolution,
    runId: "acceptance-kimi-full",
    maxBytes: 1024 * 1024,
    maxEvents: 1_000,
  });
  const projectedProtocolTypes = [...new Set(page.events.map((event) => event.protocolType))];
  for (const protocolType of ["llm.tools_snapshot", "llm.request"]) {
    if (!projectedProtocolTypes.includes(protocolType)) {
      throw new Error(`Kimi projected events are missing ${protocolType}`);
    }
  }
  if (page.events.some((event) => event.engine !== "kimi")) {
    throw new Error("Kimi projected events contain another engine");
  }
  return {
    contextSections: context.sections.map((section) => `${section.label}:${section.status}`),
    projectedProtocolTypes,
  };
}

async function launchDesktop(): Promise<ElectronApplication> {
  return await electron.launch({
    args: [path.join(projectRoot, "desktop")],
    cwd: path.join(projectRoot, "desktop"),
    env: {
      ...process.env,
      MOEBIUS_DATA_ROOT: runtimeRoot,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
  });
}

async function closeDesktop(application: ElectronApplication): Promise<void> {
  const child = application.process();
  let timer: NodeJS.Timeout | null = null;
  await Promise.race([
    application.close().catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
        resolve();
      }, 10_000);
    }),
  ]);
  if (timer !== null) clearTimeout(timer);
}

async function assertQuotaBlockedKimiPage(
  page: Page,
  sessionId: string,
  expectedMarker: string,
): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "设置" }).waitFor({ timeout: 20_000 });
  await selectSession(page, sessionId);
  await page.getByText(`kimi-dev 读取 trace-marker.txt 并确认 ${expectedMarker}`, { exact: true })
    .waitFor({ timeout: 20_000 });
  const outputButton = seededAttemptOutputButton(page);
  await outputButton.waitFor({ timeout: 20_000 });
  await outputButton.click();
  const processTab = page.getByTestId("process-tab");
  await processTab.waitFor({ timeout: 20_000 });
  await processTab.getByText("acceptance-kimi-full", { exact: true }).waitFor({ timeout: 20_000 });
  const expectedVisibleText = [
    "第 1 次执行",
    "completed",
    "00:02",
    "llm.tools_snapshot",
    "llm.request",
    "未识别事件",
  ];
  let visibleText = "";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    visibleText = await processTab.innerText();
    if (expectedVisibleText.every((expected) => visibleText.includes(expected))) {
      break;
    }
    await page.waitForTimeout(100);
  }
  for (const expected of expectedVisibleText) {
    if (!visibleText.includes(expected)) {
      throw new Error(`Quota-blocked Kimi page is missing ${expected}`);
    }
  }
  if (visibleText.includes("DEVELOPER_PROMPT") || visibleText.includes("USER_INPUT")) {
    throw new Error("Quota-blocked Kimi page rendered Codex context sections");
  }
  await processTab.evaluate((element) => {
    const scroller = element.parentElement;
    if (scroller !== null) {
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event("scroll"));
    }
  });
  await processTab.locator('[data-index="0"]').waitFor({ timeout: 20_000 });
  const engineValue = processTab.locator("dt", { hasText: /^engine$/u })
    .locator("xpath=following-sibling::dd[1]");
  const cliValue = processTab.locator("dt", { hasText: /^CLI$/u })
    .locator("xpath=following-sibling::dd[1]");
  if ((await engineValue.innerText()).trim() !== "kimi") {
    throw new Error("Quota-blocked Kimi page did not label the attempt as kimi");
  }
  if ((await cliValue.innerText()).trim() !== "该引擎未记录") {
    throw new Error("Quota-blocked Kimi page did not mark the missing CLI field as unrecorded");
  }
  for (const label of ["SYSTEM_PROMPT", "TURN_PROMPT", "CONTEXT", "LLM_REQUEST"]) {
    await processTab.getByText(label, { exact: true }).waitFor({ timeout: 20_000 });
  }
  await processTab.getByText("SYSTEM_PROMPT", { exact: true }).click();
  await processTab.getByText(/You are Kimi Code CLI/u).first().waitFor({ timeout: 20_000 });
  await processTab.getByText("TURN_PROMPT", { exact: true }).click();
  await processTab.getByText(expectedMarker, { exact: false }).first().waitFor({ timeout: 20_000 });
  await processTab.getByText("CONTEXT", { exact: true }).click();
  await processTab.getByText("LLM_REQUEST", { exact: true }).click();
  await processTab.getByText(/"provider": "kimi"/u).first().waitFor({ timeout: 20_000 });
  const metadata = new Map<string, string>();
  for (const label of ["model", "effort", "provider", "CLI", "engine"]) {
    const value = processTab.locator("dt", { hasText: new RegExp(`^${label}$`, "u") })
      .locator("xpath=following-sibling::dd[1]");
    metadata.set(label, (await value.innerText()).trim());
  }
  const expectedMetadata = {
    model: "kimi-for-coding",
    effort: "on",
    provider: "kimi",
    CLI: "该引擎未记录",
    engine: "kimi",
  };
  for (const [label, expected] of Object.entries(expectedMetadata)) {
    if (metadata.get(label) !== expected) {
      throw new Error(`Quota-blocked Kimi page ${label} metadata was ${metadata.get(label) ?? "missing"}`);
    }
  }
}

async function assertUnavailableProviderPage(
  page: Page,
  sessionId: string,
  expectedMessage: string,
  forbiddenMarker: string,
): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "设置" }).waitFor({ timeout: 20_000 });
  await selectSession(page, sessionId);
  const role = expectedMessage.startsWith("Kimi") ? "kimi-dev" : "claude-dev";
  await page.getByText(`${role} 读取 trace-marker.txt 并确认 ${forbiddenMarker}`, { exact: true })
    .waitFor({ timeout: 20_000 });
  await seededAttemptOutputButton(page).click();
  const processTab = page.getByTestId("process-tab");
  await processTab.waitFor({ timeout: 20_000 });
  await processTab.getByText(expectedMessage, { exact: true }).first().waitFor({ timeout: 20_000 });
  const text = await processTab.innerText();
  if (text.includes(forbiddenMarker)) {
    throw new Error(`${expectedMessage} was replaced with provider or final-reply content`);
  }
}

function seededAttemptOutputButton(page: Page): Locator {
  return page.locator("[data-testid^='timeline-message-']")
    .filter({ hasText: "耗时 00:02" })
    .filter({ has: page.getByRole("button", { name: "完整输出" }) })
    .getByRole("button", { name: "完整输出" })
    .first();
}

async function assertProviderPage(
  page: Page,
  sessionId: string,
  expected: {
    engine: "Claude" | "Kimi";
    marker: string;
    attemptFacts: Array<{ attempt: number; model: string; status: string; elapsed: string }>;
  },
): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "设置" }).waitFor({ timeout: 20_000 });
  await selectSession(page, sessionId);
  await page.getByText(
    `${expected.engine.toLowerCase()}-dev 读取 trace-marker.txt 并确认 ${expected.marker}`,
    { exact: true },
  ).waitFor({ timeout: 20_000 });
  const seededOutput = page.locator("[data-testid^='timeline-message-']")
    .filter({ hasText: `耗时 ${expected.attemptFacts.at(-1)!.elapsed}` })
    .filter({ has: page.getByRole("button", { name: "完整输出" }) })
    .getByRole("button", { name: "完整输出" })
    .first();
  await seededOutput.waitFor({ timeout: 20_000 });
  await seededOutput.click();
  const processTab = page.getByTestId("process-tab");
  await processTab.waitFor({ timeout: 20_000 });
  const text = await collectVirtualizedProcessText(processTab);
  if (!text.includes("Thinking")) {
    throw new Error(`${expected.engine} thinking event is missing`);
  }
  if (!text.includes(expected.engine.toLowerCase())) {
    throw new Error(`${expected.engine} provider metadata is missing`);
  }
  if (!text.includes(expected.marker)) {
    throw new Error(`${expected.engine} tool result marker is missing`);
  }
  if (!/Read|read_file|read/u.test(text)) {
    throw new Error(`${expected.engine} tool call is missing`);
  }
  for (const fact of expected.attemptFacts) {
    if (
      !text.includes(`第 ${String(fact.attempt)} 次执行`)
      || !text.includes(fact.model)
      || !text.includes(fact.status)
      || !text.includes(fact.elapsed)
    ) {
      throw new Error(`${expected.engine} attempt ${String(fact.attempt)} metadata is missing`);
    }
  }
}

async function collectVirtualizedProcessText(processTab: Locator): Promise<string> {
  const collected = new Set<string>();
  await processTab.page().waitForTimeout(500);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await processTab.evaluate((element) => {
      const scroller = element.parentElement;
      if (scroller !== null) {
        scroller.scrollTop = 0;
        scroller.dispatchEvent(new Event("scroll"));
      }
    });
    await processTab.page().waitForTimeout(100);
    if (await processTab.locator('[data-index="0"]').count() > 0) break;
    if (attempt === 19) {
      throw new Error("Process trace did not render its first virtualized event");
    }
  }
  for (let index = 0; index < 100; index += 1) {
    await processTab.page().waitForTimeout(50);
    collected.add(await processTab.innerText());
    const atBottom = await processTab.evaluate((element) => {
      const scroller = element.parentElement;
      if (scroller === null) return true;
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      if (scroller.scrollTop >= maximum - 1) return true;
      scroller.scrollTop = Math.min(maximum, scroller.scrollTop + Math.max(1, scroller.clientHeight * 0.75));
      scroller.dispatchEvent(new Event("scroll"));
      return false;
    });
    if (atBottom) break;
  }
  return [...collected].join("\n");
}

async function selectSession(page: Page, sessionId: string): Promise<void> {
  const row = page.locator(`[data-testid='conversation-sidebar-session'][data-session-id="${sessionId}"]`);
  await row.waitFor({ timeout: 20_000 });
  await row.click();
  await page.waitForFunction((id) => {
    const target = document.querySelector(
      `[data-testid='conversation-sidebar-session'][data-session-id="${String(id)}"]`,
    );
    return target?.getAttribute("aria-current") === "page";
  }, sessionId);
}

function assertProviderRun(
  label: string,
  result: Awaited<ReturnType<typeof runClaude>>,
  expectedText: string,
): asserts result is Extract<Awaited<ReturnType<typeof runClaude>>, { ok: true }> {
  assertSuccessfulProviderRun(label, result);
  if (!result.finalText.includes(expectedText)) {
    throw new Error(`${label} returned an unexpected final reply`);
  }
}

function assertSuccessfulProviderRun(
  label: string,
  result: Awaited<ReturnType<typeof runClaude>>,
): asserts result is Extract<Awaited<ReturnType<typeof runClaude>>, { ok: true }> {
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.reason}`);
  }
}

function timestamp(offsetSeconds: number): string {
  return new Date(Date.UTC(2026, 6, 30, 8, 0, offsetSeconds)).toISOString();
}

function sessionDigest(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 12);
}

async function commandVersion(command: string): Promise<string> {
  const { execFile } = await import("node:child_process");
  return await new Promise((resolve, reject) => {
    execFile(command, ["--version"], { timeout: 10_000 }, (error, stdout) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
