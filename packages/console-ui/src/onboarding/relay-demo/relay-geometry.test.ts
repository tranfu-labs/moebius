import { describe, expect, it } from "vitest";

import {
  createRelayConnectorPath,
  createRelayTrackGeometry,
  RELAY_DESKTOP_LANE_WIDTH,
} from "./relay-geometry";

describe("relay geometry", () => {
  it.each([2, 4, 6])(
    "uses stable equal lanes for %i members",
    (memberCount) => {
      const geometry = createRelayTrackGeometry(
        memberCount,
        RELAY_DESKTOP_LANE_WIDTH,
      );

      expect(geometry.graphWidth).toBe(memberCount * RELAY_DESKTOP_LANE_WIDTH);
      expect(geometry.nodeX(0)).toBe(0.5 * RELAY_DESKTOP_LANE_WIDTH);
      expect(geometry.nodeX(memberCount - 1)).toBe(
        (memberCount - 0.5) * RELAY_DESKTOP_LANE_WIDTH,
      );
    },
  );

  it("builds the prototype-style cubic handoff between member lanes", () => {
    const connector = createRelayConnectorPath({
      currentMemberIndex: 3,
      memberCount: 4,
      previousMemberIndex: 1,
      laneWidth: RELAY_DESKTOP_LANE_WIDTH,
    });

    expect(connector.graphWidth).toBe(256);
    expect(connector.previousX).toBe(96);
    expect(connector.currentX).toBe(224);
    expect(connector.d).toBe("M 96 0 C 96 20 224 11 224 31");
  });

  it("rejects invalid track inputs", () => {
    expect(() => createRelayTrackGeometry(0, RELAY_DESKTOP_LANE_WIDTH)).toThrow(
      "at least one member",
    );
    expect(() => createRelayTrackGeometry(4, 0)).toThrow("positive number");
    expect(() => createRelayTrackGeometry(4, RELAY_DESKTOP_LANE_WIDTH).nodeX(4)).toThrow(
      "outside the track",
    );
  });
});
