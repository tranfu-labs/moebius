import type { ExecutionFailureTerminal } from "./execution-contract.js";

export interface CodexRunFailure {
  code:
    | "codex-cli-upgrade-required"
    | "kimi-cli-not-found"
    | "kimi-cli-not-executable"
    | "kimi-cli-spawn-failed"
    | "kimi-cli-exited"
    | "kimi-acp-timeout"
    | "kimi-acp-interrupted"
    | "kimi-quota-exhausted"
    | "kimi-rate-limited"
    | "kimi-no-complete-result"
    | "kimi-empty-response"
    | "claude-cli-not-found"
    | "claude-cli-not-executable"
    | "claude-cli-unsupported-version"
    | "claude-cli-spawn-failed"
    | "claude-auth-required"
    | "claude-profile-invalid"
    | "claude-permission-denied"
    | "claude-rate-limited"
    | "claude-billing-unavailable"
    | "claude-service-unavailable"
    | "claude-resume-unavailable"
    | "claude-native-prompt-unresolved"
    | "claude-protocol-invalid"
    | "claude-timeout"
    | "claude-cancelled"
    | "pi-auth-required"
    | "pi-model-unavailable"
    | "pi-model-incompatible"
    | "pi-rate-limited"
    | "pi-quota-exhausted"
    | "pi-network-unavailable"
    | "pi-provider-unavailable"
    | "pi-provider-disabled"
    | "pi-provider-needs-attention"
    | "pi-provider-missing"
    | "pi-resume-unavailable"
    | "pi-host-crashed"
    | "pi-no-complete-result"
    | "pi-cancelled";
  message: string;
  action?: "update-claude";
  /** Trusted adapter diagnostic; never used as user-facing failure text. */
  diagnostic?: string;
}

export function planExecutionFailureTerminal(
  failure: CodexRunFailure,
  partialText: string,
): ExecutionFailureTerminal {
  switch (failure.code) {
    case "claude-auth-required":
    case "pi-auth-required":
      return {
        kind: "auth",
        retryable: false,
        partialText,
        safeCode: failure.code,
      };
    case "claude-billing-unavailable":
    case "kimi-quota-exhausted":
    case "pi-quota-exhausted":
      return {
        kind: "quota-exhausted",
        retryable: false,
        partialText,
        safeCode: failure.code,
      };
    case "claude-rate-limited":
    case "claude-service-unavailable":
    case "kimi-rate-limited":
    case "pi-rate-limited":
    case "pi-network-unavailable":
    case "pi-provider-unavailable":
      return {
        kind: "rate-limited",
        retryable: true,
        partialText,
        safeCode: failure.code,
      };
    case "claude-cancelled":
    case "kimi-acp-interrupted":
    case "pi-cancelled":
      return { kind: "interrupted", actor: "user", cause: "user", partialText };
    case "claude-timeout":
    case "kimi-acp-timeout":
      return { kind: "timeout", basis: "idle", partialText };
    case "codex-cli-upgrade-required":
    case "kimi-cli-not-found":
    case "kimi-cli-not-executable":
    case "kimi-cli-spawn-failed":
    case "kimi-cli-exited":
    case "kimi-no-complete-result":
    case "kimi-empty-response":
    case "claude-cli-not-found":
    case "claude-cli-not-executable":
    case "claude-cli-unsupported-version":
    case "claude-cli-spawn-failed":
    case "claude-profile-invalid":
    case "claude-permission-denied":
    case "claude-resume-unavailable":
    case "claude-native-prompt-unresolved":
    case "claude-protocol-invalid":
    case "pi-model-unavailable":
    case "pi-model-incompatible":
    case "pi-provider-disabled":
    case "pi-provider-needs-attention":
    case "pi-provider-missing":
    case "pi-resume-unavailable":
    case "pi-host-crashed":
    case "pi-no-complete-result":
      return { kind: "crashed", partialText, safeCode: failure.code };
    default:
      return assertFailureNever(failure.code);
  }
}

function assertFailureNever(value: never): never {
  throw new Error(`Unhandled execution failure: ${String(value)}`);
}
