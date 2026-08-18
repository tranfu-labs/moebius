import {
  AlertTriangle,
  Check,
  ExternalLink,
  FileWarning,
  LoaderCircle,
  Lock,
  MoreHorizontal,
  RotateCcw,
  Search,
  Star,
  X,
} from "lucide-react";

import {
  AgentTeamDetail,
  type AgentExecutionProfile,
  type AgentExecutionProfileDocument,
  type AgentTeamDetailState,
  type AgentTeamDetailTeam,
} from "@/console/agent-team-detail";
import { AgentTeamsPageHeading, AgentTeamsPageSurface } from "@/console/agent-teams-page";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/ui/select";

export type GithubTeamLanguage = "zh" | "en" | "all";

export interface GithubTeamSearchResult {
  repository: string;
  name: string;
  description: string;
  stars: number;
  updatedLabel: string;
  language: Exclude<GithubTeamLanguage, "all">;
  private?: boolean;
}

export type GithubTeamDiscoveryState =
  | { status: "initial" }
  | { status: "loading"; previousResults?: GithubTeamSearchResult[] }
  | { status: "ready"; results: GithubTeamSearchResult[] }
  | { status: "empty" }
  | { status: "rate-limited"; seconds: number }
  | { status: "offline" }
  | { status: "permission-denied" };

export function GithubTeamDiscoveryPage({
  query,
  language,
  ghAuthenticated,
  state,
  onBack,
  onQueryChange,
  onLanguageChange,
  onRetry,
  onOpenRepository,
  onOpenResult,
}: {
  query: string;
  language: GithubTeamLanguage;
  ghAuthenticated: boolean;
  state: GithubTeamDiscoveryState;
  onBack?: () => void;
  onQueryChange?: (query: string) => void;
  onLanguageChange?: (language: GithubTeamLanguage) => void;
  onRetry?: () => void;
  onOpenRepository?: (repository: string) => void;
  onOpenResult?: (repository: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  const visibleResults = state.status === "ready"
    ? state.results
    : state.status === "loading"
      ? state.previousResults ?? []
      : [];

  return (
    <AgentTeamsPageSurface labelledBy="github-team-discovery-title">
      <AgentTeamsPageHeading
        title={t("console.githubTeams.discoveryTitle")}
        titleId="github-team-discovery-title"
        backLabel={t("console.githubTeams.backToTeams")}
        onBack={onBack}
      />

      <div className="mt-8">
        <div className="max-w-2xl">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sub" strokeWidth={1.5} aria-hidden="true" />
            <Input
              value={query}
              onChange={(event) => onQueryChange?.(event.target.value)}
              placeholder={t("console.githubTeams.searchPlaceholder")}
              className="pl-9 pr-3"
              aria-label={t("console.githubTeams.searchPlaceholder")}
            />
          </div>

          <div className="mt-3 hidden flex-wrap items-center gap-2 sm:flex" aria-label={t("console.githubTeams.languageLabel")}>
            <span className="mr-1 text-xs text-sub">{t("console.githubTeams.languageLabel")}</span>
            {(["zh", "en", "all"] as const).map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={language === option ? "subtle" : "ghost"}
                aria-pressed={language === option}
                onClick={() => onLanguageChange?.(option)}
              >
                {option === "zh" ? "中文" : option === "en" ? "English" : t("console.githubTeams.languageAll")}
              </Button>
            ))}
          </div>

          <label className="mt-3 grid gap-1.5 text-xs text-sub sm:hidden">
            {t("console.githubTeams.languageLabel")}
            <Select value={language} onValueChange={(value) => onLanguageChange?.(value as GithubTeamLanguage)}>
              <SelectTrigger aria-label={t("console.githubTeams.languageLabel")}>
                {language === "zh" ? "中文" : language === "en" ? "English" : t("console.githubTeams.languageAll")}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh">中文</SelectItem>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="all">{t("console.githubTeams.languageAll")}</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <p className="mt-4 max-w-3xl text-sm leading-6 text-sub">
            {ghAuthenticated
              ? t("console.githubTeams.scopeAuthenticated")
              : t("console.githubTeams.scopePublic")}
          </p>

        </div>

        <div className="mt-6 space-y-3" data-testid="github-team-results">
            {state.status === "initial" ? (
              <DiscoveryMessage title={t("console.githubTeams.initialTitle")} description={t("console.githubTeams.initialDescription")} />
            ) : null}
            {state.status === "loading" && visibleResults.length === 0 ? (
              <DiscoveryMessage loading title={t("console.githubTeams.loadingTitle")} description={t("console.githubTeams.loadingDescription")} />
            ) : null}
            {visibleResults.map((result) => (
              <GithubTeamResultRow
                key={result.repository}
                result={result}
                dimmed={state.status === "loading"}
                onOpen={() => onOpenResult?.(result.repository)}
                onOpenRepository={() => onOpenRepository?.(result.repository)}
              />
            ))}
            {state.status === "loading" && visibleResults.length > 0 ? (
              <div className="flex items-center gap-2 rounded-xl border border-line bg-card px-4 py-3 text-xs text-sub">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" strokeWidth={1.5} aria-hidden="true" />
                {t("console.githubTeams.loadingTitle")}
              </div>
            ) : null}
            {state.status === "empty" ? (
              <DiscoveryMessage
                title={t("console.githubTeams.emptyTitle", { query })}
                description={t("console.githubTeams.emptyDescription")}
              />
            ) : null}
            {state.status === "rate-limited" ? (
              <DiscoveryMessage
                icon="warning"
                title={t("console.githubTeams.rateLimitedTitle")}
                description={`${t("console.githubTeams.rateLimitedDescription", { seconds: String(state.seconds) })}${ghAuthenticated ? "" : ` ${t("console.githubTeams.rateLimitedPublicHint")}`}`}
                actionLabel={t("console.githubTeams.retry")}
                actionDisabled={state.seconds > 0}
                onAction={onRetry}
              />
            ) : null}
            {state.status === "offline" ? (
              <DiscoveryMessage icon="warning" title={t("console.githubTeams.offlineTitle")} description={t("console.githubTeams.offlineDescription")} actionLabel={t("console.githubTeams.retry")} onAction={onRetry} />
            ) : null}
            {state.status === "permission-denied" ? (
              <DiscoveryMessage icon="warning" title={t("console.githubTeams.permissionTitle")} description={t("console.githubTeams.permissionDescription")} />
            ) : null}
        </div>
      </div>
    </AgentTeamsPageSurface>
  );
}

