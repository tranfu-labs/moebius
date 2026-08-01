import type { LocalLegacyHandoffRecoveryRuntime } from "./legacy-handoff-recovery-runtime.js";
import type { LocalStartupRecoveryRuntime } from "./startup-recovery-runtime.js";

type LegacyPorts = ConstructorParameters<typeof LocalLegacyHandoffRecoveryRuntime>[0];
type StartupPorts = ConstructorParameters<typeof LocalStartupRecoveryRuntime>[0];

export function createLocalStartupRecoveryWiring(ports: {
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
}) {
  return {
    legacy(): LegacyPorts {
      return {
        store: ports.store,
        storeCall: ports.storeCall,
        nowIso: ports.nowIso,
        recoveryStore: ports.recoveryStore,
        readRecoveryFacts: ports.readRecoveryFacts,
        readRunContexts: ports.readRunContexts,
        activeRunIds: ports.activeRunIds,
        report: ports.report,
      };
    },

    startup(legacyRecovery: LocalLegacyHandoffRecoveryRuntime): StartupPorts {
      return {
        store: ports.store,
        defaultSessionId: ports.defaultSessionId,
        storeCall: ports.storeCall,
        now: ports.now,
        nowIso: ports.nowIso,
        idleTimeoutMs: ports.idleTimeoutMs,
        maxDurationMs: ports.maxDurationMs,
        staleGraceMs: ports.staleGraceMs,
        activeSessionIds: ports.activeSessionIds,
        recoveryStore: ports.recoveryStore,
        readRecoveryFacts: ports.readRecoveryFacts,
        legacyRecovery,
        recordError: ports.recordError,
        report: ports.report,
      };
    },
  };
}
