import { cn } from "@/lib/utils";
import type {
  OperatorAgentTeamMember,
  OperatorAgentTeamRelayBeat,
} from "@/console/agent-teams-page";
import {
  createRelayConnectorPath,
  createRelayTrackGeometry,
  RELAY_CONNECTOR_HEIGHT,
  RELAY_SVG_LANE_WIDTH,
} from "./relay-geometry";

export const RELAY_STAGE_COLUMNS = "var(--relay-graph-width) minmax(0, 1fr)";

export function RelayRoleColumns({
  activeSpeakerSlug,
  members,
  reducedMotion,
}: {
  activeSpeakerSlug: string | null;
  members: readonly OperatorAgentTeamMember[];
  reducedMotion: boolean;
}): JSX.Element {
  const activeIndex = members.findIndex((member) => member.slug === activeSpeakerSlug);
  const activePosition = activeIndex < 0
    ? null
    : ((activeIndex + 0.5) / members.length) * 100;
  return (
    <div
      className="relative grid min-w-0"
      style={{
        gridTemplateColumns: `repeat(${String(members.length)}, var(--relay-lane-width))`,
        width: "var(--relay-graph-width)",
      }}
      aria-label="接力角色位置"
    >
      {members.map((member, index) => (
        <span
          className={cn(
            "relative grid min-w-0 place-items-center px-1 pb-2 text-center text-[10px] font-semibold leading-3",
            member.slug === activeSpeakerSlug
              ? "text-ink"
              : "text-hint",
          )}
          key={member.slug}
          data-active={member.slug === activeSpeakerSlug ? "true" : "false"}
        >
          <span
            className="hidden whitespace-normal break-words [text-wrap:balance] sm:block"
            data-testid="relay-role-label"
          >
            {member.displayName || member.slug}
          </span>
          <span
            className="block sm:hidden"
            data-testid="relay-role-label-compact"
            aria-hidden="true"
          >
            {(member.displayName || member.slug).slice(0, 1)}
          </span>
        </span>
      ))}
      {activeIndex >= 0 ? (
        <i
          className={cn(
            "absolute bottom-0 h-0.5 w-4 rounded-full bg-ink",
            !reducedMotion && "transition-[left,opacity] duration-300 ease-out",
          )}
          style={{
            left: `calc(${String(activePosition)}% - 8px)`,
          }}
          data-testid="relay-holder-indicator"
          data-member-index={activeIndex}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}

export function RelayGraph({
  activeIndex,
  beats,
  members,
  reducedMotion,
  visibleCount,
}: {
  activeIndex: number;
  beats: readonly OperatorAgentTeamRelayBeat[];
  members: readonly OperatorAgentTeamMember[];
  reducedMotion: boolean;
  visibleCount: number;
}): JSX.Element {
  const memberIndex = new Map(members.map((member, index) => [member.slug, index]));
  const svgGeometry = createRelayTrackGeometry(
    members.length,
    RELAY_SVG_LANE_WIDTH,
  );
  return (
    <>
      {beats.map((beat, index) => {
        const speakerIndex = memberIndex.get(beat.speakerSlug);
        if (speakerIndex === undefined) {
          throw new Error(`Relay speaker is not a current team member: ${beat.speakerSlug}`);
        }
        const previousSpeakerIndex = index === 0
          ? null
          : memberIndex.get(beats[index - 1]!.speakerSlug);
        if (index > 0 && previousSpeakerIndex === undefined) {
          throw new Error(`Relay speaker is not a current team member: ${beats[index - 1]!.speakerSlug}`);
        }
        const visible = index < visibleCount;
        const current = index === activeIndex;
        const x = svgGeometry.nodeX(speakerIndex);
        const connector = previousSpeakerIndex === null || previousSpeakerIndex === undefined
          ? null
          : createRelayConnectorPath({
            currentMemberIndex: speakerIndex,
            memberCount: members.length,
            previousMemberIndex: previousSpeakerIndex,
          });
        const positionPercent = (x / svgGeometry.graphWidth) * 100;

        return (
          <div
            className={cn(
              "relative min-h-[72px] border-b border-line transition-opacity last:border-b-0",
              visible ? "opacity-100" : "opacity-0",
            )}
            style={{ gridColumn: 1, gridRow: index + 1 }}
            data-testid="relay-node-row"
            data-relay-row={index}
            data-grid-row={index + 1}
            data-visible={visible ? "true" : "false"}
            key={`graph-${String(index)}`}
            aria-hidden="true"
          >
            {connector !== null ? (
              <svg
                className="absolute left-0 top-[-6px] h-[31px] w-[var(--relay-graph-width)] overflow-visible"
                viewBox={`0 0 ${String(connector.graphWidth)} ${String(RELAY_CONNECTOR_HEIGHT)}`}
                preserveAspectRatio="none"
              >
                <path
                  className={cn(
                    "fill-none stroke-line-strong [vector-effect:non-scaling-stroke]",
                    current && "stroke-sub",
                  )}
                  d={connector.d}
                  pathLength={1}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  data-testid="relay-connector"
                  data-y1={index - 1}
                  data-y2={index}
                />
              </svg>
            ) : null}
            <span
              className={cn(
                "absolute top-[19px] z-[2] h-3 w-3 rounded-full border-2 border-card",
                current ? "bg-ink" : visible ? "bg-sub" : "bg-hint",
              )}
              style={{
                left: `calc(${String(positionPercent)}% - 6px)`,
              }}
              data-testid="relay-node"
            >
              {current ? (
                <i
                  className={cn(
                    "absolute inset-[-6px] rounded-full border border-sub",
                    !reducedMotion && "animate-breathe",
                  )}
                />
              ) : null}
            </span>
            {index < beats.length - 1 ? (
              <span
                className={cn(
                  "absolute bottom-[-6px] top-[25px] z-[1] w-[1.5px] bg-line-strong transition-opacity",
                  index < activeIndex ? "opacity-100" : "opacity-0",
                )}
                style={{
                  left: `calc(${String(positionPercent)}% - 0.75px)`,
                }}
                data-testid="relay-tail"
                data-y1={index}
                data-y2={index + 1}
                data-visible={index < activeIndex ? "true" : "false"}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}