function GithubTeamResultRow({
  result,
  dimmed,
  onOpen,
  onOpenRepository,
}: {
  result: GithubTeamSearchResult;
  dimmed: boolean;
  onOpen: () => void;
  onOpenRepository: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <article className={cn("group relative rounded-xl border border-line bg-card p-4 transition-colors hover:bg-hover", dimmed && "opacity-55")}>
      <button type="button" className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent" aria-label={result.name} onClick={onOpen} />
      <div className="pointer-events-none relative">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-6 tracking-[-0.01em] text-ink">{result.name}</h2>
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-sub">{result.description}</p>
          <button
            type="button"
            className="pointer-events-auto relative mt-2 inline-flex items-center gap-1 font-mono text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={(event) => {
              event.stopPropagation();
              onOpenRepository();
            }}
          >
            {result.repository}
            <ExternalLink className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-hint">
          <span className="inline-flex items-center gap-1"><Star className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />{result.stars}</span>
          <span>{result.updatedLabel}</span>
          <span className="rounded-full border border-line-strong px-2 py-0.5 text-sub">{result.language === "zh" ? "中文" : "English"}</span>
          {result.private ? <span className="inline-flex items-center gap-1 rounded-full border border-line-strong px-2 py-0.5 text-sub"><Lock className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />{t("console.githubTeams.private")}</span> : null}
        </div>
      </div>
    </article>
  );
}

