import { Users } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";

import type {
  OperatorAgentTeam,
  OperatorAgentTeamRelayBeat,
} from "@/console/agent-teams-page";
import { useI18n } from "@/i18n";
import { RelayGraph, RelayRoleColumns, RELAY_STAGE_COLUMNS } from "./relay-graph";
import { RelayMessages } from "./relay-messages";
import { parseRelayDurationToken, useRelayPlayback } from "./relay-motion";
import { RelayReplayButton } from "./relay-replay-button";

export interface RelayDemoProps {
  team: OperatorAgentTeam;
  relayRun: number;
  onReplay: () => void;
  reducedMotion?: boolean;
}

export function RelayDemo({
  team,
  relayRun,
  onReplay,
  reducedMotion,
}: RelayDemoProps): JSX.Element {
  const relay = readRelayTeam(team);
  if (relay === null) {
    return <RelayUnavailable team={team} />;
  }
  return (
    <RelayPlaybackDemo
      team={team}
      relayRun={relayRun}
      onReplay={onReplay}
      reducedMotion={reducedMotion}
      relay={relay}
    />
  );
}

function RelayPlaybackDemo({
  team,
  relayRun,
  onReplay,
  reducedMotion,
  relay,
}: RelayDemoProps & {
  relay: NonNullable<ReturnType<typeof readRelayTeam>>;
}): JSX.Element {
  const { t } = useI18n();
  const stageRef = useRef<HTMLDivElement>(null);
  const { beats, members } = relay;
  const playback = useRelayPlayback({
    beatCount: beats.length,
    relayRun,
    reducedMotion,
  });
  const holderIndex = playback.typingIndex >= 0
    ? playback.typingIndex
    : playback.activeIndex;
  const activeSpeakerSlug = holderIndex < 0
    ? null
    : beats[holderIndex]!.speakerSlug;
  const relayStyle = {
    "--relay-graph-width": `calc(var(--relay-lane-width) * ${String(members.length)})`,
  } as CSSProperties;

  useEffect(() => {
    if (playback.activeIndex < 0) {
      return;
    }
    const currentMessage = stageRef.current?.querySelector<HTMLElement>(
      `[data-testid="relay-message-row"][data-relay-row="${String(playback.activeIndex)}"]`,
    );
    currentMessage?.scrollIntoView?.({
      block: "nearest",
      behavior: playback.reducedMotion ? "auto" : "smooth",
    });
  }, [playback.activeIndex, playback.reducedMotion]);

  useEffect(() => {
    if (playback.reducedMotion || playback.activeIndex < 0) {
      return;
    }
    const elements = stageRef.current?.querySelectorAll<HTMLElement>(
      `[data-relay-row="${String(playback.activeIndex)}"]`,
    );
    const rootStyle = window.getComputedStyle(document.documentElement);
    const enterEasing = rootStyle.getPropertyValue("--ease-enter").trim() || "ease-out";
    const standardEasing = rootStyle.getPropertyValue("--ease").trim() || "ease";
    const standardDurationMs = parseRelayDurationToken(
      rootStyle.getPropertyValue("--dur"),
      150,
    );
    elements?.forEach((element) => {
      element.animate?.(
        [
          { opacity: 0, transform: "translateY(8px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: standardDurationMs, easing: enterEasing, fill: "both" },
      );
    });
    const connector = stageRef.current?.querySelector<SVGPathElement>(
      `[data-relay-row="${String(playback.activeIndex)}"] [data-testid="relay-connector"]`,
    );
    connector?.animate?.(
      [
        { strokeDasharray: "1", strokeDashoffset: "1" },
        { strokeDasharray: "1", strokeDashoffset: "0" },
      ],
      { duration: standardDurationMs, easing: standardEasing, fill: "both" },
    );
  }, [playback.activeIndex, playback.reducedMotion]);

  return (
    <section
      className="[--relay-lane-width:28px] [--relay-row-height:clamp(60px,8dvh,72px)] overflow-hidden rounded-lg border border-line bg-card sm:[--relay-lane-width:64px]"
      style={relayStyle}
      data-testid="onboarding-relay-demo-slot"
      data-relay-run={relayRun}
      data-motion={playback.reducedMotion ? "reduced" : "standard"}
      data-total-duration-ms={playback.timing.totalDurationMs}
      aria-label={t("onboarding.relay.label")}
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:flex-nowrap">
          <i className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--status-run-fg)]" aria-hidden="true" />
          <span className="text-xs text-sub">{t("onboarding.relay.title")}</span>
          <span className="min-w-0 break-words text-xs text-ink">
            {team.name ?? t("onboarding.relay.selectedTeam")}
          </span>
        </span>
        <RelayReplayButton onReplay={onReplay} />
      </div>

      <div
        className="grid items-center gap-x-3 border-b border-line bg-sunken px-3 py-2 text-meta text-hint"
        style={{ gridTemplateColumns: RELAY_STAGE_COLUMNS }}
      >
        <RelayRoleColumns
          activeSpeakerSlug={activeSpeakerSlug}
          members={members}
          reducedMotion={playback.reducedMotion}
        />
        <span className="tracking-[0.04em]">{t("onboarding.relay.messages")}</span>
      </div>

      <div
        ref={stageRef}
        className="grid max-h-[min(432px,calc(100dvh-280px))] gap-x-3 overflow-y-auto px-3"
        style={{
          gridAutoRows: "minmax(var(--relay-row-height), auto)",
          gridTemplateColumns: RELAY_STAGE_COLUMNS,
        }}
        aria-live="polite"
        data-testid="relay-stage"
      >
        <RelayGraph
          activeIndex={playback.activeIndex}
          beats={beats}
          members={members}
          reducedMotion={playback.reducedMotion}
          visibleCount={playback.visibleCount}
        />
        <RelayMessages
          activeIndex={playback.activeIndex}
          beats={beats}
          members={members}
          reducedMotion={playback.reducedMotion}
          typingIndex={playback.typingIndex}
          visibleCount={playback.visibleCount}
        />
      </div>

      <footer className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-meta text-hint">
        <Users className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
        <span>
          {playback.complete
            ? t("onboarding.relay.complete")
            : t("onboarding.relay.canContinue")}
        </span>
      </footer>
    </section>
  );
}

