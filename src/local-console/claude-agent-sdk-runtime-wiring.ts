import { createLocalClaudeAgentSdkRunner } from "./claude-agent-sdk-runner.js";

/**
 * Default ordinary-Claude composition for the local console. The old TUI
 * wiring remains available for its isolated compatibility tests until the
 * later history/UI cleanup module removes that surface.
 */
export function createLocalClaudeAgentSdkRuntimeWiring(input: {
  hasCustomClaudeRunner: boolean;
  hasCustomExecutionRunner: boolean;
}): {
  runClaude: ReturnType<typeof createLocalClaudeAgentSdkRunner> | undefined;
  claudeOwnsManagedProcess: false;
  claudeReportsProcessStart: boolean;
  close(): Promise<void>;
} {
  const createRunner = !input.hasCustomExecutionRunner && !input.hasCustomClaudeRunner;
  return {
    runClaude: createRunner ? createLocalClaudeAgentSdkRunner() : undefined,
    claudeOwnsManagedProcess: false,
    claudeReportsProcessStart: createRunner,
    close: async () => undefined,
  };
}