function DiscoveryMessage({
  title,
  description,
  loading = false,
  icon,
  actionLabel,
  actionDisabled,
  onAction,
}: {
  title: string;
  description: string;
  loading?: boolean;
  icon?: "warning";
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
}): JSX.Element {
  const Icon = loading ? LoaderCircle : icon === "warning" ? AlertTriangle : Search;
  return (
    <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-line bg-card px-6 py-10 text-center">
      <Icon className={cn("h-5 w-5 text-sub", loading && "animate-spin motion-reduce:animate-none")} strokeWidth={1.5} aria-hidden="true" />
      <h2 className="mt-3 text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-lg text-sm leading-6 text-sub">{description}</p>
      {actionLabel ? <Button type="button" variant="outline" size="sm" className="mt-4" disabled={actionDisabled} onClick={onAction}><RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />{actionLabel}</Button> : null}
    </div>
  );
}

export interface GithubTeamPreviewMember {
  slug: string;
  displayName: string;
  description: string;
  markdown: string;
  recommendedProfile: string | null;
  portraitId?: string | null;
  readable?: boolean;
  readError?: string;
}

export interface GithubTeamPreviewData extends GithubTeamSearchResult {
  primaryAgentSlug: string;
  members: GithubTeamPreviewMember[];
}

export type GithubTeamPreviewState =
  | { status: "loading" }
  | { status: "ready"; team: GithubTeamPreviewData }
  | { status: "installed"; team: GithubTeamPreviewData }
  | { status: "invalid-repository"; repository: string }
  | { status: "offline"; repository: string }
  | { status: "permission-denied"; repository: string }
  | { status: "rate-limited"; repository: string; seconds: number }
  | { status: "installing"; team: GithubTeamPreviewData }
  | { status: "install-failed"; team: GithubTeamPreviewData; reason: string };

