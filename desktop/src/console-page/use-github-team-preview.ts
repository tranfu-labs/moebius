import { useCallback, useRef, useState } from "react";
import type { GithubTeamPreviewState } from "@moebius/console-ui";

import type { DesktopLocale } from "../language-preference-contract.js";
import {
  decideGithubTeamInstallEligibility,
  decideGithubTeamInstallFailureMessage,
  decideGithubTeamInstalledTeamId,
  decideGithubTeamPreviewState,
} from "./github-team-console-model.js";
import type { DesktopApi } from "./desktop-api-contract.js";

export interface GithubTeamPreviewController {
  previewRepository: string | null;
  state: GithubTeamPreviewState;
  selectedMemberSlug: string | undefined;
  installedTeamId: string | null;
  setSelectedMemberSlug: (slug: string) => void;
  loadPreview: (repository: string) => void;
  onRetry: () => void;
  install: () => void;
  openInstalledTeam: (onOpenTeam: ((teamId: string) => void) | undefined) => void;
  reset: () => void;
}

export function useGithubTeamPreviewConsole(
  api: DesktopApi | undefined,
  locale: DesktopLocale,
  onInstalled: () => void,
): GithubTeamPreviewController {
  const [previewRepository, setPreviewRepository] = useState<string | null>(null);
  const [state, setState] = useState<GithubTeamPreviewState>({ status: "loading" });
  const [selectedMemberSlug, setSelectedMemberSlug] = useState<string | undefined>(undefined);
  const [installedTeamId, setInstalledTeamId] = useState<string | null>(null);

  const previewRequestRef = useRef(0);
  const installRequestRef = useRef(0);
  const stateRef = useRef(state);
  const installedTeamIdRef = useRef(installedTeamId);
  stateRef.current = state;
  installedTeamIdRef.current = installedTeamId;

  const loadPreview = useCallback((repository: string): void => {
    const requestId = ++previewRequestRef.current;
    const normalizedRepository = repository.trim();
    setPreviewRepository(normalizedRepository);
    setSelectedMemberSlug(undefined);
    setInstalledTeamId(null);
    setState({ status: "loading" });
    const port = api?.previewGithubTeam;
    if (port === undefined) {
      setState({ status: "offline", repository: normalizedRepository });
      return;
    }
    void port.call(api, { repository: normalizedRepository })
      .then((response) => {
        if (requestId !== previewRequestRef.current) return;
        setState(decideGithubTeamPreviewState(response, locale));
      })
      .catch(() => {
        if (requestId === previewRequestRef.current) {
          setState({ status: "offline", repository: normalizedRepository });
        }
      });
  }, [api, locale]);

  const onRetry = useCallback(() => {
    if (previewRepository !== null) loadPreview(previewRepository);
  }, [loadPreview, previewRepository]);

  const install = useCallback((): void => {
    const eligibility = decideGithubTeamInstallEligibility(stateRef.current);
    if (!eligibility.eligible) return;
    const requestId = ++installRequestRef.current;
    const team = eligibility.team;
    setState({ status: "installing", team });
    const port = api?.installGithubTeam;
    if (port === undefined) {
      setState({ status: "install-failed", team, reason: decideGithubTeamInstallFailureMessage("offline", locale) });
      return;
    }
    void port.call(api, { repository: team.repository })
      .then((response) => {
        if (requestId !== installRequestRef.current) return;
        const teamId = decideGithubTeamInstalledTeamId(response);
        if (teamId !== null) {
          setInstalledTeamId(teamId);
          setState({ status: "installed", team });
          onInstalled();
          return;
        }
        setState({ status: "install-failed", team, reason: decideGithubTeamInstallFailureMessage(response, locale) });
      })
      .catch(() => {
        if (requestId === installRequestRef.current) {
          setState({ status: "install-failed", team, reason: decideGithubTeamInstallFailureMessage("offline", locale) });
        }
      });
  }, [api, locale, onInstalled]);

  const openInstalledTeam = useCallback((onOpenTeam: ((teamKey: string) => void) | undefined) => {
    const teamId = installedTeamIdRef.current;
    if (teamId !== null) {
      onInstalled();
      // GitHub installs always create user-owned teams; the navigation surface
      // addresses teams by `ownership:id` keys (getAgentTeamKey), not by id.
      onOpenTeam?.(`user:${teamId}`);
    }
  }, [onInstalled]);

  const reset = useCallback(() => {
    previewRequestRef.current += 1;
    installRequestRef.current += 1;
    setPreviewRepository(null);
    setState({ status: "loading" });
    setSelectedMemberSlug(undefined);
    setInstalledTeamId(null);
  }, []);

  return {
    previewRepository,
    state,
    selectedMemberSlug,
    installedTeamId,
    setSelectedMemberSlug,
    loadPreview,
    onRetry,
    install,
    openInstalledTeam,
    reset,
  };
}
