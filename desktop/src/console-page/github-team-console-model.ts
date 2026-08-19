import type {
  GithubTeamDiscoveryState,
  GithubTeamPreviewData,
  GithubTeamPreviewState,
  GithubTeamSearchResult,
} from "@moebius/console-ui";

import type { DesktopLocale } from "../language-preference-contract.js";
import { normalizeGithubRepository } from "../github-team-contract.js";
import { translateDesktop } from "../i18n/index.js";
import type {
  GithubTeamInstallIpcResponse,
  GithubTeamPreviewIpcData,
  GithubTeamPreviewIpcResponse,
  GithubTeamSearchIpcItem,
  GithubTeamSearchIpcResponse,
} from "../github-team-ipc-contract.js";

export const GITHUB_TEAM_SEARCH_DEBOUNCE_MS = 320;

export function decideGithubTeamInitialLanguage(locale: DesktopLocale): "zh" | "en" {
  return locale === "en" ? "en" : "zh"; // i18n-exempt: language-tag mapping, not interface copy
}

export function decideGithubTeamDebounceMs(overrideMs: number | undefined): number {
  return overrideMs ?? GITHUB_TEAM_SEARCH_DEBOUNCE_MS;
}

export function decideGithubTeamRepositorySlug(repository: string): string | null {
  return normalizeGithubRepository(repository);
}

export type GithubTeamSearchIntent =
  | { kind: "empty" }
  | { kind: "search"; query: string };

export function decideGithubTeamSearchIntent(query: string): GithubTeamSearchIntent {
  const normalized = query.trim();
  return normalized.length === 0 ? { kind: "empty" } : { kind: "search", query: normalized };
}

export function planGithubTeamSearchLoadingState(previous: GithubTeamDiscoveryState): GithubTeamDiscoveryState {
  const previousResults = previous.status === "ready"
    ? previous.results
    : previous.status === "loading"
      ? previous.previousResults
      : undefined;
  return previousResults === undefined ? { status: "loading" } : { status: "loading", previousResults };
}

export function decideGithubTeamDiscoveryState(
  response: GithubTeamSearchIpcResponse,
  locale: DesktopLocale,
): GithubTeamDiscoveryState {
  switch (response.status) {
    case "ready": {
      const results = response.results.map((result) => decideGithubTeamSearchResult(result, locale));
      return results.length === 0 ? { status: "empty" } : { status: "ready", results };
    }
    case "rate-limited":
      return { status: "rate-limited", seconds: response.seconds };
    case "permission-denied":
      return { status: "permission-denied" };
    case "offline":
      return { status: "offline" };
    case "error":
      return { status: "error", message: response.message };
  }
}

function decideGithubTeamSearchResult(result: GithubTeamSearchIpcItem, locale: DesktopLocale): GithubTeamSearchResult {
  return {
    repository: result.repository,
    name: result.name,
    description: result.description,
    stars: result.stars,
    updatedLabel: decideGithubTeamUpdatedLabel(result.updatedAt, locale),
    language: result.language,
    private: result.private,
  };
}

export function decideGithubTeamPreviewState(
  response: GithubTeamPreviewIpcResponse,
  locale: DesktopLocale,
): GithubTeamPreviewState {
  switch (response.status) {
    case "ready":
      return { status: "ready", team: decideGithubTeamPreviewData(response.team, locale) };
    case "invalid-repository":
      return { status: "invalid-repository", repository: response.repository };
    case "offline":
      return { status: "offline", repository: response.repository };
    case "permission-denied":
      return { status: "permission-denied", repository: response.repository };
    case "rate-limited":
      return { status: "rate-limited", repository: response.repository, seconds: response.seconds };
    case "error":
      return { status: "error", repository: response.repository, message: response.message };
  }
}

function decideGithubTeamPreviewData(data: GithubTeamPreviewIpcData, locale: DesktopLocale): GithubTeamPreviewData {
  return {
    repository: data.repository,
    name: data.name,
    description: data.description,
    stars: data.stars,
    updatedLabel: decideGithubTeamUpdatedLabel(data.updatedAt, locale),
    language: data.language,
    private: data.private,
    primaryAgentSlug: data.primaryAgentSlug,
    members: data.members.map((member) => ({
      slug: member.slug,
      displayName: member.displayName,
      description: member.description,
      markdown: member.markdown,
      recommendedProfile: member.recommendedProfile,
      readable: member.readable,
      readError: member.readError ?? undefined,
    })),
  };
}

function decideGithubTeamUpdatedLabel(updatedAt: string, locale: DesktopLocale): string {
  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp)) return updatedAt;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

export function decideGithubTeamInstallFailureMessage(
  response: GithubTeamInstallIpcResponse | "offline",
  locale: DesktopLocale,
): string {
  if (response === "offline" || response.status === "offline") {
    return translateDesktop(locale, "githubTeam.error.offline");
  }
  if (response.status === "rate-limited") {
    return translateDesktop(locale, "githubTeam.error.rateLimited", { seconds: response.seconds });
  }
  if (response.status === "permission-denied") {
    return translateDesktop(locale, "githubTeam.error.permissionDenied");
  }
  return response.status === "failed"
    ? response.message
    : translateDesktop(locale, "githubTeam.error.installFailed");
}

export type GithubTeamInstallEligibility =
  | { eligible: true; team: GithubTeamPreviewData }
  | { eligible: false };

export function decideGithubTeamInstallEligibility(state: GithubTeamPreviewState): GithubTeamInstallEligibility {
  if (state.status !== "ready" && state.status !== "install-failed") return { eligible: false };
  if (state.team.members.some((member) => member.readable === false)) return { eligible: false };
  return { eligible: true, team: state.team };
}

export function decideGithubTeamInstalledTeamId(response: GithubTeamInstallIpcResponse): string | null {
  if (response.status === "installed") return response.teamId;
  if (response.status === "duplicate") return response.existingTeamId;
  return null;
}