export function GithubTeamPreviewPage({
  state,
  selectedMemberSlug,
  onBack,
  onSelectMember,
  onOpenRepository,
  onOpenFormatGuide,
  onRetry,
  onInstall,
  onOpenInstalledTeam,
}: {
  state: GithubTeamPreviewState;
  selectedMemberSlug?: string;
  onBack?: () => void;
  onSelectMember?: (slug: string) => void;
  onOpenRepository?: (repository: string) => void;
  onOpenFormatGuide?: () => void;
  onRetry?: () => void;
  onInstall?: () => void;
  onOpenInstalledTeam?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const team = "team" in state ? state.team : null;
  const unreadableMembers = team?.members.filter((member) => member.readable === false) ?? [];
  const canInstall = state.status === "ready" && unreadableMembers.length === 0;

  if (team === null) {
    return (
      <AgentTeamsPageSurface labelledBy="github-team-preview-title">
        <AgentTeamsPageHeading
          title={t("console.githubTeams.previewTitle")}
          titleId="github-team-preview-title"
          backLabel={t("console.githubTeams.backToSearch")}
          onBack={onBack}
        />
        <div className="mt-8">
          {state.status === "loading" ? <PreviewStatus loading title={t("console.githubTeams.previewLoadingTitle")} description={t("console.githubTeams.previewLoadingDescription")} /> : null}
          {state.status === "invalid-repository" ? <PreviewStatus icon="file" title={t("console.githubTeams.invalidTitle")} description={t("console.githubTeams.invalidDescription")} actionLabel={t("console.githubTeams.viewFormat")} onAction={onOpenFormatGuide} /> : null}
          {state.status === "offline" ? <PreviewStatus icon="warning" actionIcon="retry" title={t("console.githubTeams.offlineTitle")} description={t("console.githubTeams.offlineDescription")} actionLabel={t("console.githubTeams.retry")} onAction={onRetry} /> : null}
          {state.status === "permission-denied" ? <PreviewStatus icon="warning" title={t("console.githubTeams.permissionTitle")} description={t("console.githubTeams.permissionDescription")} /> : null}
          {state.status === "rate-limited" ? <PreviewStatus icon="warning" actionIcon="retry" title={t("console.githubTeams.rateLimitedTitle")} description={t("console.githubTeams.previewRateLimitedDescription", { seconds: String(state.seconds) })} actionLabel={t("console.githubTeams.retry")} actionDisabled={state.seconds > 0} onAction={onRetry} /> : null}
        </div>
      </AgentTeamsPageSurface>
    );
  }

  const detailTeam = previewDetailTeam(team);
  const detailState = previewDetailState(team, selectedMemberSlug);
  const primaryMember = team.members.find((member) => member.slug === team.primaryAgentSlug);
  const installFailure = state.status === "install-failed" ? (
    <div className="flex items-start gap-3 border border-danger/30 bg-danger/5 p-4 text-sm" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={1.5} aria-hidden="true" />
      <div>
        <p className="font-normal text-danger">{t("console.githubTeams.installFailed")}</p>
        <p className="mt-1 text-sub">{state.reason}</p>
      </div>
    </div>
  ) : undefined;
  const previewContext = (
    <div className="space-y-1">
      <p className="text-sm text-ink">
        {t("console.githubTeams.memberSummary", {
          primary: primaryMember?.displayName ?? team.primaryAgentSlug,
          count: String(team.members.length),
        })}
      </p>
      <p className="text-sm leading-6 text-sub">{t("console.githubTeams.markdownDescription")}</p>
      {installFailure !== undefined ? <div className="pt-3">{installFailure}</div> : null}
    </div>
  );

  return (
    <section className="flex h-full min-h-0 flex-col bg-canvas text-ink">
      <AgentTeamsPageSurface>
        <AgentTeamDetail
          team={detailTeam}
          state={detailState}
          readOnly
          backLabel={t("console.githubTeams.backToSearch")}
          onOpenUpstreamRepository={() => onOpenRepository?.(team.repository)}
          notice={previewContext}
          teamActions={(
            <div className="flex max-w-sm flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-sub">
              <span className="inline-flex items-center gap-1"><Star className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />{team.stars}</span>
              <span>{team.updatedLabel}</span>
              <span className="rounded-full border border-line-strong px-2 py-0.5">{team.language === "zh" ? "中文" : "English"}</span>
            </div>
          )}
          onSelectMember={(slug) => onSelectMember?.(slug)}
          onChangeMember={() => undefined}
          onSaveMember={async () => undefined}
          onRetryLoad={() => onRetry?.()}
          onDiscardMember={() => undefined}
          onDiscardAll={() => undefined}
          onSaveAll={async () => ({ failures: [] })}
          onLeave={() => onBack?.()}
        />
      </AgentTeamsPageSurface>

      <footer className="shrink-0 border-t border-line bg-card px-4 py-4 sm:px-8">
          <div className="mx-auto flex max-w-[960px] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <ul className="space-y-1 text-xs leading-5 text-sub">
              <li>{t("console.githubTeams.installEffectLocal")}</li>
              <li>{t("console.githubTeams.installEffectUpstream")}</li>
              <li>{t("console.githubTeams.installEffectRemove")}</li>
            </ul>
            {state.status === "installed" ? (
              <Button type="button" className="shrink-0" onClick={onOpenInstalledTeam}><Check className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />{t("console.githubTeams.openInstalled")}</Button>
            ) : (
              <Button type="button" className="shrink-0" disabled={!canInstall && state.status !== "install-failed"} onClick={onInstall}>
                {state.status === "installing" ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" strokeWidth={1.5} aria-hidden="true" /> : null}
                {state.status === "installing" ? t("console.githubTeams.installing") : state.status === "install-failed" ? t("console.githubTeams.retryInstall") : t("console.githubTeams.install")}
              </Button>
            )}
          </div>
      </footer>
    </section>
  );
}

function previewDetailTeam(team: GithubTeamPreviewData): AgentTeamDetailTeam {
  return {
    teamKey: `preview:${team.repository}`,
    ownership: "user",
    upstreamRepository: team.repository,
    name: team.name,
    description: team.description,
    primaryAgentSlug: team.primaryAgentSlug,
    memberOrder: team.members.map((member) => member.slug),
    members: team.members.map((member) => ({
      slug: member.slug,
      displayName: member.displayName,
      description: member.description,
      portraitId: member.portraitId,
      available: member.readable !== false,
      executionProfile: previewProfileDocument(member.recommendedProfile),
    })),
    status: "usable",
    canCreateConversation: false,
  };
}

function previewDetailState(team: GithubTeamPreviewData, selectedMemberSlug?: string): AgentTeamDetailState {
  const selected = team.members.some((member) => member.slug === selectedMemberSlug)
    ? selectedMemberSlug!
    : team.members[0]?.slug ?? null;
  return {
    teamKey: `preview:${team.repository}`,
    selectedMemberSlug: selected,
    saveAllFailures: [],
    memberEditors: Object.fromEntries(team.members.map((member) => [member.slug, {
      memberSlug: member.slug,
      loadStatus: member.readable === false ? "failed" as const : "ready" as const,
      loadError: member.readError ?? null,
      draftMarkdown: `---\ndisplay_name: ${member.displayName}\ndescription: ${member.description}\n---\n\n${member.markdown}`,
      isDirty: false,
      saveStatus: "idle" as const,
      saveError: null,
      externalChangeStatus: "none" as const,
      displayName: member.displayName,
      description: member.description,
    }])),
  };
}

function previewProfileDocument(label: string | null): AgentExecutionProfileDocument | undefined {
  if (label === null) return undefined;
  const [model = "gpt-5.6-sol", effort = "high"] = label.split("·").map((part) => part.trim());
  const cli: AgentExecutionProfile["cli"] = model.startsWith("claude-")
    ? "claude"
    : model.startsWith("kimi-")
      ? "kimi"
      : "codex";
  const profile: AgentExecutionProfile = { cli, model, effort };
  return {
    binding: { source: "recommended", profile },
    recommendation: profile,
    effectiveProfile: profile,
  };
}

function PreviewStatus({
  title,
  description,
  loading,
  icon,
  actionIcon,
  actionLabel,
  actionDisabled,
  onAction,
}: {
  title: string;
  description: string;
  loading?: boolean;
  icon?: "warning" | "file";
  actionIcon?: "retry";
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
}): JSX.Element {
  const Icon = loading ? LoaderCircle : icon === "warning" ? AlertTriangle : icon === "file" ? FileWarning : Search;
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-line bg-card px-6 py-10 text-center">
      <Icon className={cn("h-5 w-5 text-sub", loading && "animate-spin motion-reduce:animate-none")} strokeWidth={1.5} aria-hidden="true" />
      <h2 className="mt-3 text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-xl text-sm leading-6 text-sub">{description}</p>
      {actionLabel ? <Button type="button" variant="outline" size="sm" className="mt-4" disabled={actionDisabled} onClick={onAction}>{actionIcon === "retry" ? <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" /> : null}{actionLabel}</Button> : null}
    </div>
  );
}

export interface FollowingTeamDetailMember extends GithubTeamPreviewMember {
  executionProfile: string;
  profileSource: "recommended" | "overridden";
}

export interface FollowingTeamSyncSummary {
  commit: string;
  affectedMemberCount: number;
  summary: string;
}

export function FollowingTeamDetailPage({
  name,
  description,
  repository,
  customized,
  primaryAgentSlug,
  members,
  selectedMemberSlug,
  syncSummary,
  contentState = "ready",
  upstreamStatus = "available",
  onBack,
  onOpenRepository,
  onSelectMember,
  onChangePrimaryAgent,
  onAddMember,
  onEditInformation,
  onViewRecentSync,
  onDuplicateTeam,
  onOpenLocation,
  onMoveToTrash,
  onViewSyncChanges,
  onRevertSync,
  onDismissSync,
  onRetryLoad,
  onRetryUpstream,
  onDetachUpstream,
  onRestoreRecommendedProfile,
  onDiscardChanges,
  onSave,
}: {
  name: string;
  description: string;
  repository: string;
  customized?: boolean;
  primaryAgentSlug: string;
  members: FollowingTeamDetailMember[];
  selectedMemberSlug?: string;
  syncSummary?: FollowingTeamSyncSummary | null;
  contentState?: "ready" | "loading" | "error";
  upstreamStatus?: "available" | "unavailable";
  onBack?: () => void;
  onOpenRepository?: () => void;
  onSelectMember?: (slug: string) => void;
  onChangePrimaryAgent?: () => void;
  onAddMember?: () => void;
  onEditInformation?: () => void;
  onViewRecentSync?: () => void;
  onDuplicateTeam?: () => void;
  onOpenLocation?: () => void;
  onMoveToTrash?: () => void;
  onViewSyncChanges?: () => void;
  onRevertSync?: () => void;
  onDismissSync?: () => void;
  onRetryLoad?: () => void;
  onRetryUpstream?: () => void;
  onDetachUpstream?: () => void;
  onRestoreRecommendedProfile?: () => void;
  onDiscardChanges?: () => void;
  onSave?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const detailTeam = followingDetailTeam({
    name,
    description,
    repository,
    customized,
    primaryAgentSlug,
    members,
  });
  const detailState = followingDetailState(
    detailTeam.teamKey,
    members,
    selectedMemberSlug,
    contentState,
    t("console.githubTeams.detailErrorDescription"),
  );
  const notice = upstreamStatus === "unavailable" ? (
    <div className="border-l-2 border-line bg-sunken px-4 py-3">
      <p className="text-sm font-normal text-ink">{t("console.githubTeams.upstreamUnavailableTitle")}</p>
      <p className="mt-1 text-sm leading-6 text-sub">{t("console.githubTeams.upstreamUnavailableDescription", { repository })}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onRetryUpstream}><RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />{t("console.githubTeams.recheckUpstream")}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDetachUpstream}>{t("console.githubTeams.detachUpstream")}</Button>
      </div>
    </div>
  ) : syncSummary ? (
    <div className="border-l-2 border-accent/50 bg-sunken px-4 py-3" role="status">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-normal text-ink">{t("console.githubTeams.syncedTitle", { commit: syncSummary.commit, count: String(syncSummary.affectedMemberCount) })}</p>
          <p className="mt-1 text-sm leading-6 text-sub">{syncSummary.summary}</p>
        </div>
        <button type="button" className="shrink-0 rounded-sm p-1 text-sub hover:bg-hover hover:text-ink" aria-label={t("console.githubTeams.dismissSync")} onClick={onDismissSync}>
          <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onViewSyncChanges}>{t("console.githubTeams.viewChanges")}</Button>
        <Button type="button" variant="outline" size="sm" onClick={onRevertSync}>{t("console.githubTeams.revertSync")}</Button>
      </div>
    </div>
  ) : undefined;

  return (
    <section className="flex h-full min-h-0 flex-col bg-canvas text-ink">
      <AgentTeamsPageSurface>
        <AgentTeamDetail
          team={detailTeam}
          state={detailState}
          backLabel={t("console.githubTeams.backToTeams")}
          onOpenUpstreamRepository={onOpenRepository}
          notice={notice}
          teamActions={(
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" aria-label={t("console.githubTeams.moreActions")}>
                  <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {syncSummary !== null && syncSummary !== undefined ? <DropdownMenuItem onSelect={onViewRecentSync}>{t("console.githubTeams.recentUpstreamSync")}</DropdownMenuItem> : null}
                <DropdownMenuItem onSelect={onDuplicateTeam}>{t("console.githubTeams.duplicateTeam")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={onOpenLocation}>{t("console.githubTeams.openInFinder")}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-danger focus:text-danger" onSelect={onMoveToTrash}>{t("console.githubTeams.moveToTrash")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          onChangeTeamInformation={() => onEditInformation?.()}
          onAddMember={() => onAddMember?.()}
          onReorderMembers={(slugs) => {
            if (slugs[0] !== primaryAgentSlug) onChangePrimaryAgent?.();
          }}
          onSelectMember={(slug) => onSelectMember?.(slug)}
          onChangeMemberPortrait={() => undefined}
          onChangeMemberIdentity={() => undefined}
          onChangeMember={() => undefined}
          onSaveMember={async () => onSave?.()}
          onRetryLoad={() => onRetryLoad?.()}
          onDiscardMember={() => onDiscardChanges?.()}
          onDiscardAll={() => onDiscardChanges?.()}
          onSaveAll={async () => {
            onSave?.();
            return { failures: [] };
          }}
          onSaveExecutionProfile={async (slug, profile) => {
            const member = members.find((candidate) => candidate.slug === slug);
            return {
              binding: { source: member?.profileSource === "overridden" ? "override" : "recommended", profile },
              recommendation: member === undefined ? profile : previewProfileDocument(member.recommendedProfile)?.effectiveProfile ?? profile,
              effectiveProfile: profile,
            };
          }}
          onRestoreRecommendedProfile={async (slug) => {
            onRestoreRecommendedProfile?.();
            const member = members.find((candidate) => candidate.slug === slug);
            return previewProfileDocument(member?.recommendedProfile ?? null) ?? followingProfileDocument(member ?? members[0]!);
          }}
          onLeave={() => onBack?.()}
        />
      </AgentTeamsPageSurface>
    </section>
  );
}

function followingDetailTeam({
  name,
  description,
  repository,
  customized,
  primaryAgentSlug,
  members,
}: {
  name: string;
  description: string;
  repository: string;
  customized?: boolean;
  primaryAgentSlug: string;
  members: FollowingTeamDetailMember[];
}): AgentTeamDetailTeam {
  return {
    teamKey: `following:${repository}`,
    ownership: "user",
    upstreamRepository: repository,
    name,
    description,
    primaryAgentSlug,
    memberOrder: members.map((member) => member.slug),
    members: members.map((member) => ({
      slug: member.slug,
      displayName: member.displayName,
      description: member.description,
      portraitId: member.portraitId,
      available: member.readable !== false,
      executionProfile: followingProfileDocument(member),
    })),
    status: "usable",
    canCreateConversation: true,
    officialManagement: { customizationStatus: customized ? "customized" : "clean" },
  };
}

function followingDetailState(
  teamKey: string,
  members: FollowingTeamDetailMember[],
  selectedMemberSlug: string | undefined,
  contentState: "ready" | "loading" | "error",
  loadError: string,
): AgentTeamDetailState {
  const selected = members.some((member) => member.slug === selectedMemberSlug)
    ? selectedMemberSlug!
    : members[0]?.slug ?? null;
  return {
    teamKey,
    selectedMemberSlug: selected,
    saveAllFailures: [],
    memberEditors: Object.fromEntries(members.map((member) => [member.slug, {
      memberSlug: member.slug,
      loadStatus: contentState === "loading" ? "loading" as const : contentState === "error" || member.readable === false ? "failed" as const : "ready" as const,
      loadError: contentState === "error" ? loadError : member.readError ?? null,
      draftMarkdown: `---\ndisplay_name: ${member.displayName}\ndescription: ${member.description}\n---\n\n${member.markdown}`,
      isDirty: false,
      saveStatus: "idle" as const,
      saveError: null,
      externalChangeStatus: "none" as const,
      displayName: member.displayName,
      description: member.description,
    }])),
  };
}

function followingProfileDocument(member: FollowingTeamDetailMember): AgentExecutionProfileDocument {
  const parts = member.executionProfile.split("·").map((part) => part.trim());
  const engine = (parts.length > 2 ? parts[0] : "Codex").toLowerCase();
  const rawModel = parts.length > 2 ? parts[1]! : parts[0]!;
  const model = engine.startsWith("claude") && rawModel === "opus"
    ? "claude-opus-5"
    : engine.startsWith("kimi") && !rawModel.includes("/")
      ? `kimi-code/${rawModel}`
      : rawModel;
  const effort = parts.length > 2 ? parts[2]! : parts[1] ?? "high";
  const cli: AgentExecutionProfile["cli"] = engine.startsWith("claude")
    ? "claude"
    : engine.startsWith("kimi")
      ? "kimi"
      : "codex";
  const profile: AgentExecutionProfile = { cli, model, effort };
  const recommendation = previewProfileDocument(member.recommendedProfile)?.effectiveProfile ?? profile;
  return {
    binding: { source: member.profileSource === "overridden" ? "override" : "recommended", profile },
    recommendation,
    effectiveProfile: profile,
  };
}
