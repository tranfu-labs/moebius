import path from "node:path";

import {
  LocalClaudeTerminalTraceUnavailableError,
  pageLocalClaudeTerminalTrace,
  parseLocalClaudeTerminalTraceCursor,
  planLocalClaudeTerminalTraceSource,
  type LocalConsoleClaudeTerminalTracePage,
} from "./claude-terminal-trace.js";
import type { LocalClaudeTerminalTraceStore } from "./claude-terminal-trace-store.js";
import {
  type LocalConsoleProcessAppendPage,
  type LocalConsoleProcessDebugInvocation,
  type LocalConsoleProcessHistoryPage,
  type LocalProcessFactReader,
} from "./process-history.js";
import { loadLocalProcessAppendPage } from "./process-append-page-runtime.js";
import { loadLocalProcessDebugInvocation } from "./process-debug-invocation-runtime.js";
import { loadLocalProcessHistoryPage } from "./process-history-page-runtime.js";
import type { LocalProcessTraceReader } from "./process-history-contracts.js";
import {
  decideRunOutputFileRead,
  planClaudeTerminalTraceRunDir,
  planProcessCursor,
  planRunOutput,
  planRunOutputSource,
  type ActiveClaudeTerminalTraceSource,
  type ActiveRunOutputSource,
} from "./run-output-plan.js";
import type { LocalConsoleRunOutput, LocalConsoleStore } from "./types.js";
import { LocalRunAgentAuditRuntime } from "./run-agent-audit-runtime.js";

export class LocalConsoleRunOutputRuntime {
  constructor(private readonly input: {
    store: LocalConsoleStore;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    activeRun(runId: string): (ActiveRunOutputSource & ActiveClaudeTerminalTraceSource) | undefined;
    activeRunIds(sessionId: string): ReadonlySet<string>;
    readOptionalTextFile(filePath: string): Promise<string | null>;
    sessionFactLogPath(sessionId: string): string;
    factReader: LocalProcessFactReader;
    traceReader: LocalProcessTraceReader;
    traceDataRoot: string;
    traceStore: LocalClaudeTerminalTraceStore;
  }) {}

  async runAgentInfo(input: { sessionId: string; runId: string }) {
    return await new LocalRunAgentAuditRuntime(this.input.store).info(input);
  }

  async runAgentMarkdown(input: { sessionId: string; runId: string }): Promise<{ markdown: string }> {
    return await new LocalRunAgentAuditRuntime(this.input.store).markdown(input);
  }

  async runOutput(sessionId: string, runId: string): Promise<LocalConsoleRunOutput> {
    const messages = await this.input.storeCall("local-console-store-list-run-output", () =>
      this.input.store.listMessages(sessionId));
    const source = planRunOutputSource({
      sessionId,
      messages: messages.filter((message) => message.runId === runId),
      active: this.input.activeRun(runId),
    });
    if (source.kind === "missing") throw new Error(`local console run not found: ${sessionId}/${runId}`);
    const fileRead = decideRunOutputFileRead(source.runDir);
    const [stdout, stderr] = fileRead.kind === "skip"
      ? [null, null]
      : await Promise.all([
          this.input.readOptionalTextFile(path.join(fileRead.runDir, "stdout.jsonl")),
          this.input.readOptionalTextFile(path.join(fileRead.runDir, "stderr.log")),
        ]);
    return planRunOutput({ sessionId, runId, source, stdout, stderr });
  }

  async claudeTerminalTrace(
    sessionId: string,
    runId: string,
    cursor?: string,
  ): Promise<LocalConsoleClaudeTerminalTracePage> {
    const active = this.input.activeRun(runId);
    const source = planLocalClaudeTerminalTraceSource(active, sessionId);
    if (source.kind === "active") {
      return pageLocalClaudeTerminalTrace({
        sessionId,
        runId,
        trace: source.trace,
        cursor: parseLocalClaudeTerminalTraceCursor(cursor),
      });
    }
    if (source.kind === "unavailable") throw new LocalClaudeTerminalTraceUnavailableError();

    const messages = await this.input.storeCall("local-console-store-list-terminal-trace-messages", () =>
      this.input.store.listMessages(sessionId));
    const historical = planClaudeTerminalTraceRunDir({ messages, runId });
    if (historical.kind === "missing") {
      throw new LocalClaudeTerminalTraceUnavailableError();
    }
    return await this.input.traceStore.read({
      sessionId,
      runId,
      runDir: historical.runDir,
      cursor: parseLocalClaudeTerminalTraceCursor(cursor),
    });
  }

  async processOutput(
    sessionId: string,
    runId: string,
    cursor?: string,
  ): Promise<LocalConsoleProcessHistoryPage> {
    const messages = await this.input.storeCall("local-console-store-list-process-history", () =>
      this.input.store.listMessages(sessionId));
    return await loadLocalProcessHistoryPage({
      sessionId,
      requestedRunId: runId,
      sessionFactLogPath: this.input.sessionFactLogPath(sessionId),
      messages,
      activeRunIds: this.input.activeRunIds(sessionId),
      factReader: this.input.factReader,
      traceReader: this.input.traceReader,
      trace: { dataRoot: this.input.traceDataRoot },
      ...planProcessCursor(cursor),
    });
  }

  async processOutputAppend(
    sessionId: string,
    runId: string,
    appendCursor: string,
  ): Promise<LocalConsoleProcessAppendPage> {
    return await loadLocalProcessAppendPage({
      sessionId,
      requestedRunId: runId,
      sessionFactLogPath: this.input.sessionFactLogPath(sessionId),
      activeRunIds: this.input.activeRunIds(sessionId),
      factReader: this.input.factReader,
      traceReader: this.input.traceReader,
      appendCursor,
      trace: { dataRoot: this.input.traceDataRoot },
    });
  }

  async processDebugInvocation(
    sessionId: string,
    runId: string,
  ): Promise<LocalConsoleProcessDebugInvocation> {
    return await loadLocalProcessDebugInvocation({
      sessionId,
      runId,
      sessionFactLogPath: this.input.sessionFactLogPath(sessionId),
      factReader: this.input.factReader,
      traceReader: this.input.traceReader,
      trace: { dataRoot: this.input.traceDataRoot },
    });
  }
}
