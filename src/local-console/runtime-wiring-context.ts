import { formatLocalError } from "./runtime-domain.js";
import type { LocalConsoleStorePorts } from "./runtime-store-ports.js";

export interface LocalRuntimeWiringContext {
  storePorts: LocalConsoleStorePorts;
  now(): Date;
  nowIso(): string;
  stopping(sessionId: string): boolean;
  setError(error: string): void;
  formatAndSetError(error: unknown): string;
}

export function createLocalRuntimeWiringContext(input: {
  storePorts: LocalConsoleStorePorts;
  now(): Date;
  stopping(sessionId: string): boolean;
  setError(error: string): void;
}): LocalRuntimeWiringContext {
  return {
    ...input,
    nowIso: () => input.now().toISOString(),
    formatAndSetError: (error) => {
      const formatted = formatLocalError(error);
      input.setError(formatted);
      return formatted;
    },
  };
}
