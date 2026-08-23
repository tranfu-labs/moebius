import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  isClaudeThinkingDisplaySupported,
  isSupportedClaudeCliVersion,
  MINIMUM_CLAUDE_CLI_VERSION,
} from "./claude-cli-version.js";
import {
  ClaudeExecutableError,
  resolveClaudeExecutable,
} from "./claude-executable.js";
import {
  CLAUDE_TUI_MULTILINE_SUBMIT_SETTLE_MS,
  CLAUDE_TUI_TRANSCRIPT_RETRY_INTERVAL_MS,
  CLAUDE_TUI_TRANSCRIPT_SETTLE_TIMEOUT_MS,
} from "./config.js";
import {
  ClaudeTuiLifecycleReceiver,
  type ClaudeTuiLifecycleEvent,
  type ClaudeTuiLifecycleHandle,
} from "./claude-tui-lifecycle.js";
import { createNodePtyFactory } from "./claude-tui-node-pty.js";
import {
  ClaudeTuiTransport,
  type ClaudeTuiPtyFactory,
  type ClaudeTuiTransportEvent,
} from "./claude-tui-transport.js";
import { ClaudeTuiWorkspaceTrustDetector } from "./claude-tui-workspace-trust.js";
import {
  captureClaudeTuiTranscriptRecordCount,
  resolveClaudeTuiTranscriptFinal,
  type ClaudeTuiTranscriptFinal,
} from "./claude-tui-transcript.js";
import type { CodexRunResult } from "./codex.js";
import {
  planExecutionFailureTerminal,
  type CodexRunFailure,
} from "./execution-failure-plan.js";
import {
  executionInterruptionCause,
  type ExecutionInterruptionCause,
  type ExecutionProgressEvent,
} from "./execution-contract.js";
import type { LocalExecutionMode, ManagedProcessMcpInvocation } from "./local-console/execution-driver.js";
import type { LocalConsoleExecutionProfile } from "./local-console/types.js";

const DEFAULT_VERSION_TIMEOUT_MS = 5_000;
const DEFAULT_TUI_IDLE_TIMEOUT_MS = 10 * 60 * 1_000;
const DEFAULT_TUI_TERMINATION_GRACE_MS = 1_000;
const DEFAULT_TERMINAL_COLUMNS = 120;
const DEFAULT_TERMINAL_ROWS = 40;

export const CLAUDE_INTERNAL_AGENT_TOOLS = Object.freeze([
  "Agent",
  "Task",
  "AskUserQuestion",
  "SendMessage",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskUpdate",
  "TaskOutput",
  "TaskStop",
] as const);

export interface ClaudeRunOptions {
  prompt: string;
  runDir: string;
  cwd: string;
  profile: LocalConsoleExecutionProfile & { cli: "claude" };
  mode: LocalExecutionMode;
  signal?: AbortSignal;
  idleTimeoutMs?: number;
  toolTimeoutMs?: number;
  maxDurationMs?: number;
  versionTimeoutMs?: number;
  interruptTerminationDelayMs?: number;
  interruptKillDelayMs?: number;
  executablePath?: string;
  resolveExecutable?: typeof resolveClaudeExecutable;
  runVersion?: typeof runClaudeVersion;
  /** Retained only for source compatibility; TUI execution never spawns a print-mode child. */
  spawnProcess?: unknown;
  extraArgs?: readonly string[];
  permissionMode?: "auto" | "dontAsk";
  onVisibleAgentMarkdown?: (text: string) => void;
  /** Raw PTY output for the Claude-only read-only terminal trace. */
  onTerminalData?: (data: string | Uint8Array) => void;
  onProcessStarted?: () => void | Promise<void>;
  onStructuredActivity?: (event: unknown) => void;
  onExecutionProgress?: (event: ExecutionProgressEvent) => void;
  onSessionStarted?: (sessionId: string) => void | Promise<void>;
  /**
   * Legacy invocation-scoped injection for test and standalone callers.  The
   * production TUI path owns a stable relay and uses a per-turn lease instead.
   */
  mcpServer?: ManagedProcessMcpInvocation | null;
  managedProcess?: { sessionId: string; providerRunId: string };
  tuiRuntime?: ClaudeTuiRuntime;
}

export interface ClaudeTuiManagedProcessLease {
  acquireTurn(input: { providerRunId: string }): Promise<ManagedProcessMcpInvocation>;
  close(): Promise<void>;
}

export interface ClaudeTuiRuntimeOptions {
  lifecycleReceiver: Pick<ClaudeTuiLifecycleReceiver, "createSession">;
  createPtyFactory?: () => Promise<ClaudeTuiPtyFactory>;
  createManagedProcessLease?: (input: {
    sessionId: string;
    canonicalSessionId: string;
    workspaceRoot: string;
  }) => ClaudeTuiManagedProcessLease;
  resolveTranscript?: (input: {
    sessionId: string;
    cwd: string;
    afterRecordCount?: number;
  }) => Promise<ClaudeTuiTranscriptFinal>;
  terminalColumns?: number;
  terminalRows?: number;
  terminationGraceMs?: number;
}

