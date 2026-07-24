export const RELAY_DESKTOP_LANE_WIDTH = 64;
export const RELAY_COMPACT_LANE_WIDTH = 28;
export const RELAY_SVG_LANE_WIDTH = 100;
export const RELAY_CONNECTOR_HEIGHT = 31;

export interface RelayTrackGeometry {
  graphWidth: number;
  laneWidth: number;
  nodeX: (memberIndex: number) => number;
}

export function createRelayTrackGeometry(
  memberCount: number,
  laneWidth: number,
): RelayTrackGeometry {
  if (!Number.isInteger(memberCount) || memberCount < 1) {
    throw new Error("Relay track geometry requires at least one member.");
  }
  if (!Number.isFinite(laneWidth) || laneWidth <= 0) {
    throw new Error("Relay lane width must be a positive number.");
  }
  return {
    graphWidth: memberCount * laneWidth,
    laneWidth,
    nodeX: (memberIndex) => {
      if (!Number.isInteger(memberIndex) || memberIndex < 0 || memberIndex >= memberCount) {
        throw new Error(`Relay member index is outside the track: ${String(memberIndex)}`);
      }
      return (memberIndex + 0.5) * laneWidth;
    },
  };
}

export function createRelayConnectorPath(input: {
  currentMemberIndex: number;
  memberCount: number;
  previousMemberIndex: number;
  laneWidth?: number;
}): {
  currentX: number;
  d: string;
  graphWidth: number;
  previousX: number;
} {
  const geometry = createRelayTrackGeometry(
    input.memberCount,
    input.laneWidth ?? RELAY_SVG_LANE_WIDTH,
  );
  const previousX = geometry.nodeX(input.previousMemberIndex);
  const currentX = geometry.nodeX(input.currentMemberIndex);
  return {
    currentX,
    d: `M ${String(previousX)} 0 C ${String(previousX)} 20 ${String(currentX)} 11 ${String(currentX)} ${String(RELAY_CONNECTOR_HEIGHT)}`,
    graphWidth: geometry.graphWidth,
    previousX,
  };
}
