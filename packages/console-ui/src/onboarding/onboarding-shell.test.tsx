import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { OperatorAgentTeam } from "@/console/agent-teams-page";
import {
  OnboardingShell,
  type OnboardingShellProps,
} from "./onboarding-shell";

const developmentTeam: OperatorAgentTeam = {
  teamKey: "system:development",
  id: "development",
  ownership: "system",
  name: "开发团队",
  description: "把目标变成可验证的实现",
  primaryAgentSlug: "dev-manager",
  memberOrder: ["dev-manager", "dev"],
  onboardingOrchestration: {
    status: "ready",
    relayBeats: [
      { speakerSlug: "dev-manager", message: "拆解任务" },
      { speakerSlug: "dev", message: "完成实现" },
    ],
  },
  members: [
    {
      slug: "dev-manager",
      displayName: "技术负责人",
      description: "拆解并收尾",
    },
    {
      slug: "dev",
      displayName: "开发者",
      description: "实现和验证",
    },
  ],
  status: "usable",
  canCreateConversation: true,
};

describe("OnboardingShell", () => {
  it("hard-gates step 1 until Codex is ready and exposes install recovery", async () => {
    const onCopyInstallCommand = vi.fn();
    const onRecheckCodex = vi.fn();
    renderShell({
      environment: { status: "error", kind: "missing" },
      onCopyInstallCommand,
      onRecheckCodex,
    });

    expect(screen.getByTestId("moebius-logo")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "继续" })).toBeDisabled();
    expect(screen.getByText("brew install codex")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument());
    expect(onCopyInstallCommand).toHaveBeenCalledOnce();
    expect(onRecheckCodex).toHaveBeenCalledOnce();

    const visibleText = document.body.textContent ?? "";
    expect(visibleText).not.toMatch(/\b(?:gh|GitHub|PR|issue)\b/i);
  });

  it("keeps selection and environment state while navigating all four steps", async () => {
    renderShell();

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /开发团队/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    ));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(screen.getByTestId("onboarding-relay-demo-slot")).toHaveAttribute("data-relay-run", "1");
    fireEvent.click(screen.getByRole("button", { name: "重新播放" }));
    expect(screen.getByTestId("onboarding-relay-demo-slot")).toHaveAttribute("data-relay-run", "2");
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(screen.getByTestId("onboarding-step-4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "上一步" }));
    expect(screen.getByTestId("onboarding-relay-demo-slot")).toHaveAttribute("data-relay-run", "3");
    fireEvent.click(screen.getByRole("button", { name: "上一步" }));

    expect(screen.getByTestId("onboarding-step-2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /开发团队/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("opens the AI builder inline in step 2", () => {
    const onOpenTeamBuilder = vi.fn();
    renderShell({ onOpenTeamBuilder });

    expect(screen.getByTestId("onboarding-content-column")).toHaveClass("max-w-lg");
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(screen.getByTestId("open-onboarding-team-builder"));

    expect(screen.getByRole("heading", { name: "AI 团队设计器" })).toBeInTheDocument();
    expect(screen.getByText("仍在第 2 步")).toBeInTheDocument();
    expect(screen.getByLabelText("第 2 步，共 4 步")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-content-column")).toHaveClass("max-w-[780px]");
    expect(screen.getByTestId("team-builder-view")).toHaveClass(
      "h-[min(720px,calc(100dvh-220px))]",
    );
    expect(onOpenTeamBuilder).toHaveBeenCalledOnce();
  });

  it("finishes with the selected team key", async () => {
    const onComplete = vi.fn(async () => undefined);
    renderShell({ onComplete });

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /开发团队/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    ));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(screen.getByRole("button", { name: "开始使用" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith("system:development"));
  });

  it("keeps continue available when the selected team has no playable orchestration", async () => {
    renderShell({
      teamsState: {
        status: "ready",
        teams: [{
          ...developmentTeam,
          onboardingOrchestration: { status: "unavailable" },
        }],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /开发团队/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    ));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));

    expect(screen.getByText("暂无可播放的协作示例")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "继续" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(screen.getByTestId("onboarding-step-4")).toBeInTheDocument();
  });
});

function renderShell(overrides: Partial<OnboardingShellProps> = {}) {
  const props: OnboardingShellProps = {
    environment: { status: "ready", detail: "codex-cli 1.0" },
    teamsState: { status: "ready", teams: [developmentTeam] },
    teamBuilderState: {
      phase: "idle",
      messages: [{
        role: "assistant",
        text: "你希望这支团队长期替你完成什么工作？",
      }],
      proposal: null,
      proposalRevision: null,
      error: null,
    },
    onRecheckCodex: vi.fn(),
    onCopyInstallCommand: vi.fn(),
    onRetryTeams: vi.fn(),
    onOpenTeamBuilder: vi.fn(),
    onTeamBuilderSubmit: vi.fn(),
    onTeamBuilderAdjust: vi.fn(),
    onTeamBuilderRetry: vi.fn(),
    onTeamBuilderCommit: vi.fn(),
    onComplete: vi.fn(),
    ...overrides,
  };
  return render(<OnboardingShell {...props} />);
}