interface ClaudeTuiSession {
  sessionId: string;
  cwd: string;
  model: string;
  effort: string;
  permissionMode: "auto" | "dontAsk";
  transport: ClaudeTuiTransport;
  generation: ClaudeTuiGeneration | null;
  activeTurn: ClaudeTuiTurn | null;
  cleanup: Promise<void>;
}

interface ClaudeTuiGeneration {
  lifecycle: ClaudeTuiLifecycleHandle;
  lease: ClaudeTuiManagedProcessLease | null;
  mcpConfigPath: string | null;
  supportsManagedRelay: boolean;
}

interface ClaudeTuiTurn {
  options: ClaudeRunOptions;
  paths: ClaudeRunPaths;
  resolve: (result: CodexRunResult) => void;
  result: Promise<CodexRunResult>;
  managedInvocation: ManagedProcessMcpInvocation | null;
  ownsManagedInvocation: boolean;
  activated: boolean;
  inputState: "live" | "awaiting-terminal" | "terminal-ready";
  workspaceTrustDetector: ClaudeTuiWorkspaceTrustDetector | null;
  workspaceTrustAutoConfirmed: boolean;
  transcriptAfterRecordCount: number | null;
  inputWritten: boolean;
  initialSubmitPending: boolean;
  initialSubmitTimer: NodeJS.Timeout | null;
  settled: boolean;
  abortListener: (() => void) | null;
}

interface ClaudeRunPaths {
  runDir: string;
  stdoutPath: string;
  stderrPath: string;
}

interface SupportedClaudeExecutable {
  executable: string;
  version: string;
}

/**
 * Owns canonical Claude sessions for one LocalConsoleRuntime lifetime.  It
 * treats the PTY as an opaque terminal: only human input enters it and only a
 * lifecycle Stop permits transcript lookup for the final response.
 */
export class ClaudeTuiRuntime {
  private readonly sessions = new Map<string, ClaudeTuiSession>();
  private ptyFactory: Promise<ClaudeTuiPtyFactory> | null = null;
  private closed = false;

  constructor(private readonly dependencies: ClaudeTuiRuntimeOptions) {}

