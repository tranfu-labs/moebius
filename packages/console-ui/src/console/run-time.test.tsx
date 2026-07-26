import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { formatRunCompletedAt, formatRunDuration, RunTime } from "./run-time";

describe("run time", () => {
  it("formats short and long durations", () => {
    expect(formatRunDuration(0)).toBe("00:00");
    expect(formatRunDuration(3_599_000)).toBe("59:59");
    expect(formatRunDuration(3_600_000)).toBe("1:00:00");
    expect(formatRunDuration(90_061_000)).toBe("25:01:01");
  });

  it("formats today, same-year, and cross-year completion labels", () => {
    const now = new Date(2026, 6, 26, 18, 0);
    expect(formatRunCompletedAt(new Date(2026, 6, 26, 14, 32).toISOString(), now)).toBe("完成于 14:32");
    expect(formatRunCompletedAt(new Date(2026, 6, 25, 14, 32).toISOString(), now)).toBe("完成于 7月25日 14:32");
    expect(formatRunCompletedAt(new Date(2025, 6, 25, 14, 32).toISOString(), now)).toBe("完成于 2025年7月25日 14:32");
  });

  it("keeps completion time out of visible text while exposing it accessibly", () => {
    render(
      <RunTime
        mode="completed"
        elapsedMs={138_000}
        completedAt={new Date(2026, 6, 26, 14, 32).toISOString()}
      />,
    );

    expect(screen.getByText("耗时 02:18")).toBeVisible();
    expect(screen.getByText("耗时 02:18")).toHaveAttribute("aria-label", expect.stringContaining("完成于"));
  });
});
