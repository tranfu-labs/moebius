import { readLocalCodexRecoveryFacts } from "./codex-resume.js";
import { readCodexThreadLinks } from "./codex-thread-link-reader.js";
import {
  readAgentSessionLinks,
  readAgentTimelineCursors,
  readExecutionSessionLinks,
  readProviderSessionObservations,
  readRunExecutionContexts,
} from "./execution-context-reader.js";
import type { LocalRunRecoverySnapshot } from "./run-preparation-flow.js";

export async function readLocalRunRecoverySnapshot(input: {
  factLogPath: string | null;
  sessionId: string;
}): Promise<LocalRunRecoverySnapshot> {
  if (input.factLogPath === null) {
    return {
      recoveryFacts: { intents: [], consumedIntentIds: new Set(), repairedIntentIds: new Set() },
      threadLinks: [],
      executionLinks: [],
      runContexts: [],
      canonicalLinks: [],
      observations: [],
      timelineCursors: [],
    };
  }
  const [
    recoveryFacts,
    threadLinks,
    executionLinks,
    runContexts,
    canonicalLinks,
    observations,
    timelineCursors,
  ] = await Promise.all([
    readLocalCodexRecoveryFacts(input.factLogPath, input.sessionId),
    readCodexThreadLinks(input.factLogPath, input.sessionId),
    readExecutionSessionLinks(input.factLogPath, input.sessionId),
    readRunExecutionContexts(input.factLogPath, input.sessionId),
    readAgentSessionLinks(input.factLogPath, input.sessionId),
    readProviderSessionObservations(input.factLogPath, input.sessionId),
    readAgentTimelineCursors(input.factLogPath, input.sessionId),
  ]);
  return {
    recoveryFacts,
    threadLinks,
    executionLinks,
    runContexts,
    canonicalLinks,
    observations,
    timelineCursors,
  };
}