  async run(options: ClaudeRunOptions): Promise<CodexRunResult> {
    const paths = createRunPaths(options.runDir);
    if (this.closed) {
      return failed("claude-cli-spawn-failed", "Claude TUI 运行时已经关闭。", paths);
    }
    if (isSignalAborted(options.signal)) {
      return cancelled(paths, options.signal);
    }

    const sessionId = options.mode.kind === "resume"
      ? options.mode.externalSessionId
      : randomUUID();
    let session = this.sessions.get(sessionId);
    if (session === undefined) {
      try {
        session = await this.createSession(sessionId, options);
      } catch {
        return failed("claude-cli-spawn-failed", "Claude TUI 初始化失败，请检查安装后重试。", paths);
      }
      this.sessions.set(sessionId, session);
    } else if (!matchesSession(session, options)) {
      return failed(
        "claude-protocol-invalid",
        "Claude session 与当前冻结运行配置不一致。",
        paths,
      );
    }
    if (session.activeTurn !== null) {
      return failed(
        "claude-protocol-invalid",
        "Claude TUI 当前仍在处理上一轮输入。",
        paths,
        undefined,
        sessionId,
      );
    }

    const turn = createTurn(options, paths);
    session.activeTurn = turn;
    turn.abortListener = () => {
      void this.settleFailure(
        session!,
        turn,
        cancelled(paths, options.signal),
        true,
      );
    };
    options.signal?.addEventListener("abort", turn.abortListener, { once: true });

    try {
      if (isSignalAborted(options.signal)) {
        return await this.settleFailure(session, turn, cancelled(paths, options.signal), true);
      }
      const snapshot = session.transport.getSnapshot();
      if (snapshot !== null && snapshot.state === "stopping") {
        return await this.settleFailure(session, turn, failed(
          "claude-resume-unavailable",
          "原 Claude 执行正在结束，请稍后重试。",
          paths,
          undefined,
          sessionId,
        ));
      }
      if (snapshot === null) {
        await session.cleanup;
        const executable = await this.resolveSupportedExecutable(options, paths);
        if ("ok" in executable) {
          return await this.settleFailure(session, turn, executable);
        }
        const generation = await this.prepareGeneration(session, options);
        session.generation = generation;
        await this.prepareManagedInvocation(session, generation, turn);
        await this.startGeneration(session, generation, turn, executable);
      } else {
        const generation = session.generation;
        if (generation === null) {
          return await this.settleFailure(session, turn, failed(
            "claude-protocol-invalid",
            "Claude TUI 生命周期状态不完整。",
            paths,
            undefined,
            sessionId,
          ), true);
        }
        await this.prepareManagedInvocation(session, generation, turn);
        if (turn.managedInvocation !== null && !generation.supportsManagedRelay) {
          return await this.settleFailure(session, turn, failed(
            "claude-protocol-invalid",
            "当前 Claude TUI 没有可用的托管运行项 relay。",
            paths,
            undefined,
            sessionId,
          ));
        }
      }
      if (turn.settled) return await turn.result;
      await this.activateTurn(session, turn);
      return await turn.result;
    } catch {
      return await this.settleFailure(session, turn, failed(
        "claude-cli-spawn-failed",
        "Claude Code 启动失败，请检查安装后重试。",
        paths,
        undefined,
        sessionId,
      ), session.transport.getSnapshot() !== null);
    } finally {
      options.signal?.removeEventListener("abort", turn.abortListener ?? (() => undefined));
      this.discardUnstartedSession(session);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const closing = [...this.sessions.values()].map(async (session) => {
      if (session.activeTurn !== null) {
        await this.settleFailure(session, session.activeTurn, failed(
          "claude-cancelled",
          "Claude 执行已取消。",
          session.activeTurn.paths,
          undefined,
          session.sessionId,
          "",
          "runtime-closing",
        ), true);
      } else {
        session.transport.terminate();
      }
      await session.cleanup;
      if (session.generation !== null) {
        await this.cleanupGeneration(session.generation);
        session.generation = null;
      }
    });
    await Promise.all(closing);
    this.sessions.clear();
  }

  private async createSession(sessionId: string, options: ClaudeRunOptions): Promise<ClaudeTuiSession> {
    const factory = await this.getPtyFactory();
    let session: ClaudeTuiSession;
    const transport = new ClaudeTuiTransport({
      factory,
      idleTimeoutMs: options.idleTimeoutMs ?? DEFAULT_TUI_IDLE_TIMEOUT_MS,
      terminationGraceMs: options.interruptTerminationDelayMs ?? this.dependencies.terminationGraceMs ?? DEFAULT_TUI_TERMINATION_GRACE_MS,
      onEvent: (event) => this.handleTransportEvent(session, event),
    });
    session = {
      sessionId,
      cwd: path.resolve(options.cwd),
      model: options.profile.model,
      effort: options.profile.effort,
      permissionMode: options.permissionMode ?? "auto",
      transport,
      generation: null,
      activeTurn: null,
      cleanup: Promise.resolve(),
    };
    return session;
  }

  private async getPtyFactory(): Promise<ClaudeTuiPtyFactory> {
    if (this.ptyFactory === null) {
      this.ptyFactory = (this.dependencies.createPtyFactory ?? createNodePtyFactory)();
    }
    return await this.ptyFactory;
  }

  private async resolveSupportedExecutable(
    options: ClaudeRunOptions,
    paths: ClaudeRunPaths,
  ): Promise<SupportedClaudeExecutable | CodexRunResult> {
    let executable: string;
    try {
      executable = options.executablePath ?? await (options.resolveExecutable ?? resolveClaudeExecutable)({
        pathValue: process.env.PATH,
        cwd: options.cwd,
        homeDir: os.homedir(),
      });
    } catch (error) {
      if (error instanceof ClaudeExecutableError) {
        return failed(error.code, error.safeMessage, paths);
      }
      return failed("claude-cli-spawn-failed", "暂时无法启动 Claude Code。", paths);
    }
    try {
      const version = await (options.runVersion ?? runClaudeVersion)(
        executable,
        options.versionTimeoutMs ?? DEFAULT_VERSION_TIMEOUT_MS,
        options.signal,
      );
      if (!isSupportedClaudeCliVersion(version)) {
        return failed(
          "claude-cli-unsupported-version",
          `Claude Code 版本过旧，需要 ${MINIMUM_CLAUDE_CLI_VERSION} 或更高版本。`,
          paths,
          "update-claude",
        );
      }
      return { executable, version };
    } catch (error) {
      if (isSignalAborted(options.signal)) return cancelled(paths, options.signal);
      return failed(
        "claude-cli-spawn-failed",
        error instanceof ClaudeVersionError ? error.safeMessage : "暂时无法检查 Claude Code 版本。",
        paths,
      );
    }
  }

  private async prepareGeneration(
    session: ClaudeTuiSession,
    options: ClaudeRunOptions,
  ): Promise<ClaudeTuiGeneration> {
    const lifecycle = this.dependencies.lifecycleReceiver.createSession({
      sessionId: session.sessionId,
      runDir: options.runDir,
      onEvent: (event) => this.handleLifecycleEvent(session, event),
    });
    const lease = options.managedProcess === undefined || this.dependencies.createManagedProcessLease === undefined
      ? null
      : this.dependencies.createManagedProcessLease({
          sessionId: options.managedProcess.sessionId,
          canonicalSessionId: session.sessionId,
          workspaceRoot: session.cwd,
        });
    return {
      lifecycle,
      lease,
      mcpConfigPath: null,
      supportsManagedRelay: lease !== null || options.mcpServer !== null && options.mcpServer !== undefined,
    };
  }

  private async prepareManagedInvocation(
    session: ClaudeTuiSession,
    generation: ClaudeTuiGeneration,
    turn: ClaudeTuiTurn,
  ): Promise<void> {
    if (generation.lease !== null) {
      const managed = turn.options.managedProcess;
      if (managed === undefined) return;
      turn.managedInvocation = await generation.lease.acquireTurn({ providerRunId: managed.providerRunId });
      turn.ownsManagedInvocation = true;
    } else if (turn.options.mcpServer !== null && turn.options.mcpServer !== undefined) {
      turn.managedInvocation = turn.options.mcpServer;
      turn.ownsManagedInvocation = false;
    }
    await turn.managedInvocation?.preflight?.();
    if (session.transport.getSnapshot() !== null && turn.managedInvocation !== null && !generation.supportsManagedRelay) {
      throw new Error("Claude TUI relay was not present at process startup.");
    }
  }

  private async startGeneration(
    session: ClaudeTuiSession,
    generation: ClaudeTuiGeneration,
    turn: ClaudeTuiTurn,
    executable: SupportedClaudeExecutable,
  ): Promise<void> {
    await fs.mkdir(path.join(turn.paths.runDir, "input-attachments"), {
      recursive: true,
      mode: 0o700,
    });
    const mcpConfigPath = turn.managedInvocation === null
      ? null
      : await writeManagedMcpConfig(turn.paths.runDir, turn.managedInvocation);
    generation.mcpConfigPath = mcpConfigPath;
    await generation.lifecycle.writeSettings();
    turn.inputState = "awaiting-terminal";
    turn.workspaceTrustDetector = new ClaudeTuiWorkspaceTrustDetector();
    session.transport.start({
      executable: executable.executable,
      args: buildClaudeArgs(turn.options, {
        sessionId: session.sessionId,
        settingsPath: generation.lifecycle.settingsPath,
        ...(mcpConfigPath === null ? {} : { mcpConfigPath }),
        cliVersion: executable.version,
      }),
      cwd: session.cwd,
      env: buildClaudeEnvironment(process.env),
      columns: this.dependencies.terminalColumns ?? DEFAULT_TERMINAL_COLUMNS,
      rows: this.dependencies.terminalRows ?? DEFAULT_TERMINAL_ROWS,
    });
    generation.lifecycle.markSessionStarted();
  }

  private async activateTurn(session: ClaudeTuiSession, turn: ClaudeTuiTurn): Promise<void> {
    if (isSignalAborted(turn.options.signal)) {
      await this.settleFailure(session, turn, cancelled(turn.paths, turn.options.signal), true);
      return;
    }
    await turn.options.onProcessStarted?.();
    await turn.options.onSessionStarted?.(session.sessionId);
    if (isSignalAborted(turn.options.signal)) {
      await this.settleFailure(session, turn, cancelled(turn.paths, turn.options.signal), true);
      return;
    }
    if (this.dependencies.resolveTranscript === undefined) {
      // The cursor distinguishes a later turn's final assistant record from a
      // prior reply in the same persistent Claude transcript. It is optional
      // for a first session whose transcript has not been created yet.
      turn.transcriptAfterRecordCount = await captureClaudeTuiTranscriptRecordCount({
        sessionId: session.sessionId,
        cwd: session.cwd,
      });
    }
    if (isSignalAborted(turn.options.signal)) {
      await this.settleFailure(session, turn, cancelled(turn.paths, turn.options.signal), true);
      return;
    }
    turn.activated = true;
    this.advanceInitialInput(session, turn);
  }

  private handleLifecycleEvent(session: ClaudeTuiSession, event: ClaudeTuiLifecycleEvent): void {
    if (event.sessionId !== session.sessionId) return;
    if (event.type === "turn-stopped") {
      const turn = session.activeTurn;
      if (turn !== null && turn.inputWritten) {
        void this.finishStoppedTurn(session, turn);
      }
      return;
    }
    if (event.type === "session-ended") {
      const turn = session.activeTurn;
      if (turn !== null) {
        void this.settleFailure(session, turn, failed(
          "claude-resume-unavailable",
          "原 Claude 执行已经无法继续。",
          turn.paths,
          undefined,
          session.sessionId,
        ), true);
      } else {
        session.transport.terminate();
      }
    }
  }

  private handleTransportEvent(session: ClaudeTuiSession, event: ClaudeTuiTransportEvent): void {
    if (event.type === "data") {
      this.forwardTerminalData(session, event.data);
      this.scheduleDeferredInitialPrompt(session);
      this.handleBootstrapTerminalData(session, event);
      return;
    }
    if (event.type !== "exit") return;
    const generation = session.generation;
    if (generation === null) return;
    session.generation = null;
    const turn = session.activeTurn;
    if (turn !== null) {
      void this.settleFailure(session, turn, failed(
        turn.options.mode.kind === "resume" ? "claude-resume-unavailable" : "claude-cli-spawn-failed",
        turn.options.mode.kind === "resume"
          ? "原 Claude 执行已经无法继续。"
          : "Claude Code 未能完成本次执行。",
        turn.paths,
        undefined,
        session.sessionId,
      ));
    }
    session.cleanup = this.cleanupGeneration(generation).catch(() => undefined);
  }

  /**
   * PTY output is only a terminal projection. A trace delivery is deliberately
   * fire-and-forget so a renderer failure cannot affect lifecycle, transcript,
   * or the live Claude PTY.
   */
  private forwardTerminalData(session: ClaudeTuiSession, data: string | Uint8Array): void {
    const turn = session.activeTurn;
    if (turn === null || turn.settled) return;
    try {
      turn.options.onTerminalData?.(data);
    } catch {
      // Terminal observation is non-authoritative and must never alter a run.
    }
  }

  private scheduleDeferredInitialPrompt(session: ClaudeTuiSession): void {
    const turn = session.activeTurn;
    if (turn === null || turn.settled || !turn.initialSubmitPending) return;
    if (turn.initialSubmitTimer !== null) clearTimeout(turn.initialSubmitTimer);
    turn.initialSubmitTimer = setTimeout(() => {
      turn.initialSubmitTimer = null;
      if (turn.settled || session.activeTurn !== turn || !turn.initialSubmitPending) return;
      turn.initialSubmitPending = false;
      try {
        session.transport.writeHumanInput("\r");
      } catch {
        void this.settleFailure(session, turn, failed(
          "claude-cli-spawn-failed",
          "Claude Code 在提交输入前已退出。",
          turn.paths,
          undefined,
          session.sessionId,
        ), true);
      }
    }, CLAUDE_TUI_MULTILINE_SUBMIT_SETTLE_MS);
  }

  private handleBootstrapTerminalData(
    session: ClaudeTuiSession,
    event: Extract<ClaudeTuiTransportEvent, { type: "data" }>,
  ): void {
    const turn = session.activeTurn;
    if (
      turn === null
      || turn.settled
      || turn.inputWritten
      || turn.workspaceTrustDetector === null
      || turn.inputState !== "awaiting-terminal"
    ) {
      return;
    }
    const detection = turn.workspaceTrustDetector.observe(event.data);
    if (detection === "workspace-trust-required") {
      this.automaticallyConfirmWorkspaceTrust(session, turn);
      return;
    }
    if (detection === "terminal-ready") {
      turn.inputState = "terminal-ready";
      this.advanceInitialInput(session, turn);
    }
  }

  private advanceInitialInput(session: ClaudeTuiSession, turn: ClaudeTuiTurn): void {
    if (turn.settled || session.activeTurn !== turn || !turn.activated || turn.inputWritten) return;
    if (turn.inputState === "awaiting-terminal") return;
    turn.inputWritten = true;
    turn.inputState = "live";
    // Once the task is written, terminal bytes are never inspected for trust
    // prompts. This makes the native safety gate non-spoofable by Agent text.
    turn.workspaceTrustDetector = null;
    try {
      this.writeInitialPrompt(session, turn);
    } catch {
      void this.settleFailure(session, turn, failed(
        "claude-cli-spawn-failed",
        "Claude Code 在接收输入前已退出。",
        turn.paths,
        undefined,
        session.sessionId,
      ), true);
    }
  }

  /**
   * Claude's multiline editor treats a carriage return delivered in the same
   * PTY write as pasted text as part of that paste.  Keep the text and the
   * submit key as distinct terminal writes when the human prompt spans lines.
   * The Enter waits for a terminal redraw to settle, which proves the TUI has
   * consumed the text write instead of folding the key into the same paste.
   */
  private writeInitialPrompt(session: ClaudeTuiSession, turn: ClaudeTuiTurn): void {
    const prompt = turn.options.prompt;
    if (!/[\r\n]/u.test(prompt)) {
      session.transport.writeHumanInput(`${prompt}\r`);
      return;
    }
    session.transport.writeHumanInput(prompt);
    turn.initialSubmitPending = true;
  }

  /**
   * The user-selected product behavior is to accept the one native Claude
   * workspace-trust prompt before the first task reaches the TUI. The detector
   * has already constrained this path to that prompt and is switched to
   * normal-prompt-only observation before the key reaches the PTY.
   */
  private automaticallyConfirmWorkspaceTrust(session: ClaudeTuiSession, turn: ClaudeTuiTurn): void {
    if (!turn.activated || turn.settled || turn.workspaceTrustAutoConfirmed) return;
    void this.confirmWorkspaceTrustNativeDefault(session, turn);
  }

  private async confirmWorkspaceTrustNativeDefault(session: ClaudeTuiSession, turn: ClaudeTuiTurn): Promise<boolean> {
    const detector = turn.workspaceTrustDetector;
    if (detector === null || turn.workspaceTrustAutoConfirmed) return false;
    turn.workspaceTrustAutoConfirmed = true;
    detector.resetAfterTrust();
    turn.inputState = "awaiting-terminal";
    try {
      // Claude's native prompt has option 1 focused and explicitly asks for
      // Enter to confirm. Confirm that visible default rather than rely on
      // an undocumented numeric shortcut.
      session.transport.writeHumanInput("\r");
      return true;
    } catch {
      await this.settleFailure(session, turn, failed(
        "claude-cli-spawn-failed",
        "Claude Code 在确认工作区信任前已退出。",
        turn.paths,
        undefined,
        session.sessionId,
      ), true);
      return false;
    }
  }

  private async finishStoppedTurn(session: ClaudeTuiSession, turn: ClaudeTuiTurn): Promise<void> {
    if (turn.settled || session.activeTurn !== turn) return;
    await this.releaseManagedInvocation(turn);
    let result: CodexRunResult;
    try {
      const transcript = await resolveStoppedClaudeTranscript(
        this.dependencies.resolveTranscript ?? resolveClaudeTuiTranscriptFinal,
        {
          sessionId: session.sessionId,
          cwd: session.cwd,
          ...(turn.transcriptAfterRecordCount === null
            ? {}
            : { afterRecordCount: turn.transcriptAfterRecordCount }),
        },
      );
      if (turn.settled || session.activeTurn !== turn) return;
      result = transcript.status === "available"
        ? {
            ok: true,
            finalText: transcript.finalText,
            threadId: session.sessionId,
            cachedInputTokens: transcript.cachedInputTokens,
            runDir: turn.paths.runDir,
            stdoutPath: turn.paths.stdoutPath,
            stderrPath: turn.paths.stderrPath,
            terminal: {
              kind: "completed",
              externalSessionId: session.sessionId,
              finalText: transcript.finalText,
            },
          }
        : failed(
            "claude-protocol-invalid",
            "Claude Code 没有返回可显示的回答。",
            turn.paths,
            undefined,
            session.sessionId,
          );
    } catch {
      result = failed(
        "claude-protocol-invalid",
        "Claude Code 的最终记录无法安全读取。",
        turn.paths,
        undefined,
        session.sessionId,
      );
    }
    this.settleTurn(session, turn, result);
    try {
      session.transport.markTurnIdle();
    } catch {
      // A concurrent SessionEnd/exit already owns cleanup and the completed
      // result remains valid because it was resolved from Stop-delimited data.
    }
  }

  private async settleFailure(
    session: ClaudeTuiSession,
    turn: ClaudeTuiTurn,
    result: CodexRunResult,
    terminate = false,
  ): Promise<CodexRunResult> {
    if (turn.settled) return await turn.result;
    await this.releaseManagedInvocation(turn);
    this.settleTurn(session, turn, result);
    if (terminate) session.transport.terminate();
    return await turn.result;
  }

  private settleTurn(session: ClaudeTuiSession, turn: ClaudeTuiTurn, result: CodexRunResult): void {
    if (turn.settled) return;
    turn.settled = true;
    if (turn.initialSubmitTimer !== null) {
      clearTimeout(turn.initialSubmitTimer);
      turn.initialSubmitTimer = null;
    }
    turn.initialSubmitPending = false;
    turn.options.signal?.removeEventListener("abort", turn.abortListener ?? (() => undefined));
    if (session.activeTurn === turn) session.activeTurn = null;
    turn.resolve(result);
  }

  private async releaseManagedInvocation(turn: ClaudeTuiTurn): Promise<void> {
    const invocation = turn.managedInvocation;
    turn.managedInvocation = null;
    if (invocation !== null && turn.ownsManagedInvocation) {
      await Promise.resolve(invocation.close()).catch(() => undefined);
    }
    turn.ownsManagedInvocation = false;
  }

  private async cleanupGeneration(generation: ClaudeTuiGeneration): Promise<void> {
    if (generation.lease !== null) {
      await generation.lease.close().catch(() => undefined);
    }
    await generation.lifecycle.dispose().catch(() => undefined);
    if (generation.mcpConfigPath !== null) {
      await fs.unlink(generation.mcpConfigPath).catch(() => undefined);
    }
  }

  private discardUnstartedSession(session: ClaudeTuiSession): void {
    if (session.activeTurn !== null || session.generation !== null || session.transport.getSnapshot() !== null) return;
    this.sessions.delete(session.sessionId);
  }
}

export function createClaudeTuiRunner(runtime: ClaudeTuiRuntime): (
  options: ClaudeRunOptions,
) => Promise<CodexRunResult> {
  return async (options) => await runtime.run(options);
}

/**
 * Compatibility entry point for direct callers.  Production must provide the
 * LocalConsole-owned runtime so lifecycle hooks and a PTY survive between
 * turns; a one-off caller is rejected rather than silently falling back to
 * print/stream-json mode.
 */
export async function runClaude(options: ClaudeRunOptions): Promise<CodexRunResult> {
  if (options.tuiRuntime !== undefined) return await options.tuiRuntime.run(options);
  return failed(
    "claude-cli-spawn-failed",
    "Claude TUI 运行时未配置。",
    createRunPaths(options.runDir),
  );
}

export function buildClaudeArgs(
  options: Pick<ClaudeRunOptions, "prompt" | "runDir" | "profile" | "mode" | "extraArgs" | "permissionMode">,
  launch: {
    sessionId: string;
    settingsPath: string;
    mcpConfigPath?: string;
    cliVersion: string;
  },
): string[] {
  return [
    ...(options.mode.kind === "resume"
      ? ["--resume", launch.sessionId]
      : ["--session-id", launch.sessionId]),
    "--model", options.profile.model,
    "--effort", options.profile.effort,
    "--permission-mode", options.permissionMode ?? "auto",
    "--disallowedTools", CLAUDE_INTERNAL_AGENT_TOOLS.join(","),
    "--add-dir", path.resolve(options.runDir, "input-attachments"),
    "--settings", launch.settingsPath,
    ...(launch.mcpConfigPath === undefined ? [] : ["--mcp-config", launch.mcpConfigPath]),
    ...(isClaudeThinkingDisplaySupported(launch.cliVersion)
      ? ["--thinking-display", "summarized"]
      : []),
    ...(options.extraArgs ?? []),
  ];
}

export function buildClaudeEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.CLAUDE_CODE_EFFORT_LEVEL;
  delete env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
  delete env.CLAUDE_AUTO_BACKGROUND_TASKS;
  delete env.CLAUDE_CODE_FORWARD_SUBAGENT_TEXT;
  env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = "1";
  return env;
}