function RelayUnavailable({ team }: { team: OperatorAgentTeam }): JSX.Element {
  const { t } = useI18n();
  return (
    <section
      className="overflow-hidden rounded-lg border border-line bg-card"
      data-testid="onboarding-relay-demo-slot"
      data-orchestration-status="unavailable"
      aria-label={t("onboarding.relay.label")}
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <i className="h-1.5 w-1.5 shrink-0 rounded-full bg-hint" aria-hidden="true" />
        <span className="text-xs text-sub">{t("onboarding.relay.title")}</span>
        <span className="truncate text-xs text-ink">
          {team.name ?? t("onboarding.relay.selectedTeam")}
        </span>
      </div>
      <div className="flex min-h-56 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
        <strong className="text-sm font-semibold text-ink">{t("onboarding.relay.unavailable")}</strong>
        <p className="text-xs text-sub">{t("onboarding.relay.unavailableDetail")}</p>
      </div>
    </section>
  );
}

function readRelayTeam(team: OperatorAgentTeam): {
  beats: OperatorAgentTeamRelayBeat[];
  members: OperatorAgentTeam["members"];
} | null {
  const orchestration = team.onboardingOrchestration;
  if (orchestration?.status !== "ready" || orchestration.relayBeats.length === 0) {
    return null;
  }
  const beats = orchestration.relayBeats;
  const membersBySlug = new Map(team.members.map((member) => [member.slug, member]));
  for (const beat of beats) {
    if (!membersBySlug.has(beat.speakerSlug)) {
      return null;
    }
  }
  const orderedMembers = team.memberOrder
    .map((slug) => membersBySlug.get(slug))
    .filter((member): member is NonNullable<typeof member> => member !== undefined);
  const orderedSlugs = new Set(orderedMembers.map((member) => member.slug));
  const members = [
    ...orderedMembers,
    ...team.members.filter((member) => !orderedSlugs.has(member.slug)),
  ];
  return {
    beats,
    members,
  };
}
