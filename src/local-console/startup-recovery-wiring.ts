import type { LocalLegacyHandoffRecoveryRuntime } from "./legacy-handoff-recovery-runtime.js";
import type { LocalStartupRecoveryRuntime } from "./startup-recovery-runtime.js";

type LegacyPorts = ConstructorParameters<typeof LocalLegacyHandoffRecoveryRuntime>[0];
type StartupPorts = ConstructorParameters<typeof LocalStartupRecoveryRuntime>[0];

export class LocalStartupRecoveryWiring {
  constructor(private readonly ports: {
    store: LegacyPorts["store"];
    defaultSessionId: string;
    storeCall: LegacyPorts["storeCall"];
    now: StartupPorts["now"];
    nowIso: LegacyPorts["nowIso"];
    idleTimeoutMs: StartupPorts["idleTimeoutMs"];
    maxDurationMs: StartupPorts["maxDurationMs"];
    staleGraceMs: StartupPorts["staleGraceMs"];
    activeRunIds: LegacyPorts["activeRunIds"];
    activeSessionIds: StartupPorts["activeSessionIds"];
    recoveryStore: LegacyPorts["recoveryStore"];
    readRecoveryFacts: LegacyPorts["readRecoveryFacts"];
    readRunContexts: LegacyPorts["readRunContexts"];
    recordError: StartupPorts["recordError"];
    report: LegacyPorts["report"];
  }) {}

  legacy(): LegacyPorts {
    return {
      store: this.ports.store,
      storeCall: this.ports.storeCall,
      nowIso: this.ports.nowIso,
      recoveryStore: this.ports.recoveryStore,
      readRecoveryFacts: this.ports.readRecoveryFacts,
      readRunContexts: this.ports.readRunContexts,
      activeRunIds: this.ports.activeRunIds,
      report: this.ports.report,
    };
  }

  startup(legacyRecovery: LocalLegacyHandoffRecoveryRuntime): StartupPorts {
    return {
      store: this.ports.store,
      defaultSessionId: this.ports.defaultSessionId,
      storeCall: this.ports.storeCall,
      now: this.ports.now,
      nowIso: this.ports.nowIso,
      idleTimeoutMs: this.ports.idleTimeoutMs,
      maxDurationMs: this.ports.maxDurationMs,
      staleGraceMs: this.ports.staleGraceMs,
      activeSessionIds: this.ports.activeSessionIds,
      recoveryStore: this.ports.recoveryStore,
      readRecoveryFacts: this.ports.readRecoveryFacts,
      legacyRecovery,
      recordError: this.ports.recordError,
      report: this.ports.report,
    };
  }
}