export async function runClaudeVersion(
  executablePath: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(executablePath, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: process.env,
    });
    let stdout = "";
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error === undefined) resolve(stdout.trim());
      else reject(error);
    };
    const abort = (): void => {
      child.kill("SIGKILL");
      finish(new ClaudeVersionError("Claude Code 版本检查已取消。"));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new ClaudeVersionError("Claude Code 版本检查超时。"));
    }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < 4_096) stdout += chunk.toString("utf8");
    });
    child.on("error", () => finish(new ClaudeVersionError("暂时无法检查 Claude Code 版本。")));
    child.on("close", (code) => {
      if (code !== 0 || stdout.trim().length === 0) {
        finish(new ClaudeVersionError("Claude Code 没有返回有效版本。"));
        return;
      }
      finish();
    });
  });
}

export function classifyClaudeResult(event: Record<string, unknown>): CodexRunFailure | null {
  if (event.type !== "result" || event.is_error !== true) return null;
  const codes = collectClaudeMachineCodes(event).join(" ");
  if (/auth|login|unauthenticated/iu.test(codes)) {
    return { code: "claude-auth-required", message: "Claude Code 尚未登录。" };
  }
  if (/rate.?limit|too_many_requests/iu.test(codes)) {
    return { code: "claude-rate-limited", message: "Claude 服务当前触发了速率限制，请稍后重试。" };
  }
  if (/billing|credit|payment/iu.test(codes)) {
    return { code: "claude-billing-unavailable", message: "Claude 账户当前无法使用推理额度。" };
  }
  if (/model|effort/iu.test(codes)) {
    return { code: "claude-profile-invalid", message: "保存的 Claude 模型或思考程度当前不可用。" };
  }
  if (/permission|tool/iu.test(codes)) {
    return { code: "claude-permission-denied", message: "Claude Code 拒绝了当前权限或工具策略。" };
  }
  if (/resume|session/iu.test(codes)) {
    return { code: "claude-resume-unavailable", message: "原 Claude 执行已经无法继续。" };
  }
  if (/service|overload|unavailable/iu.test(codes)) {
    return { code: "claude-service-unavailable", message: "Claude 服务暂时不可用，请稍后重试。" };
  }
  return { code: "claude-service-unavailable", message: "Claude Code 本次执行失败，请稍后重试。" };
}

