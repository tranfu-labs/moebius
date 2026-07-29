export const MINIMUM_CODEX_CLI_VERSION = "0.145.0";

interface ParsedCodexCliVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

export function parseCodexCliVersion(value: string): ParsedCodexCliVersion | null {
  const match = value.match(
    /(?:^|[^\d])(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?=$|[^\d])/u,
  );
  if (match === null) {
    return null;
  }
  const major = Number.parseInt(match[1]!, 10);
  const minor = Number.parseInt(match[2]!, 10);
  const patch = Number.parseInt(match[3]!, 10);
  if (![major, minor, patch].every(Number.isSafeInteger)) {
    return null;
  }
  return {
    major,
    minor,
    patch,
    prerelease: match[4] ?? null,
  };
}

export function isSupportedCodexCliVersion(value: string): boolean {
  const actual = parseCodexCliVersion(value);
  const minimum = parseCodexCliVersion(MINIMUM_CODEX_CLI_VERSION);
  if (actual === null || minimum === null) {
    return false;
  }
  const actualParts = [actual.major, actual.minor, actual.patch];
  const minimumParts = [minimum.major, minimum.minor, minimum.patch];
  for (let index = 0; index < actualParts.length; index += 1) {
    const delta = actualParts[index]! - minimumParts[index]!;
    if (delta !== 0) {
      return delta > 0;
    }
  }
  return actual.prerelease === null;
}
