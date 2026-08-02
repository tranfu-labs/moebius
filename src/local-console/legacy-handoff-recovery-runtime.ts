import type { LocalCodexRecoveryFacts } from "./codex-resume.js";
import type { LocalRunExecutionContextFact } from "./execution-context.js";
import {
  decideKnownValueSource,
  decideLegacyRepairCapability,
  planLegacyHandoffRepair,
  planUnconsumedGracefulIntents,
} from "./startup-recovery-plan.js";
import type { LocalConsoleMessage, LocalConsoleStore } from "./types.js";

interface LocalLegacyHandoffRecoveryStore {
  getSessionFactLogPath(sessionId: string): string;
}

export class LocalLegacyHandoffRecoveryRuntime {
  constructor(private readonly input: {
    store: LocalConsoleStore;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    nowIso(): string;
    recoveryStore(): LocalLegacyHandoffRecoveryStore | null;
    readRecoveryFacts(path: string, sessionId: string): Promise<LocalCodexRecoveryFacts>;
    readRunContexts(path: string, sessionId: string): Promise<LocalRunExecutionContextFact[]>;
    activeRunIds(): ReadonlySet<string>;
    report(input: Record<string, unknown> & { event: string }): void;
  }) {}

  async repair(
    sessionId: string,
    startupMessages?: LocalConsoleMessage[],
    knownRecoveryFacts?: LocalCodexRecoveryFacts,
  ): Promise<void> {
    const recoveryStore = this.input.recoveryStore();
    const repairSource = this.input.store.repairAgentHandoffResumeSource;
    const capability = decideLegacyRepairCapability({
      recoveryStoreAvailable: recoveryStore !== null,
      repairCapabilityAvailable: repairSource !== undefined,
    });
    if (capability.kind === "skip") return;
    const factLogPath = recoveryStore!.getSessionFactLogPath(sessionId);
    const messageSource = decideKnownValueSource(startupMessages !== undefined);
    const factSource = decideKnownValueSource(knownRecoveryFacts !== undefined);
    const [messages, recoveryFacts, runContexts] = await Promise.all([
      messageSource.kind === "known"
        ? Promise.resolve(startupMessages!)
        : this.input.storeCall("local-console-store-list-messages", () => this.input.store.listMessages(sessionId)),
      factSource.kind === "known"
        ? Promise.resolve(knownRecoveryFacts!)
        : this.input.readRecoveryFacts(factLogPath, sessionId),
      this.input.readRunContexts(factLogPath, sessionId),
    ]);
    const unconsumedGracefulIntents = planUnconsumedGracefulIntents(recoveryFacts);
    for (const intent of unconsumedGracefulIntents) {
      const plan = planLegacyHandoffRepair({
        sessionId,
        intent,
        gracefulIntents: unconsumedGracefulIntents,
        repairedIntentIds: recoveryFacts.repairedIntentIds,
        messages,
        runContexts,
        activeRunIds: this.input.activeRunIds(),
      });
      if (plan.kind === "skip") continue;
      if (plan.kind === "reject") {
        this.input.report({
          event: "local-console-agent-handoff-resume-repair-rejected",
          sessionId,
          intentId: intent.intentId,
          targetRunId: intent.targetRunId,
          sourceMessageId: intent.sourceMessageId,
          reason: plan.reason,
        });
        continue;
      }
      await this.input.storeCall("local-console-store-repair-agent-handoff-resume-source", () =>
        repairSource!.call(this.input.store, {
          sessionId,
          intentId: intent.intentId,
          targetRunId: intent.targetRunId,
          sourceMessageId: intent.sourceMessageId,
          role: intent.role,
          now: this.input.nowIso(),
        }));
    }
  }
}
