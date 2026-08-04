import {
  hasRunNotStartedTerminal,
  projectRunAgentInfo,
  readRunAgentMarkdown,
  requireRunAgentAuditValue,
} from "./run-agent-audit-plan.js";
import type { LocalConsoleRunAgentInfo, LocalConsoleStore } from "./types.js";

export class LocalRunAgentAuditRuntime {
  constructor(private readonly store: LocalConsoleStore) {}

  async info(input: { sessionId: string; runId: string }): Promise<LocalConsoleRunAgentInfo> {
    const sourceReader = requireRunAgentAuditValue(this.store.readRunAgentAuditSource, "RUN_AGENT_AUDIT_UNAVAILABLE");
    const source = await sourceReader.call(this.store, input);
    const context = requireRunAgentAuditValue(source.context, "RUN_AGENT_AUDIT_NOT_FOUND");
    const messages = await this.store.listMessages(input.sessionId);
    return projectRunAgentInfo({ ...source, context, preStartTerminal: hasRunNotStartedTerminal(messages, input.runId) });
  }

  async markdown(input: { sessionId: string; runId: string }): Promise<{ markdown: string }> {
    const sourceReader = requireRunAgentAuditValue(this.store.readRunAgentAuditSource, "RUN_AGENT_AUDIT_UNAVAILABLE");
    const source = await sourceReader.call(this.store, input);
    return { markdown: readRunAgentMarkdown(requireRunAgentAuditValue(source.context, "RUN_AGENT_AUDIT_NOT_FOUND")) };
  }
}
