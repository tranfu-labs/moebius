const RUN_OUTPUT_SOURCE_KEY_PREFIX = "run-output-v2:";
const STEP_RUN_OUTPUT_SOURCE_KEY_PREFIX = "run-output-v3:";

export interface ProcessOutputSourceLocator {
  sessionId: string;
  runId: string;
  stepId: string | null;
}

export function parseProcessOutputSourceKey(
  sourceKey: string | null,
  legacySessionId?: string,
): ProcessOutputSourceLocator | null {
  if (sourceKey === null) return null;
  if (sourceKey.startsWith(STEP_RUN_OUTPUT_SOURCE_KEY_PREFIX)) {
    const encoded = sourceKey.slice(STEP_RUN_OUTPUT_SOURCE_KEY_PREFIX.length);
    const firstSeparator = encoded.indexOf(":");
    const secondSeparator = encoded.indexOf(":", firstSeparator + 1);
    if (
      firstSeparator <= 0
      || secondSeparator <= firstSeparator + 1
      || secondSeparator >= encoded.length - 1
    ) return null;
    try {
      const sessionId = decodeURIComponent(encoded.slice(0, firstSeparator));
      const stepId = decodeURIComponent(encoded.slice(firstSeparator + 1, secondSeparator));
      const runId = decodeURIComponent(encoded.slice(secondSeparator + 1));
      return sessionId === "" || stepId === "" || runId === ""
        ? null
        : { sessionId, runId, stepId };
    } catch {
      return null;
    }
  }
  if (sourceKey.startsWith(RUN_OUTPUT_SOURCE_KEY_PREFIX)) {
    const encoded = sourceKey.slice(RUN_OUTPUT_SOURCE_KEY_PREFIX.length);
    const separator = encoded.indexOf(":");
    if (separator <= 0 || separator >= encoded.length - 1) return null;
    try {
      const sessionId = decodeURIComponent(encoded.slice(0, separator));
      const runId = decodeURIComponent(encoded.slice(separator + 1));
      return sessionId === "" || runId === "" ? null : { sessionId, runId, stepId: null };
    } catch {
      return null;
    }
  }
  if (legacySessionId === undefined) return null;
  const legacyPrefix = `run-output:${legacySessionId}:`;
  const runId = sourceKey.startsWith(legacyPrefix)
    ? sourceKey.slice(legacyPrefix.length)
    : "";
  return runId === "" ? null : { sessionId: legacySessionId, runId, stepId: null };
}