function createRunPaths(runDir: string): ClaudeRunPaths {
  const resolvedRunDir = path.resolve(runDir);
  return {
    runDir: resolvedRunDir,
    stdoutPath: path.join(resolvedRunDir, "claude-tui-terminal.log"),
    stderrPath: path.join(resolvedRunDir, "claude-tui-stderr.log"),
  };
}

function createTurn(options: ClaudeRunOptions, paths: ClaudeRunPaths): ClaudeTuiTurn {
  let resolve!: (result: CodexRunResult) => void;
  const result = new Promise<CodexRunResult>((next) => {
    resolve = next;
  });
  return {
    options,
    paths,
    resolve,
    result,
    managedInvocation: null,
    ownsManagedInvocation: false,
    activated: false,
    inputState: "live",
    workspaceTrustDetector: null,
    workspaceTrustAutoConfirmed: false,
    transcriptAfterRecordCount: null,
    inputWritten: false,
    initialSubmitPending: false,
    initialSubmitTimer: null,
    settled: false,
    abortListener: null,
  };
}

function matchesSession(session: ClaudeTuiSession, options: ClaudeRunOptions): boolean {
  return session.cwd === path.resolve(options.cwd)
    && session.model === options.profile.model
    && session.effort === options.profile.effort
    && session.permissionMode === (options.permissionMode ?? "auto");
}

