import type { GithubTeamLanguage } from "./github-team-contract.js";

export const GITHUB_TEAM_IPC_CHANNELS = {
  authStatus: "github-teams:auth-status",
  search: "github-teams:search",
  preview: "github-teams:preview",
  install: "github-teams:install",
  detach: "github-teams:detach",
  checkUpstream: "github-teams:check-upstream",
  sync: "github-teams:sync",
  revertSync: "github-teams:revert-sync",
} as const;

export interface GithubTeamSearchIpcRequest {
  query: string;
  language: GithubTeamLanguage;
}

export interface GithubTeamSearchIpcItem {
  repository: string;
  name: string;
  description: string;
  stars: number;
  updatedAt: string;
  language: Exclude<GithubTeamLanguage, "all"> | null;
  private: boolean;
}

export interface GithubTeamAuthIpcResponse {
  authenticated: boolean;
  cliAvailable: boolean;
}

export type GithubTeamSearchIpcResponse =
  | {
    status: "ready";
    authenticated: boolean;
    results: GithubTeamSearchIpcItem[];
  }
  | {
    status: "rate-limited";
    authenticated: boolean;
    seconds: number;
  }
  | {
    status: "permission-denied";
    authenticated: boolean;
  }
  | {
    status: "offline";
    authenticated: boolean;
  }
  | {
    status: "error";
    authenticated: boolean;
    message: string;
  };

export interface GithubTeamPreviewIpcRequest {
  repository: string;
}

export interface GithubTeamPreviewIpcMember {
  slug: string;
  displayName: string;
  description: string;
  markdown: string;
  recommendedProfile: string | null;
  readable: boolean;
  readError: string | null;
}

export interface GithubTeamPreviewIpcData {
  repository: string;
  name: string;
  description: string;
  stars: number;
  updatedAt: string;
  language: Exclude<GithubTeamLanguage, "all"> | null;
  private: boolean;
  primaryAgentSlug: string;
  members: GithubTeamPreviewIpcMember[];
}

export type GithubTeamPreviewIpcResponse =
  | {
    status: "ready";
    team: GithubTeamPreviewIpcData;
  }
  | {
    status: "invalid-repository";
    repository: string;
    issues: Array<{ path?: string; message: string }>;
  }
  | {
    status: "permission-denied";
    repository: string;
  }
  | {
    status: "rate-limited";
    repository: string;
    seconds: number;
  }
  | {
    status: "offline";
    repository: string;
  }
  | {
    status: "error";
    repository: string;
    message: string;
  };

export interface GithubTeamInstallIpcRequest {
  repository: string;
}

export type GithubTeamInstallIpcResponse =
  | {
    status: "installed";
    teamId: string;
  }
  | {
    status: "duplicate";
    existingTeamId: string;
  }
  | {
    status: "rate-limited";
    seconds: number;
  }
  | {
    status: "permission-denied";
  }
  | {
    status: "offline";
  }
  | {
    status: "failed";
    message: string;
  };

export interface GithubTeamDetachIpcRequest {
  teamId: string;
}

export type GithubTeamDetachIpcResponse =
  | { status: "detached" }
  | { status: "not-found" }
  | { status: "not-following" };

export interface GithubTeamCheckUpstreamIpcRequest {
  teamId: string;
}

export interface GithubTeamRecentSyncView {
  officialVersion: string;
  occurredAt: string;
}

export type GithubTeamCheckUpstreamIpcResponse =
  | { status: "not-following" }
  | {
      status: "up-to-date" | "update-available" | "unreachable";
      recentSync: GithubTeamRecentSyncView | null;
      pendingMergeMemberCount: number;
    };

export interface GithubTeamSyncIpcRequest {
  teamId: string;
}

export type GithubTeamSyncIpcResponse =
  | { status: "applied"; changedMemberCount: number; pendingMergeMemberCount: number }
  | { status: "up-to-date" }
  | { status: "unreachable" }
  | { status: "not-following" }
  | { status: "failed"; message: string };

export interface GithubTeamRevertSyncIpcRequest {
  teamId: string;
}

export type GithubTeamRevertSyncIpcResponse =
  | { status: "reverted" }
  | { status: "none" }
  | { status: "failed"; message: string };
