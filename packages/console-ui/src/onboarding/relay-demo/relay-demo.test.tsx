import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OperatorAgentTeam } from "@/console/agent-teams-page";
import { I18nProvider } from "@/i18n";
import { RelayDemo } from "./relay-demo";
import { createRelayPlaybackTiming, parseRelayDurationToken } from "./relay-motion";

const developmentTeam: OperatorAgentTeam = {
  teamKey: "system:development",
  id: "development",
  ownership: "system",
  name: "开发团队",
  description: "把目标变成有证据的实现",
  primaryAgentSlug: "manager",
  memberOrder: ["manager", "developer", "qa"],
  onboardingOrchestration: {
    status: "ready",
    relayBeats: [
      { speakerSlug: "manager", message: "拆解任务并派工。" },
      { speakerSlug: "developer", message: "完成第一版实现。" },
      { speakerSlug: "qa", message: "复核发现边界问题。" },
      { speakerSlug: "developer", message: "修正边界问题。" },
      { speakerSlug: "qa", message: "第二轮复核通过。" },
      { speakerSlug: "manager", message: "带着证据收尾。" },
    ],
  },
  members: [
    { slug: "manager", displayName: "经理", description: "拆解并收尾" },
    { slug: "developer", displayName: "开发", description: "负责实现" },
    { slug: "qa", displayName: "测试", description: "负责复核" },
  ],
  status: "usable",
  canCreateConversation: true,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("RelayDemo", () => {
  it("keeps every connector within one beat and aligns graph and message rows", () => {
    renderDemo({ reducedMotion: true });

    const connectors = screen.getAllByTestId("relay-connector");
    const tails = screen.getAllByTestId("relay-tail");
    expect(connectors).toHaveLength(5);
    expect(tails).toHaveLength(5);
    for (const connector of connectors) {
      const y1 = Number(connector.getAttribute("data-y1"));
      const y2 = Number(connector.getAttribute("data-y2"));
      expect(y2 - y1).toBeLessThanOrEqual(1);
    }
    for (const tail of tails) {
      const y1 = Number(tail.getAttribute("data-y1"));
      const y2 = Number(tail.getAttribute("data-y2"));
      expect(y2 - y1).toBe(1);
    }

    const nodeRows = screen.getAllByTestId("relay-node-row");
    const messageRows = screen.getAllByTestId("relay-message-row");
    expect(screen.getByTestId("relay-stage")).toHaveStyle({
      gridAutoRows: "minmax(var(--relay-row-height), auto)",
    });
    expect(nodeRows).toHaveLength(messageRows.length);
    nodeRows.forEach((nodeRow, index) => {
      expect(nodeRow).toHaveClass("min-h-[var(--relay-row-height)]");
      expect(nodeRow.getAttribute("data-grid-row")).toBe(
        messageRows[index]?.getAttribute("data-grid-row"),
      );
      expect((nodeRow as HTMLElement).style.gridRow).toBe(
        (messageRows[index] as HTMLElement).style.gridRow,
      );
    });
  });

  it("uses opacity-only progression for reduced motion", () => {
    vi.useFakeTimers();
    const animate = vi.fn();
    const originalAnimate = Object.getOwnPropertyDescriptor(window.Element.prototype, "animate");
    vi.stubGlobal("Element", window.Element);
    Object.defineProperty(window.Element.prototype, "animate", {
      configurable: true,
      value: animate,
    });

    const { container } = renderDemo({ reducedMotion: true });
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByTestId("onboarding-relay-demo-slot")).toHaveAttribute("data-motion", "reduced");
    expect(animate).not.toHaveBeenCalled();
    const renderedMarkup = container.innerHTML;
    expect(renderedMarkup).not.toMatch(/\b(?:transform|translate(?:X|Y)?)[\s:"'(-]/u);
    expect(screen.getAllByTestId("relay-message-row").every(
      (row) => row.getAttribute("data-visible") === "true",
    )).toBe(true);
    expect(screen.getByText("这支团队已带着复核证据完成接力。")).toBeInTheDocument();

    if (originalAnimate === undefined) {
      Reflect.deleteProperty(window.Element.prototype, "animate");
    } else {
      Object.defineProperty(window.Element.prototype, "animate", originalAnimate);
    }
    vi.unstubAllGlobals();
  });

  it("shows a bounded typing phase before revealing the next beat", () => {
    vi.useFakeTimers();
    renderDemo();
    const timing = createRelayPlaybackTiming(6, false);

    act(() => {
      vi.advanceTimersByTime(timing.typingOffsetsMs[0]!);
    });
    expect(screen.getByRole("status", { name: "经理 正在输入" })).toBeInTheDocument();
    expect(screen.getByTestId("relay-holder-indicator")).toHaveAttribute(
      "data-member-index",
      "0",
    );

    act(() => {
      vi.advanceTimersByTime(
        timing.revealOffsetsMs[0]! - timing.typingOffsetsMs[0]!,
      );
    });
    expect(screen.queryByRole("status", { name: "经理 正在输入" })).not.toBeInTheDocument();
    expect(screen.getByText("拆解任务并派工。")).toBeVisible();
  });

  it("keeps long desktop role labels readable and provides compact labels", () => {
    const longNameTeam: OperatorAgentTeam = {
      ...developmentTeam,
      name: "AI 热点社媒编辑部",
      memberOrder: ["manager", "researcher", "editor", "reviewer"],
      onboardingOrchestration: {
        status: "ready",
        relayBeats: [
          { speakerSlug: "manager", message: "确定选题。" },
          { speakerSlug: "researcher", message: "核对热点。" },
          { speakerSlug: "editor", message: "完成编辑。" },
          { speakerSlug: "reviewer", message: "品牌复核。" },
        ],
      },
      members: [
        { slug: "manager", displayName: "策略负责人", description: "负责选题" },
        { slug: "researcher", displayName: "热点研究员", description: "负责研究" },
        { slug: "editor", displayName: "社交媒体编辑", description: "负责编辑" },
        { slug: "reviewer", displayName: "品牌复核专员", description: "负责复核" },
      ],
    };

    render(
      <I18nProvider locale="zh-CN">
        <RelayDemo
          team={longNameTeam}
          relayRun={1}
          reducedMotion
          onReplay={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("AI 热点社媒编辑部")).not.toHaveClass("truncate");
    const labels = screen.getAllByTestId("relay-role-label");
    expect(labels).toHaveLength(4);
    expect(labels.every((label) => !label.classList.contains("truncate"))).toBe(true);
    expect(screen.getAllByTestId("relay-role-label-compact")).toHaveLength(4);
  });

  it("reads an AI team's relay metadata without branching on team id", () => {
    const aiTeam: OperatorAgentTeam = {
      ...developmentTeam,
      teamKey: "user:launch-team",
      id: "launch-team",
      ownership: "user",
      name: "发布团队",
      onboardingOrchestration: {
        status: "ready",
        relayBeats: [
          { speakerSlug: "manager", message: "锁定发布目标。" },
          { speakerSlug: "qa", message: "校验渠道与排期。" },
        ],
      },
    };

    render(
      <I18nProvider locale="zh-CN">
        <RelayDemo
          team={aiTeam}
          relayRun={1}
          reducedMotion
          onReplay={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("锁定发布目标。")).toBeInTheDocument();
    expect(screen.getByText("校验渠道与排期。")).toBeInTheDocument();
    expect(screen.getAllByTestId("relay-message-row")).toHaveLength(2);
  });

  it("isolates invalid relay metadata to a local unavailable state", () => {
    const invalidTeam: OperatorAgentTeam = {
      ...developmentTeam,
      onboardingOrchestration: {
        status: "ready",
        relayBeats: [{ speakerSlug: "missing", message: "不应静默降级。" }],
      },
    };

    render(
      <I18nProvider locale="zh-CN">
        <RelayDemo
          team={invalidTeam}
          relayRun={1}
          reducedMotion
          onReplay={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("暂无可播放的协作示例")).toBeInTheDocument();
    expect(screen.getByText("不影响这支团队的实际使用")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新播放" })).not.toBeInTheDocument();
  });

  it("allows onboarding to continue when orchestration is missing", () => {
    render(
      <I18nProvider locale="zh-CN">
        <RelayDemo
          team={{ ...developmentTeam, onboardingOrchestration: { status: "unavailable" } }}
          relayRun={1}
          reducedMotion
          onReplay={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("暂无可播放的协作示例")).toBeInTheDocument();
  });

  it("delegates replay and computes a standard duration in the 8-12 second window", () => {
    const onReplay = vi.fn();
    renderDemo({ onReplay });

    fireEvent.click(screen.getByRole("button", { name: "重新播放" }));

    expect(onReplay).toHaveBeenCalledOnce();
    expect(createRelayPlaybackTiming(4, false).totalDurationMs).toBe(8_000);
    expect(createRelayPlaybackTiming(6, false).totalDurationMs).toBe(10_200);
    expect(createRelayPlaybackTiming(10, false).totalDurationMs).toBe(12_000);
    expect(createRelayPlaybackTiming(6, false).typingOffsetsMs).toHaveLength(6);
  });

  it("parses the shared motion duration token for WAAPI timing", () => {
    expect(parseRelayDurationToken("150ms", 99)).toBe(150);
    expect(parseRelayDurationToken("0.2s", 99)).toBe(200);
    expect(parseRelayDurationToken("", 99)).toBe(99);
  });
});

function renderDemo(overrides: Partial<{
  onReplay: () => void;
  reducedMotion: boolean;
}> = {}) {
  return render(
    <I18nProvider locale="zh-CN">
      <RelayDemo
        team={developmentTeam}
        relayRun={1}
        reducedMotion={overrides.reducedMotion}
        onReplay={overrides.onReplay ?? vi.fn()}
      />
    </I18nProvider>,
  );
}
