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

export function resolveUpdateStrategy(platform: NodeJS.Platform): UpdateStrategy {
  return platform === "darwin" ? "manual-download" : "auto-update";
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) {
      return Math.sign(delta);
    }
  }
  return 0;
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
    if (!isSafeReleaseUrl(latestRelease.url)) {
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
    const version = raw.tag_name.match(/^desktop-v(\d+\.\d+\.\d+)$/u)?.[1];
    if (version === undefined) {
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

function isSafeReleaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.origin === "https://github.com"
      && url.pathname.startsWith("/tranfu-labs/moebius/releases/");
  } catch {
    return false;
  }
}

function isReleaseResponse(value: unknown): value is { tag_name: string; html_url: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const release = value as Partial<{ tag_name: unknown; html_url: unknown }>;
  return typeof release.tag_name === "string"
    && release.tag_name.trim() !== ""
    && typeof release.html_url === "string";
}

function parseVersion(version: string): number[] {
  return version
    .trim()
    .replace(/^[^\d]*/u, "")
    .split(/[.-]/u)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}
