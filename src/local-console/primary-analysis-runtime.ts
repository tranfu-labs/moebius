import type { CodexRunResult } from "../codex.js";
import type { LocalPreparedPrimaryRun, LocalPrimaryRunInput } from "./primary-preparation-runtime.js";
import {
  decidePrimaryAnalysisConfirmation,
  decidePrimaryAnalysisControl,
  decidePrimaryAnalysisHandling,
} from "./primary-runtime-plan.js";
import { parseSessionAnalysisResponse } from "./session-analysis-gate.js";

export class LocalPrimaryAnalysisRuntime {
  constructor(private readonly input: {
    updateGate(input: {
      sessionId: string;
      proposalVersion: string | null;
      writeLeaseVersion: string | null;
    }): Promise<void>;
    resumeConfirmed(input: {
      run: LocalPrimaryRunInput;
      preparation: LocalPreparedPrimaryRun;
      confirmedVersion: string;
      externalSessionId: string;
    }): Promise<CodexRunResult>;
  }) {}

  async apply(input: {
    run: LocalPrimaryRunInput;
    preparation: LocalPreparedPrimaryRun;
    result: CodexRunResult;
    observedExternalSessionId: string | null;
  }): Promise<CodexRunResult> {
    const handling = decidePrimaryAnalysisHandling({
      analysisGateEnabled: input.run.analysisGateEnabled,
      role: input.run.role,
      primaryAgent: input.run.primaryAgent,
      result: input.result,
    });
    if (handling.kind === "skip") return input.result;
    const result = handling.result as Extract<CodexRunResult, { ok: true }>;
    const parsed = parseSessionAnalysisResponse(result.finalText);
    const control = decidePrimaryAnalysisControl(parsed.control);
    if (control.kind === "proposal") {
      await this.input.updateGate({
        sessionId: input.run.sessionId,
        proposalVersion: control.version,
        writeLeaseVersion: null,
      });
      return { ...result, finalText: parsed.visibleText };
    }
    if (control.kind === "skip") return result;
    const confirmation = decidePrimaryAnalysisConfirmation({
      currentVersion: input.run.proposalVersion,
      confirmedVersion: control.version,
      observedExternalSessionId: input.observedExternalSessionId,
      resultExternalSessionId: result.threadId,
    });
    if (confirmation.kind === "reject") {
      return {
        ...result,
        finalText: [
          parsed.visibleText,
          "这次确认没有与当前方案版本精确匹配，或当前 provider 会话无法安全继续；我保持只读，没有修改文件。请先重新确认当前完整方案。",
        ].filter((part) => part.trim() !== "").join("\n\n"),
      };
    }
    await this.input.updateGate({
      sessionId: input.run.sessionId,
      proposalVersion: control.version,
      writeLeaseVersion: control.version,
    });
    try {
      return await this.input.resumeConfirmed({
        run: input.run,
        preparation: input.preparation,
        confirmedVersion: control.version,
        externalSessionId: confirmation.externalSessionId,
      });
    } finally {
      await this.input.updateGate({
        sessionId: input.run.sessionId,
        proposalVersion: control.version,
        writeLeaseVersion: null,
      });
    }
  }
}