/**
 * A Claude Stop hook can precede the append of its final transcript record.
 * Retry only write-in-progress states after Stop; identity and trusted-path
 * failures remain fail-closed on the first observation.
 */
async function resolveStoppedClaudeTranscript(
  resolver: (input: { sessionId: string; cwd: string; afterRecordCount?: number }) => Promise<ClaudeTuiTranscriptFinal>,
  input: { sessionId: string; cwd: string; afterRecordCount?: number },
): Promise<ClaudeTuiTranscriptFinal> {
  const deadline = Date.now() + CLAUDE_TUI_TRANSCRIPT_SETTLE_TIMEOUT_MS;
  let transcript = await resolver(input);
  while (
    transcript.status === "unavailable"
    && isTransientStoppedTranscriptUnavailable(transcript)
    && Date.now() < deadline
  ) {
    await pause(Math.min(CLAUDE_TUI_TRANSCRIPT_RETRY_INTERVAL_MS, deadline - Date.now()));
    transcript = await resolver(input);
  }
  return transcript;
}

function isTransientStoppedTranscriptUnavailable(
  transcript: Extract<ClaudeTuiTranscriptFinal, { status: "unavailable" }>,
): boolean {
  return transcript.reason === "root-unavailable"
    || transcript.reason === "not-found"
    || transcript.reason === "unreadable"
    || transcript.reason === "malformed"
    || transcript.reason === "no-final-assistant-message";
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function writeManagedMcpConfig(
  runDir: string,
  invocation: ManagedProcessMcpInvocation,
): Promise<string> {
  const resolvedRunDir = path.resolve(runDir);
  const configPath = path.join(resolvedRunDir, "claude-tui-managed-process-mcp.json");
  await fs.mkdir(resolvedRunDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(configPath, JSON.stringify({
    mcpServers: {
      moebius_managed: {
        type: "stdio",
        command: invocation.command,
        args: invocation.args,
        env: invocation.env,
      },
    },
  }), { encoding: "utf8", mode: 0o600, flag: "wx" });
  await fs.chmod(configPath, 0o600);
  return configPath;
}

function cancelled(paths: ClaudeRunPaths, signal: AbortSignal | undefined): CodexRunResult {
  return failed(
    "claude-cancelled",
    "Claude 执行已取消。",
    paths,
    undefined,
    undefined,
    "",
    executionInterruptionCause(signal?.reason),
  );
}

function failed(
  code: CodexRunFailure["code"],
  message: string,
  paths: ClaudeRunPaths,
  action?: CodexRunFailure["action"],
  threadId?: string,
  partialText = "",
  interruptionCause?: ExecutionInterruptionCause,
): CodexRunResult {
  const failure: CodexRunFailure = {
    code,
    message,
    ...(action === undefined ? {} : { action }),
  };
  return {
    ok: false,
    reason: code,
    failure,
    terminal: interruptionCause === undefined
      ? planExecutionFailureTerminal(failure, partialText)
      : {
          kind: "interrupted",
          actor: interruptionCause === "user" ? "user" : "system",
          cause: interruptionCause,
          partialText,
        },
    ...(threadId === undefined ? {} : { threadId }),
    runDir: paths.runDir,
    stdoutPath: paths.stdoutPath,
    stderrPath: paths.stderrPath,
  };
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function collectClaudeMachineCodes(event: Record<string, unknown>): string[] {
  const codes: string[] = [];
  for (const value of [event.subtype, event.code, event.stop_reason]) {
    if (typeof value === "string") codes.push(value);
  }
  if (isRecord(event.error)) {
    for (const value of [event.error.code, event.error.type]) {
      if (typeof value === "string") codes.push(value);
    }
  }
  if (Array.isArray(event.errors)) {
    for (const error of event.errors) {
      if (!isRecord(error)) continue;
      for (const value of [error.code, error.type]) {
        if (typeof value === "string") codes.push(value);
      }
    }
  }
  return codes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class ClaudeVersionError extends Error {
  constructor(readonly safeMessage: string) {
    super(safeMessage);
    this.name = "ClaudeVersionError";
  }
}
