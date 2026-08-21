import { ArrowUpRight, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AgentPortrait } from "@/console/agent-portrait";
import type { OperatorConsoleAppearance } from "@/console/operator-console-appearance";
import { operatorFloatingSurfaceClassName } from "@/console/operator-console-appearance";
import { useI18n, type Translate } from "@/i18n";
import { Button } from "@/ui/button";
import { AnimatedPopoverContent, Popover, PopoverTrigger } from "@/ui/popover";

export interface AgentRunInfoView {
  sessionId: string;
  runId: string;
  role: string;
  agent: { slug: string; displayName: string | null; description: string | null };
  team: {
    teamKey: string | null;
    name: string | null;
    ownership: "system" | "user" | null;
    sourceName: string | null;
  };
  profile: {
    cli: "codex" | "claude" | "kimi";
    model: string;
    effort: string;
  } | {
    cli: "pi";
    providerId: string;
    model: string;
    effort: string;
  } | null;
  loadedAt: string | null;
  evidence: "executed" | "planned-not-started" | "bound-start-unknown";
}

type LoadState<T> = { status: "idle" | "loading" } | { status: "ready"; value: T } | { status: "error" };

export function AgentRunInfoPopover({
  sessionId,
  runId,
  role,
  displayName,
  portraitId,
  engine,
  loadInfo,
  onOpenAgentTeamMember,
  appearance = "default",
}: {
  sessionId: string;
  runId: string;
  role: string;
  displayName: string;
  /** The face this member has been given; the trigger must match the plain RoleTag. */
  portraitId?: string | null;
  /** Engine known from the roster, so the badge is there before the popover loads. */
  engine?: { cli: "codex" | "claude" | "kimi" | "pi"; providerId?: string };
  loadInfo(input: { sessionId: string; runId: string; signal: AbortSignal }): Promise<AgentRunInfoView>;
  onOpenAgentTeamMember?: (teamKey: string, memberSlug: string) => void;
  appearance?: OperatorConsoleAppearance;
}): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [info, setInfo] = useState<LoadState<AgentRunInfoView>>({ status: "idle" });
  const infoLoader = useRef(loadInfo);
  const avatarTrigger = useRef<HTMLButtonElement>(null);
  infoLoader.current = loadInfo;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setInfo({ status: "loading" });
    void infoLoader.current({ sessionId, runId, signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setInfo({ status: "ready", value }); })
      .catch(() => { if (!controller.signal.aborted) setInfo({ status: "error" }); });
    return () => controller.abort();
  }, [open, retry, runId, sessionId]);

  return (
    <Popover
        group="agent-run-info"
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
        }}
      >
        <PopoverTrigger asChild>
          <button
            ref={avatarTrigger}
            type="button"
            // inline-flex, not the default block: a block button reserves line-height
            // leading below inline content, growing a 24px portrait into a 29.5px box
            // with the portrait pinned to the top — it then sits above the row's text.
            className="inline-flex rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={t("console.agentRunInfo.view", { name: displayName })}
          >
            {/* The roster engine shows the badge immediately; once the payload lands we
                prefer what actually ran, which can differ from the roster default. */}
            <AgentPortrait
              displayName={displayName}
              slug={role}
              portraitId={portraitId}
              engine={info.status === "ready" && info.value.profile !== null
                ? {
                    cli: info.value.profile.cli,
                    ...(info.value.profile.cli === "pi" ? { providerId: info.value.profile.providerId } : {}),
                  }
                : engine}
              className="h-6 w-6"
            />
          </button>
        </PopoverTrigger>
        <AnimatedPopoverContent
          side="bottom"
          align="start"
          collisionPadding={12}
          className={operatorFloatingSurfaceClassName(
            appearance,
            "w-[min(340px,calc(100vw-24px))] p-0",
          )}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            avatarTrigger.current?.focus();
          }}
        >
          {info.status === "loading" || info.status === "idle" ? <p className="p-4 text-sm text-sub">{t("console.agentRunInfo.loading")}</p> : null}
          {info.status === "error" ? (
            <div className="p-4 text-sm">
              <p className="text-danger">{t("console.agentRunInfo.loadFailed")}</p>
              <Button className="mt-3" size="sm" variant="outline" onClick={() => setRetry((value) => value + 1)}>
                <RotateCcw className="mr-1.5 h-3 w-3" strokeWidth={1.5} aria-hidden="true" />{t("common.retry")}
              </Button>
            </div>
          ) : null}
          {info.status === "ready" ? <AgentRunInfoContent
            info={info.value}
            t={t}
            onOpenAgentTeamMember={onOpenAgentTeamMember}
          /> : null}
        </AnimatedPopoverContent>
    </Popover>
  );
}

function AgentRunInfoContent({ info, t, onOpenAgentTeamMember }: {
  info: AgentRunInfoView;
  t: Translate;
  onOpenAgentTeamMember?: (teamKey: string, memberSlug: string) => void;
}): JSX.Element {
  const evidence = {
    executed: t("console.agentRunInfo.executed"),
    "planned-not-started": t("console.agentRunInfo.plannedNotStarted"),
    "bound-start-unknown": t("console.agentRunInfo.boundStartUnknown"),
  }[info.evidence];
  const notRecorded = t("console.agentRunInfo.notRecorded");
  return (
    <div className="grid gap-3 p-4 text-xs">
      <div><p className="font-normal text-ink">{info.agent.displayName ?? `@${info.agent.slug}`}</p><p className="text-sub">@{info.agent.slug}</p></div>
      <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt className="text-sub">{t("console.agentRunInfo.team")}</dt><dd className="text-ink">{info.team.name ?? notRecorded}{info.team.ownership ? ` · ${info.team.ownership === "system" ? (info.team.sourceName ?? t("console.agentRunInfo.official")) : t("console.agentRunInfo.user")}` : ""}</dd>
        <dt className="text-sub">{t("console.agentRunInfo.evidence")}</dt><dd className="text-ink">{evidence}</dd>
        <dt className="text-sub">CLI / model</dt><dd className="break-words text-ink">{info.profile ? `${info.profile.cli} / ${info.profile.model}` : notRecorded}</dd>
        <dt className="text-sub">effort</dt><dd className="text-ink">{info.profile?.effort ?? notRecorded}</dd>
        <dt className="text-sub">{t("console.agentRunInfo.loaded")}</dt><dd className="text-ink">{info.loadedAt ?? notRecorded}</dd>
      </dl>
      {info.team.teamKey !== null && onOpenAgentTeamMember !== undefined ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onOpenAgentTeamMember(info.team.teamKey!, info.agent.slug)}
        >
          <ArrowUpRight className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          {t("console.agentRunInfo.openAgentDetail")}
        </Button>
      ) : null}
    </div>
  );
}
