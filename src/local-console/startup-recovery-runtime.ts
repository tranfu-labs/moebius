import type { LocalCodexRecoveryFacts } from "./codex-resume.js";
import type { LocalLegacyHandoffRecoveryRuntime } from "./legacy-handoff-recovery-runtime.js";
import { ORPHAN_RUN_STUCK_REASON, identifyOrphanRuns } from "./orphan-runs.js";
import {
  decideLegacyStartupRepair,
  decideOrphanPlaceholderRelease,
  decideOrphanResumeRelease,
  decideRecoveryFactsRead,
  decideStartupProjectedWork,
  decideStartupRecoveryFactSource,
  emptyStartupRecoveryFacts,
  planOrphanRecovery,
  planStaleRunningRepair,
  planStartupRecoverySessions,
} from "./startup-recovery-plan.js";
import { planStaleRunningRoles } from "./terminal-record-plan.js";
import type { LocalConsoleMessage, LocalConsoleStore } from "./types.js";

interface LocalStartupRecoveryFactStore {
  getSessionFactLogPath(sessionId: string): string;
}

export class LocalStartupRecoveryRuntime {
  constructor(private readonly input: {
    store: LocalConsoleStore;
    defaultSessionId: string;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    now(): Date;
    nowIso(): string;
    idleTimeoutMs: number | undefined;
    maxDurationMs: number | undefined;
    staleGraceMs: number;
    activeSessionIds(): ReadonlySet<string>;
    recoveryStore(): LocalStartupRecoveryFactStore | null;
    readRecoveryFacts(path: string, sessionId: string): Promise<LocalCodexRecoveryFacts>;
    legacyRecovery: LocalLegacyHandoffRecoveryRuntime;
    recordError(error: unknown): string;
    report(input: Record<string, unknown> & { event: string }): void;
  }) {}

  async init(): Promise<void> {
    await this.input.store.init();
    const sessions = await this.input.storeCall("local-console-store-list-sessions", () =>
      this.input.store.listSessions());
    const sessionPlans = planStartupRecoverySessions(sessions, this.input.defaultSessionId);
    await Promise.all(sessionPlans.map(async (sessionPlan) => await this.recoverSession(sessionPlan)));
  }

  async repairStaleRunning(sessionId: string): Promise<number> {
    const messages = await this.input.storeCall("local-console-store-list-messages", () =>
      this.input.store.listMessages(sessionId));
    return await this.repairStaleRunningWithMessages(sessionId, messages);
  }

  private async repairStaleRunningWithMessages(sessionId: string, messages: LocalConsoleMessage[]): Promise<number> {
    const plan = planStaleRunningRepair({
      nowMs: this.input.now().getTime(),
      idleTimeoutMs: this.input.idleTimeoutMs,
      maxDurationMs: this.input.maxDurationMs,
      graceMs: this.input.staleGraceMs,
    });
    return await this.input.storeCall("local-console-store-mark-stale", () =>
      this.input.store.markStaleRunning({
        sessionId,
        cutoffIso: plan.cutoffIso,
        now: this.input.nowIso(),
        reason: plan.reason,
        roles: planStaleRunningRoles(messages),
      }));
  }

