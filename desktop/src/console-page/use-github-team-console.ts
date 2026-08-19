import { useCallback, useMemo, useState } from "react";
import type { GithubTeamConsoleController } from "@moebius/console-ui";

import type { DesktopLocale } from "../language-preference-contract.js";
import { decideGithubTeamRepositorySlug } from "./github-team-console-model.js";
import { useGithubTeamDiscoveryConsole } from "./use-github-team-discovery.js";
import { useGithubTeamPreviewConsole } from "./use-github-team-preview.js";
import type { DesktopApi } from "./desktop-api-contract.js";

export interface GithubTeamConsoleOptions {
  onOpenExternalLink?: (url: string) => void | Promise<void>;
  onOpenTeam?: (teamKey: string) => void;
  refreshTeams?: () => void;
  debounceMs?: number;
}

export function useGithubTeamConsole(
  api: DesktopApi | undefined,
  locale: DesktopLocale,
  options: GithubTeamConsoleOptions = {},
): GithubTeamConsoleController {
  const [page, setPage] = useState<GithubTeamConsoleController["page"]>(null);

  const onInstalled = useCallback(() => options.refreshTeams?.(), [options.refreshTeams]);
  const discovery = useGithubTeamDiscoveryConsole(api, locale, page === "discovery", options.debounceMs);
  const preview = useGithubTeamPreviewConsole(api, locale, onInstalled);

  const openDiscovery = useCallback(() => {
    discovery.reset();
    preview.reset();
    setPage("discovery");
  }, [discovery, preview]);

  const openRepository = useCallback((repository: string): void => {
    const normalizedRepository = decideGithubTeamRepositorySlug(repository);
    if (normalizedRepository === null) return;
    void options.onOpenExternalLink?.(`https://github.com/${normalizedRepository}`);
  }, [options.onOpenExternalLink]);

  const onOpenResult = useCallback((repository: string) => {
    setPage("preview");
    preview.loadPreview(repository);
  }, [preview]);

  const onPreviewBack = useCallback(() => {
    preview.reset();
    setPage("discovery");
  }, [preview]);

  const onDiscoveryBack = useCallback(() => {
    discovery.reset();
    setPage(null);
  }, [discovery]);

  const onOpenInstalledTeam = useCallback(() => {
    preview.openInstalledTeam(options.onOpenTeam);
    setPage(null);
  }, [preview, options.onOpenTeam]);

  return useMemo<GithubTeamConsoleController>(() => ({
    page,
    openDiscovery,
    discovery: {
      query: discovery.query,
      language: discovery.language,
      ghAuthenticated: discovery.ghAuthenticated,
      state: discovery.state,
      onBack: onDiscoveryBack,
      onQueryChange: discovery.setQuery,
      onLanguageChange: discovery.setLanguage,
      onRetry: discovery.onRetry,
      onOpenRepository: openRepository,
      onOpenResult,
    },
    preview: {
      state: preview.state,
      selectedMemberSlug: preview.selectedMemberSlug,
      onBack: onPreviewBack,
      onSelectMember: preview.setSelectedMemberSlug,
      onOpenRepository: openRepository,
      onRetry: preview.onRetry,
      onInstall: preview.install,
      onOpenInstalledTeam,
    },
  }), [discovery, onDiscoveryBack, onOpenInstalledTeam, onOpenResult, onPreviewBack, openDiscovery, openRepository, page, preview]);
}
