// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  GithubTeamAuthIpcResponse,
  GithubTeamInstallIpcResponse,
  GithubTeamPreviewIpcResponse,
  GithubTeamSearchIpcResponse,
} from "../github-team-ipc-contract.js";
import type { DesktopApi } from "./desktop-api-contract.js";
import { useGithubTeamConsole } from "./use-github-team-console.js";

describe("useGithubTeamConsole", () => {
  it("debounces non-empty searches, opens a full preview, and preserves discovery state on back", async () => {
    const api = apiPort({
      searchGithubTeams: vi.fn(async (): Promise<GithubTeamSearchIpcResponse> => ({
        status: "ready",
        authenticated: true,
        results: [{
          repository: "someone/moebius-team",
          name: "Moebius Team",
          description: "A reusable team.",
          stars: 7,
          updatedAt: "2026-08-18T00:00:00Z",
          language: "en",
          private: false,
        }],
      })),
      previewGithubTeam: vi.fn(async (): Promise<GithubTeamPreviewIpcResponse> => ({
        status: "ready",
        team: previewData(),
      })),
    });
    const { result } = renderHook(() => useGithubTeamConsole(api, "en", { debounceMs: 0 }));

    act(() => result.current.openDiscovery());
    await waitFor(() => expect(result.current.discovery.ghAuthenticated).toBe(true));

    act(() => result.current.discovery.onQueryChange("moebius"));
    await waitFor(() => expect(result.current.discovery.state).toMatchObject({
      status: "ready",
      results: [{ repository: "someone/moebius-team", updatedLabel: "08/18/2026" }],
    }));
    expect(api.searchGithubTeams).toHaveBeenCalledWith({ query: "moebius", language: "en" });

    act(() => result.current.discovery.onOpenResult("someone/moebius-team"));
    await waitFor(() => expect(result.current.preview.state).toMatchObject({
      status: "ready",
      team: { repository: "someone/moebius-team", members: [{ markdown: "# Rules\n" }] },
    }));
    expect(result.current.page).toBe("preview");

    act(() => result.current.preview.onBack());
    expect(result.current.page).toBe("discovery");
    expect(result.current.discovery.query).toBe("moebius");
    expect(result.current.discovery.state).toMatchObject({ status: "ready" });
  });

  it("refreshes the team catalog and opens the installed or duplicate team", async () => {
    const refreshTeams = vi.fn();
    const onOpenTeam = vi.fn();
    const api = apiPort({
      previewGithubTeam: vi.fn(async (): Promise<GithubTeamPreviewIpcResponse> => ({
        status: "ready",
        team: previewData(),
      })),
      installGithubTeam: vi.fn(async (): Promise<GithubTeamInstallIpcResponse> => ({
        status: "installed",
        teamId: "github-team-1",
      })),
    });
    const { result } = renderHook(() => useGithubTeamConsole(api, "zh-CN", {
      refreshTeams,
      onOpenTeam,
      debounceMs: 0,
    }));

    act(() => result.current.openDiscovery());
    act(() => result.current.discovery.onOpenResult("someone/moebius-team"));
    await waitFor(() => expect(result.current.preview.state.status).toBe("ready"));

    act(() => result.current.preview.onInstall());
    await waitFor(() => expect(result.current.preview.state.status).toBe("installed"));
    expect(refreshTeams).toHaveBeenCalledOnce();

    act(() => result.current.preview.onOpenInstalledTeam());
    expect(refreshTeams).toHaveBeenCalledTimes(2);
    // The navigation surface addresses teams by `ownership:id` keys.
    expect(onOpenTeam).toHaveBeenCalledWith("user:github-team-1");
    expect(result.current.page).toBeNull();
  });

  it("does not invoke installation when the preview contains an unreadable member", async () => {
    const installGithubTeam = vi.fn(async (): Promise<GithubTeamInstallIpcResponse> => ({
      status: "installed",
      teamId: "should-not-be-used",
    }));
    const api = apiPort({
      previewGithubTeam: vi.fn(async (): Promise<GithubTeamPreviewIpcResponse> => ({
        status: "ready",
        team: { ...previewData(), members: [{ ...previewData().members[0]!, readable: false, readError: "denied" }] },
      })),
      installGithubTeam,
    });
    const { result } = renderHook(() => useGithubTeamConsole(api, "en", { debounceMs: 0 }));

    act(() => result.current.openDiscovery());
    act(() => result.current.discovery.onOpenResult("someone/moebius-team"));
    await waitFor(() => expect(result.current.preview.state.status).toBe("ready"));

    act(() => result.current.preview.onInstall());
    expect(installGithubTeam).not.toHaveBeenCalled();
  });
});

function apiPort(overrides: Partial<DesktopApi> = {}): DesktopApi {
  const auth: () => Promise<GithubTeamAuthIpcResponse> = async () => ({
    authenticated: true,
    cliAvailable: true,
  });
  return {
    readGithubTeamAuthStatus: auth,
    ...overrides,
  };
}

function previewData() {
  return {
    repository: "someone/moebius-team",
    defaultBranch: "main",
    name: "Moebius Team",
    description: "A reusable team.",
    stars: 7,
    updatedAt: "2026-08-18T00:00:00Z",
    language: "en" as const,
    private: false,
    primaryAgentSlug: "dev",
    members: [{
      slug: "dev",
      displayName: "Developer",
      description: "Builds features",
      markdown: "# Rules\n",
      recommendedProfile: "gpt-5.6-sol · high",
      readable: true,
      readError: null,
    }],
  };
}