  private async recoverSession(sessionPlan: { sessionId: string; hasProjectedWork: boolean }): Promise<void> {
    const recoveryStore = this.input.recoveryStore();
    const factSource = decideStartupRecoveryFactSource({
      hasProjectedWork: sessionPlan.hasProjectedWork,
      storeAvailable: recoveryStore !== null,
    });
    let knownRecoveryFacts: LocalCodexRecoveryFacts | undefined;
    if (factSource.kind === "read") {
      knownRecoveryFacts = await this.input.readRecoveryFacts(
        recoveryStore!.getSessionFactLogPath(sessionPlan.sessionId),
        sessionPlan.sessionId,
      );
    }
    let startupMessages: LocalConsoleMessage[] | undefined;
    const projectedWork = decideStartupProjectedWork(sessionPlan.hasProjectedWork);
    if (projectedWork.kind === "run") {
      try {
        // 启动 catch-up 对每个 session 只读一次消息：orphan 识别与 stale 归属共用同一份快照。
        const messages = await this.input.storeCall("local-console-store-list-messages", () =>
          this.input.store.listMessages(sessionPlan.sessionId));
        startupMessages = messages;
        await this.claimOrphanRuns(sessionPlan.sessionId, messages);
      } catch (error) {
        this.reportFailure("local-console-claim-orphan-runs-failed", sessionPlan.sessionId, error);
      }
    }
    const legacyRepair = decideLegacyStartupRepair({
      hasProjectedWork: sessionPlan.hasProjectedWork,
      knownFacts: knownRecoveryFacts,
    });
    if (legacyRepair.kind === "run") {
      try {
        await this.input.legacyRecovery.repair(sessionPlan.sessionId, startupMessages, knownRecoveryFacts);
      } catch (error) {
        this.reportFailure("local-console-repair-agent-handoff-resume-failed", sessionPlan.sessionId, error);
      }
    }
    if (projectedWork.kind === "run") {
      try {
        // 与首块共用同一份消息快照；读失败时 startupMessages 为 undefined，
        // 由下方 catch 统一报告，不会进入正常路径。
        await this.repairStaleRunningWithMessages(sessionPlan.sessionId, startupMessages!);
      } catch (error) {
        this.reportFailure("local-console-repair-stale-failed", sessionPlan.sessionId, error);
      }
    }
  }

  private async claimOrphanRuns(sessionId: string, messages: LocalConsoleMessage[]): Promise<void> {
    const orphans = identifyOrphanRuns({
      sessionId,
      messages,
      activeSessionIds: this.input.activeSessionIds(),
    });
    const recoveryStore = this.input.recoveryStore();
    const factRead = decideRecoveryFactsRead(recoveryStore !== null);
    const recoveryFacts = factRead.kind === "read"
      ? await this.input.readRecoveryFacts(recoveryStore!.getSessionFactLogPath(sessionId), sessionId)
      : emptyStartupRecoveryFacts();
    for (const orphan of orphans) {
      try {
        const plan = planOrphanRecovery({ orphan, facts: recoveryFacts });
        if (plan.kind === "record-stuck") {
          await this.input.storeCall("local-console-store-record-stuck", () =>
            this.input.store.recordStuck({
              userMessageId: plan.orphan.userMessageId,
              sessionId,
              reason: ORPHAN_RUN_STUCK_REASON,
              runId: plan.orphan.runId,
              runDir: plan.orphan.runDir,
              role: plan.orphan.role,
              processSteps: [],
              now: this.input.nowIso(),
            }));
          continue;
        }
        const placeholder = decideOrphanPlaceholderRelease(plan.placeholderMessageId);
        if (placeholder.kind === "release") {
          await this.input.storeCall("local-console-store-release-graceful-worker-placeholder", () =>
            this.input.store.releaseMessageForRetry({
              userMessageId: placeholder.messageId,
              sessionId,
              now: this.input.nowIso(),
            }));
        }
        const releaseMessageForResume = this.input.store.releaseMessageForResume;
        const resume = decideOrphanResumeRelease({
          plan,
          capabilityAvailable: releaseMessageForResume !== undefined,
        });
        if (resume.kind === "unavailable") {
          throw new Error("local console graceful resume persistence capability unavailable");
        }
        if (resume.kind === "release") {
          await this.input.storeCall("local-console-store-release-graceful-resume", () =>
            releaseMessageForResume!.call(this.input.store, {
              userMessageId: resume.sourceMessageId,
              sessionId,
              sourceDisposition: resume.sourceDisposition,
              targetRunId: resume.targetRunId,
              role: resume.role,
              now: this.input.nowIso(),
            }));
        }
      } catch (error) {
        const formatted = this.input.recordError(error);
        this.input.report({
          event: "local-console-record-orphan-stuck-failed",
          sessionId,
          userMessageId: orphan.userMessageId,
          error: formatted,
        });
      }
    }
  }

  private reportFailure(event: string, sessionId: string, error: unknown): void {
    const formatted = this.input.recordError(error);
    this.input.report({ event, sessionId, error: formatted });
  }
}
