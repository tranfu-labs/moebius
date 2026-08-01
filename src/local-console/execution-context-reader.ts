import {
  normalizeRunExecutionContext,
  projectExecutionFactPayloads,
  type LocalAgentSessionLinkFact,
  type LocalAgentTimelineCursorFact,
  type LocalExecutionSessionLinkFact,
  type LocalProviderSessionObservedFact,
  type LocalRunExecutionContextFact,
} from "./execution-context.js";
import { readSessionFactLog } from "./session-fact-log.js";

async function readTypedFacts(logPath: string, sessionId: string, type: string): Promise<unknown[]> {
  const snapshot = await readSessionFactLog(logPath, sessionId);
  return snapshot === null ? [] : projectExecutionFactPayloads(snapshot.values, sessionId, type);
}

export async function readRunExecutionContexts(logPath: string, sessionId: string): Promise<LocalRunExecutionContextFact[]> {
  return (await readTypedFacts(logPath, sessionId, "run_execution_context"))
    .map((value) => normalizeRunExecutionContext(value as LocalRunExecutionContextFact));
}

export async function readExecutionSessionLinks(logPath: string, sessionId: string): Promise<LocalExecutionSessionLinkFact[]> {
  return await readTypedFacts(logPath, sessionId, "execution_session_link") as LocalExecutionSessionLinkFact[];
}

export async function readAgentSessionLinks(logPath: string, sessionId: string): Promise<LocalAgentSessionLinkFact[]> {
  return await readTypedFacts(logPath, sessionId, "agent_session_link") as LocalAgentSessionLinkFact[];
}

export async function readProviderSessionObservations(logPath: string, sessionId: string): Promise<LocalProviderSessionObservedFact[]> {
  return await readTypedFacts(logPath, sessionId, "provider_session_observed") as LocalProviderSessionObservedFact[];
}

export async function readAgentTimelineCursors(logPath: string, sessionId: string): Promise<LocalAgentTimelineCursorFact[]> {
  return await readTypedFacts(logPath, sessionId, "agent_timeline_cursor") as LocalAgentTimelineCursorFact[];
}
