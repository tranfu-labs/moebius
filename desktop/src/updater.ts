import type { SettingsUpdateCheckResult } from "./settings-contract.js";

export type UpdateStrategy = "manual-download" | "auto-update";

export interface UpdateDecision {
  strategy: UpdateStrategy;
  action: "none" | "open-download-page" | "auto-update";
  updateAvailable: boolean;
  latestVersion?: string;
  downloadUrl?: string;
}

export interface ReleaseMetadata {
  version: string;
  url: string;
}

export const SETTINGS_UPDATE_TIMEOUT_MS = 15_000;
const LATEST_DESKTOP_RELEASE_API = "https://api.github.com/repos/tranfu-labs/moebius/releases/latest";
const DESKTOP_RELEASE_TAG_PATTERN = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/u;
const SEMANTIC_VERSION_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const DESKTOP_RELEASE_URL_PREFIX = "https://github.com/tranfu-labs/moebius/releases/tag/";

export function resolveUpdateStrategy(platform: NodeJS.Platform): UpdateStrategy {
  return platform === "darwin" ? "manual-download" : "auto-update";
}

export function compareVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);

  for (let index = 0; index < leftVersion.core.length; index += 1) {
    const leftPart = leftVersion.core[index]!;
    const rightPart = rightVersion.core[index]!;
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }

  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

export function decideUpdate(input: {
  platform: NodeJS.Platform;
  currentVersion: string;
  latestVersion?: string;
  downloadUrl?: string;
}): UpdateDecision {
  const strategy = resolveUpdateStrategy(input.platform);
  const updateAvailable =
    input.latestVersion !== undefined && compareVersions(input.latestVersion, input.currentVersion) > 0;

  if (!updateAvailable) {
    return { strategy, action: "none", updateAvailable: false, latestVersion: input.latestVersion };
  }

  if (strategy === "manual-download") {
    return {
      strategy,
      action: "open-download-page",
      updateAvailable: true,
      latestVersion: input.latestVersion,
      downloadUrl: input.downloadUrl,
    };
  }

  return {
    strategy,
    action: "auto-update",
    updateAvailable: true,
    latestVersion: input.latestVersion,
    downloadUrl: input.downloadUrl,
  };
}

export async function checkDesktopUpdates(input: {
  currentVersion: string;
  fetchLatestRelease(signal: AbortSignal): Promise<ReleaseMetadata | null>;
  timeoutMs?: number;
}): Promise<SettingsUpdateCheckResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = input.timeoutMs ?? SETTINGS_UPDATE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });

  try {
    const latestRelease = await Promise.race([
      input.fetchLatestRelease(controller.signal),
      timeout,
    ]);
    if (latestRelease === null) {
      return {
        status: "failed",
        currentVersion: input.currentVersion,
        reason: timedOut ? "timeout" : "unavailable",
      };
    }
    if (!isSafeReleaseMetadata(latestRelease)) {
      return {
        status: "failed",
        currentVersion: input.currentVersion,
        reason: "unavailable",
      };
    }
    if (compareVersions(latestRelease.version, input.currentVersion) > 0) {
      return {
        status: "available",
        currentVersion: input.currentVersion,
        latestVersion: latestRelease.version,
        downloadUrl: latestRelease.url,
      };
    }
    return {
      status: "latest",
      currentVersion: input.currentVersion,
      latestVersion: latestRelease.version,
    };
  } catch {
    return {
      status: "failed",
      currentVersion: input.currentVersion,
      reason: timedOut ? "timeout" : "unavailable",
    };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export async function fetchLatestDesktopRelease(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ReleaseMetadata | null> {
  try {
    const response = await fetcher(LATEST_DESKTOP_RELEASE_API, {
      signal,
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "moebius-desktop",
      },
    });
    if (!response.ok) {
      return null;
    }
    const raw = await response.json() as unknown;
    if (!isReleaseResponse(raw)) {
      return null;
    }
    const version = raw.tag_name.match(DESKTOP_RELEASE_TAG_PATTERN)?.[1];
    if (
      version === undefined
      || raw.draft
      || raw.prerelease
      || raw.html_url !== `${DESKTOP_RELEASE_URL_PREFIX}${raw.tag_name}`
    ) {
      return null;
    }
    return {
      version,
      url: raw.html_url,
    };
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    return null;
  }
}

function isSafeReleaseMetadata(release: ReleaseMetadata): boolean {
  return DESKTOP_RELEASE_TAG_PATTERN.test(`v${release.version}`)
    && release.url === `${DESKTOP_RELEASE_URL_PREFIX}v${release.version}`;
}

function isReleaseResponse(value: unknown): value is {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const release = value as Partial<{
    tag_name: unknown;
    html_url: unknown;
    draft: unknown;
    prerelease: unknown;
  }>;
  return typeof release.tag_name === "string"
    && release.tag_name.trim() !== ""
    && typeof release.html_url === "string"
    && typeof release.draft === "boolean"
    && typeof release.prerelease === "boolean";
}

function parseVersion(version: string): {
  core: readonly [bigint, bigint, bigint];
  prerelease: readonly string[];
} {
  const match = version.trim().match(SEMANTIC_VERSION_PATTERN);
  if (match === null) {
    throw new RangeError(`invalid semantic version: ${version}`);
  }
  return {
    core: [BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)],
    prerelease: match[4]?.split(".") ?? [],
  };
}

function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) {
    if (left.length === right.length) {
      return 0;
    }
    return left.length === 0 ? 1 : -1;
  }

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) {
      continue;
    }
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) {
      return BigInt(leftPart) > BigInt(rightPart) ? 1 : -1;
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}
