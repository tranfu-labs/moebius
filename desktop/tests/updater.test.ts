import { describe, expect, it, vi } from "vitest";
import {
  checkDesktopUpdates,
  compareVersions,
  decideUpdate,
  fetchLatestDesktopRelease,
  resolveUpdateStrategy,
} from "../src/updater.js";

describe("desktop updater", () => {
  it("uses manual download on macOS and auto update elsewhere", () => {
    expect(resolveUpdateStrategy("darwin")).toBe("manual-download");
    expect(resolveUpdateStrategy("win32")).toBe("auto-update");
    expect(resolveUpdateStrategy("linux")).toBe("auto-update");
  });

  it("compares semantic versions", () => {
    expect(compareVersions("1.2.1", "1.2.0")).toBe(1);
    expect(compareVersions("v1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("1.1.9", "1.2.0")).toBe(-1);
    expect(compareVersions("1.2.0-rc.1", "1.2.0")).toBe(-1);
    expect(compareVersions("1.2.0-rc.2", "1.2.0-rc.10")).toBe(-1);
    expect(compareVersions("1.2.0+build.2", "1.2.0+build.1")).toBe(0);
    expect(() => compareVersions("desktop-v1.2.1", "1.2.0")).toThrow(RangeError);
  });

  it("decides platform-specific update actions", () => {
    expect(
      decideUpdate({
        platform: "darwin",
        currentVersion: "0.1.0",
        latestVersion: "0.2.0",
        downloadUrl: "https://example.test/download",
      }),
    ).toMatchObject({ action: "open-download-page", updateAvailable: true });

    expect(
      decideUpdate({
        platform: "linux",
        currentVersion: "0.1.0",
        latestVersion: "0.2.0",
      }),
    ).toMatchObject({ action: "auto-update", updateAvailable: true });

    expect(
      decideUpdate({
        platform: "win32",
        currentVersion: "0.2.0",
        latestVersion: "0.2.0",
      }),
    ).toMatchObject({ action: "none", updateAvailable: false });
  });

  it("returns available and latest results without opening or downloading anything", async () => {
    await expect(checkDesktopUpdates({
      currentVersion: "0.1.4",
      fetchLatestRelease: async () => ({
        version: "0.1.5",
        url: "https://github.com/tranfu-labs/moebius/releases/tag/v0.1.5",
      }),
    })).resolves.toEqual({
      status: "available",
      currentVersion: "0.1.4",
      latestVersion: "0.1.5",
      downloadUrl: "https://github.com/tranfu-labs/moebius/releases/tag/v0.1.5",
    });

    await expect(checkDesktopUpdates({
      currentVersion: "0.1.5",
      fetchLatestRelease: async () => ({
        version: "0.1.5",
        url: "https://github.com/tranfu-labs/moebius/releases/tag/v0.1.5",
      }),
    })).resolves.toMatchObject({
      status: "latest",
      currentVersion: "0.1.5",
      latestVersion: "0.1.5",
    });
  });

  it("fails closed for timeout, missing release, and unsafe release URLs", async () => {
    vi.useFakeTimers();
    try {
      const timedOut = checkDesktopUpdates({
        currentVersion: "0.1.4",
        timeoutMs: 15_000,
        fetchLatestRelease: async () => new Promise(() => undefined),
      });
      await vi.advanceTimersByTimeAsync(15_000);
      await expect(timedOut).resolves.toEqual({
        status: "failed",
        currentVersion: "0.1.4",
        reason: "timeout",
      });
    } finally {
      vi.useRealTimers();
    }

    await expect(checkDesktopUpdates({
      currentVersion: "0.1.4",
      fetchLatestRelease: async () => null,
    })).resolves.toMatchObject({ status: "failed", reason: "unavailable" });
    await expect(checkDesktopUpdates({
      currentVersion: "0.1.4",
      fetchLatestRelease: async () => ({
        version: "0.1.5",
        url: "file:///tmp/not-a-release",
      }),
    })).resolves.toMatchObject({ status: "failed", reason: "unavailable" });
    await expect(checkDesktopUpdates({
      currentVersion: "0.1.4",
      fetchLatestRelease: async () => ({
        version: "0.1.5",
        url: "https://example.test/releases/tag/v0.1.5",
      }),
    })).resolves.toMatchObject({ status: "failed", reason: "unavailable" });
    await expect(checkDesktopUpdates({
      currentVersion: "0.1.4",
      fetchLatestRelease: async () => ({
        version: "0.1.5",
        url: "https://github.com/tranfu-labs/moebius/releases/tag/v0.1.4",
      }),
    })).resolves.toMatchObject({ status: "failed", reason: "unavailable" });
  });

  it("parses the real GitHub latest-release response shape", async () => {
    const response = new Response(JSON.stringify({
      url: "https://api.github.com/repos/tranfu-labs/moebius/releases/123",
      assets_url: "https://api.github.com/repos/tranfu-labs/moebius/releases/123/assets",
      tag_name: "v0.1.5",
      name: "Moebius v0.1.5",
      draft: false,
      prerelease: false,
      published_at: "2026-07-30T00:00:00Z",
      html_url: "https://github.com/tranfu-labs/moebius/releases/tag/v0.1.5",
      assets: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
    await expect(fetchLatestDesktopRelease(
      new AbortController().signal,
      vi.fn(async () => response),
    )).resolves.toEqual({
      version: "0.1.5",
      url: "https://github.com/tranfu-labs/moebius/releases/tag/v0.1.5",
    });
  });

  it.each([
    {
      label: "legacy desktop tag",
      release: {
        tag_name: "desktop-v0.1.5",
        html_url: "https://github.com/tranfu-labs/moebius/releases/tag/desktop-v0.1.5",
        draft: false,
        prerelease: false,
      },
    },
    {
      label: "draft",
      release: {
        tag_name: "v0.1.5",
        html_url: "https://github.com/tranfu-labs/moebius/releases/tag/v0.1.5",
        draft: true,
        prerelease: false,
      },
    },
    {
      label: "prerelease",
      release: {
        tag_name: "v0.1.5",
        html_url: "https://github.com/tranfu-labs/moebius/releases/tag/v0.1.5",
        draft: false,
        prerelease: true,
      },
    },
    {
      label: "prerelease tag",
      release: {
        tag_name: "v0.1.5-rc.1",
        html_url: "https://github.com/tranfu-labs/moebius/releases/tag/v0.1.5-rc.1",
        draft: false,
        prerelease: false,
      },
    },
    {
      label: "mismatched release URL",
      release: {
        tag_name: "v0.1.5",
        html_url: "https://github.com/tranfu-labs/moebius/releases/tag/v0.1.4",
        draft: false,
        prerelease: false,
      },
    },
  ])("rejects $label metadata", async ({ release }) => {
    const response = new Response(JSON.stringify(release), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    await expect(fetchLatestDesktopRelease(
      new AbortController().signal,
      vi.fn(async () => response),
    )).resolves.toBeNull();
  });
});
